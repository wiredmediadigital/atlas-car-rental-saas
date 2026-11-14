import { describe, expect, it } from 'vitest'

import { createRateState } from '../_shared/public-booking-rates.ts'
import {
  defaultWindow,
  isError,
  parseBookingQuery,
  parseRequestBody,
  serveBooking,
  serveRequest,
  windowProblem,
  type AgencyRow,
  type BookingDeps,
  type PublicBookingPage,
  type VehicleRow,
} from '../_shared/public-booking.ts'

const NOW = Date.parse('2027-02-01T12:00:00Z')
const FROM = '2027-03-01T09:00:00.000Z'
const TO = '2027-03-05T09:00:00.000Z'

const AGENCY: AgencyRow = {
  organization_id: 'org-1',
  name: 'Atlas Cars',
  logo_path: 'logos/atlas.png',
  phone: '+33 1 23 45 67 89',
  time_zone: 'Europe/Paris',
  default_currency: 'EUR',
  accepts_requests: true,
}

const VEHICLE: VehicleRow = {
  vehicle_id: 'veh-1',
  make: 'Renault',
  model: 'Clio',
  model_year: 2024,
  category: 'Compact',
  transmission: 'manual',
  fuel_type: 'petrol',
  seats: 5,
  doors: 5,
  image_path: 'fleet/clio.jpg',
  currency: 'EUR',
  daily_rate_minor: 4500,
  billable_days: 4,
  quoted_total_minor: 18000,
  is_available: true,
}

function depsFor(
  overrides: Partial<BookingDeps> = {},
): BookingDeps & { logs: string[]; created: unknown[] } {
  const logs: string[] = []
  const created: unknown[] = []
  return {
    findAgency: () => Promise.resolve(AGENCY),
    listVehicles: () => Promise.resolve([VEHICLE]),
    createLead: (input) => {
      created.push(input)
      return Promise.resolve({ leadId: 'lead-1', reference: 'REQ-ABCD2345' })
    },
    signImages: ({ logo, photos }) =>
      Promise.resolve(
        new Map(
          [...(logo === null ? [] : [logo]), ...photos].map((path) => [
            path,
            `https://signed.test/${path}`,
          ]),
        ),
      ),
    now: () => NOW,
    rate: createRateState(),
    address: '203.0.113.7',
    log: (message: string) => logs.push(message),
    logs,
    created,
    ...overrides,
  }
}

const submission = (overrides: Record<string, unknown> = {}) => ({
  slug: 'atlas-cars',
  vehicleId: 'veh-1',
  from: FROM,
  to: TO,
  fullName: 'Grace Hopper',
  email: 'grace@example.test',
  phone: null,
  note: null,
  honeypot: null,
  startedAt: NOW - 30_000,
  ...overrides,
})

const query = (search: string) => new URL(`https://edge.test/public-booking${search}`)

describe('reading the query', () => {
  it('accepts a slug with no window', () => {
    expect(parseBookingQuery(query('?slug=atlas-cars'))).toEqual({
      slug: 'atlas-cars',
      from: null,
      to: null,
    })
  })

  it('treats a malformed or missing slug as a page that is not there', () => {
    for (const search of ['', '?slug=', '?slug=Not A Slug', '?slug=-leading']) {
      const parsed = parseBookingQuery(query(search))
      expect(isError(parsed) && parsed.status).toBe(404)
    }
  })

  it('refuses a window it cannot read', () => {
    const parsed = parseBookingQuery(query('?slug=atlas-cars&from=yesterday&to=tomorrow'))
    expect(isError(parsed) && parsed.status).toBe(400)
  })
})

describe('the window rules', () => {
  it('refuses a window whose return is before its pick-up', () => {
    expect(windowProblem(TO, FROM, NOW)).not.toBeNull()
  })

  it('refuses a window starting in the past', () => {
    expect(windowProblem('2026-01-01T09:00:00Z', '2026-01-05T09:00:00Z', NOW)).not.toBeNull()
  })

  it('refuses a window longer than the maximum', () => {
    expect(windowProblem(FROM, '2029-03-01T09:00:00Z', NOW)).not.toBeNull()
  })

  it('forgives a start a few hours into the past', () => {
    // A visitor whose clock or time zone puts this morning behind them.
    expect(windowProblem(new Date(NOW - 3_600_000).toISOString(), TO, NOW)).toBeNull()
  })

  it('accepts an ordinary window', () => {
    expect(windowProblem(FROM, TO, NOW)).toBeNull()
  })
})

describe('the default window', () => {
  it('starts tomorrow morning in the agency time zone, not the server one', () => {
    const paris = defaultWindow('Europe/Paris', NOW)
    const auckland = defaultWindow('Pacific/Auckland', NOW)
    expect(paris.from).not.toBe(auckland.from)

    const shown = (iso: string, timeZone: string) =>
      new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hour12: false }).format(
        new Date(iso),
      )
    expect(shown(paris.from, 'Europe/Paris')).toBe('10')
    expect(shown(auckland.from, 'Pacific/Auckland')).toBe('10')
  })

  it('offers a window this product will quote', () => {
    expect(
      windowProblem(
        ...(Object.values(defaultWindow('Europe/Paris', NOW)) as [string, string]),
        NOW,
      ),
    ).toBeNull()
  })
})

describe('serving the page', () => {
  it('answers with the agency, the window and the fleet', async () => {
    const decision = await serveBooking(depsFor(), { slug: 'atlas-cars', from: FROM, to: TO })
    expect(decision.status).toBe(200)
    const body = decision.body as PublicBookingPage
    expect(body.agency).toMatchObject({ name: 'Atlas Cars', acceptsRequests: true })
    expect(body.window).toEqual({ from: FROM, to: TO })
    expect(body.vehicles).toHaveLength(1)
    expect(body.vehicles[0]).toMatchObject({ id: 'veh-1', isAvailable: true })
  })

  it('answers 404 identically for an unknown slug and a switched-off agency', async () => {
    // The database cannot tell them apart either, and that is the point: this
    // page must not be usable to discover who is a customer of Pevvy.
    const missing = await serveBooking(depsFor({ findAgency: () => Promise.resolve(null) }), {
      slug: 'no-such-agency',
      from: FROM,
      to: TO,
    })
    const switchedOff = await serveBooking(depsFor({ findAgency: () => Promise.resolve(null) }), {
      slug: 'atlas-cars',
      from: FROM,
      to: TO,
    })
    expect(missing.status).toBe(404)
    expect(JSON.stringify(missing.body)).toBe(JSON.stringify(switchedOff.body))
  })

  it('omits any count of unavailable vehicles from the body', async () => {
    const deps = depsFor({
      listVehicles: () =>
        Promise.resolve([VEHICLE, { ...VEHICLE, vehicle_id: 'veh-2', is_available: false }]),
    })
    const decision = await serveBooking(deps, { slug: 'atlas-cars', from: FROM, to: TO })
    const body = decision.body as Record<string, unknown>
    // How busy an agency is on a weekend is theirs. A list is not a report.
    for (const key of ['total', 'totals', 'available', 'availableCount', 'unavailable', 'count']) {
      expect(Object.keys(body)).not.toContain(key)
    }
    expect(JSON.stringify(body)).not.toMatch(/"(total|count|available)Count"/)
  })

  it('uses the default window when the visitor has not chosen', async () => {
    const decision = await serveBooking(depsFor(), { slug: 'atlas-cars', from: null, to: null })
    const body = decision.body as PublicBookingPage
    expect(body.window).toEqual(defaultWindow('Europe/Paris', NOW))
  })

  it('signs the logo and the photographs', async () => {
    const decision = await serveBooking(depsFor(), { slug: 'atlas-cars', from: FROM, to: TO })
    const body = decision.body as PublicBookingPage
    expect(body.agency.logoUrl).toBe('https://signed.test/logos/atlas.png')
    expect(body.vehicles[0]!.imageUrl).toBe('https://signed.test/fleet/clio.jpg')
  })

  it('still serves the fleet when signing the images fails', async () => {
    const deps = depsFor({ signImages: () => Promise.reject(new Error('storage down')) })
    const decision = await serveBooking(deps, { slug: 'atlas-cars', from: FROM, to: TO })
    const body = decision.body as PublicBookingPage
    expect(decision.status).toBe(200)
    expect(body.vehicles).toHaveLength(1)
    expect(body.vehicles[0]!.imageUrl).toBeNull()
  })

  it('answers 503 without explaining when the read itself fails', async () => {
    const deps = depsFor({ findAgency: () => Promise.reject(new Error('relation does not exist')) })
    const decision = await serveBooking(deps, { slug: 'atlas-cars', from: FROM, to: TO })
    expect(decision.status).toBe(503)
    expect(JSON.stringify(decision.body)).not.toMatch(/relation/)
    expect(deps.logs.join(' ')).toMatch(/relation/)
  })
})

describe('reading a submission', () => {
  it('keeps what a person typed and trims it', () => {
    const parsed = parseRequestBody({
      slug: 'Atlas-Cars',
      vehicleId: 'veh-1',
      from: FROM,
      to: TO,
      fullName: '  Grace Hopper  ',
      email: ' grace@example.test ',
      phone: '  ',
      note: '  Arriving late.  ',
      company: '',
      startedAt: NOW,
    })
    expect(isError(parsed)).toBe(false)
    if (!isError(parsed)) {
      expect(parsed).toMatchObject({
        slug: 'atlas-cars',
        fullName: 'Grace Hopper',
        email: 'grace@example.test',
        phone: null,
        note: 'Arriving late.',
      })
    }
  })

  it('refuses a body that is not an object, a missing field, or an impossible address', () => {
    for (const raw of [
      null,
      'nonsense',
      { ...submission(), fullName: '   ' },
      { ...submission(), email: 'not-an-address' },
      { ...submission(), vehicleId: '' },
    ]) {
      const parsed = parseRequestBody(raw)
      expect(isError(parsed)).toBe(true)
    }
  })

  it('refuses a note or a name longer than the column will take', () => {
    expect(isError(parseRequestBody({ ...submission(), fullName: 'a'.repeat(121) }))).toBe(true)
    expect(isError(parseRequestBody({ ...submission(), note: 'a'.repeat(2001) }))).toBe(true)
  })
})

describe('serving a submission', () => {
  it('creates the lead and answers with its reference', async () => {
    const deps = depsFor()
    const decision = await serveRequest(deps, submission())
    expect(decision.status).toBe(201)
    expect(decision.body).toEqual({ reference: 'REQ-ABCD2345' })
    expect(deps.created).toHaveLength(1)
  })

  it('rejects a submission whose honeypot is filled, without touching the database', async () => {
    const deps = depsFor()
    const decision = await serveRequest(deps, submission({ honeypot: 'Acme Ltd' }))
    expect(decision.status).toBe(400)
    expect(deps.created).toHaveLength(0)
    // Logged with its reason, answered without one.
    expect(deps.logs.join(' ')).toMatch(/honeypot/)
    expect(JSON.stringify(decision.body)).not.toMatch(/honeypot/)
  })

  it('rejects a submission faster than the minimum time on form', async () => {
    const deps = depsFor()
    const decision = await serveRequest(deps, submission({ startedAt: NOW - 100 }))
    expect(decision.status).toBe(400)
    expect(deps.created).toHaveLength(0)
  })

  it('rate limits by email address and by IP independently', async () => {
    const shared = createRateState()
    const send = (email: string, address: string) =>
      serveRequest(depsFor({ rate: shared, address }), submission({ email }))

    // Five from one address: the sixth is refused on the email rule.
    for (let attempt = 0; attempt < 5; attempt += 1)
      await send('grace@example.test', '198.51.100.1')
    const sameEmail = await send('grace@example.test', '198.51.100.1')
    expect(sameEmail.status).toBe(429)

    // A different person on a different address is unaffected.
    const other = await send('ada@example.test', '198.51.100.2')
    expect(other.status).toBe(201)

    // And twenty from one address refuses the twenty-first whoever sends it.
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await send(`person${attempt}@example.test`, '203.0.113.9')
    }
    const sameAddress = await send('fresh@example.test', '203.0.113.9')
    expect(sameAddress.status).toBe(429)
  })

  it('refuses when the agency is not taking requests', async () => {
    const deps = depsFor({
      findAgency: () => Promise.resolve({ ...AGENCY, accepts_requests: false }),
    })
    const decision = await serveRequest(deps, submission())
    expect(decision.status).toBe(409)
    expect(deps.created).toHaveLength(0)
  })

  it('answers 404 for a page that is not there', async () => {
    const deps = depsFor({ findAgency: () => Promise.resolve(null) })
    expect((await serveRequest(deps, submission())).status).toBe(404)
  })

  it('never lets the database explain itself to the browser', async () => {
    // The refusals name whether an agency stopped paying and whether a car was
    // withdrawn. That is the agency's business, not the visitor's.
    const deps = depsFor({
      createLead: () =>
        Promise.reject(
          new Error('This agency has no active subscription, so its records are read-only.'),
        ),
    })
    const decision = await serveRequest(deps, submission())
    expect(decision.status).toBe(409)
    expect(JSON.stringify(decision.body)).not.toMatch(/subscription|read-only/i)
    expect(deps.logs.join(' ')).toMatch(/subscription/)
  })

  it('refuses a window the write would refuse, before asking it to', async () => {
    const deps = depsFor()
    const decision = await serveRequest(deps, submission({ from: TO, to: FROM }))
    expect(decision.status).toBe(400)
    expect(deps.created).toHaveLength(0)
  })
})

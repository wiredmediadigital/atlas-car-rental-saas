// @vitest-environment node
/**
 * app.public_booking_create_lead — the one write a stranger can cause.
 *
 * Everything the renter sends is a parameter; nothing the renter sends is
 * trusted. The price is read from the vehicle inside the function, the agency
 * and vehicle are re-checked at the moment of the write rather than at the
 * moment the page was built, and the result is a lead in `new` holding no car.
 *
 * Granted to service_role alone: the caller is the public-booking Edge
 * Function, and the browser never reaches this.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { TestDatabase, signUp } from './support/harness'

let db: TestDatabase
let organizationId: string
let ownerId: string
let vehicleId: string
let seq = 0

const FROM = '2027-03-01T09:00:00Z'
const TO = '2027-03-05T09:00:00Z'

type Created = { lead_id: string; reference: string }

type LeadRow = {
  status: string
  reference: string
  vehicle_id: string
  full_name: string
  email: string
  phone: string | null
  note: string | null
  currency: string
  daily_rate_minor: string | number
  billable_days: number
  quoted_total_minor: string | number
}

/** As the Edge Function calls it: the service role. */
function request(
  overrides: Partial<{
    organizationId: string
    vehicleId: string
    from: string
    to: string
    fullName: string
    email: string
    phone: string | null
    note: string | null
  }> = {},
): Promise<Created[]> {
  const args = {
    organizationId,
    vehicleId,
    from: FROM,
    to: TO,
    fullName: 'Renter Person',
    email: 'renter@example.test',
    phone: '+33 1 23 45 67 89',
    note: 'Is a child seat available?',
    ...overrides,
  }
  return db.asServiceRole(ownerId, (session) =>
    session.sql<Created>(
      `select * from app.public_booking_create_lead($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        args.organizationId,
        args.vehicleId,
        args.from,
        args.to,
        args.fullName,
        args.email,
        args.phone,
        args.note,
      ],
    ),
  )
}

async function leads(): Promise<LeadRow[]> {
  return db.sql<LeadRow>(
    `select status, reference, vehicle_id, full_name, email, phone, note,
            currency, daily_rate_minor, billable_days, quoted_total_minor
       from public.booking_leads where organization_id = $1 order by created_at`,
    [organizationId],
  )
}

async function createVehicle(
  plate: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const values: Record<string, unknown> = {
    organization_id: organizationId,
    make: 'Renault',
    model: 'Clio',
    registration_plate: plate,
    currency: 'EUR',
    daily_rate_minor: 4500,
    public_booking_enabled: true,
    ...overrides,
  }
  const columns = Object.keys(values)
  const [row] = await db.sql<{ id: string }>(
    `insert into public.vehicles (${columns.join(', ')})
     values (${columns.map((_, index) => `$${index + 1}`).join(', ')}) returning id`,
    Object.values(values),
  )
  return row!.id
}

beforeAll(async () => {
  db = await TestDatabase.create()
})

afterAll(async () => {
  await db.close()
})

beforeEach(async () => {
  seq += 1
  const owner = await signUp(db, {
    email: `owner${seq}@request.test`,
    organizationName: `Request ${seq}`,
    currency: 'EUR',
    timeZone: 'Europe/Paris',
  })
  if (!owner.organizationId) throw new Error('provisioning failed')
  organizationId = owner.organizationId
  ownerId = owner.userId
  await db.sql(`update public.organizations set public_booking_enabled = true where id = $1`, [
    organizationId,
  ])
  vehicleId = await createVehicle(`REQ-${seq}`)
})

describe('a request that should succeed', () => {
  it('creates a lead whose status is new', async () => {
    const [created] = await request()
    expect(created!.lead_id).toBeTruthy()
    expect(created!.reference).toMatch(/^REQ-[0-9A-HJKMNP-TV-Z]{8}$/)

    const [lead] = await leads()
    expect(lead).toMatchObject({
      status: 'new',
      reference: created!.reference,
      vehicle_id: vehicleId,
      full_name: 'Renter Person',
      email: 'renter@example.test',
    })
  })

  it('takes the price from the vehicle, never from the caller', async () => {
    // The function has no price parameters at all, which is the point: there is
    // no field a forged request could put a rate in.
    const [created] = await request()
    expect(created).toBeTruthy()
    const [lead] = await leads()
    const [expected] = await db.sql<{ days: number }>(
      `select public.rental_billable_days($1, $2) as days`,
      [FROM, TO],
    )
    expect(lead!.currency).toBe('EUR')
    expect(Number(lead!.daily_rate_minor)).toBe(4500)
    expect(lead!.billable_days).toBe(expected!.days)
    expect(Number(lead!.quoted_total_minor)).toBe(4500 * expected!.days)
  })

  it('tidies what the renter typed and keeps an empty note out', async () => {
    await request({ fullName: '  Renter Person  ', phone: '   ', note: '   ' })
    const [lead] = await leads()
    expect(lead!.full_name).toBe('Renter Person')
    expect(lead!.phone).toBeNull()
    expect(lead!.note).toBeNull()
  })

  it('gives each request its own reference', async () => {
    // Two DIFFERENT requests. Sending the identical one twice is a double
    // click, and is answered with the first reference on purpose -- see the
    // duplicate tests at the end of this file.
    const [first] = await request()
    const [second] = await request({ email: 'another.person@example.test' })
    expect(second!.reference).not.toBe(first!.reference)
  })

  it('leaves the vehicle available to the next visitor', async () => {
    // A request holds nothing. The car stays on offer until staff convert the
    // lead into a rental, which is the only thing that takes a vehicle.
    await request()
    const rows = await db.asServiceRole(ownerId, (session) =>
      session.sql<{ vehicle_id: string; is_available: boolean }>(
        `select vehicle_id, is_available from app.public_booking_vehicles($1, $2, $3)`,
        [organizationId, FROM, TO],
      ),
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]!.is_available).toBe(true)
  })
})

describe('a vehicle that is no longer on offer', () => {
  it('refuses a vehicle that is not opted in', async () => {
    const privateCar = await createVehicle(`PRV-${seq}`, { public_booking_enabled: false })
    await db.expectRejection(() => request({ vehicleId: privateCar }), /no longer available/i)
    expect(await leads()).toHaveLength(0)
  })

  it('refuses a vehicle that was opted out after the page loaded', async () => {
    await db.sql(`update public.vehicles set public_booking_enabled = false where id = $1`, [
      vehicleId,
    ])
    await db.expectRejection(() => request(), /no longer available/i)
    expect(await leads()).toHaveLength(0)
  })

  it('refuses a vehicle that was deleted after the page loaded', async () => {
    await db.sql(`delete from public.vehicles where id = $1`, [vehicleId])
    await db.expectRejection(() => request(), /no longer available/i)
    expect(await leads()).toHaveLength(0)
  })

  it('refuses a vehicle that was archived, which is how a sold car leaves', async () => {
    await db.sql(`update public.vehicles set archived_at = now() where id = $1`, [vehicleId])
    await db.expectRejection(() => request(), /no longer available/i)
    expect(await leads()).toHaveLength(0)
  })

  it('refuses a vehicle belonging to another agency', async () => {
    const other = await signUp(db, {
      email: `rival${seq}@request.test`,
      organizationName: `Rival ${seq}`,
      currency: 'EUR',
    })
    const [theirs] = await db.sql<{ id: string }>(
      `insert into public.vehicles
         (organization_id, make, model, registration_plate, currency, public_booking_enabled)
       values ($1, 'Renault', 'Clio', $2, 'EUR', true) returning id`,
      [other.organizationId, `OTH-${seq}`],
    )
    await db.expectRejection(() => request({ vehicleId: theirs!.id }), /no longer available/i)
    expect(await leads()).toHaveLength(0)
  })
})

describe('an agency that is not taking requests', () => {
  it('refuses once the master switch is off', async () => {
    await db.sql(`update public.organizations set public_booking_enabled = false where id = $1`, [
      organizationId,
    ])
    await db.expectRejection(() => request(), /not accepting booking requests/i)
    expect(await leads()).toHaveLength(0)
  })

  it('refuses once closure has been requested', async () => {
    await db.sql(
      `update public.organizations
          set closure_requested_at = now(),
              closure_purge_after = now() + interval '30 days'
        where id = $1`,
      [organizationId],
    )
    await db.expectRejection(() => request(), /not accepting booking requests/i)
    expect(await leads()).toHaveLength(0)
  })

  it('refuses when the agency is billing-restricted, with 42501', async () => {
    await db.sql(`select app.billing_report_platform_state(true, 'test', 'Configured.')`)
    await db.sql(`select app.billing_replace_catalogue($1::jsonb)`, [
      JSON.stringify([
        {
          plan_key: 'pro_monthly',
          display_name: 'Pro',
          stripe_price_id: 'price_test_pro_monthly',
          currency: 'EUR',
          amount_minor: 4900,
          interval: 'month',
          interval_count: 1,
          mode: 'test',
          sort_order: 0,
        },
      ]),
    ])
    try {
      let code: string | undefined
      try {
        await request()
      } catch (error) {
        code = (error as { code?: string }).code
      }
      expect(code).toBe('42501')
      expect(await leads()).toHaveLength(0)
    } finally {
      await db.sql(`select app.billing_replace_catalogue('[]'::jsonb)`)
      await db.sql(`select app.billing_report_platform_state(false, 'test', 'Not configured.')`)
    }
  })
})

describe('dates and details the database will not accept', () => {
  it('refuses a period that ends before it starts', async () => {
    await db.expectRejection(() => request({ from: TO, to: FROM }), /must end after it starts/i)
    expect(await leads()).toHaveLength(0)
  })

  it('refuses a period that started well before today', async () => {
    await db.expectRejection(
      () => request({ from: '2020-01-01T09:00:00Z', to: '2020-01-05T09:00:00Z' }),
      /cannot start in the past/i,
    )
    expect(await leads()).toHaveLength(0)
  })

  it('refuses a hire of implausible length', async () => {
    await db.expectRejection(
      () => request({ from: FROM, to: '2031-03-01T09:00:00Z' }),
      /more than 370 days/i,
    )
    expect(await leads()).toHaveLength(0)
  })

  it('refuses a malformed email address', async () => {
    await db.expectRejection(() => request({ email: 'not-an-address' }), /email_address|violates/i)
    expect(await leads()).toHaveLength(0)
  })

  it('refuses an empty name', async () => {
    await db.expectRejection(() => request({ fullName: '   ' }), /needs a name/i)
    expect(await leads()).toHaveLength(0)
  })
})

describe('who may call it', () => {
  it('is unreachable by anon and by a signed-in member', async () => {
    const statement = `select * from app.public_booking_create_lead(
      '00000000-0000-0000-0000-000000000000'::uuid,
      '00000000-0000-0000-0000-000000000000'::uuid,
      now() + interval '1 day', now() + interval '2 days',
      'A Name', 'someone@example.test', null, null)`
    await db.expectRejection(
      () => db.asAnon((session) => session.sql(statement)),
      /permission denied/i,
    )
    await db.expectRejection(
      () => db.asUser(ownerId, (session) => session.sql(statement)),
      /permission denied/i,
    )
  })
})

describe('the same request twice', () => {
  /*
   * A double click, a flaky connection retried, a browser that resubmits on
   * back -- all of them send the identical payload again within seconds. The
   * second one answers with the first one's reference and writes nothing, so
   * the renter sees the success they expected and staff see one enquiry.
   *
   * ANSWERING RATHER THAN REFUSING IS THE POINT. A refusal would show an error
   * to somebody who did nothing wrong, and would tempt them to try again.
   */
  it('answers the first reference and creates no second lead', async () => {
    const [first] = await request()
    const [second] = await request()
    expect(second!.reference).toBe(first!.reference)
    expect(second!.lead_id).toBe(first!.lead_id)
    expect(await leads()).toHaveLength(1)
  })

  it('ignores the case of the address, as a mail server would', async () => {
    const [first] = await request({ email: 'Grace@Example.test' })
    const [second] = await request({ email: 'grace@example.test' })
    expect(second!.reference).toBe(first!.reference)
    expect(await leads()).toHaveLength(1)
  })

  it('does not collapse a different car, a different window or a different person', async () => {
    await request()
    const other = await createVehicle(`TWO-${seq}`)
    await request({ vehicleId: other })
    await request({ from: '2027-04-01T09:00:00Z', to: '2027-04-05T09:00:00Z' })
    await request({ email: 'someone.else@example.test' })
    expect(await leads()).toHaveLength(4)
  })

  it('takes a repeat as a new enquiry once staff have worked the first', async () => {
    // Contacted, declined or converted: the agency has already acted, so the
    // same person asking again is saying something new, not clicking twice.
    const [first] = await request()
    await db.sql(`update public.booking_leads set status = 'contacted' where id = $1`, [
      first!.lead_id,
    ])
    const [second] = await request()
    expect(second!.reference).not.toBe(first!.reference)
    expect(await leads()).toHaveLength(2)
  })

  it('takes a repeat as a new enquiry once the window has passed', async () => {
    const [first] = await request()
    await db.sql(
      `update public.booking_leads set created_at = now() - interval '2 hours' where id = $1`,
      [first!.lead_id],
    )
    const [second] = await request()
    expect(second!.reference).not.toBe(first!.reference)
    expect(await leads()).toHaveLength(2)
  })

  it('notifies once, not twice', async () => {
    // The notification hangs off the insert, so suppressing the duplicate
    // suppresses the second notification without the trigger knowing.
    await request()
    await request()
    const [row] = await db.sql<{ n: number }>(
      `select count(*)::int as n from public.notification_events
        where organization_id = $1 and kind = 'booking_lead_received'`,
      [organizationId],
    )
    expect(row!.n).toBe(1)
  })
})

describe('the same request at the same instant', () => {
  /*
   * The duplicate rule above reads for an existing lead and then inserts if it
   * found none, and the double click it exists for is exactly what slips
   * between the two: both submissions read, both find nothing, both insert.
   *
   * A single-connection PGlite cannot open the two transactions that race, so
   * what is asserted is the property that makes them safe -- the lock is taken
   * before the check. Checking the body rather than the behaviour is
   * deliberate: without it, somebody tidying this function later drops a
   * `perform` that looks decorative and nothing anywhere fails.
   */
  const source = async (): Promise<string> => {
    const [row] = await db.sql<{ src: string }>(
      `select pg_get_functiondef(
         'app.public_booking_create_lead(uuid, uuid, timestamptz, timestamptz,
                                         text, text, text, text)'::regprocedure) as src`,
    )
    return row!.src.toLowerCase()
  }

  it('takes a lock on the request before looking for its twin', async () => {
    const src = await source()
    expect(src).toContain('pg_advisory_xact_lock')
    expect(src.indexOf('pg_advisory_xact_lock')).toBeLessThan(
      src.indexOf('from public.booking_leads l'),
    )
  })

  it('keys the lock on what makes two requests identical, and nothing wider', async () => {
    // A key any wider would make unrelated visitors queue behind each other,
    // which is the per-agency ceiling 20261113100800 refused as weaponisable.
    const src = await source()
    for (const part of ['p_organization_id', 'p_vehicle_id', 'p_from', 'p_to', 'lower(v_email)']) {
      expect(src).toContain(part)
    }
  })
})

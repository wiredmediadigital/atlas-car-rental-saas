// @vitest-environment node
/**
 * What a visitor who is not signed in is allowed to learn about an agency and
 * its fleet.
 *
 * These are the only two reads behind the public booking page. They are
 * SECURITY DEFINER and granted to `service_role` alone: the browser never calls
 * them, the Edge Function does. Two things are therefore load-bearing in every
 * test here — the projection is narrow (no plate, no VIN, no odometer, no
 * compliance dates, no customer and no rental), and a page that should not
 * exist answers with no rows rather than with an error that confirms the agency
 * is real.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { TestDatabase, signUp } from './support/harness'

let db: TestDatabase
let organizationId: string
let ownerId: string
let slug: string
let seq = 0

const FROM = '2026-12-01T09:00:00Z'
const TO = '2026-12-05T09:00:00Z'

type AgencyRow = {
  organization_id: string
  name: string
  logo_path: string | null
  phone: string | null
  time_zone: string
  default_currency: string
  accepts_requests: boolean
}

type VehicleRow = {
  vehicle_id: string
  make: string
  model: string
  model_year: number | null
  category: string | null
  transmission: string | null
  fuel_type: string | null
  seats: number | null
  doors: number | null
  image_path: string | null
  currency: string
  daily_rate_minor: string | number
  billable_days: number
  quoted_total_minor: string | number
  is_available: boolean
}

/** As the Edge Function calls it: the service role, with no user at all. */
function asServer<T>(run: (session: TestDatabase) => Promise<T>): Promise<T> {
  return db.asServiceRole(ownerId, run)
}

function agency(forSlug = slug): Promise<AgencyRow[]> {
  return asServer((session) =>
    session.sql<AgencyRow>(`select * from app.public_booking_agency($1)`, [forSlug]),
  )
}

function fleet(from = FROM, to = TO, organization = organizationId): Promise<VehicleRow[]> {
  return asServer((session) =>
    session.sql<VehicleRow>(`select * from app.public_booking_vehicles($1, $2, $3)`, [
      organization,
      from,
      to,
    ]),
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

async function openTheDoor(): Promise<void> {
  await db.sql(`update public.organizations set public_booking_enabled = true where id = $1`, [
    organizationId,
  ])
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
    email: `owner${seq}@reads.test`,
    organizationName: `Reads ${seq}`,
    currency: 'EUR',
    timeZone: 'Europe/Paris',
  })
  if (!owner.organizationId) throw new Error('provisioning failed')
  organizationId = owner.organizationId
  ownerId = owner.userId
  const [row] = await db.sql<{ slug: string }>(
    `select slug from public.organizations where id = $1`,
    [organizationId],
  )
  slug = row!.slug
})

describe('the agency behind a slug', () => {
  it('answers for an agency that has turned the page on', async () => {
    await openTheDoor()
    const [row] = await agency()
    expect(row).toMatchObject({
      organization_id: organizationId,
      time_zone: 'Europe/Paris',
      default_currency: 'EUR',
      accepts_requests: true,
    })
  })

  it('returns nothing for a slug that does not exist', async () => {
    expect(await agency('no-such-agency')).toHaveLength(0)
  })

  it('returns nothing when the master switch is off', async () => {
    // Indistinguishable from the slug that does not exist: same zero rows, same
    // absence of an error. A visitor cannot use this page to discover who is a
    // customer of Pevvy.
    expect(await agency()).toHaveLength(0)
  })

  it('returns nothing once closure has been requested', async () => {
    await openTheDoor()
    await db.sql(
      `update public.organizations
          set closure_requested_at = now(),
              closure_purge_after = now() + interval '30 days'
        where id = $1`,
      [organizationId],
    )
    expect(await agency()).toHaveLength(0)
  })

  it('tells only what the page has to render', async () => {
    await openTheDoor()
    const [row] = await agency()
    expect(Object.keys(row!).sort()).toEqual(
      [
        'accepts_requests',
        'default_currency',
        'logo_path',
        'name',
        'organization_id',
        'phone',
        'time_zone',
      ].sort(),
    )
  })

  it('still answers for a billing-restricted agency, but takes no requests', async () => {
    await openTheDoor()
    // "Configured" is credentials AND something to sell (app.billing_platform_configured).
    // Configured with nothing bought is the restricted state.
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
      const [row] = await agency()
      expect(row!.accepts_requests).toBe(false)
    } finally {
      await db.sql(`select app.billing_replace_catalogue('[]'::jsonb)`)
      await db.sql(`select app.billing_report_platform_state(false, 'test', 'Not configured.')`)
    }
  })
})

describe('the fleet for a date range', () => {
  beforeEach(openTheDoor)

  it('lists opted-in vehicles only', async () => {
    const offered = await createVehicle(`IN-${seq}`)
    await createVehicle(`OUT-${seq}`, { public_booking_enabled: false })
    const rows = await fleet()
    expect(rows.map((row) => row.vehicle_id)).toEqual([offered])
  })

  it('leaves out an archived vehicle entirely', async () => {
    await createVehicle(`ARC-${seq}`, { archived_at: new Date().toISOString() })
    expect(await fleet()).toHaveLength(0)
  })

  it('marks a vehicle in maintenance exactly as it marks a booked one', async () => {
    const free = await createVehicle(`FREE-${seq}`)
    const servicing = await createVehicle(`MNT-${seq}`, { status: 'maintenance' })
    const booked = await createVehicle(`BKD-${seq}`)

    const [customer] = await db.sql<{ id: string }>(
      `insert into public.customers (organization_id, first_name, last_name)
       values ($1, 'Booked', 'Already') returning id`,
      [organizationId],
    )
    await db.sql(
      `insert into public.rentals
         (organization_id, vehicle_id, customer_id, starts_at, ends_at, currency, status)
       values ($1, $2, $3, $4, $5, 'EUR', 'reserved')`,
      [organizationId, booked, customer!.id, FROM, TO],
    )

    const rows = await fleet()
    const byId = new Map(rows.map((row) => [row.vehicle_id, row]))
    expect(byId.get(free)!.is_available).toBe(true)
    expect(byId.get(servicing)!.is_available).toBe(false)
    expect(byId.get(booked)!.is_available).toBe(false)

    // And nothing in the row says which of the two reasons it was.
    const { vehicle_id: _s, ...servicingRest } = byId.get(servicing)!
    const { vehicle_id: _b, ...bookedRest } = byId.get(booked)!
    expect(servicingRest).toEqual(bookedRest)
  })

  it('quotes the vehicle rate times the days the rental will charge', async () => {
    await createVehicle(`QTE-${seq}`, { daily_rate_minor: 4500 })
    const [row] = await fleet()
    const [expected] = await db.sql<{ days: number }>(
      `select public.rental_billable_days($1, $2) as days`,
      [FROM, TO],
    )
    expect(row!.billable_days).toBe(expected!.days)
    expect(Number(row!.quoted_total_minor)).toBe(4500 * expected!.days)
  })

  it('counts the same days for an agency on the other side of the date line', async () => {
    // The quote a stranger is shown must be the quote the rental computes at
    // conversion. public.rental_billable_days counts elapsed 24-hour days on
    // purpose (20260815100200), so the agency's zone cannot move the total --
    // if it could, every lead crossing a date boundary would drift in price
    // between the page and the conversion dialog.
    await db.sql(`update public.organizations set time_zone = 'Pacific/Auckland' where id = $1`, [
      organizationId,
    ])
    await createVehicle(`NZ-${seq}`, { daily_rate_minor: 4500 })
    const spansMidnightUtc = ['2026-12-01T20:00:00Z', '2026-12-04T20:00:00Z']
    const [row] = await fleet(spansMidnightUtc[0], spansMidnightUtc[1])
    const [expected] = await db.sql<{ days: number }>(
      `select public.rental_billable_days($1, $2) as days`,
      spansMidnightUtc,
    )
    expect(row!.billable_days).toBe(expected!.days)
    expect(Number(row!.quoted_total_minor)).toBe(4500 * expected!.days)
  })

  it('carries the primary photograph and no other', async () => {
    const vehicleId = await createVehicle(`PIC-${seq}`)
    for (const [path, isPrimary] of [
      ['fleet/second.jpg', false],
      ['fleet/leading.jpg', true],
    ] as const) {
      await db.sql(
        `insert into public.vehicle_images
           (organization_id, vehicle_id, storage_path, content_type, byte_size, is_primary)
         values ($1, $2, $3, 'image/jpeg', 2048, $4)`,
        [organizationId, vehicleId, path, isPrimary],
      )
    }
    const [row] = await fleet()
    expect(row!.image_path).toBe('fleet/leading.jpg')
  })

  it('tells only what the page has to render', async () => {
    await createVehicle(`NAR-${seq}`, { vin: 'VF1234567890', odometer: 91000 })
    const [row] = await fleet()
    expect(Object.keys(row!).sort()).toEqual(
      [
        'billable_days',
        'category',
        'currency',
        'daily_rate_minor',
        'doors',
        'fuel_type',
        'image_path',
        'is_available',
        'make',
        'model',
        'model_year',
        'quoted_total_minor',
        'seats',
        'transmission',
        'vehicle_id',
      ].sort(),
    )
  })

  it('answers with no rows once the master switch goes off', async () => {
    // Not a trusted-caller function: the submit path carries an organization id
    // the browser sent back, so the switch is re-asked here rather than assumed
    // to have been asked during slug resolution.
    await createVehicle(`OFF-${seq}`)
    expect(await fleet()).toHaveLength(1)
    await db.sql(`update public.organizations set public_booking_enabled = false where id = $1`, [
      organizationId,
    ])
    expect(await fleet()).toHaveLength(0)
  })

  it('answers with no rows once closure has been requested', async () => {
    await createVehicle(`CLO-${seq}`)
    await db.sql(
      `update public.organizations
          set closure_requested_at = now(),
              closure_purge_after = now() + interval '30 days'
        where id = $1`,
      [organizationId],
    )
    expect(await fleet()).toHaveLength(0)
  })

  it('still lists the fleet for a billing-restricted agency', async () => {
    // The page keeps its cars and its prices; it loses the form, not the fleet.
    await createVehicle(`RES-${seq}`)
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
      expect(await fleet()).toHaveLength(1)
    } finally {
      await db.sql(`select app.billing_replace_catalogue('[]'::jsonb)`)
      await db.sql(`select app.billing_report_platform_state(false, 'test', 'Not configured.')`)
    }
  })

  it('refuses a period that ends before it starts', async () => {
    await createVehicle(`BAD-${seq}`)
    await db.expectRejection(() => fleet(TO, FROM))
  })
})

describe('who may call these at all', () => {
  it('is unreachable by anon', async () => {
    for (const statement of [
      `select * from app.public_booking_agency('anything')`,
      `select * from app.public_booking_vehicles('00000000-0000-0000-0000-000000000000', now(), now() + interval '1 day')`,
    ]) {
      await db.expectRejection(
        () => db.asAnon((session) => session.sql(statement)),
        /permission denied/i,
      )
    }
  })

  it('is unreachable by a signed-in member too', async () => {
    // The product reads its own fleet through its own RLS-protected tables.
    // These exist for the one caller that holds the service key.
    await db.expectRejection(
      () =>
        db.asUser(ownerId, (session) =>
          session.sql(`select * from app.public_booking_agency($1)`, [slug]),
        ),
      /permission denied/i,
    )
  })
})

describe('the membership gate on the fleet read it shares', () => {
  it('still refuses public.vehicles_available_between to a non-member', async () => {
    const outsider = await signUp(db, { email: `outsider${seq}@reads.test` })
    await db.expectRejection(
      () =>
        db.asUser(outsider.userId, (session) =>
          session.sql(`select * from public.vehicles_available_between($1, $2, $3)`, [
            organizationId,
            FROM,
            TO,
          ]),
        ),
      /not a member/i,
    )
  })
})

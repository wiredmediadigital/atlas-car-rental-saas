// @vitest-environment node
/**
 * public.convert_booking_lead — the button that turns an enquiry into business.
 *
 * One transaction produces a customer, a reserved rental and a lead marked
 * converted, or it produces none of them. Two things decide the shape of this
 * function: a lead holds no vehicle, so the car may have gone between the
 * request and the click; and staff may click twice.
 *
 * It runs as the signed-in member, so it is behind app.has_min_role and
 * therefore behind the second factor, like every other privileged write here.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { TestDatabase, addMember, signUp } from './support/harness'

let db: TestDatabase
let organizationId: string
let ownerId: string
let staffId: string
let vehicleId: string
let leadId: string
let seq = 0

const FROM = '2027-04-01T09:00:00Z'
const TO = '2027-04-05T09:00:00Z'

type Converted = { customer_id: string; rental_id: string }

function convert(
  userId: string = staffId,
  lead: string = leadId,
  overrides: Record<string, unknown> | null = null,
  claims: { aal?: 'aal1' | 'aal2' } = {},
): Promise<Converted[]> {
  return db.asUser(
    userId,
    (session) =>
      session.sql<Converted>(
        `select * from public.convert_booking_lead($1, coalesce($2::jsonb, '{}'::jsonb))`,
        [lead, overrides === null ? null : JSON.stringify(overrides)],
      ),
    claims,
  )
}

async function createVehicle(plate: string, rate = 4500): Promise<string> {
  const [row] = await db.sql<{ id: string }>(
    `insert into public.vehicles
       (organization_id, make, model, registration_plate, currency, daily_rate_minor,
        public_booking_enabled)
     values ($1, 'Renault', 'Clio', $2, 'EUR', $3, true) returning id`,
    [organizationId, plate, rate],
  )
  return row!.id
}

async function createLead(vehicle: string = vehicleId): Promise<string> {
  const [row] = await db.asServiceRole(ownerId, (session) =>
    session.sql<{ lead_id: string }>(
      `select lead_id from app.public_booking_create_lead($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        organizationId,
        vehicle,
        FROM,
        TO,
        'Grace Hopper',
        'grace@example.test',
        '+33 1 98 76 54 32',
        'Arriving on the evening train.',
      ],
    ),
  )
  return row!.lead_id
}

async function lead(id: string = leadId) {
  const [row] = await db.sql<{
    status: string
    converted_customer_id: string | null
    converted_rental_id: string | null
    daily_rate_minor: string | number
    quoted_total_minor: string | number
  }>(
    `select status, converted_customer_id, converted_rental_id,
            daily_rate_minor, quoted_total_minor
       from public.booking_leads where id = $1`,
    [id],
  )
  return row!
}

async function rentalsFor(vehicle: string = vehicleId) {
  return db.sql<{
    id: string
    customer_id: string
    status: string
    starts_at: string
    currency: string
    daily_rate_minor: string | number
    billable_days: number
    subtotal_minor: string | number
    total_minor: string | number
    reference: string
  }>(
    `select id, customer_id, status, starts_at, currency, daily_rate_minor, billable_days,
            subtotal_minor, total_minor, reference
       from public.rentals where vehicle_id = $1 order by created_at`,
    [vehicle],
  )
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
    email: `owner${seq}@convert.test`,
    organizationName: `Convert ${seq}`,
    currency: 'EUR',
    timeZone: 'Europe/Paris',
  })
  if (!owner.organizationId) throw new Error('provisioning failed')
  organizationId = owner.organizationId
  ownerId = owner.userId
  const staff = await signUp(db, { email: `staff${seq}@convert.test` })
  staffId = staff.userId
  await addMember(db, organizationId, staffId, 'staff')
  await db.sql(`update public.organizations set public_booking_enabled = true where id = $1`, [
    organizationId,
  ])
  vehicleId = await createVehicle(`CNV-${seq}`)
  leadId = await createLead()
})

describe('a conversion that should succeed', () => {
  it('creates one customer and one rental', async () => {
    const [result] = await convert()
    expect(result!.customer_id).toBeTruthy()
    expect(result!.rental_id).toBeTruthy()

    const rentals = await rentalsFor()
    expect(rentals).toHaveLength(1)
    expect(rentals[0]).toMatchObject({
      id: result!.rental_id,
      customer_id: result!.customer_id,
      // Reserved, not draft: a draft holds no vehicle, and the point of
      // converting is that the car stops being on offer.
      status: 'reserved',
    })
    expect(rentals[0]!.reference).toBeTruthy()
  })

  it('carries the renter across to the customer record', async () => {
    const [result] = await convert()
    const [customer] = await db.sql<{
      display_name: string
      first_name: string
      last_name: string
      email: string
      phone: string
    }>(
      `select display_name, first_name, last_name, email, phone
         from public.customers where id = $1`,
      [result!.customer_id],
    )
    expect(customer).toMatchObject({
      first_name: 'Grace',
      last_name: 'Hopper',
      email: 'grace@example.test',
    })
    expect(customer!.display_name).toBe('Grace Hopper')
  })

  it('lets staff correct what the renter typed', async () => {
    const [result] = await convert(staffId, leadId, {
      first_name: 'Grace',
      last_name: 'Hopper-Murray',
      phone: '+33 6 00 00 00 00',
    })
    const [customer] = await db.sql<{ display_name: string; phone: string; email: string }>(
      `select display_name, phone, email from public.customers where id = $1`,
      [result!.customer_id],
    )
    expect(customer!.display_name).toBe('Grace Hopper-Murray')
    expect(customer!.phone).toBe('+33 6 00 00 00 00')
    // Not overridden, so it still comes from the request.
    expect(customer!.email).toBe('grace@example.test')
  })

  it('marks the lead converted and names both records', async () => {
    const [result] = await convert()
    const row = await lead()
    expect(row).toMatchObject({
      status: 'converted',
      converted_customer_id: result!.customer_id,
      converted_rental_id: result!.rental_id,
    })
  })

  it('attaches the customer as the primary driver', async () => {
    const [result] = await convert()
    const drivers = await db.sql<{ customer_id: string; driver_role: string }>(
      `select customer_id, driver_role from public.rental_drivers where rental_id = $1`,
      [result!.rental_id],
    )
    expect(drivers).toEqual([{ customer_id: result!.customer_id, driver_role: 'primary' }])
  })

  it('derives the rental total from a base charge line, not from the snapshot', async () => {
    await convert()
    const [rental] = await rentalsFor()
    const lines = await db.sql<{ kind: string; amount_minor: string | number }>(
      `select kind, amount_minor from public.rental_line_items where rental_id = $1`,
      [rental!.id],
    )
    expect(lines).toHaveLength(1)
    expect(lines[0]!.kind).toBe('base_rental')
    expect(Number(rental!.subtotal_minor)).toBe(Number(lines[0]!.amount_minor))
    expect(Number(rental!.total_minor)).toBe(Number(rental!.subtotal_minor))
  })
})

describe('the price at conversion', () => {
  it('prices the rental from the vehicle now, not from the snapshot', async () => {
    await db.sql(`update public.vehicles set daily_rate_minor = 6000 where id = $1`, [vehicleId])
    await convert()
    const [rental] = await rentalsFor()
    const [days] = await db.sql<{ days: number }>(
      `select public.rental_billable_days($1, $2) as days`,
      [FROM, TO],
    )
    expect(Number(rental!.daily_rate_minor)).toBe(6000)
    expect(Number(rental!.total_minor)).toBe(6000 * days!.days)

    // And the lead keeps what it quoted, so the two can be compared.
    const row = await lead()
    expect(Number(row.daily_rate_minor)).toBe(4500)
    expect(Number(row.quoted_total_minor)).toBe(4500 * days!.days)
  })
})

describe('what conversion refuses', () => {
  it('refuses a lead that is already converted', async () => {
    await convert()
    await db.expectRejection(() => convert(), /already/i)
    expect(await rentalsFor()).toHaveLength(1)
  })

  it('refuses when the vehicle is no longer free for those dates', async () => {
    const [customer] = await db.sql<{ id: string }>(
      `insert into public.customers (organization_id, first_name, last_name)
       values ($1, 'Someone', 'Else') returning id`,
      [organizationId],
    )
    await db.sql(
      `insert into public.rentals
         (organization_id, vehicle_id, customer_id, starts_at, ends_at, currency, status)
       values ($1, $2, $3, $4, $5, 'EUR', 'reserved')`,
      [organizationId, vehicleId, customer!.id, FROM, TO],
    )

    await db.expectRejection(() => convert(), /no longer free|not free|overlap/i)

    // Nothing half-built: the competing rental is the only one, and no customer
    // was minted for a conversion that did not happen.
    expect(await rentalsFor()).toHaveLength(1)
    const names = await db.sql<{ display_name: string }>(
      `select display_name from public.customers where organization_id = $1`,
      [organizationId],
    )
    expect(names.map((row) => row.display_name)).toEqual(['Someone Else'])
    expect((await lead()).status).toBe('new')
  })

  it('refuses a lead whose vehicle has been archived', async () => {
    await db.sql(`update public.vehicles set archived_at = now() where id = $1`, [vehicleId])
    await db.expectRejection(() => convert(), /no longer in the fleet/i)
    expect(await rentalsFor()).toHaveLength(0)
  })

  it('is refused at aal1', async () => {
    // The same sentence a stranger gets: a lead you may not act on is a lead
    // that does not exist, and the refusal says nothing more.
    await db.expectRejection(
      () => convert(staffId, leadId, null, { aal: 'aal1' }),
      /could not be found/i,
    )
    expect(await rentalsFor()).toHaveLength(0)
    expect((await lead()).status).toBe('new')
  })

  it('is refused to another agency, which cannot even see the lead', async () => {
    const rival = await signUp(db, {
      email: `rival${seq}@convert.test`,
      organizationName: `Rival ${seq}`,
      currency: 'EUR',
    })
    await db.expectRejection(() => convert(rival.userId), /could not be found/i)
    expect(await rentalsFor()).toHaveLength(0)
  })

  it('refuses while the agency is billing-restricted', async () => {
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
        await convert()
      } catch (error) {
        code = (error as { code?: string }).code
      }
      expect(code).toBe('42501')
      expect(await rentalsFor()).toHaveLength(0)
    } finally {
      await db.sql(`select app.billing_replace_catalogue('[]'::jsonb)`)
      await db.sql(`select app.billing_report_platform_state(false, 'test', 'Not configured.')`)
    }
  })
})

describe('a vehicle withdrawn from the public page', () => {
  it('can still be converted, because the enquiry already happened', async () => {
    // Opting a car out stops it being offered; it does not cancel the requests
    // an agency already received for it.
    await db.sql(`update public.vehicles set public_booking_enabled = false where id = $1`, [
      vehicleId,
    ])
    const [result] = await convert()
    expect(result!.rental_id).toBeTruthy()
  })
})

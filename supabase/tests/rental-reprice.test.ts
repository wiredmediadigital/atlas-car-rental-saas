// @vitest-environment node
/**
 * Repricing a booking after its car or its dates change.
 *
 * The rule these pin: changing the dates or the vehicle NEVER rewrites what a
 * customer was quoted, and repricing is a separate act somebody performs with
 * both figures in front of them. What changed is that the booking no longer
 * carries a day rate belonging to a car it does not involve.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { TestDatabase, signUp } from './support/harness'

let db: TestDatabase
let organizationId: string
let ownerId: string
let customerId: string
let vehicleId: string
let rentalId: string
let seq = 0

const FROM = '2027-07-01T09:00:00Z'
const THREE_DAYS = '2027-07-04T09:00:00Z'
const TWO_DAYS = '2027-07-03T09:00:00Z'

const PREMIUM_RATE = 9000
const SMALL_RATE = 4000

async function createVehicle(plate: string, rate: number, currency = 'EUR'): Promise<string> {
  const [row] = await db.sql<{ id: string }>(
    `insert into public.vehicles
       (organization_id, make, model, registration_plate, currency, daily_rate_minor)
     values ($1, 'Renault', 'Clio', $2, $3, $4) returning id`,
    [organizationId, plate, currency, rate],
  )
  return row!.id
}

/** The charge lines, in the order the product reads them. */
async function lines() {
  return db.sql<{
    kind: string
    description: string
    quantity: string
    amount_minor: string
    sort_order: number
  }>(
    `select kind, description, quantity, amount_minor, sort_order
       from public.rental_line_items where rental_id = $1
      order by sort_order, created_at`,
    [rentalId],
  )
}

async function rental() {
  const [row] = await db.sql<{
    vehicle_id: string
    daily_rate_minor: string
    billable_days: number
    subtotal_minor: string
    total_minor: string
    currency: string
  }>(
    `select vehicle_id, daily_rate_minor, billable_days, subtotal_minor, total_minor, currency
       from public.rentals where id = $1`,
    [rentalId],
  )
  return row!
}

const reprice = (userId = ownerId) =>
  db.asUser(userId, (session) => session.sql(`select public.rental_reprice($1)`, [rentalId]))

const substitute = (vehicle: string, userId = ownerId) =>
  db.asUser(userId, (session) =>
    session.sql(`select public.rental_substitute_vehicle($1, $2)`, [rentalId, vehicle]),
  )

beforeAll(async () => {
  db = await TestDatabase.create()
})

afterAll(async () => {
  await db.close()
})

beforeEach(async () => {
  seq += 1
  const owner = await signUp(db, {
    email: `owner${seq}@reprice.test`,
    organizationName: `Reprice ${seq}`,
    currency: 'EUR',
  })
  if (!owner.organizationId) throw new Error('provisioning failed')
  organizationId = owner.organizationId
  ownerId = owner.userId

  const [customer] = await db.sql<{ id: string }>(
    `insert into public.customers (organization_id, first_name, last_name)
     values ($1, 'Pat', 'Renter') returning id`,
    [organizationId],
  )
  customerId = customer!.id
  vehicleId = await createVehicle(`PRM-${seq}`, PREMIUM_RATE)

  // A three-day reservation, priced the way the product prices one.
  const [created] = await db.sql<{ id: string }>(
    `insert into public.rentals
       (organization_id, vehicle_id, customer_id, starts_at, ends_at, currency,
        daily_rate_minor, billable_days, status)
     values ($1, $2, $3, $4, $5, 'EUR', $6, 3, 'reserved') returning id`,
    [organizationId, vehicleId, customerId, FROM, THREE_DAYS, PREMIUM_RATE],
  )
  rentalId = created!.id

  await db.sql(
    `insert into public.rental_line_items
       (organization_id, rental_id, kind, description, quantity, unit_amount_minor,
        amount_minor, currency, sort_order)
     values ($1, $2, 'base_rental', '3 day hire', 3, $3, $4, 'EUR', 0)`,
    [organizationId, rentalId, PREMIUM_RATE, PREMIUM_RATE * 3],
  )
})

describe('what still does not reprice on its own', () => {
  it('leaves the charge alone when the dates shorten', async () => {
    // The rule the original author wrote down: a booking nudged on a calendar
    // does not rewrite what somebody was quoted.
    await db.asUser(ownerId, (session) =>
      session.sql(`select public.rental_reschedule($1, $2, $3)`, [rentalId, FROM, TWO_DAYS]),
    )
    const after = await rental()
    expect(after.billable_days).toBe(2)
    expect(Number((await lines())[0]!.amount_minor)).toBe(PREMIUM_RATE * 3)
  })

  it('leaves the charge alone when the car changes', async () => {
    const small = await createVehicle(`SML-${seq}`, SMALL_RATE)
    await substitute(small)
    expect(Number((await lines())[0]!.amount_minor)).toBe(PREMIUM_RATE * 3)
  })
})

describe('substituting a vehicle', () => {
  it('carries the new car day rate onto the booking', async () => {
    // The column was simply wrong before: it held a rate belonging to a car
    // the booking no longer involved.
    const small = await createVehicle(`SML-${seq}`, SMALL_RATE)
    await substitute(small)
    const after = await rental()
    expect(after.vehicle_id).toBe(small)
    expect(Number(after.daily_rate_minor)).toBe(SMALL_RATE)
  })

  it('refuses a car priced in another currency', async () => {
    // A rental is denominated in one currency, and this product holds no
    // exchange rate to invent one with.
    const foreign = await createVehicle(`USD-${seq}`, SMALL_RATE, 'USD')
    const message = await db.expectRejection(() => substitute(foreign), /priced in/i)
    expect(message).toMatch(/USD/)
    expect((await rental()).vehicle_id).toBe(vehicleId)
  })
})

describe('repricing', () => {
  it('rewrites the base charge from the rate and the days the booking carries', async () => {
    const small = await createVehicle(`SML-${seq}`, SMALL_RATE)
    await substitute(small)
    await db.asUser(ownerId, (session) =>
      session.sql(`select public.rental_reschedule($1, $2, $3)`, [rentalId, FROM, TWO_DAYS]),
    )

    await reprice()

    const [base] = await lines()
    expect(Number(base!.amount_minor)).toBe(SMALL_RATE * 2)
    expect(Number(base!.quantity)).toBe(2)
    expect(base!.description).toBe('2 day hire')
  })

  it('moves the totals with it', async () => {
    // Totals are derived from the lines; nothing here writes them.
    await db.asUser(ownerId, (session) =>
      session.sql(`select public.rental_reschedule($1, $2, $3)`, [rentalId, FROM, TWO_DAYS]),
    )
    await reprice()
    const after = await rental()
    expect(Number(after.subtotal_minor)).toBe(PREMIUM_RATE * 2)
    expect(Number(after.total_minor)).toBe(PREMIUM_RATE * 2)
  })

  it('leaves an extension, an extra and a discount alone', async () => {
    /*
     * An extension is a separate base_rental line by design, so that the extra
     * days and their charge are one record. Repricing the booking must not
     * swallow something somebody negotiated after it.
     */
    await db.sql(
      `insert into public.rental_line_items
         (organization_id, rental_id, kind, description, quantity, unit_amount_minor,
          amount_minor, currency, sort_order)
       values
         ($1, $2, 'base_rental', 'Extension — 1 day', 1, 9000, 9000, 'EUR', 1),
         ($1, $2, 'child_seat', 'Child seat', 1, 1500, 1500, 'EUR', 2),
         ($1, $2, 'discount', 'Goodwill', 1, -500, -500, 'EUR', 3)`,
      [organizationId, rentalId],
    )

    await db.asUser(ownerId, (session) =>
      session.sql(`select public.rental_reschedule($1, $2, $3)`, [rentalId, FROM, TWO_DAYS]),
    )
    await reprice()

    const after = await lines()
    expect(Number(after[0]!.amount_minor)).toBe(PREMIUM_RATE * 2)
    expect(after.map((line) => line.description)).toEqual([
      '2 day hire',
      'Extension — 1 day',
      'Child seat',
      'Goodwill',
    ])
    expect(Number(after[1]!.amount_minor)).toBe(9000)
    expect(Number(after[3]!.amount_minor)).toBe(-500)
  })

  it('gives a booking with no base charge one', async () => {
    await db.sql(`delete from public.rental_line_items where rental_id = $1`, [rentalId])
    await reprice()
    const after = await lines()
    expect(after).toHaveLength(1)
    expect(Number(after[0]!.amount_minor)).toBe(PREMIUM_RATE * 3)
  })

  it('refuses once the customer has collected the car', async () => {
    // What they were charged is a fact by then, not a plan.
    await db.sql(
      `update public.rentals
          set status = 'active', picked_up_at = now(), pickup_odometer = 100
        where id = $1`,
      [rentalId],
    )
    await db.expectRejection(() => reprice(), /draft or a confirmed reservation/i)
  })

  it('is refused to another agency', async () => {
    const outsider = await signUp(db, { email: `outsider${seq}@reprice.test` })
    await db.expectRejection(() => reprice(outsider.userId), /not found/i)
  })

  it('is refused at aal1', async () => {
    const refused = await db
      .asUser(ownerId, (session) => session.sql(`select public.rental_reprice($1)`, [rentalId]), {
        aal: 'aal1',
      })
      .catch((error: Error) => error.message)
    expect(typeof refused).toBe('string')
    expect(Number((await lines())[0]!.amount_minor)).toBe(PREMIUM_RATE * 3)
  })
})

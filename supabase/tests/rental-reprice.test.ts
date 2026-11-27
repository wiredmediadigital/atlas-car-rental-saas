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
    unit_amount_minor: string
    amount_minor: string
    sort_order: number
  }>(
    `select kind, description, quantity, unit_amount_minor, amount_minor, sort_order
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
    /*
     * Two days booked, one of them already charged by the extension, so the
     * base line covers one. Two days are charged in total -- which is the
     * point. Asserting two days in the BASE line, as this once did, is
     * asserting the double charge.
     */
    expect(Number(after[0]!.amount_minor)).toBe(PREMIUM_RATE)
    expect(after.map((line) => line.description)).toEqual([
      '1 day hire',
      'Extension — 1 day',
      'Child seat',
      'Goodwill',
    ])
    expect(Number(after[0]!.amount_minor) + Number(after[1]!.amount_minor)).toBe(PREMIUM_RATE * 2)
    expect(Number(after[1]!.amount_minor)).toBe(9000)
    expect(Number(after[3]!.amount_minor)).toBe(-500)
  })

  it('gives a booking with no base charge one', async () => {
    /*
     * A booking that never had a base charge, built as a draft rather than by
     * deleting from under a committed one. Posted charges stopped being
     * destructible in 20261126130000, and a fixture that reached around that
     * guard would be asserting against a database no deployment will have.
     * Repricing accepts a draft or a confirmed reservation alike, so the
     * behaviour under test is unchanged.
     */
    const bare = await createVehicle('BARE-0001', PREMIUM_RATE)
    const [created] = await db.sql<{ id: string }>(
      `insert into public.rentals
         (organization_id, vehicle_id, customer_id, starts_at, ends_at, currency,
          daily_rate_minor, billable_days, status)
       values ($1, $2, $3, $4, $5, 'EUR', $6, 3, 'draft') returning id`,
      [organizationId, bare, customerId, FROM, THREE_DAYS, PREMIUM_RATE],
    )
    rentalId = created!.id
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

describe('extending a hire', () => {
  /** Extends the way the product does, through the function the dialog calls. */
  const extend = async (days: number, chargeMinor: number) => {
    const [row] = await db.sql<{ ends_at: string }>(
      `select ends_at from public.rentals where id = $1`,
      [rentalId],
    )
    const newEnd = new Date(new Date(row!.ends_at).getTime() + days * 86_400_000).toISOString()
    await db.asUser(ownerId, (session) =>
      session.sql(`select public.rental_extend($1, $2, $3, $4, $5)`, [
        rentalId,
        newEnd,
        chargeMinor,
        `Extension — ${days} day`,
        days,
      ]),
    )
  }

  it('lengthens the hire line rather than adding a second one', async () => {
    /*
     * A separate extension line reads well on a booking that only grows, and
     * stops reading at all once anybody moves the dates: a nine day hire
     * extended twice and rescheduled to three showed "7 day hire" with two
     * extensions attached, on a contract whose own header said three days.
     */
    await extend(1, PREMIUM_RATE)

    const after = await lines()
    expect(after).toHaveLength(1)
    expect(after[0]!.description).toBe('4 day hire')
    expect(Number(after[0]!.amount_minor)).toBe(PREMIUM_RATE * 4)
    expect(Number(after[0]!.quantity)).toBe(4)
    expect((await rental()).billable_days).toBe(4)
  })

  it('charges the extended days once', async () => {
    await extend(1, PREMIUM_RATE)
    expect(Number((await rental()).subtotal_minor)).toBe(PREMIUM_RATE * 4)
  })

  it('needs no repricing afterwards, and reprices to the same figure', async () => {
    // The hire line already says what the dates say, so the warning stays
    // quiet; pressing the button anyway must not move the money.
    await extend(1, PREMIUM_RATE)
    await reprice()
    const after = await lines()
    expect(after).toHaveLength(1)
    expect(Number(after[0]!.amount_minor)).toBe(PREMIUM_RATE * 4)
  })

  it('reprices the whole hire when the car changes', async () => {
    // Four days at the new rate, which is what the booking now is.
    await extend(1, PREMIUM_RATE)
    const small = await createVehicle(`SML-${seq}`, SMALL_RATE)
    await substitute(small)
    await reprice()

    const after = await lines()
    expect(after).toHaveLength(1)
    expect(Number(after[0]!.amount_minor)).toBe(SMALL_RATE * 4)
  })

  it('folds a negotiated extension into the hire and blends the day rate', async () => {
    /*
     * The trade this makes, stated as a test. Two extra days agreed at $15
     * rather than the $90 rate: the amount is kept exactly, added to the hire,
     * and the per-day figure becomes the blend. What is lost is the itemised
     * record of what those two days cost -- and repricing afterwards would
     * normalise them to the day rate, because a single line cannot hold two
     * prices.
     */
    await extend(2, 1500)
    const [hire] = await lines()
    expect(Number(hire!.amount_minor)).toBe(PREMIUM_RATE * 3 + 1500)
    expect(Number(hire!.quantity)).toBe(5)
    expect(Number(hire!.unit_amount_minor)).toBe(Math.round((PREMIUM_RATE * 3 + 1500) / 5))
  })

  it('counts the days itself when the caller does not say', async () => {
    // The calendar extends without a day count. Before, billable_days was left
    // behind and the booking reported fewer days than it held the car for.
    const [row] = await db.sql<{ ends_at: string }>(
      `select ends_at from public.rentals where id = $1`,
      [rentalId],
    )
    const newEnd = new Date(new Date(row!.ends_at).getTime() + 2 * 86_400_000).toISOString()
    await db.asUser(ownerId, (session) =>
      session.sql(`select public.rental_extend($1, $2, 0)`, [rentalId, newEnd]),
    )
    expect((await rental()).billable_days).toBe(5)
  })
})

describe('a booking carrying an extension line from before the change', () => {
  /*
   * Lines written by the old rental_extend are left where they are, so an
   * older contract keeps totalling correctly. rental_reprice still discounts
   * the days a later base_rental line charges for; a new booking simply never
   * grows one for it to find.
   */
  const legacyExtension = (days: number, amountMinor: number) =>
    db.sql(
      `insert into public.rental_line_items
         (organization_id, rental_id, kind, description, quantity, unit_amount_minor,
          amount_minor, currency, sort_order)
       values ($1, $2, 'base_rental', $3, $4, $5, $6, 'EUR', 1)`,
      [organizationId, rentalId, `Extension — ${days} day`, days, amountMinor / days, amountMinor],
    )

  it('leaves its days to it when repricing', async () => {
    await legacyExtension(1, PREMIUM_RATE)
    await db.sql(`update public.rentals set billable_days = 4 where id = $1`, [rentalId])

    await reprice()

    const after = await lines()
    expect(after[0]!.description).toBe('3 day hire')
    expect(Number(after[0]!.amount_minor)).toBe(PREMIUM_RATE * 3)
    expect(Number(after[1]!.amount_minor)).toBe(PREMIUM_RATE)
  })

  it('refuses when those lines already cover the whole hire', async () => {
    await legacyExtension(4, PREMIUM_RATE * 4)
    await db.sql(`update public.rentals set billable_days = 4 where id = $1`, [rentalId])
    await db.expectRejection(() => reprice(), /already cover/i)
  })
})

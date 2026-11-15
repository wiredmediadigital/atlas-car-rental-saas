// @vitest-environment node
/**
 * Money held for a customer rather than for a booking.
 *
 * `payments.rental_id` was nullable from the first migration and nothing ever
 * wrote a row there, so an overpayment could only ever leave the till. These
 * assert the three operations that make a credit usable instead of a trap:
 * taking it, spending it on a booking, and handing it back.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { TestDatabase, signUp } from './support/harness'

let db: TestDatabase
let organizationId: string
let ownerId: string
let vehicleId: string
let customerId: string

const DAY = 24 * 60 * 60 * 1000
let periodCursor = Date.UTC(2031, 0, 1, 9, 0, 0)

function nextPeriod(days = 3): { startsAt: string; endsAt: string } {
  const start = new Date(periodCursor)
  const end = new Date(periodCursor + days * DAY)
  periodCursor += (days + 5) * DAY
  return { startsAt: start.toISOString(), endsAt: end.toISOString() }
}

async function bookingOf(totalMinor: number, currency = 'EUR'): Promise<string> {
  const period = nextPeriod()
  const [row] = await db.sql<{ id: string }>(
    `insert into public.rentals
       (organization_id, vehicle_id, customer_id, starts_at, ends_at, currency, status,
        daily_rate_minor, billable_days)
     values ($1, $2, $3, $4::timestamptz, $5::timestamptz, $6, 'reserved', 10000, 3)
     returning id`,
    [organizationId, vehicleId, customerId, period.startsAt, period.endsAt, currency],
  )
  await db.sql(
    `insert into public.rental_line_items
       (organization_id, rental_id, kind, description, quantity, unit_amount_minor,
        amount_minor, currency)
     values ($1, $2, 'base_rental', '3 day hire', 1, $3, $3, $4)`,
    [organizationId, row!.id, totalMinor, currency],
  )
  return row!.id
}

const credit = (
  amountMinor: number,
  direction: 'inbound' | 'outbound' = 'inbound',
  currency = 'EUR',
) =>
  db.asUser(ownerId, (session) =>
    session.sql(`select public.customer_record_credit($1, $2, $3, $4)`, [
      customerId,
      amountMinor,
      currency,
      direction,
    ]),
  )

const apply = (rentalId: string, amountMinor: number) =>
  db.asUser(ownerId, (session) =>
    session.sql(`select public.customer_apply_credit($1, $2, $3)`, [
      customerId,
      rentalId,
      amountMinor,
    ]),
  )

async function balance(currency = 'EUR'): Promise<number> {
  const rows = await db.asUser(ownerId, (session) =>
    session.sql<{ currency: string; on_account_minor: number }>(
      `select * from public.customer_account_balance($1)`,
      [customerId],
    ),
  )
  return Number(rows.find((row) => row.currency === currency)?.on_account_minor ?? 0)
}

async function paidOn(rentalId: string): Promise<number> {
  const [row] = await db.sql<{ amount_paid_minor: number }>(
    `select amount_paid_minor from public.rentals where id = $1`,
    [rentalId],
  )
  return Number(row!.amount_paid_minor)
}

beforeAll(async () => {
  db = await TestDatabase.create()

  const owner = await signUp(db, {
    email: 'owner@credit.test',
    organizationName: 'Credit Cars',
    currency: 'EUR',
    timeZone: 'Europe/Lisbon',
  })
  if (!owner.organizationId) throw new Error('Provisioning failed')
  ownerId = owner.userId
  organizationId = owner.organizationId

  const [vehicle] = await db.sql<{ id: string }>(
    `insert into public.vehicles (organization_id, make, model, registration_plate, currency,
                                  daily_rate_minor)
     values ($1, 'Seat', 'Ibiza', 'CREDIT-1', 'EUR', 10000) returning id`,
    [organizationId],
  )
  vehicleId = vehicle!.id

  const [customer] = await db.sql<{ id: string }>(
    `insert into public.customers (organization_id, first_name, last_name)
     values ($1, 'Carla', 'Costa') returning id`,
    [organizationId],
  )
  customerId = customer!.id
})

afterAll(async () => {
  await db?.close()
})

describe('taking money onto the account', () => {
  it('holds it against nobody’s booking', async () => {
    await credit(7_000)

    expect(await balance()).toBe(7_000)
    const [row] = await db.sql<{ rental_id: string | null }>(
      `select rental_id from public.payments where customer_id = $1 and rental_id is null`,
      [customerId],
    )
    expect(row!.rental_id).toBeNull()
  })

  it('reports nothing for a currency it holds nothing in', async () => {
    expect(await balance('USD')).toBe(0)
  })

  it('refuses an amount that is not positive', async () => {
    await db.expectRejection(() => credit(0), /positive amount/i)
  })
})

describe('spending it on a booking', () => {
  it('moves it onto the contract and off the account', async () => {
    const id = await bookingOf(30_000)
    await apply(id, 5_000)

    expect(await paidOn(id)).toBe(5_000)
    expect(await balance()).toBe(2_000)
  })

  it('records it as two entries rather than moving one', async () => {
    /*
     * The money did arrive on the account on a day, and that is what the
     * receipt says. Re-pointing the original row would rewrite it, and could
     * not express a partial application at all.
     */
    const rows = await db.sql<{ count: number }>(
      `select count(*)::int as count from public.payments
        where customer_id = $1 and rental_id is null`,
      [customerId],
    )
    expect(Number(rows[0]!.count)).toBe(2)
  })

  it('refuses more than is held', async () => {
    const id = await bookingOf(30_000)
    await db.expectRejection(() => apply(id, 99_000), /only .* is held/i)
  })

  it('refuses a booking belonging to somebody else', async () => {
    const [other] = await db.sql<{ id: string }>(
      `insert into public.customers (organization_id, first_name, last_name)
       values ($1, 'Someone', 'Else') returning id`,
      [organizationId],
    )
    const period = nextPeriod()
    const [theirs] = await db.sql<{ id: string }>(
      `insert into public.rentals
         (organization_id, vehicle_id, customer_id, starts_at, ends_at, currency, status)
       values ($1, $2, $3, $4::timestamptz, $5::timestamptz, 'EUR', 'reserved')
       returning id`,
      [organizationId, vehicleId, other!.id, period.startsAt, period.endsAt],
    )

    await db.expectRejection(() => apply(theirs!.id, 1_000), /belongs to somebody else/i)
  })

  it('leaves the balance alone when the booking refuses the money', async () => {
    // A cancelled booking that charges nothing takes nothing, and the credit
    // has to be exactly where it was before the attempt.
    const id = await bookingOf(30_000)
    await db.asUser(ownerId, (session) =>
      session.sql(`select public.rental_cancel($1, 'called off')`, [id]),
    )

    const before = await balance()
    await db.expectRejection(() => apply(id, 1_000), /nothing is owed/i)
    expect(await balance()).toBe(before)
  })

  it('settles a cancellation fee out of the account', async () => {
    const id = await bookingOf(30_000)
    await db.asUser(ownerId, (session) =>
      session.sql(`select public.rental_cancel($1, 'called off', 1500)`, [id]),
    )

    await apply(id, 1_500)

    expect(await paidOn(id)).toBe(1_500)
  })
})

describe('handing it back', () => {
  it('pays out what is held', async () => {
    const before = await balance()
    expect(before).toBeGreaterThan(0)

    await credit(before, 'outbound')

    expect(await balance()).toBe(0)
  })

  it('refuses to pay out more than is held', async () => {
    await credit(2_000)
    await db.expectRejection(() => credit(5_000, 'outbound'), /only .* is held/i)
  })

  it('refuses to pay out a currency it holds nothing in', async () => {
    await db.expectRejection(() => credit(1_000, 'outbound', 'USD'), /nothing is held/i)
  })
})

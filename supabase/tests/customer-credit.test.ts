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

describe('keeping an overpayment instead of refunding it', () => {
  const moveToAccount = (rentalId: string, amountMinor: number) =>
    db.asUser(ownerId, (session) =>
      session.sql(`select public.rental_move_to_account($1, $2)`, [rentalId, amountMinor]),
    )

  /** Paid in full, then cancelled keeping a fee: the shape that started this. */
  async function overpaidCancellation(): Promise<string> {
    const id = await bookingOf(30_000)
    await db.sql(`select public.rental_record_payment($1, 30000, 'inbound', 'rental_charge')`, [id])
    await db.asUser(ownerId, (session) =>
      session.sql(`select public.rental_cancel($1, 'called off', 5000)`, [id]),
    )
    return id
  }

  it('takes it off the booking and puts it on the account in one go', async () => {
    const before = await balance()
    const id = await overpaidCancellation()

    await moveToAccount(id, 25_000)

    // The booking now holds exactly what it charges, and the account has
    // the rest. Nothing was invented and nothing went missing.
    expect(await paidOn(id)).toBe(5_000)
    expect(await balance()).toBe(before + 25_000)
  })

  it('stops the booking reporting a refund it is no longer holding', async () => {
    /*
     * The bug this closes. Taking money on account without taking it off the
     * booking left the booking still reporting it as refundable, and the
     * agency recording more received than the customer ever handed over.
     */
    const id = await overpaidCancellation()
    await moveToAccount(id, 25_000)

    const [row] = await db.asUser(ownerId, (session) =>
      session.sql<{ to_refund_minor: number }>(
        `select * from public.customer_financial_summary($1)`,
        [customerId],
      ),
    )
    expect(Number(row!.to_refund_minor)).toBe(0)
  })

  it('refuses more than the booking is holding over its charge', async () => {
    const id = await overpaidCancellation()
    await db.expectRejection(() => moveToAccount(id, 30_000), /only .* is held over/i)
  })

  it('refuses a booking holding nothing spare', async () => {
    const id = await bookingOf(30_000)
    await db.expectRejection(() => moveToAccount(id, 1_000), /not holding anything over/i)
  })

  it('says on both entries where the other one went', async () => {
    // No column joins a payment to its pair. Two notes that name each other
    // are what somebody with the customer on the phone actually reads.
    const id = await overpaidCancellation()
    await moveToAccount(id, 25_000)

    const rows = await db.asUser(ownerId, (session) =>
      session.sql<{ rental_id: string | null; notes: string | null }>(
        `select rental_id, notes from public.payments
          where notes is not null and (rental_id = $1 or rental_id is null)
          order by created_at desc limit 2`,
        [id],
      ),
    )

    expect(rows.some((row) => row.notes?.includes('Moved from'))).toBe(true)
    expect(rows.some((row) => row.notes?.includes('Moved to the customer'))).toBe(true)
  })
})

describe('two people spending the same balance', () => {
  /*
   * A single-connection PGlite cannot open two real transactions, so the race
   * itself cannot be run here -- scripts/live-smoke-test.mjs does that over
   * separate connections. What is asserted is the property that makes the
   * race safe: the customer row is locked before the balance is read, so a
   * second caller waits and then re-reads a balance that includes the first
   * caller's write.
   *
   * Checking the body rather than the behaviour is unusual and deliberate.
   * Without it, somebody tidying these functions later removes a `for update`
   * that looks decorative and nothing anywhere fails.
   */
  const bodyOf = async (signature: string): Promise<string> => {
    const [row] = await db.sql<{ src: string }>(
      `select pg_get_functiondef($1::regprocedure) as src`,
      [signature],
    )
    return row!.src.toLowerCase()
  }

  it('locks the customer before paying money out of the account', async () => {
    const src = await bodyOf(
      'public.customer_record_credit(uuid, bigint, public.currency_code,' +
        ' public.payment_direction, public.payment_method, timestamptz, text, text)',
    )
    expect(src).toMatch(/from public\.customers[\s\S]*?for update/)
  })

  it('locks the customer before spending the account on a booking', async () => {
    const src = await bodyOf('public.customer_apply_credit(uuid, uuid, bigint)')
    expect(src).toMatch(/from public\.customers[\s\S]*?for update/)
  })

  it('takes the customer before the rental, so the pair cannot deadlock', async () => {
    // Nothing in the schema takes these two the other way round. A later
    // function that needs both has to take them in this order.
    // The two locking statements, not the declare block above them -- which
    // names public.rentals first and says nothing about order.
    const src = await bodyOf('public.customer_apply_credit(uuid, uuid, bigint)')
    expect(src.indexOf('from public.customers')).toBeLessThan(src.indexOf('from public.rentals'))
  })

  it('still refuses to spend more than is held', async () => {
    // The lock must not have changed what the arithmetic says.
    await credit(3_000)
    const id = await bookingOf(30_000)
    await db.expectRejection(() => apply(id, 99_000), /only .* is held/i)
  })
})

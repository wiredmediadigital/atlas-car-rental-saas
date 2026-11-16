// @vitest-environment node
/**
 * What an agency keeps when a booking is called off.
 *
 * Cancelling used to leave the hire charges where they were, so a cancelled
 * booking carried a total nobody owed. These assert the two halves of the
 * replacement: cancelling settles the booking down to whatever is kept, and
 * the customer's account reports that fee as a charge rather than as money
 * waiting to be given back.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { TestDatabase, signUp } from './support/harness'

let db: TestDatabase
let organizationId: string
let ownerId: string
let vehicleId: string
let customerId: string

const DAY = 24 * 60 * 60 * 1000
let periodCursor = Date.UTC(2030, 0, 1, 9, 0, 0)

/** A fresh window each time, so the exclusion constraint never decides a test. */
function nextPeriod(days = 4): { startsAt: string; endsAt: string } {
  const start = new Date(periodCursor)
  const end = new Date(periodCursor + days * DAY)
  periodCursor += (days + 5) * DAY
  return { startsAt: start.toISOString(), endsAt: end.toISOString() }
}

async function createReservation(
  options: { taxRateBps?: number; depositMinor?: number } = {},
): Promise<string> {
  const period = nextPeriod()
  const [row] = await db.sql<{ id: string }>(
    `insert into public.rentals
       (organization_id, vehicle_id, customer_id, starts_at, ends_at, currency, status,
        deposit_minor, tax_rate_bps, daily_rate_minor, billable_days)
     values ($1, $2, $3, $4::timestamptz, $5::timestamptz, 'EUR', 'reserved',
             $6, $7, 10000, 4)
     returning id`,
    [
      organizationId,
      vehicleId,
      customerId,
      period.startsAt,
      period.endsAt,
      options.depositMinor ?? 0,
      options.taxRateBps ?? 0,
    ],
  )
  return row!.id
}

async function addLine(
  rentalId: string,
  values: { kind?: string; description?: string; amountMinor: number },
): Promise<void> {
  await db.sql(
    `insert into public.rental_line_items
       (organization_id, rental_id, kind, description, quantity, unit_amount_minor,
        amount_minor, currency)
     values ($1, $2, $3::public.rental_charge_kind, $4, 1, $5, $5, 'EUR')`,
    [
      organizationId,
      rentalId,
      values.kind ?? 'base_rental',
      values.description ?? '4 day hire',
      values.amountMinor,
    ],
  )
}

/** A booking with a hire charge on it, confirmed and ready to be called off. */
async function bookedAt(amountMinor: number, taxRateBps = 0): Promise<string> {
  const id = await createReservation({ taxRateBps })
  await addLine(id, { amountMinor })
  return id
}

const cancel = (rentalId: string, feeMinor?: number) =>
  db.asUser(ownerId, (session) =>
    feeMinor === undefined
      ? session.sql(`select public.rental_cancel($1, 'Flight cancelled')`, [rentalId])
      : session.sql(`select public.rental_cancel($1, 'Flight cancelled', $2)`, [
          rentalId,
          feeMinor,
        ]),
  )

const setFee = (rentalId: string, feeMinor: number) =>
  db.asUser(ownerId, (session) =>
    session.sql(`select public.rental_set_cancellation_fee($1, $2)`, [rentalId, feeMinor]),
  )

async function totals(rentalId: string) {
  const [row] = await db.sql<{
    status: string
    subtotal_minor: number
    extras_minor: number
    discount_minor: number
    tax_minor: number
    total_minor: number
  }>(
    `select status, subtotal_minor, extras_minor, discount_minor, tax_minor, total_minor
       from public.rentals where id = $1`,
    [rentalId],
  )
  return row!
}

async function lines(rentalId: string) {
  return db.sql<{
    kind: string
    description: string
    unit_amount_minor: number
    amount_minor: number
    is_taxable: boolean
  }>(
    `select kind, description, unit_amount_minor, amount_minor, is_taxable
       from public.rental_line_items where rental_id = $1 order by sort_order, created_at`,
    [rentalId],
  )
}

async function pay(rentalId: string, amountMinor: number): Promise<void> {
  await db.sql(`select public.rental_record_payment($1, $2, 'inbound', 'rental_charge')`, [
    rentalId,
    amountMinor,
  ])
}

beforeAll(async () => {
  db = await TestDatabase.create()

  const owner = await signUp(db, {
    email: 'owner@cancellation.test',
    organizationName: 'Cancellation Cars',
    currency: 'EUR',
    timeZone: 'Europe/Lisbon',
  })
  if (!owner.organizationId) throw new Error('Provisioning failed')
  ownerId = owner.userId
  organizationId = owner.organizationId

  const [vehicle] = await db.sql<{ id: string }>(
    `insert into public.vehicles (organization_id, make, model, registration_plate, currency,
                                  daily_rate_minor)
     values ($1, 'Dacia', 'Duster', 'CANCEL-1', 'EUR', 10000) returning id`,
    [organizationId],
  )
  vehicleId = vehicle!.id

  const [customer] = await db.sql<{ id: string }>(
    `insert into public.customers (organization_id, first_name, last_name)
     values ($1, 'Amina', 'Benali') returning id`,
    [organizationId],
  )
  customerId = customer!.id
})

afterAll(async () => {
  await db?.close()
})

describe('cancelling settles the booking', () => {
  it('charges the fee and nothing else', async () => {
    const id = await bookedAt(40_000)
    await cancel(id, 5_000)

    const after = await totals(id)
    expect(after.status).toBe('cancelled')
    expect(Number(after.total_minor)).toBe(5_000)
  })

  it('leaves the hire on the contract, saying what it now is', async () => {
    // Zeroed, not deleted: what was booked is still readable, and the amount
    // says the hire is not happening.
    const id = await bookedAt(40_000)
    await cancel(id, 5_000)

    const rows = await lines(id)
    expect(rows).toHaveLength(2)
    expect(rows[0]!.description).toBe('4 day hire')
    expect(Number(rows[0]!.amount_minor)).toBe(0)
    expect(Number(rows[0]!.unit_amount_minor)).toBe(0)
    expect(rows[1]!.description).toBe('Cancellation fee')
    expect(Number(rows[1]!.amount_minor)).toBe(5_000)
  })

  it('charges nothing when nothing is kept', async () => {
    const id = await bookedAt(40_000)
    await cancel(id)

    expect(Number((await totals(id)).total_minor)).toBe(0)
    expect(await lines(id)).toHaveLength(1)
  })

  it('removes a discount, which is the one line it cannot zero', async () => {
    /*
     * rental_line_items_discount_is_negative will not have a discount sitting
     * at nothing, and a negative line left behind has nothing to reduce --
     * which makes the recalculation refuse the contract as discounted below
     * zero. Cancelling a booking carrying a discount would have failed outright
     * either way.
     */
    const id = await bookedAt(40_000)
    await addLine(id, { kind: 'discount', description: 'Returning customer', amountMinor: -5_000 })

    await cancel(id, 5_000)

    const after = await totals(id)
    expect(Number(after.discount_minor)).toBe(0)
    expect(Number(after.total_minor)).toBe(5_000)
    expect((await lines(id)).map((row) => row.kind)).toEqual(['base_rental', 'cancellation_fee'])
  })

  it('keeps the fee out of the tax base unless the agency says otherwise', async () => {
    // What a cancellation fee is for tax differs by country. Charging tax
    // nobody owes is the worse mistake to make without asking.
    const id = await bookedAt(40_000, 2_000)
    await cancel(id, 5_000)

    const after = await totals(id)
    expect(Number(after.tax_minor)).toBe(0)
    expect(Number(after.total_minor)).toBe(5_000)
    expect((await lines(id))[1]!.is_taxable).toBe(false)
  })

  it('refuses a negative fee', async () => {
    const id = await bookedAt(40_000)
    await db.expectRejection(() => cancel(id, -100), /cannot be negative/i)
  })
})

describe('changing what is kept afterwards', () => {
  it('replaces the fee rather than adding a second one', async () => {
    const id = await bookedAt(40_000)
    await cancel(id, 5_000)

    await setFee(id, 7_500)

    const rows = await lines(id)
    expect(rows.filter((row) => row.kind === 'cancellation_fee')).toHaveLength(1)
    expect(Number((await totals(id)).total_minor)).toBe(7_500)
  })

  it('takes the fee away again', async () => {
    const id = await bookedAt(40_000)
    await cancel(id, 5_000)

    await setFee(id, 0)

    expect(await lines(id)).toHaveLength(1)
    expect(Number((await totals(id)).total_minor)).toBe(0)
  })

  it('settles a booking cancelled before any of this existed', async () => {
    /*
     * The migration rewrites nobody's records. An older cancelled booking
     * keeps the hire it was carrying until somebody settles it, and a fee of
     * nothing is how that is done.
     */
    const id = await bookedAt(40_000)
    await db.sql(
      `update public.rentals set status = 'cancelled', cancelled_at = now() where id = $1`,
      [id],
    )
    expect(Number((await totals(id)).total_minor)).toBe(40_000)

    await setFee(id, 0)

    expect(Number((await totals(id)).total_minor)).toBe(0)
  })

  it('refuses on a booking that was not cancelled', async () => {
    const id = await bookedAt(40_000)
    await db.expectRejection(() => setFee(id, 5_000), /only a cancelled booking/i)
  })
})

describe('the fee on the customer’s account', () => {
  /*
   * Its own customer, and absolute figures rather than deltas from a baseline.
   * The delta version hid what it was really asserting: when `paid` changed
   * meaning, three of these failed with numbers that could not be reasoned
   * about without replaying every booking the file had made.
   */
  let feeCustomer: string

  beforeAll(async () => {
    const [row] = await db.sql<{ id: string }>(
      `insert into public.customers (organization_id, first_name, last_name)
       values ($1, 'Fee', 'Payer') returning id`,
      [organizationId],
    )
    feeCustomer = row!.id
  })

  /** A booking charging `amountMinor`, on this describe's own customer. */
  const booked = async (amountMinor: number): Promise<string> => {
    const id = await bookedAt(amountMinor)
    await db.sql(`update public.rentals set customer_id = $2 where id = $1`, [id, feeCustomer])
    return id
  }

  const summary = async () => {
    const [row] = await db.asUser(ownerId, (session) =>
      session.sql<{
        charged_minor: number
        paid_minor: number
        outstanding_minor: number
        cancelled_count: number
        to_refund_minor: number
      }>(`select * from public.customer_financial_summary($1)`, [feeCustomer]),
    )
    return row!
  }

  it('counts a kept fee as charged, and the rest as refundable', async () => {
    const id = await booked(40_000)
    await pay(id, 12_000)
    await cancel(id, 5_000)

    const row = await summary()
    expect(Number(row.charged_minor)).toBe(5_000)
    // Everything taken, whatever became of the booking: 120 in, 50 of it
    // earned as the fee, 70 to go back.
    expect(Number(row.paid_minor)).toBe(12_000)
    expect(Number(row.to_refund_minor)).toBe(7_000)
    expect(Number(row.outstanding_minor)).toBe(0)
  })

  it('reports a fee nobody has paid as outstanding', async () => {
    const id = await booked(40_000)
    await cancel(id, 5_000)

    const row = await summary()
    expect(Number(row.charged_minor)).toBe(10_000)
    expect(Number(row.outstanding_minor)).toBe(5_000)
    expect(Number(row.to_refund_minor)).toBe(7_000)
  })

  it('charges nothing for a booking nobody has settled', async () => {
    const id = await booked(40_000)
    await pay(id, 12_000)
    await db.sql(
      `update public.rentals set status = 'cancelled', cancelled_at = now() where id = $1`,
      [id],
    )

    const row = await summary()
    expect(Number(row.charged_minor)).toBe(10_000)
    expect(Number(row.paid_minor)).toBe(24_000)
    expect(Number(row.to_refund_minor)).toBe(19_000)
  })

  it('keeps charged less paid equal to outstanding less what must go back', async () => {
    /*
     * The identity, in the only form that is true. The previous version
     * asserted `charged - paid = outstanding`, which holds only while nobody
     * has overpaid -- and passed, because every booking this described had
     * been cancelled. A live booking repriced below what was paid for it broke
     * it in production.
     */
    const row = await summary()
    expect(Number(row.charged_minor) - Number(row.paid_minor)).toBe(
      Number(row.outstanding_minor) - Number(row.to_refund_minor),
    )
  })
})

describe('settling up after a cancellation', () => {
  const record = (
    rentalId: string,
    amountMinor: number,
    direction: 'inbound' | 'outbound',
    purpose: 'rental_charge' | 'deposit' = 'rental_charge',
  ) =>
    db.asUser(ownerId, (session) =>
      session.sql(`select public.rental_record_payment($1, $2, $3, $4)`, [
        rentalId,
        amountMinor,
        direction,
        purpose,
      ]),
    )

  async function paidAndDue(rentalId: string) {
    const [row] = await db.sql<{ amount_paid_minor: number; balance_due_minor: number }>(
      `select amount_paid_minor, balance_due_minor from public.rentals where id = $1`,
      [rentalId],
    )
    return row!
  }

  it('takes payment of a cancellation fee the customer owes', async () => {
    // The receivable this product gained in 20261115100200, and could not
    // settle: every inbound payment on a cancelled booking was refused.
    const id = await bookedAt(40_000)
    await cancel(id, 5_000)

    await record(id, 5_000, 'inbound')

    const after = await paidAndDue(id)
    expect(Number(after.amount_paid_minor)).toBe(5_000)
    expect(Number(after.balance_due_minor)).toBe(0)
  })

  it('refuses more than the booking still charges', async () => {
    const id = await bookedAt(40_000)
    await cancel(id, 5_000)

    await db.expectRejection(
      () => record(id, 6_000, 'inbound'),
      /only .* is owed on this cancelled reservation/i,
    )
  })

  it('refuses payment on a cancellation that charges nothing', async () => {
    const id = await bookedAt(40_000)
    await cancel(id)

    await db.expectRejection(() => record(id, 1_000, 'inbound'), /nothing is owed/i)
  })

  it('refuses a deposit on a car that is not going anywhere', async () => {
    const id = await bookedAt(40_000)
    await cancel(id, 5_000)

    await db.expectRejection(
      () => record(id, 1_000, 'inbound', 'deposit'),
      /cannot take a deposit/i,
    )
  })

  it('refunds what was taken before the booking was called off', async () => {
    // The whole point: 120 taken, 50 kept, 70 handed back.
    const id = await bookedAt(40_000)
    await pay(id, 12_000)
    await cancel(id, 5_000)

    await record(id, 7_000, 'outbound')

    expect(Number((await paidAndDue(id)).amount_paid_minor)).toBe(5_000)
  })

  it('refuses a refund larger than what was received', async () => {
    // The rollup clamps at zero rather than aborting somebody else's write,
    // which makes this silent unless the function says so.
    const id = await bookedAt(40_000)
    await pay(id, 12_000)
    await cancel(id)

    await db.expectRejection(
      () => record(id, 15_000, 'outbound'),
      /only .* has been received on this contract/i,
    )
  })

  it('still takes payment normally on a booking that stands', async () => {
    const id = await bookedAt(40_000)
    await record(id, 40_000, 'inbound')
    expect(Number((await paidAndDue(id)).balance_due_minor)).toBe(0)
  })
})

describe('a booking that is still standing can be overpaid', () => {
  /*
   * Reported from live use: a hire repriced downwards after it had been paid
   * in full left money to go back, and the account said nothing. to_refund
   * was filtered to cancelled bookings, which is not the only way to end up
   * holding more than you charge.
   */
  let payer: string

  const summary = async () => {
    const [row] = await db.asUser(ownerId, (session) =>
      session.sql<{
        charged_minor: number
        paid_minor: number
        outstanding_minor: number
        to_refund_minor: number
      }>(`select * from public.customer_financial_summary($1)`, [payer]),
    )
    return row!
  }

  /** Charges a booking by rewriting its hire line, the way repricing does. */
  const chargeIt = (rentalId: string, amountMinor: number) =>
    db.sql(
      `update public.rental_line_items set amount_minor = $2, unit_amount_minor = $2
             where rental_id = $1 and kind = 'base_rental'`,
      [rentalId, amountMinor],
    )

  beforeAll(async () => {
    const [row] = await db.sql<{ id: string }>(
      `insert into public.customers (organization_id, first_name, last_name)
       values ($1, 'Over', 'Paid') returning id`,
      [organizationId],
    )
    payer = row!.id
  })

  const bookingFor = async (amountMinor: number): Promise<string> => {
    const id = await createReservation()
    await db.sql(`update public.rentals set customer_id = $2 where id = $1`, [id, payer])
    await addLine(id, { amountMinor })
    return id
  }

  it('reports what has to go back when the charge drops below the payment', async () => {
    // 330 taken, then repriced to 280.50: 49.50 is theirs.
    const id = await bookingFor(33_000)
    await pay(id, 33_000)
    await chargeIt(id, 28_050)

    const row = await summary()
    expect(Number(row.charged_minor)).toBe(28_050)
    expect(Number(row.paid_minor)).toBe(33_000)
    expect(Number(row.outstanding_minor)).toBe(0)
    expect(Number(row.to_refund_minor)).toBe(4_950)
  })

  it('holds the identity across a mixture, not one shape', async () => {
    /*
     * The test that was missing. The old one asserted charged less paid equals
     * outstanding and passed, because the customer it ran against had only
     * cancelled bookings -- the case already in mind. This one carries an
     * overpaid live booking, an underpaid live booking and a cancelled one at
     * the same time.
     */
    const owing = await bookingFor(20_000)
    await pay(owing, 5_000)

    const called_off = await bookingFor(30_000)
    await pay(called_off, 12_000)
    await db.asUser(ownerId, (session) =>
      session.sql(`select public.rental_cancel($1, 'changed plans', 5000)`, [called_off]),
    )

    const row = await summary()
    expect(Number(row.charged_minor) - Number(row.paid_minor)).toBe(
      Number(row.outstanding_minor) - Number(row.to_refund_minor),
    )
    // And the parts are the per-booking split, not a net across bookings.
    expect(Number(row.outstanding_minor)).toBe(15_000)
    expect(Number(row.to_refund_minor)).toBe(4_950 + 7_000)
  })

  it('counts everything received, including against a cancelled booking', async () => {
    // Paid used to mean "what the charges have been paid" for a cancelled
    // booking and "everything received" for the rest. It now means one thing.
    const row = await summary()
    expect(Number(row.paid_minor)).toBe(33_000 + 5_000 + 12_000)
  })
})

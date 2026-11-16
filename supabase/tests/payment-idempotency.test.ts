// @vitest-environment node
/**
 * A payment is recorded once, however many times it is sent.
 *
 * The case these are about is not a double click -- the buttons already
 * disable themselves for that. It is a connection that drops after the insert
 * committed but before the answer got home, so the client retries something
 * that already worked. Without a key the second attempt is a second payment,
 * and the agency ends up explaining a double charge to somebody who clicked
 * once and cannot reproduce it.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { TestDatabase, signUp } from './support/harness'

let db: TestDatabase
let organizationId: string
let ownerId: string
let vehicleId: string
let customerId: string

/** A second agency, for the one question that is about tenancy. */
let otherOrganizationId: string
let otherOwnerId: string
let otherCustomerId: string

const DAY = 24 * 60 * 60 * 1000
let periodCursor = Date.UTC(2032, 0, 1, 9, 0, 0)

/*
 * One key per payment the person is making, which is what a client issues: it
 * is generated when the form opens, not once for the whole session. Sharing
 * one across unrelated payments is the client bug the mismatch guard refuses,
 * and it is tested for on purpose below.
 */
let keyCursor = 0
const nextKey = (): string => `00000000-0000-4000-8000-${String(++keyCursor).padStart(12, '0')}`

async function bookingOf(
  totalMinor: number,
  orgId = organizationId,
  vId = vehicleId,
  cId = customerId,
) {
  const start = new Date(periodCursor)
  const end = new Date(periodCursor + 3 * DAY)
  periodCursor += 8 * DAY

  const [row] = await db.sql<{ id: string }>(
    `insert into public.rentals
       (organization_id, vehicle_id, customer_id, starts_at, ends_at, currency, status,
        daily_rate_minor, billable_days)
     values ($1, $2, $3, $4::timestamptz, $5::timestamptz, 'EUR', 'reserved', 10000, 3)
     returning id`,
    [orgId, vId, cId, start.toISOString(), end.toISOString()],
  )
  await db.sql(
    `insert into public.rental_line_items
       (organization_id, rental_id, kind, description, quantity, unit_amount_minor,
        amount_minor, currency)
     values ($1, $2, 'base_rental', '3 day hire', 1, $3, $3, 'EUR')`,
    [orgId, row!.id, totalMinor],
  )
  return row!.id
}

const pay = (
  rentalId: string,
  amountMinor: number,
  key: string | null,
  direction: 'inbound' | 'outbound' = 'inbound',
  userId = ownerId,
) =>
  db.asUser(userId, (session) =>
    session.sql<{ id: string }>(
      `select (public.rental_record_payment($1, $2, $3, 'rental_charge', 'cash', null, null, null, $4)).id as id`,
      [rentalId, amountMinor, direction, key],
    ),
  )

const credit = (customer: string, amountMinor: number, key: string | null, userId = ownerId) =>
  db.asUser(userId, (session) =>
    session.sql<{ id: string }>(
      `select (public.customer_record_credit($1, $2, 'EUR', 'inbound', 'cash', null, null, null, $3)).id as id`,
      [customer, amountMinor, key],
    ),
  )

async function paymentCount(rentalId: string): Promise<number> {
  const [row] = await db.sql<{ count: number }>(
    `select count(*)::int as count from public.payments where rental_id = $1`,
    [rentalId],
  )
  return Number(row!.count)
}

beforeAll(async () => {
  db = await TestDatabase.create()

  const owner = await signUp(db, {
    email: 'owner@idempotency.test',
    organizationName: 'Idempotent Cars',
    currency: 'EUR',
    timeZone: 'Europe/Lisbon',
  })
  if (!owner.organizationId) throw new Error('Provisioning failed')
  ownerId = owner.userId
  organizationId = owner.organizationId

  const other = await signUp(db, {
    email: 'owner@elsewhere.test',
    organizationName: 'Elsewhere Cars',
    currency: 'EUR',
    timeZone: 'Europe/Lisbon',
  })
  if (!other.organizationId) throw new Error('Provisioning failed')
  otherOwnerId = other.userId
  otherOrganizationId = other.organizationId

  for (const [org, plate] of [
    [organizationId, 'IDEM-1'],
    [otherOrganizationId, 'IDEM-2'],
  ] as const) {
    const [vehicle] = await db.sql<{ id: string }>(
      `insert into public.vehicles (organization_id, make, model, registration_plate, currency,
                                    daily_rate_minor)
       values ($1, 'Opel', 'Corsa', $2, 'EUR', 10000) returning id`,
      [org, plate],
    )
    const [customer] = await db.sql<{ id: string }>(
      `insert into public.customers (organization_id, first_name, last_name)
       values ($1, 'Paula', 'Pereira') returning id`,
      [org],
    )
    if (org === organizationId) {
      vehicleId = vehicle!.id
      customerId = customer!.id
    } else {
      otherCustomerId = customer!.id
    }
  }
})

afterAll(async () => {
  await db?.close()
})

describe('the same payment sent twice', () => {
  it('records it once and answers with what it already wrote', async () => {
    const id = await bookingOf(30_000)
    const key = nextKey()

    const [first] = await pay(id, 30_000, key)
    const [again] = await pay(id, 30_000, key)

    expect(again!.id).toBe(first!.id)
    expect(await paymentCount(id)).toBe(1)
  })

  it('lets the same customer genuinely pay twice under a different key', async () => {
    // Two 100s in a day is a real thing at a counter. A rule that refused it
    // on the amount would be the wrong rule.
    const id = await bookingOf(30_000)

    await pay(id, 10_000, nextKey())
    await pay(id, 10_000, nextKey())

    expect(await paymentCount(id)).toBe(2)
  })

  it('leaves a caller that claims nothing exactly as it was', async () => {
    const id = await bookingOf(30_000)

    await pay(id, 10_000, null)
    await pay(id, 10_000, null)

    expect(await paymentCount(id)).toBe(2)
  })
})

describe('a retry of something that already worked', () => {
  it('does not fail a refund against a ceiling its own first attempt lowered', async () => {
    /*
     * The reason the key is checked before the caps and not after. The first
     * refund takes amount_paid to zero; a second attempt validated normally
     * would be refused with "only 0 has been received", showing a failure for
     * money that is on the record.
     */
    const id = await bookingOf(30_000)
    await pay(id, 30_000, nextKey())

    const key = nextKey()
    const [refund] = await pay(id, 30_000, key, 'outbound')
    const [retried] = await pay(id, 30_000, key, 'outbound')

    expect(retried!.id).toBe(refund!.id)
    expect(await paymentCount(id)).toBe(2)
  })

  it('answers a repeated credit with the credit it already took', async () => {
    const key = nextKey()
    const [first] = await credit(customerId, 7_000, key)
    const [again] = await credit(customerId, 7_000, key)

    expect(again!.id).toBe(first!.id)

    const [row] = await db.sql<{ count: number }>(
      `select count(*)::int as count from public.payments
        where customer_id = $1 and rental_id is null`,
      [customerId],
    )
    expect(Number(row!.count)).toBe(1)
  })
})

describe('two agencies using the same key', () => {
  it('does not let one agency’s key collide with another’s', async () => {
    /*
     * Why the index is on (organization_id, idempotency_key) rather than the
     * key alone. Under a global index the second agency's insert would do
     * nothing, and the fallback read would be reaching for a row belonging to
     * the first -- which RLS refuses, leaving the function returning no
     * payment at all.
     */
    const mine = await bookingOf(30_000)
    const [theirs] = await db.sql<{ id: string }>(
      `insert into public.rentals
         (organization_id, vehicle_id, customer_id, starts_at, ends_at, currency, status)
       values ($1, (select id from public.vehicles where organization_id = $1 limit 1), $2,
               '2032-06-01T09:00:00Z', '2032-06-04T09:00:00Z', 'EUR', 'reserved')
       returning id`,
      [otherOrganizationId, otherCustomerId],
    )

    const shared = nextKey()
    const [a] = await pay(mine, 5_000, shared)
    const [b] = await pay(theirs!.id, 5_000, shared, 'inbound', otherOwnerId)

    expect(b!.id).toBeTruthy()
    expect(b!.id).not.toBe(a!.id)
  })
})

describe('a key used for something else', () => {
  it('refuses rather than answering with the other payment', async () => {
    /*
     * Found by writing these tests badly: sharing one key across unrelated
     * payments made the second one silently answer with the first one's row,
     * so a second booking looked paid by the first one's money. A reused key
     * is a client bug, and a loud one is the only safe kind.
     */
    const first = await bookingOf(30_000)
    const second = await bookingOf(30_000)
    const key = nextKey()

    await pay(first, 10_000, key)

    await db.expectRejection(
      () => pay(second, 10_000, key),
      /already been used for a different payment/i,
    )
    expect(await paymentCount(second)).toBe(0)
  })

  it('refuses a different amount under the same key', async () => {
    const id = await bookingOf(30_000)
    const key = nextKey()

    await pay(id, 10_000, key)

    await db.expectRejection(
      () => pay(id, 20_000, key),
      /already been used for a different payment/i,
    )
    expect(await paymentCount(id)).toBe(1)
  })
})

describe('a key whose payment was voided', () => {
  /*
   * The lookup matches on agency and key alone, so a payment that was recorded
   * and then voided still matched -- and the answer was "recorded" for money
   * that counts nowhere, since voided entries are excluded from every rollup.
   *
   * Refused rather than ignored: ignoring voided rows would send the insert
   * into the unique index, whose conflict path reads the same voided row back,
   * which is a loop.
   */
  it('refuses rather than reporting a success', async () => {
    const id = await bookingOf(30_000)
    const key = nextKey()

    const [payment] = await pay(id, 10_000, key)
    await db.asUser(ownerId, (session) =>
      session.sql(`select public.rental_void_payment($1, 'entered twice')`, [payment!.id]),
    )

    await db.expectRejection(() => pay(id, 10_000, key), /recorded and then voided/i)
  })

  it('refuses a voided credit the same way', async () => {
    const key = nextKey()
    const [credited] = await credit(customerId, 4_000, key)
    await db.asUser(ownerId, (session) =>
      session.sql(`select public.rental_void_payment($1, 'entered twice')`, [credited!.id]),
    )

    await db.expectRejection(() => credit(customerId, 4_000, key), /recorded and then voided/i)
  })
})

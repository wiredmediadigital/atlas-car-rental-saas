// @vitest-environment node
/**
 * Posted rental charges cannot be erased, and corrections leave a trail.
 *
 * Every assertion here runs through `db.asUser`, so row level security, the
 * role ladder and the integrity trigger all apply exactly as they would to a
 * request arriving at PostgREST. That matters more than usual in this file:
 * the defect being closed was reachable precisely BECAUSE the only gate was in
 * the browser, and a test that wrote as the table owner would re-create the
 * same blind spot it exists to remove.
 *
 * This replaces, rather than preserves, the behaviour it was written against.
 * Before the migration a staff member could delete a charge after the contract
 * was issued and after the customer had paid; those cases are asserted here as
 * REJECTIONS, not as a documented quirk.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { TestDatabase, addMember, signUp } from './support/harness'

let db: TestDatabase

let organizationId: string
let ownerId: string
let managerId: string
let staffId: string
let vehicleId: string
let customerId: string

let otherOrganizationId: string
let otherOwnerId: string
let otherVehicleId: string
let otherCustomerId: string

const DAY = 24 * 60 * 60 * 1000
let periodCursor = Date.UTC(2029, 0, 1, 9, 0, 0)
let plateCursor = 0

function nextPeriod(days = 3): { startsAt: string; endsAt: string } {
  const start = new Date(periodCursor)
  const end = new Date(periodCursor + days * DAY)
  periodCursor += (days + 5) * DAY
  return { startsAt: start.toISOString(), endsAt: end.toISOString() }
}

async function makeVehicle(orgId: string): Promise<string> {
  plateCursor += 1
  const [row] = await db.sql<{ id: string }>(
    `insert into public.vehicles
       (organization_id, make, model, registration_plate, currency, daily_rate_minor)
     values ($1, 'Test', 'Integrity', $2, 'EUR', 5000) returning id`,
    [orgId, `CHG-${String(plateCursor).padStart(4, '0')}`],
  )
  return row!.id
}

async function makeCustomer(orgId: string): Promise<string> {
  const [row] = await db.sql<{ id: string }>(
    `insert into public.customers (organization_id, first_name, last_name)
     values ($1, 'Integrity', 'Customer') returning id`,
    [orgId],
  )
  return row!.id
}

interface RentalOptions {
  status?: string
  orgId?: string
  vehicle?: string
  customer?: string
}

async function makeRental(options: RentalOptions = {}): Promise<string> {
  const period = nextPeriod()
  const [row] = await db.sql<{ id: string }>(
    `insert into public.rentals
       (organization_id, vehicle_id, customer_id, starts_at, ends_at, currency, status,
        deposit_minor, tax_rate_bps, daily_rate_minor)
     values ($1, $2, $3, $4::timestamptz, $5::timestamptz, 'EUR', $6::public.rental_status,
             0, 2000, 5000)
     returning id`,
    [
      options.orgId ?? organizationId,
      options.vehicle ?? vehicleId,
      options.customer ?? customerId,
      period.startsAt,
      period.endsAt,
      options.status ?? 'draft',
    ],
  )
  return row!.id
}

/** A charge line, written as the owner so the test controls the starting point. */
async function addLine(
  rentalId: string,
  over: { kind?: string; amount?: number; taxable?: boolean; orgId?: string } = {},
): Promise<string> {
  const [row] = await db.sql<{ id: string }>(
    `insert into public.rental_line_items
       (organization_id, rental_id, kind, description, quantity,
        unit_amount_minor, amount_minor, currency, is_taxable)
     values ($1, $2, $3::public.rental_charge_kind, 'Line', 1, $4, $4, 'EUR', $5)
     returning id`,
    [
      over.orgId ?? organizationId,
      rentalId,
      over.kind ?? 'cleaning',
      over.amount ?? 10_000,
      over.taxable ?? true,
    ],
  )
  return row!.id
}

const deleteAs = (userId: string, lineId: string) =>
  db.asUser(userId, (session) =>
    session.sql(`delete from public.rental_line_items where id = $1`, [lineId]),
  )

const reverseAs = (userId: string, lineId: string, reason = 'Charged in error') =>
  db.asUser(userId, (session) =>
    session.sql<{ id: string; amount_minor: number; is_taxable: boolean }>(
      `select id, amount_minor, is_taxable from public.rental_reverse_charge($1, $2)`,
      [lineId, reason],
    ),
  )

async function totals(rentalId: string) {
  const [row] = await db.sql<{
    subtotal_minor: number
    extras_minor: number
    discount_minor: number
    tax_minor: number
    total_minor: number
    balance_due_minor: number
  }>(
    `select subtotal_minor, extras_minor, discount_minor, tax_minor, total_minor, balance_due_minor
       from public.rentals where id = $1`,
    [rentalId],
  )
  return row!
}

async function lineCount(rentalId: string): Promise<number> {
  const [row] = await db.sql<{ n: number }>(
    `select count(*)::int as n from public.rental_line_items where rental_id = $1`,
    [rentalId],
  )
  return row!.n
}

beforeAll(async () => {
  db = await TestDatabase.create()

  const owner = await signUp(db, { email: 'owner@charges.test', organizationName: 'Charges Co' })
  ownerId = owner.userId
  organizationId = owner.organizationId!

  const manager = await signUp(db, { email: 'manager@charges.test' })
  managerId = manager.userId
  await addMember(db, organizationId, managerId, 'manager')

  const staff = await signUp(db, { email: 'staff@charges.test' })
  staffId = staff.userId
  await addMember(db, organizationId, staffId, 'staff')

  vehicleId = await makeVehicle(organizationId)
  customerId = await makeCustomer(organizationId)

  const other = await signUp(db, { email: 'owner@other.test', organizationName: 'Other Co' })
  otherOwnerId = other.userId
  otherOrganizationId = other.organizationId!
  otherVehicleId = await makeVehicle(otherOrganizationId)
  otherCustomerId = await makeCustomer(otherOrganizationId)
}, 180_000)

afterAll(async () => {
  await db.close()
})

describe('deleting a charge before anything is committed', () => {
  it('is allowed on a draft with no contract and no money', async () => {
    // Composing a booking is not correcting one. Drafting stays free.
    const rental = await makeRental({ status: 'draft' })
    const line = await addLine(rental)

    await deleteAs(staffId, line)

    expect(await lineCount(rental)).toBe(0)
  })

  it('is refused once a payment has been taken, even on a draft', async () => {
    /*
     * Taking money before confirming is ordinary, and it commits the charges
     * just as firmly as a reservation does. The status alone is not the test.
     */
    const rental = await makeRental({ status: 'draft' })
    const line = await addLine(rental)
    await db.sql(
      `insert into public.payments
         (organization_id, rental_id, amount_minor, currency, direction, purpose, method)
       values ($1, $2, 5000, 'EUR', 'inbound', 'rental_charge', 'cash')`,
      [organizationId, rental],
    )

    await db.expectRejection(() => deleteAs(staffId, line), /cannot be deleted|Reverse it instead/i)
    expect(await lineCount(rental)).toBe(1)
  })

  it('is refused once a contract has been issued against a draft', async () => {
    const rental = await makeRental({ status: 'draft' })
    const line = await addLine(rental)
    await db.sql(
      `insert into public.rental_contracts
         (organization_id, rental_id, version, contract_number, status, snapshot, issued_by)
       values ($1, $2, 1, 'TEST-0001', 'issued', '{}'::jsonb, $3)`,
      [organizationId, rental, ownerId],
    )

    await db.expectRejection(() => deleteAs(staffId, line), /cannot be deleted|Reverse it instead/i)
  })
})

describe('deleting a charge after a commitment', () => {
  it.each([
    ['reserved', 'reserved'],
    ['active', 'active'],
    ['completed', 'completed'],
    ['cancelled', 'cancelled'],
  ])('is refused on a %s rental', async (_label, status) => {
    const rental = await makeRental({ status })
    const line = await addLine(rental)

    await db.expectRejection(() => deleteAs(staffId, line), /cannot be deleted|Reverse it instead/i)
    expect(await lineCount(rental)).toBe(1)
  })

  it('is refused for an owner too — this is not a role the boundary bends for', async () => {
    // The protection is about the record's state, not the operator's seniority.
    // An owner who needs the money off posts a reversal like anyone else.
    const rental = await makeRental({ status: 'reserved' })
    const line = await addLine(rental)

    await db.expectRejection(() => deleteAs(ownerId, line), /cannot be deleted|Reverse it instead/i)
  })
})

describe('modifying a posted charge directly', () => {
  it('refuses a change to the amount', async () => {
    /*
     * The bypass that matters most. Deleting is not the only way to make money
     * disappear -- an UPDATE to amount_minor does it just as well, and the
     * policy permitted staff updates with no reference to the rental's state.
     */
    const rental = await makeRental({ status: 'reserved' })
    const line = await addLine(rental, { amount: 10_000 })

    await db.expectRejection(
      () =>
        db.asUser(staffId, (s) =>
          s.sql(`update public.rental_line_items set amount_minor = 1 where id = $1`, [line]),
        ),
      /cannot be changed|post a reversal/i,
    )
  })

  it.each([
    ['the tax treatment', `is_taxable = false`],
    ['the quantity', `quantity = 99`],
    ['the unit amount', `unit_amount_minor = 1`],
    ['the charge kind', `kind = 'damage'::public.rental_charge_kind`],
  ])('refuses a change to %s', async (_label, assignment) => {
    const rental = await makeRental({ status: 'reserved' })
    const line = await addLine(rental)

    await db.expectRejection(
      () =>
        db.asUser(staffId, (s) =>
          s.sql(`update public.rental_line_items set ${assignment} where id = $1`, [line]),
        ),
      /cannot be changed|post a reversal/i,
    )
  })

  it('will not move a charge onto another rental', async () => {
    /*
     * This one does not raise, and the test says so rather than pretending.
     * `rental_line_items_freeze_columns` (20260815100000:277) already protects
     * the association, and it does it by RESTORING the old value instead of
     * refusing -- so the statement reports success and changes nothing. The
     * property that matters is where the charge ends up, so that is what is
     * asserted.
     */
    const rental = await makeRental({ status: 'reserved' })
    const elsewhere = await makeRental({ status: 'reserved' })
    const line = await addLine(rental)

    await db.asUser(staffId, (s) =>
      s.sql(`update public.rental_line_items set rental_id = $2 where id = $1`, [line, elsewhere]),
    )

    const [row] = await db.sql<{ rental_id: string }>(
      `select rental_id from public.rental_line_items where id = $1`,
      [line],
    )
    expect(row!.rental_id).toBe(rental)
    expect(await lineCount(elsewhere)).toBe(0)
  })

  it('still allows reordering and relabelling, which move no money', async () => {
    const rental = await makeRental({ status: 'reserved' })
    const line = await addLine(rental)

    await db.asUser(staffId, (s) =>
      s.sql(
        `update public.rental_line_items set sort_order = 5, description = 'Clearer label' where id = $1`,
        [line],
      ),
    )

    const [row] = await db.sql<{ description: string }>(
      `select description from public.rental_line_items where id = $1`,
      [line],
    )
    expect(row!.description).toBe('Clearer label')
  })
})

describe('reversing a charge', () => {
  it('is a manager’s act, not every staff member’s', async () => {
    /*
     * The ladder the codebase already uses for money: recording a payment is
     * staff, voiding one is manager, destroying one is admin. Undoing a posted
     * charge is the same kind of act as voiding a payment.
     */
    const rental = await makeRental({ status: 'reserved' })
    const line = await addLine(rental)

    await db.expectRejection(() => reverseAs(staffId, line))
    const reversal = await reverseAs(managerId, line)
    expect(reversal[0]!.amount_minor).toBe(-10_000)
  })

  it('preserves the original and mirrors its amount and tax treatment', async () => {
    const rental = await makeRental({ status: 'reserved' })
    const line = await addLine(rental, { amount: 7_500, taxable: true })

    const reversal = await reverseAs(managerId, line)

    expect(await lineCount(rental)).toBe(2)
    expect(reversal[0]!.amount_minor).toBe(-7_500)
    expect(reversal[0]!.is_taxable).toBe(true)
  })

  it('records who posted it, when, and why', async () => {
    const rental = await makeRental({ status: 'reserved' })
    const line = await addLine(rental)

    await reverseAs(managerId, line, 'Charged to the wrong booking')

    const [row] = await db.sql<{
      created_by: string
      reversal_reason: string
      created_at: Date
      reverses_line_item_id: string
    }>(
      `select created_by, reversal_reason, created_at, reverses_line_item_id
         from public.rental_line_items where reverses_line_item_id = $1`,
      [line],
    )
    expect(row!.created_by).toBe(managerId)
    expect(row!.reversal_reason).toBe('Charged to the wrong booking')
    expect(row!.reverses_line_item_id).toBe(line)
    expect(row!.created_at).toBeTruthy()
  })

  it('refuses a second reversal of the same charge', async () => {
    const rental = await makeRental({ status: 'reserved' })
    const line = await addLine(rental)
    await reverseAs(managerId, line)

    await db.expectRejection(() => reverseAs(managerId, line), /already been reversed/i)
  })

  it('refuses a reversal with no reason', async () => {
    const rental = await makeRental({ status: 'reserved' })
    const line = await addLine(rental)

    await db.expectRejection(() => reverseAs(managerId, line, '   '), /has to say why/i)
  })

  it('refuses reversing the hire itself', async () => {
    // The hire is restated by repricing, extension or an early return, each of
    // which keeps the contract and the availability in step. A reversal would
    // move the money without moving any of that.
    const rental = await makeRental({ status: 'reserved' })
    const line = await addLine(rental, { kind: 'base_rental' })

    await db.expectRejection(() => reverseAs(managerId, line), /repricing, extension/i)
  })

  it('refuses reversing a reversal', async () => {
    const rental = await makeRental({ status: 'reserved' })
    const line = await addLine(rental)
    const reversal = await reverseAs(managerId, line)

    await db.expectRejection(
      () => reverseAs(managerId, reversal[0]!.id),
      /cannot itself be reversed/i,
    )
  })

  it('cannot reach across agencies', async () => {
    const mine = await makeRental({ status: 'reserved' })
    const theirs = await makeRental({
      status: 'reserved',
      orgId: otherOrganizationId,
      vehicle: otherVehicleId,
      customer: otherCustomerId,
    })
    const theirLine = await addLine(theirs, { orgId: otherOrganizationId })

    // The other agency's charge is not even visible, so this fails as "not
    // found" rather than as a refusal — which is the stronger outcome.
    await db.expectRejection(() => reverseAs(managerId, theirLine))
    expect(await lineCount(mine)).toBe(0)
  })

  it('refuses a hand-made reversal pointing at another rental’s charge', async () => {
    const rental = await makeRental({ status: 'reserved' })
    const elsewhere = await makeRental({ status: 'reserved' })
    const line = await addLine(rental)

    await db.expectRejection(
      () =>
        db.asUser(managerId, (s) =>
          s.sql(
            `insert into public.rental_line_items
               (organization_id, rental_id, kind, description, quantity,
                unit_amount_minor, amount_minor, currency, is_taxable,
                reverses_line_item_id, reversal_reason)
             values ($1, $2, 'cleaning', 'Fake', 1, -10000, -10000, 'EUR', true, $3, 'nope')`,
            [organizationId, elsewhere, line],
          ),
        ),
      /same rental/i,
    )
  })

  it('refuses a hand-made reversal that does not mirror the amount', async () => {
    // Otherwise "reversal" becomes a licence to write any figure at all.
    const rental = await makeRental({ status: 'reserved' })
    const line = await addLine(rental, { amount: 10_000 })

    await db.expectRejection(
      () =>
        db.asUser(managerId, (s) =>
          s.sql(
            `insert into public.rental_line_items
               (organization_id, rental_id, kind, description, quantity,
                unit_amount_minor, amount_minor, currency, is_taxable,
                reverses_line_item_id, reversal_reason)
             values ($1, $2, 'cleaning', 'Fake', 1, -1, -1, 'EUR', true, $3, 'nope')`,
            [organizationId, rental, line],
          ),
        ),
      /exact opposite/i,
    )
  })

  it('cannot itself be deleted once posted', async () => {
    const rental = await makeRental({ status: 'reserved' })
    const line = await addLine(rental)
    const reversal = await reverseAs(managerId, line)

    await db.expectRejection(() => deleteAs(ownerId, reversal[0]!.id))
  })
})

describe('what a reversal does to the money', () => {
  it('takes the charge and its tax back out of the total', async () => {
    const rental = await makeRental({ status: 'reserved' })
    const line = await addLine(rental, { amount: 10_000, taxable: true })

    const before = await totals(rental)
    expect(before.extras_minor).toBe(10_000)
    expect(before.tax_minor).toBe(2_000)
    expect(before.total_minor).toBe(12_000)

    await reverseAs(managerId, line)

    const after = await totals(rental)
    expect(after.extras_minor).toBe(0)
    expect(after.tax_minor).toBe(0)
    expect(after.total_minor).toBe(0)
  })

  it('does not count a reversal as a discount the agency never gave', async () => {
    /*
     * A negative line would otherwise land in the discount bucket, and a later
     * contract version would print a refunded extra as a discount. The
     * breakdown has to stay readable, not merely add up.
     */
    const rental = await makeRental({ status: 'reserved' })
    const line = await addLine(rental, { amount: 10_000 })

    await reverseAs(managerId, line)

    expect((await totals(rental)).discount_minor).toBe(0)
  })

  it('takes a discount back when the discount is reversed', async () => {
    const rental = await makeRental({ status: 'reserved' })
    await addLine(rental, { kind: 'cleaning', amount: 10_000 })
    const discount = await addLine(rental, { kind: 'discount', amount: -4_000 })

    expect((await totals(rental)).discount_minor).toBe(4_000)

    await reverseAs(managerId, discount)

    const after = await totals(rental)
    expect(after.discount_minor).toBe(0)
    expect(after.total_minor).toBe(12_000)
  })

  it('leaves an untaxed charge untaxed when reversed', async () => {
    const rental = await makeRental({ status: 'reserved' })
    const line = await addLine(rental, { amount: 10_000, taxable: false })

    expect((await totals(rental)).tax_minor).toBe(0)
    await reverseAs(managerId, line)

    const after = await totals(rental)
    expect(after.tax_minor).toBe(0)
    expect(after.total_minor).toBe(0)
  })

  it('restates the outstanding balance against money already taken', async () => {
    const rental = await makeRental({ status: 'reserved' })
    const line = await addLine(rental, { amount: 10_000, taxable: false })
    await db.sql(
      `insert into public.payments
         (organization_id, rental_id, amount_minor, currency, direction, purpose, method)
       values ($1, $2, 10000, 'EUR', 'inbound', 'rental_charge', 'cash')`,
      [organizationId, rental],
    )

    expect((await totals(rental)).balance_due_minor).toBe(0)

    await reverseAs(managerId, line)

    // The customer has paid for something that has been taken back off, so the
    // booking now owes them money. That is a credit, not a negative charge.
    expect((await totals(rental)).balance_due_minor).toBe(-10_000)
  })
})

describe('cancelling a booking settles it by reversing', () => {
  it('reverses the charges instead of erasing them', async () => {
    const rental = await makeRental({ status: 'reserved' })
    await addLine(rental, { kind: 'base_rental', amount: 15_000, taxable: false })

    await db.asUser(ownerId, (s) =>
      s.sql(`select public.rental_cancel($1, 'Customer called off', 0)`, [rental]),
    )

    // Two lines, not none: the original and its reversal.
    expect(await lineCount(rental)).toBe(2)
    expect((await totals(rental)).total_minor).toBe(0)
  })

  it('keeps the agreed cancellation fee as the only charge standing', async () => {
    const rental = await makeRental({ status: 'reserved' })
    await addLine(rental, { kind: 'base_rental', amount: 15_000, taxable: false })

    await db.asUser(ownerId, (s) =>
      s.sql(`select public.rental_cancel($1, 'Called off', 5000)`, [rental]),
    )

    expect((await totals(rental)).total_minor).toBe(5_000)
  })

  it('settles a booking that carries a discount', async () => {
    // The order is load-bearing: reversing a discount raises the total, and
    // doing it second would leave a discount briefly exceeding the charges,
    // which the recalculation refuses outright.
    const rental = await makeRental({ status: 'reserved' })
    await addLine(rental, { kind: 'base_rental', amount: 20_000, taxable: false })
    await addLine(rental, { kind: 'discount', amount: -5_000, taxable: false })

    await db.asUser(ownerId, (s) => s.sql(`select public.rental_cancel($1, 'Called off', 0)`, [rental]))

    const after = await totals(rental)
    expect(after.total_minor).toBe(0)
    expect(after.discount_minor).toBe(0)
  })

  it('settles a booking that has already been paid, leaving the payment alone', async () => {
    const rental = await makeRental({ status: 'reserved' })
    await addLine(rental, { kind: 'base_rental', amount: 20_000, taxable: false })
    await db.sql(
      `insert into public.payments
         (organization_id, rental_id, amount_minor, currency, direction, purpose, method)
       values ($1, $2, 20000, 'EUR', 'inbound', 'rental_charge', 'cash')`,
      [organizationId, rental],
    )

    await db.asUser(ownerId, (s) => s.sql(`select public.rental_cancel($1, 'Called off', 5000)`, [rental]))

    const after = await totals(rental)
    expect(after.total_minor).toBe(5_000)
    // Paid 20,000, keeping 5,000: the agency owes 15,000 back. Refunding it is
    // a separate, deliberate act; cancellation only decides the entitlement.
    expect(after.balance_due_minor).toBe(-15_000)

    const [payment] = await db.sql<{ n: number }>(
      `select count(*)::int as n from public.payments where rental_id = $1 and voided_at is null`,
      [rental],
    )
    expect(payment!.n).toBe(1)
  })

  it('settles a booking with an issued contract, and leaves the contract alone', async () => {
    const rental = await makeRental({ status: 'reserved' })
    await addLine(rental, { kind: 'base_rental', amount: 20_000, taxable: false })
    await db.sql(
      `insert into public.rental_contracts
         (organization_id, rental_id, version, contract_number, status, snapshot, issued_by)
       values ($1, $2, 1, 'TEST-0009', 'issued', '{"total_minor": 20000}'::jsonb, $3)`,
      [organizationId, rental, ownerId],
    )

    await db.asUser(ownerId, (s) => s.sql(`select public.rental_cancel($1, 'Called off', 0)`, [rental]))

    const [contract] = await db.sql<{ status: string; snapshot: { total_minor: number } }>(
      `select status, snapshot from public.rental_contracts where rental_id = $1`,
      [rental],
    )
    // The live balance moved; the signed document did not.
    expect(contract!.snapshot.total_minor).toBe(20_000)
    expect((await totals(rental)).total_minor).toBe(0)
  })

  it('changing the fee afterwards reverses the old one rather than deleting it', async () => {
    const rental = await makeRental({ status: 'reserved' })
    await addLine(rental, { kind: 'base_rental', amount: 20_000, taxable: false })

    await db.asUser(ownerId, (s) => s.sql(`select public.rental_cancel($1, 'Called off', 5000)`, [rental]))
    const afterFirst = await lineCount(rental)

    await db.asUser(ownerId, (s) =>
      s.sql(`select public.rental_set_cancellation_fee($1, 8000)`, [rental]),
    )

    // Nothing was removed: the first fee, its reversal and the new fee all stand.
    expect(await lineCount(rental)).toBeGreaterThan(afterFirst)
    expect((await totals(rental)).total_minor).toBe(8_000)
  })

  it('is safe to settle twice — a retry adds no second reversal', async () => {
    const rental = await makeRental({ status: 'reserved' })
    await addLine(rental, { kind: 'base_rental', amount: 20_000, taxable: false })

    await db.asUser(ownerId, (s) => s.sql(`select public.rental_cancel($1, 'Called off', 0)`, [rental]))
    const afterOnce = await lineCount(rental)

    await db.sql(`select app.settle_cancelled_rental($1, 0)`, [rental])

    expect(await lineCount(rental)).toBe(afterOnce)
    expect((await totals(rental)).total_minor).toBe(0)
  })

  it('refuses to cancel a rental that is already under way', async () => {
    // The approved rule, unchanged: only a draft or a reservation is cancellable.
    const rental = await makeRental({ status: 'active' })

    await db.expectRejection(
      () => db.asUser(ownerId, (s) => s.sql(`select public.rental_cancel($1, 'No', 0)`, [rental])),
      /draft or a reservation/i,
    )
  })

  it('leaves no partial settlement when it fails', async () => {
    /*
     * A cancellation that failed half-way would be the worst outcome of all:
     * some charges reversed, some standing, and a booking in neither state.
     * The whole settlement runs in the caller's transaction, so the refusal
     * above must leave the charges exactly as they were.
     */
    const rental = await makeRental({ status: 'active' })
    await addLine(rental, { kind: 'base_rental', amount: 20_000, taxable: false })
    const before = await totals(rental)

    await db.expectRejection(() =>
      db.asUser(ownerId, (s) => s.sql(`select public.rental_cancel($1, 'No', 0)`, [rental])),
    )

    expect(await lineCount(rental)).toBe(1)
    expect((await totals(rental)).total_minor).toBe(before.total_minor)
  })
})

describe('the settlement helper is not a way in', () => {
  it('cannot be used to invent a reversal on a live booking', async () => {
    /*
     * app.post_settlement_reversal is executable by authenticated so that
     * cancellation can call it, so it is worth proving it grants nothing on a
     * rental that has not been cancelled: the insert policy still demands
     * manager, and the trigger still demands a faithful mirror.
     */
    const rental = await makeRental({ status: 'reserved' })
    const line = await addLine(rental)

    await db.expectRejection(() =>
      db.asUser(staffId, (s) =>
        s.sql(
          `select app.post_settlement_reversal(l.*) from public.rental_line_items l where l.id = $1`,
          [line],
        ),
      ),
    )
  })

  it('cannot settle another agency’s booking', async () => {
    const theirs = await makeRental({
      status: 'reserved',
      orgId: otherOrganizationId,
      vehicle: otherVehicleId,
      customer: otherCustomerId,
    })
    await addLine(theirs, { kind: 'base_rental', amount: 9_000, orgId: otherOrganizationId })

    await db.expectRejection(() =>
      db.asUser(managerId, (s) => s.sql(`select app.settle_cancelled_rental($1, 0)`, [theirs])),
    )
  })
})

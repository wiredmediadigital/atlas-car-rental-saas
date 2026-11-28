// @vitest-environment node
/**
 * An authorized restatement of a finalized hire leaves a record of itself.
 *
 * The defect being closed: a confirmed reservation could be repriced and the
 * previous hire amount simply vanished. Where an issued contract existed, the
 * superseded version preserved it; where none existed, nothing did. Contract
 * issuance is a manual act, so history depended on whether somebody happened
 * to press a button.
 *
 * The assertions that matter most are the ones about what is STILL THERE after
 * an amendment, not the ones about the new figure. A test that only checked
 * the revised amount would pass just as happily against the old behaviour.
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
let periodCursor = Date.UTC(2030, 0, 1, 9, 0, 0)
let plateCursor = 0

/** The vehicle day rate every fixture here is priced from. */
const RATE = 5_000

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
     values ($1, 'Test', 'Amend', $2, 'EUR', $3) returning id`,
    [orgId, `AMD-${String(plateCursor).padStart(4, '0')}`, RATE],
  )
  return row!.id
}

async function makeCustomer(orgId: string): Promise<string> {
  const [row] = await db.sql<{ id: string }>(
    `insert into public.customers (organization_id, first_name, last_name)
     values ($1, 'Amend', 'Customer') returning id`,
    [orgId],
  )
  return row!.id
}

interface RentalOptions {
  status?: string
  orgId?: string
  vehicle?: string
  customer?: string
  days?: number
}

async function makeRental(options: RentalOptions = {}): Promise<string> {
  const period = nextPeriod(options.days ?? 3)
  const [row] = await db.sql<{ id: string }>(
    `insert into public.rentals
       (organization_id, vehicle_id, customer_id, starts_at, ends_at, currency, status,
        deposit_minor, tax_rate_bps, daily_rate_minor)
     values ($1, $2, $3, $4::timestamptz, $5::timestamptz, 'EUR', $6::public.rental_status,
             0, 2000, $7)
     returning id`,
    [
      options.orgId ?? organizationId,
      options.vehicle ?? vehicleId,
      options.customer ?? customerId,
      period.startsAt,
      period.endsAt,
      options.status ?? 'draft',
      RATE,
    ],
  )
  return row!.id
}

/** A hire line, written as the owner so each test controls its starting point. */
async function addHire(rentalId: string, amount: number, orgId = organizationId): Promise<string> {
  const [row] = await db.sql<{ id: string }>(
    `insert into public.rental_line_items
       (organization_id, rental_id, kind, description, quantity,
        unit_amount_minor, amount_minor, currency, is_taxable)
     values ($1, $2, 'base_rental', 'Hire', 1, $3, $3, 'EUR', true)
     returning id`,
    [orgId, rentalId, amount],
  )
  return row!.id
}

interface Amendment {
  id: string
  kind: string
  previous_amount_minor: number
  revised_amount_minor: number
  difference_minor: number
  currency: string
  changes: Record<string, { from: unknown; to: unknown }>
  contract_version: number | null
  reason: string | null
  amended_by: string | null
  line_item_id: string | null
}

async function amendments(rentalId: string): Promise<Amendment[]> {
  return db.sql<Amendment>(
    `select id, kind, previous_amount_minor, revised_amount_minor, difference_minor,
            currency, changes, contract_version, reason, amended_by, line_item_id
       from public.rental_pricing_amendments
      where rental_id = $1
      order by amended_at, id`,
    [rentalId],
  )
}

const hireOf = (rentalId: string) =>
  db.sql<{ id: string; amount_minor: number; quantity: number }>(
    `select id, amount_minor, quantity from public.rental_line_items
      where rental_id = $1 and kind = 'base_rental' and reverses_line_item_id is null
      order by sort_order, created_at limit 1`,
    [rentalId],
  )

const repriceAs = (userId: string, rentalId: string) =>
  db.asUser(userId, (session) => session.sql(`select public.rental_reprice($1)`, [rentalId]))

const extendAs = (userId: string, rentalId: string, endsAt: string, charge = 0, reason?: string) =>
  db.asUser(userId, (session) =>
    session.sql(`select public.rental_extend($1, $2::timestamptz, $3, $4, $5)`, [
      rentalId,
      endsAt,
      charge,
      reason ?? null,
      2,
    ]),
  )

async function endsAtOf(rentalId: string): Promise<string> {
  const [row] = await db.sql<{ ends_at: Date }>(
    `select ends_at from public.rentals where id = $1`,
    [rentalId],
  )
  return row!.ends_at.toISOString()
}

/** A uuid as a SQL literal; a DO block takes no parameters. */
function literal(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

beforeAll(async () => {
  db = await TestDatabase.create()

  const owner = await signUp(db, { email: 'owner@amend.test', organizationName: 'Amend Co' })
  ownerId = owner.userId
  organizationId = owner.organizationId!

  const manager = await signUp(db, { email: 'manager@amend.test' })
  managerId = manager.userId
  await addMember(db, organizationId, managerId, 'manager')

  const staff = await signUp(db, { email: 'staff@amend.test' })
  staffId = staff.userId
  await addMember(db, organizationId, staffId, 'staff')

  vehicleId = await makeVehicle(organizationId)
  customerId = await makeCustomer(organizationId)

  const other = await signUp(db, {
    email: 'owner@amend-other.test',
    organizationName: 'Other Amend',
  })
  otherOwnerId = other.userId
  otherOrganizationId = other.organizationId!
  otherVehicleId = await makeVehicle(otherOrganizationId)
  otherCustomerId = await makeCustomer(otherOrganizationId)
}, 180_000)

afterAll(async () => {
  await db.close()
})

describe('a reservation repriced before any contract exists', () => {
  it('keeps the previous hire amount, which nothing used to keep', async () => {
    /*
     * THE REGRESSION TEST FOR THE DEFECT. The reported case: a confirmed
     * reservation repriced from 1 to 15,000 with no contract versions in
     * existence and nowhere for the earlier figure to survive.
     */
    const rental = await makeRental({ status: 'reserved' })
    await addHire(rental, 1)

    await repriceAs(staffId, rental)

    const [record] = await amendments(rental)
    expect(record, 'the reprice recorded nothing').toBeDefined()
    expect(Number(record!.previous_amount_minor)).toBe(1)
    expect(Number(record!.revised_amount_minor)).toBe(15_000)
    expect(Number(record!.difference_minor)).toBe(14_999)
    expect(record!.kind).toBe('reprice')
  })

  it('records it without issuing a contract', async () => {
    // Issuing one would supersede live versions, surface a document nobody
    // asked for, and permanently change what the rental is. History must not
    // cost that much.
    const rental = await makeRental({ status: 'reserved' })
    await addHire(rental, 1)

    await repriceAs(staffId, rental)

    const [row] = await db.sql<{ n: number }>(
      `select count(*)::int as n from public.rental_contracts where rental_id = $1`,
      [rental],
    )
    expect(row!.n).toBe(0)
    expect((await amendments(rental))[0]?.contract_version).toBeNull()
  })

  it('names the operator and the hire line it restated', async () => {
    const rental = await makeRental({ status: 'reserved' })
    const hire = await addHire(rental, 1)

    await repriceAs(managerId, rental)

    const [record] = await amendments(rental)
    expect(record!.amended_by).toBe(managerId)
    expect(record!.line_item_id).toBe(hire)
    expect(record!.currency).toBe('EUR')
  })

  it('records what moved, and only what moved', async () => {
    const rental = await makeRental({ status: 'reserved' })
    await addHire(rental, 1)

    await repriceAs(staffId, rental)

    const changes = (await amendments(rental))[0]!.changes
    // Repricing restates the charge; it never moves the booking.
    expect(changes).not.toHaveProperty('starts_at')
    expect(changes).not.toHaveProperty('ends_at')
    expect(changes).toHaveProperty('unit_amount_minor')
    expect(changes).toHaveProperty('total_minor')
  })
})

describe('a reservation repriced after a contract exists', () => {
  it('records the amendment and leaves every contract version alone', async () => {
    const rental = await makeRental({ status: 'reserved' })
    await addHire(rental, 1)
    await db.asUser(ownerId, (s) =>
      s.sql(`select public.rental_issue_contract($1, 'first')`, [rental]),
    )

    const [before] = await db.sql<{ version: number; snapshot: unknown }>(
      `select version, snapshot from public.rental_contracts where rental_id = $1 and version = 1`,
      [rental],
    )

    await repriceAs(staffId, rental)

    const [after] = await db.sql<{ version: number; snapshot: unknown }>(
      `select version, snapshot from public.rental_contracts where rental_id = $1 and version = 1`,
      [rental],
    )
    expect(JSON.stringify(after!.snapshot)).toBe(JSON.stringify(before!.snapshot))

    const [record] = await amendments(rental)
    expect(Number(record!.previous_amount_minor)).toBe(1)
    expect(record!.contract_version).toBe(1)
  })

  it('still has exactly one contract version afterwards', async () => {
    const rental = await makeRental({ status: 'reserved' })
    await addHire(rental, 1)
    await db.asUser(ownerId, (s) =>
      s.sql(`select public.rental_issue_contract($1, 'only')`, [rental]),
    )

    await repriceAs(staffId, rental)

    const [row] = await db.sql<{ n: number }>(
      `select count(*)::int as n from public.rental_contracts where rental_id = $1`,
      [rental],
    )
    expect(row!.n).toBe(1)
  })
})

describe('an extension', () => {
  it('records the previous and revised hire, dates and duration', async () => {
    const rental = await makeRental({ status: 'active' })
    await addHire(rental, 15_000)
    const before = await endsAtOf(rental)
    const later = new Date(new Date(before).getTime() + 2 * DAY).toISOString()

    await extendAs(staffId, rental, later, 10_000)

    const [record] = await amendments(rental)
    expect(record!.kind).toBe('extension')
    expect(Number(record!.previous_amount_minor)).toBe(15_000)
    expect(Number(record!.revised_amount_minor)).toBe(25_000)
    expect(record!.changes).toHaveProperty('ends_at')
    expect(record!.changes).toHaveProperty('quantity')
    expect(record!.changes).toHaveProperty('billable_days')
  })

  it('keeps the reason the desk typed, which used to be discarded', async () => {
    /*
     * p_charge_description was accepted and thrown away by every previous
     * version of rental_extend -- the body literally ended `perform
     * p_charge_description;`. It is the reason the desk already types.
     */
    const rental = await makeRental({ status: 'active' })
    await addHire(rental, 15_000)
    const later = new Date(new Date(await endsAtOf(rental)).getTime() + 2 * DAY).toISOString()

    await extendAs(staffId, rental, later, 10_000, 'Flight delayed by two days')

    expect((await amendments(rental))[0]!.reason).toBe('Flight delayed by two days')
  })

  it('keeps each of several consecutive amendments', async () => {
    const rental = await makeRental({ status: 'active' })
    await addHire(rental, 15_000)

    for (const note of ['first', 'second', 'third']) {
      const later = new Date(new Date(await endsAtOf(rental)).getTime() + 2 * DAY).toISOString()
      await extendAs(staffId, rental, later, 5_000, note)
    }

    const history = await amendments(rental)
    expect(history).toHaveLength(3)
    expect(history.map((a) => a.reason)).toEqual(['first', 'second', 'third'])
    // Each one's previous amount is the one before it: a chain, not snapshots
    // that happen to sit near each other.
    expect(history.map((a) => Number(a.previous_amount_minor))).toEqual([15_000, 20_000, 25_000])
    expect(history.map((a) => Number(a.revised_amount_minor))).toEqual([20_000, 25_000, 30_000])
  })
})

describe('a failed pricing operation leaves nothing behind', () => {
  it('records nothing when repricing is refused', async () => {
    const rental = await makeRental({ status: 'completed' })
    await addHire(rental, 15_000)

    await db.expectRejection(() => repriceAs(staffId, rental), /draft or a confirmed reservation/i)

    expect(await amendments(rental)).toHaveLength(0)
  })

  it('records nothing when an extension is refused', async () => {
    const rental = await makeRental({ status: 'active' })
    await addHire(rental, 15_000)
    const earlier = new Date(new Date(await endsAtOf(rental)).getTime() - DAY).toISOString()

    await db.expectRejection(() => extendAs(staffId, rental, earlier, 5_000), /must end after/i)

    expect(await amendments(rental)).toHaveLength(0)
  })

  it('leaves the hire and the history together when an extension fails late', async () => {
    // The amendment and the pricing change are one transaction: neither can
    // survive the other.
    const rental = await makeRental({ status: 'active' })
    await addHire(rental, 15_000)
    const before = await hireOf(rental)

    await db.expectRejection(() =>
      extendAs(staffId, rental, new Date(Date.UTC(2020, 0, 1)).toISOString(), 5_000),
    )

    expect(Number((await hireOf(rental))[0]!.amount_minor)).toBe(Number(before[0]!.amount_minor))
    expect(await amendments(rental)).toHaveLength(0)
  })
})

describe('the history cannot be written, altered or erased from outside', () => {
  it('refuses a direct insert by a staff member', async () => {
    const rental = await makeRental({ status: 'reserved' })
    await addHire(rental, 1)

    await db.expectRejection(
      () =>
        db.asUser(staffId, (s) =>
          s.sql(
            `insert into public.rental_pricing_amendments
               (organization_id, rental_id, kind, previous_amount_minor,
                revised_amount_minor, currency)
             values ($1, $2, 'reprice', 1, 2, 'EUR')`,
            [organizationId, rental],
          ),
        ),
      /permission denied/i,
    )
  })

  it('refuses a direct insert by an owner', async () => {
    const rental = await makeRental({ status: 'reserved' })
    await addHire(rental, 1)

    await db.expectRejection(
      () =>
        db.asUser(ownerId, (s) =>
          s.sql(
            `insert into public.rental_pricing_amendments
               (organization_id, rental_id, kind, previous_amount_minor,
                revised_amount_minor, currency)
             values ($1, $2, 'reprice', 1, 2, 'EUR')`,
            [organizationId, rental],
          ),
        ),
      /permission denied/i,
    )
  })

  it('refuses an update of a recorded amendment', async () => {
    const rental = await makeRental({ status: 'reserved' })
    await addHire(rental, 1)
    await repriceAs(staffId, rental)
    const [record] = await amendments(rental)

    await db.expectRejection(
      () =>
        db.asUser(ownerId, (s) =>
          s.sql(
            `update public.rental_pricing_amendments set previous_amount_minor = 999 where id = $1`,
            [record!.id],
          ),
        ),
      /permission denied/i,
    )

    expect(Number((await amendments(rental))[0]!.previous_amount_minor)).toBe(1)
  })

  it('refuses a delete of a recorded amendment', async () => {
    const rental = await makeRental({ status: 'reserved' })
    await addHire(rental, 1)
    await repriceAs(staffId, rental)
    const [record] = await amendments(rental)

    await db.expectRejection(
      () =>
        db.asUser(ownerId, (s) =>
          s.sql(`delete from public.rental_pricing_amendments where id = $1`, [record!.id]),
        ),
      /permission denied/i,
    )

    expect(await amendments(rental)).toHaveLength(1)
  })

  it('does not show one agency another agency’s amendments', async () => {
    const theirs = await makeRental({
      status: 'reserved',
      orgId: otherOrganizationId,
      vehicle: otherVehicleId,
      customer: otherCustomerId,
    })
    await addHire(theirs, 1, otherOrganizationId)
    await repriceAs(otherOwnerId, theirs)

    // Really there, when its own agency looks.
    const mine = await db.asUser(otherOwnerId, (s) =>
      s.sql<{ n: number }>(
        `select count(*)::int as n from public.rental_pricing_amendments where rental_id = $1`,
        [theirs],
      ),
    )
    expect(mine[0]!.n).toBe(1)

    const seen = await db.asUser(ownerId, (s) =>
      s.sql<{ n: number }>(
        `select count(*)::int as n from public.rental_pricing_amendments where rental_id = $1`,
        [theirs],
      ),
    )
    expect(seen[0]!.n).toBe(0)
  })

  it('keeps the privileged recorder out of reach of signed-in callers', async () => {
    const reachable = await db.sql<{ proname: string }>(
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'app'
          and p.proname in ('record_rental_pricing_amendment',
                            'require_rental_pricing_amendment_evidence')
          and (has_function_privilege('anon', p.oid, 'EXECUTE')
               or has_function_privilege('authenticated', p.oid, 'EXECUTE'))`,
    )
    expect(reachable).toEqual([])
  })
})

describe('the evidence requirement', () => {
  it('refuses a restated hire that recorded nothing, even to the table owner', async () => {
    /*
     * The guarantee behind the whole correction. A future pricing path that
     * forgets to record what it did cannot commit -- the check is deferred to
     * commit, so it asks the only question that matters: by the time this
     * transaction finished, was there a record?
     */
    const rental = await makeRental({ status: 'reserved' })
    const hire = await addHire(rental, 15_000)

    await db.expectRejection(
      () => db.sql(`update public.rental_line_items set amount_minor = 1 where id = $1`, [hire]),
      /restated without recording what changed/i,
    )

    expect(Number((await hireOf(rental))[0]!.amount_minor)).toBe(15_000)
  })

  it('leaves a draft hire alone, which is still being written', async () => {
    const rental = await makeRental({ status: 'draft' })
    const hire = await addHire(rental, 15_000)

    await db.sql(`update public.rental_line_items set amount_minor = 9_000 where id = $1`, [hire])

    expect(Number((await hireOf(rental))[0]!.amount_minor)).toBe(9_000)
    expect(await amendments(rental)).toHaveLength(0)
  })

  it('does not ask for evidence when nothing financial moved', async () => {
    const rental = await makeRental({ status: 'reserved' })
    const hire = await addHire(rental, 15_000)

    await db.sql(`update public.rental_line_items set description = 'Renamed' where id = $1`, [
      hire,
    ])

    expect(await amendments(rental)).toHaveLength(0)
  })
})

describe('everything that already worked still works', () => {
  it('reprices a draft without recording amendment history', async () => {
    const rental = await makeRental({ status: 'draft' })
    await addHire(rental, 1)

    await repriceAs(staffId, rental)

    expect(Number((await hireOf(rental))[0]!.amount_minor)).toBe(15_000)
    expect(await amendments(rental)).toHaveLength(0)
  })

  it('keeps the finalized charge protection from the previous migration', async () => {
    const rental = await makeRental({ status: 'reserved' })
    await addHire(rental, 15_000)
    const [extra] = await db.sql<{ id: string }>(
      `insert into public.rental_line_items
         (organization_id, rental_id, kind, description, quantity,
          unit_amount_minor, amount_minor, currency, is_taxable)
       values ($1, $2, 'cleaning', 'Valet', 1, 3000, 3000, 'EUR', true) returning id`,
      [organizationId, rental],
    )

    await db.expectRejection(
      () =>
        db.asUser(staffId, (s) =>
          s.sql(`delete from public.rental_line_items where id = $1`, [extra!.id]),
        ),
      /cannot be deleted/i,
    )
  })

  it('still lets a manager reverse a posted charge', async () => {
    const rental = await makeRental({ status: 'reserved' })
    await addHire(rental, 15_000)
    const [extra] = await db.sql<{ id: string }>(
      `insert into public.rental_line_items
         (organization_id, rental_id, kind, description, quantity,
          unit_amount_minor, amount_minor, currency, is_taxable)
       values ($1, $2, 'cleaning', 'Valet', 1, 3000, 3000, 'EUR', true) returning id`,
      [organizationId, rental],
    )

    await db.asUser(managerId, (s) =>
      s.sql(`select public.rental_reverse_charge($1, 'Not carried out')`, [extra!.id]),
    )

    const [row] = await db.sql<{ n: number }>(
      `select count(*)::int as n from public.rental_line_items where reverses_line_item_id = $1`,
      [extra!.id],
    )
    expect(row!.n).toBe(1)
  })

  it('keeps the totals right after an amendment', async () => {
    const rental = await makeRental({ status: 'reserved' })
    await addHire(rental, 1)

    await repriceAs(staffId, rental)

    const [row] = await db.sql<{ subtotal_minor: number; total_minor: number }>(
      `select subtotal_minor, total_minor from public.rentals where id = $1`,
      [rental],
    )
    // 15,000 of hire at 20% tax.
    expect(Number(row!.subtotal_minor)).toBe(15_000)
    expect(Number(row!.total_minor)).toBe(18_000)
  })

  it('still settles a cancellation by reversal', async () => {
    const rental = await makeRental({ status: 'reserved' })
    await addHire(rental, 18_000)

    await db.asUser(managerId, (s) =>
      s.sql(`select public.rental_cancel($1, 'changed plans', 5000)`, [rental]),
    )

    const lines = await db.sql<{ amount_minor: number; is_reversal: boolean }>(
      `select amount_minor, reverses_line_item_id is not null as is_reversal
         from public.rental_line_items where rental_id = $1 order by created_at`,
      [rental],
    )
    expect(lines.some((l) => l.is_reversal)).toBe(true)
    expect(lines.some((l) => Number(l.amount_minor) === 18_000 && !l.is_reversal)).toBe(true)
  })
})

describe('the evidence has to describe the mutation it is offered for', () => {
  /*
   * Matching on rental and transaction alone was not enough, and this is the
   * case that proved it: one amendment row satisfied every hire restatement in
   * the same transaction, so an operation that recorded its first change and
   * then quietly made a second committed happily.
   */
  const restateTwiceRecordingOnce = (rentalId: string, lineId: string) =>
    db.sql(`do $t$
      declare
        v_before public.rentals;
        v_after  public.rentals;
        v_line   public.rental_line_items;
        v_new    public.rental_line_items;
      begin
        select * into v_before from public.rentals where id = ${literal(rentalId)};
        select * into v_line from public.rental_line_items where id = ${literal(lineId)};
        update public.rental_line_items set amount_minor = 20000 where id = ${literal(lineId)}
        returning * into v_new;
        select * into v_after from public.rentals where id = ${literal(rentalId)};
        perform app.record_rental_pricing_amendment(
          v_before, v_line, v_after, v_new,
          'reprice'::public.rental_amendment_kind, 'the only one recorded');
        update public.rental_line_items set amount_minor = 99999 where id = ${literal(lineId)};
      end
      $t$;`)

  it('refuses a second restatement that rode on the first one’s record', async () => {
    const rental = await makeRental({ status: 'reserved' })
    const hire = await addHire(rental, 10_000)

    await db.expectRejection(
      () => restateTwiceRecordingOnce(rental, hire),
      /restated without recording what changed/i,
    )

    expect(Number((await hireOf(rental))[0]!.amount_minor)).toBe(10_000)
    expect(await amendments(rental)).toHaveLength(0)
  })

  it('refuses when the recorded amounts do not match what actually happened', async () => {
    const rental = await makeRental({ status: 'reserved' })
    const hire = await addHire(rental, 10_000)

    await db.expectRejection(
      () =>
        db.sql(`do $t$
          declare
            v_before public.rentals; v_after public.rentals;
            v_line public.rental_line_items; v_new public.rental_line_items;
          begin
            select * into v_before from public.rentals where id = ${literal(rental)};
            select * into v_line from public.rental_line_items where id = ${literal(hire)};
            update public.rental_line_items set amount_minor = 20000 where id = ${literal(hire)}
            returning * into v_new;
            select * into v_after from public.rentals where id = ${literal(rental)};
            -- the record claims a different revised figure than the one written
            v_new.amount_minor := 12345;
            perform app.record_rental_pricing_amendment(
              v_before, v_line, v_after, v_new,
              'reprice'::public.rental_amendment_kind, 'wrong figure');
          end
          $t$;`),
      /restated without recording what changed/i,
    )

    expect(Number((await hireOf(rental))[0]!.amount_minor)).toBe(10_000)
  })

  it('refuses an amendment recorded against a different rental', async () => {
    const amended = await makeRental({ status: 'reserved' })
    const hire = await addHire(amended, 10_000)
    const other = await makeRental({ status: 'reserved' })
    const otherHire = await addHire(other, 10_000)

    await db.expectRejection(
      () =>
        db.sql(`do $t$
          declare
            v_before public.rentals; v_after public.rentals;
            v_line public.rental_line_items; v_new public.rental_line_items;
          begin
            -- record a genuine amendment for the OTHER rental
            select * into v_before from public.rentals where id = ${literal(other)};
            select * into v_line from public.rental_line_items where id = ${literal(otherHire)};
            update public.rental_line_items set amount_minor = 20000 where id = ${literal(otherHire)}
            returning * into v_new;
            select * into v_after from public.rentals where id = ${literal(other)};
            perform app.record_rental_pricing_amendment(
              v_before, v_line, v_after, v_new,
              'reprice'::public.rental_amendment_kind, 'for the other rental');
            -- then restate THIS one without recording anything for it
            update public.rental_line_items set amount_minor = 77777 where id = ${literal(hire)};
          end
          $t$;`),
      /restated without recording what changed/i,
    )

    expect(Number((await hireOf(amended))[0]!.amount_minor)).toBe(10_000)
  })

  it('does not accept an amendment left behind by an earlier transaction', async () => {
    // pg_current_xact_id() differs per transaction, so yesterday's record
    // cannot vouch for today's change.
    const rental = await makeRental({ status: 'reserved' })
    const hire = await addHire(rental, 1)

    await repriceAs(staffId, rental)
    expect(await amendments(rental)).toHaveLength(1)

    await db.expectRejection(
      () => db.sql(`update public.rental_line_items set amount_minor = 1 where id = $1`, [hire]),
      /restated without recording what changed/i,
    )

    expect(await amendments(rental)).toHaveLength(1)
  })

  it('rolls back the pricing change and its record together', async () => {
    const rental = await makeRental({ status: 'reserved' })
    const hire = await addHire(rental, 10_000)

    await db.expectRejection(
      () =>
        db.sql(`do $t$
          declare
            v_before public.rentals; v_after public.rentals;
            v_line public.rental_line_items; v_new public.rental_line_items;
          begin
            select * into v_before from public.rentals where id = ${literal(rental)};
            select * into v_line from public.rental_line_items where id = ${literal(hire)};
            update public.rental_line_items set amount_minor = 20000 where id = ${literal(hire)}
            returning * into v_new;
            select * into v_after from public.rentals where id = ${literal(rental)};
            perform app.record_rental_pricing_amendment(
              v_before, v_line, v_after, v_new,
              'reprice'::public.rental_amendment_kind, 'then fail');
            raise exception 'deliberate failure after a valid amendment';
          end
          $t$;`),
      /deliberate failure/i,
    )

    expect(Number((await hireOf(rental))[0]!.amount_minor)).toBe(10_000)
    expect(await amendments(rental)).toHaveLength(0)
  })

  it('keeps each of two genuinely recorded restatements in one transaction', async () => {
    // The tightening must not refuse honest work: two changes, two records.
    const rental = await makeRental({ status: 'reserved' })
    const hire = await addHire(rental, 10_000)

    await db.sql(`do $t$
      declare
        v_before public.rentals; v_after public.rentals;
        v_line public.rental_line_items; v_new public.rental_line_items;
      begin
        select * into v_before from public.rentals where id = ${literal(rental)};
        select * into v_line from public.rental_line_items where id = ${literal(hire)};
        update public.rental_line_items set amount_minor = 20000 where id = ${literal(hire)}
        returning * into v_new;
        select * into v_after from public.rentals where id = ${literal(rental)};
        perform app.record_rental_pricing_amendment(
          v_before, v_line, v_after, v_new,
          'reprice'::public.rental_amendment_kind, 'first');

        v_before := v_after; v_line := v_new;
        update public.rental_line_items set amount_minor = 30000 where id = ${literal(hire)}
        returning * into v_new;
        select * into v_after from public.rentals where id = ${literal(rental)};
        perform app.record_rental_pricing_amendment(
          v_before, v_line, v_after, v_new,
          'reprice'::public.rental_amendment_kind, 'second');
      end
      $t$;`)

    const history = await amendments(rental)
    expect(history).toHaveLength(2)
    expect(history.map((a) => Number(a.previous_amount_minor))).toEqual([10_000, 20_000])
    expect(history.map((a) => Number(a.revised_amount_minor))).toEqual([20_000, 30_000])
    expect(Number((await hireOf(rental))[0]!.amount_minor)).toBe(30_000)
  })
})

describe('one amendment per restatement, and exactly one', () => {
  /*
   * The signature match this replaces was not wrong so much as insufficient:
   * it asked whether a record LOOKED LIKE this change, and two identical
   * changes both answered yes with one record. The revision number asks which
   * change, which is a different question.
   */
  const restate = (lineId: string, amount: number, record: boolean, reason: string) => `
    select * into v_b from public.rentals where id = v_rental_id;
    select * into v_l from public.rental_line_items where id = ${literal(lineId)};
    update public.rental_line_items set amount_minor = ${Number(amount)}
     where id = ${literal(lineId)} returning * into v_n;
    select * into v_a from public.rentals where id = v_rental_id;
    ${
      record
        ? `perform app.record_rental_pricing_amendment(v_b, v_l, v_a, v_n,
             'reprice'::public.rental_amendment_kind, ${literal(reason)});`
        : '-- deliberately unrecorded'
    }`

  const oscillate = (rentalId: string, lineId: string, recordThird: boolean) =>
    db.sql(`do $t$
      declare
        v_rental_id uuid := ${literal(rentalId)};
        v_b public.rentals; v_a public.rentals;
        v_l public.rental_line_items; v_n public.rental_line_items;
      begin
        ${restate(lineId, 20000, true, 'first')}
        ${restate(lineId, 10000, true, 'second')}
        ${restate(lineId, 20000, recordThird, 'third')}
      end
      $t$;`)

  it('refuses the oscillation that the signature match used to allow', async () => {
    // 100 -> 200, 200 -> 100, 100 -> 200 with only the first two recorded. The
    // third has the same signature as the first, and used to ride on it.
    const rental = await makeRental({ status: 'reserved' })
    const hire = await addHire(rental, 10_000)

    await db.expectRejection(
      () => oscillate(rental, hire, false),
      /restated without recording what changed/i,
    )

    expect(Number((await hireOf(rental))[0]!.amount_minor)).toBe(10_000)
    expect(await amendments(rental)).toHaveLength(0)
  })

  it('accepts the same oscillation when every step is recorded', async () => {
    const rental = await makeRental({ status: 'reserved' })
    const hire = await addHire(rental, 10_000)

    await oscillate(rental, hire, true)

    const history = await amendments(rental)
    expect(history).toHaveLength(3)
    expect(history.map((a) => `${a.previous_amount_minor}->${a.revised_amount_minor}`)).toEqual([
      '10000->20000',
      '20000->10000',
      '10000->20000',
    ])
  })

  it('keeps two identical pricing transitions apart', async () => {
    // The first and third transitions above are identical in every field. They
    // are still two amendments, because they are two revisions.
    const rental = await makeRental({ status: 'reserved' })
    const hire = await addHire(rental, 10_000)
    await oscillate(rental, hire, true)

    const revisions = await db.sql<{ line_revision_no: number }>(
      `select line_revision_no from public.rental_pricing_amendments
        where rental_id = $1 order by line_revision_no`,
      [rental],
    )
    expect(revisions.map((r) => Number(r.line_revision_no))).toEqual([1, 2, 3])
  })

  it('leaves the last recorded amount equal to the live hire', async () => {
    // The property the defect broke: read back, the history used to say 10000
    // while the hire stood at 20000.
    const rental = await makeRental({ status: 'reserved' })
    const hire = await addHire(rental, 10_000)
    await oscillate(rental, hire, true)

    const history = await amendments(rental)
    const live = await hireOf(rental)
    expect(Number(history[history.length - 1]!.revised_amount_minor)).toBe(
      Number(live[0]!.amount_minor),
    )
  })

  it('will not let two records claim the same revision', async () => {
    const rental = await makeRental({ status: 'reserved' })
    await addHire(rental, 10_000)
    await repriceAs(staffId, rental)
    const [record] = await amendments(rental)

    await db.expectRejection(
      () =>
        db.sql(
          `insert into public.rental_pricing_amendments
             (organization_id, rental_id, line_item_id, line_revision_no, kind,
              previous_amount_minor, revised_amount_minor, currency)
           select organization_id, rental_id, line_item_id, line_revision_no, kind,
                  previous_amount_minor, revised_amount_minor, currency
             from public.rental_pricing_amendments where id = $1`,
          [record!.id],
        ),
      /duplicate key|unique/i,
    )
  })

  it('counts a revision only when the money moved', async () => {
    const rental = await makeRental({ status: 'reserved' })
    const hire = await addHire(rental, 10_000)

    await db.sql(`update public.rental_line_items set description = 'Renamed' where id = $1`, [
      hire,
    ])

    const [row] = await db.sql<{ revision_no: number }>(
      `select revision_no from public.rental_line_items where id = $1`,
      [hire],
    )
    expect(Number(row!.revision_no)).toBe(0)
  })

  it('does not file a record of nothing', async () => {
    /*
     * Two concurrent repricings produce exactly this: the second recomputes,
     * finds the first already did the work, and would otherwise file
     * "15000 -> 15000, difference 0".
     */
    const rental = await makeRental({ status: 'reserved' })
    await addHire(rental, 1)

    await repriceAs(staffId, rental)
    await repriceAs(staffId, rental)

    const history = await amendments(rental)
    expect(history).toHaveLength(1)
    expect(Number(history[0]!.revised_amount_minor)).toBe(15_000)
  })

  it('still records an amendment that moved only the dates', async () => {
    // A zero-value adjustment is a real financial event. Suppression is only
    // for records that say nothing at all.
    const rental = await makeRental({ status: 'active' })
    await addHire(rental, 15_000)
    const later = new Date(new Date(await endsAtOf(rental)).getTime() + 2 * DAY).toISOString()

    await extendAs(staffId, rental, later, 0, 'goodwill extension, no charge')

    const history = await amendments(rental)
    expect(history).toHaveLength(1)
    expect(history[0]!.changes).toHaveProperty('ends_at')
    expect(Number(history[0]!.difference_minor)).toBe(0)
  })

  it('does not let one rental’s evidence answer for another', async () => {
    const amended = await makeRental({ status: 'reserved' })
    const hire = await addHire(amended, 10_000)
    const other = await makeRental({ status: 'reserved' })
    await addHire(other, 10_000)
    await repriceAs(staffId, other)

    await db.expectRejection(
      () =>
        db.sql(`update public.rental_line_items set amount_minor = 20000 where id = $1`, [hire]),
      /restated without recording what changed/i,
    )
  })
})

/*
 * The revision counter and the unique index have to agree about what a
 * "revision" is, and the awkward case is the amendment that moves dates and no
 * money. app.bump_rental_line_item_revision advances the counter only when
 * amount, quantity, unit price or taxability moves -- deliberately, so the
 * counter does not drift on a description edit and start demanding records of
 * changes that never happened.
 *
 * That leaves a question this block answers rather than assumes: can two
 * legitimate date-only amendments, which by definition share a revision, both
 * be recorded?
 */
describe('date-only and zero-value amendments share a revision', () => {
  async function financialRevisionOf(rentalId: string): Promise<number> {
    const [row] = await db.sql<{ revision_no: number }>(
      `select revision_no from public.rental_line_items
        where rental_id = $1 and kind = 'base_rental' and reverses_line_item_id is null
        order by sort_order, created_at limit 1`,
      [rentalId],
    )
    return Number(row!.revision_no)
  }

  async function reservedWithHire() {
    const rental = await makeRental({ status: 'reserved' })
    await addHire(rental, 15_000)
    return rental
  }

  it('records two successive zero-charge extensions', async () => {
    const rental = await reservedWithHire()
    const first = new Date(Date.parse(await endsAtOf(rental)) + DAY).toISOString()
    await extendAs(ownerId, rental, first, 0, 'Flight delayed')
    const second = new Date(Date.parse(await endsAtOf(rental)) + DAY).toISOString()
    await extendAs(ownerId, rental, second, 0, 'Delayed again')

    const history = await amendments(rental)
    expect(history).toHaveLength(2)
    expect(history.every((a) => Number(a.revised_amount_minor) === 15_000)).toBe(true)
  })

  it('records a date-only amendment followed by a financial one', async () => {
    const rental = await reservedWithHire()
    const later = new Date(Date.parse(await endsAtOf(rental)) + DAY).toISOString()
    await extendAs(ownerId, rental, later, 0, 'Date only')
    const revisionAfterDates = await financialRevisionOf(rental)

    const chargeable = new Date(Date.parse(await endsAtOf(rental)) + DAY).toISOString()
    await extendAs(ownerId, rental, chargeable, 4_000, 'And the money moves')

    expect(await financialRevisionOf(rental)).toBe(revisionAfterDates + 1)
    expect(await amendments(rental)).toHaveLength(2)
  })

  it('moves dates through a reschedule without touching the revision or the history', async () => {
    /*
     * The genuinely date-only operation is rental_reschedule, not a zero-charge
     * extension: extending always moves billable days, so it always moves the
     * line. A reschedule shifts both ends by the same amount, leaves the
     * duration alone, and -- being a pre-commitment operation on a reservation
     * -- files no amendment at all.
     */
    const rental = await reservedWithHire()
    const chargeable = new Date(Date.parse(await endsAtOf(rental)) + DAY).toISOString()
    await extendAs(ownerId, rental, chargeable, 4_000, 'Money first')
    const revisionAfterMoney = await financialRevisionOf(rental)
    const historyAfterMoney = (await amendments(rental)).length

    const [period] = await db.sql<{ starts_at: Date; ends_at: Date }>(
      `select starts_at, ends_at from public.rentals where id = $1`,
      [rental],
    )
    const shifted = (value: Date) => new Date(value.getTime() + 7 * DAY).toISOString()
    await db.asUser(ownerId, (session) =>
      session.sql(
        `select public.rental_reschedule($1, $2::timestamptz, $3::timestamptz, null, false)`,
        [rental, shifted(period!.starts_at), shifted(period!.ends_at)],
      ),
    )

    expect(await financialRevisionOf(rental)).toBe(revisionAfterMoney)
    expect(await amendments(rental)).toHaveLength(historyAfterMoney)
  })

  it('records several zero-value amendments in a row', async () => {
    // Its own vehicle: four extensions walk this hire well past the window the
    // shared fixture vehicle is booked for, and the overlap constraint is right
    // to refuse that.
    const rental = await makeRental({
      status: 'reserved',
      vehicle: await makeVehicle(organizationId),
    })
    await addHire(rental, 15_000)
    for (let n = 0; n < 4; n += 1) {
      const next = new Date(Date.parse(await endsAtOf(rental)) + DAY).toISOString()
      await extendAs(ownerId, rental, next, 0, `Zero value ${n}`)
    }

    const history = await amendments(rental)
    expect(history).toHaveLength(4)
    // Every one of them is a record of nothing financial, and all four survive.
    expect(history.every((a) => Number(a.difference_minor) === 0)).toBe(true)
  })

  it('advances the revision once per financial restatement, and the history keeps pace', async () => {
    const rental = await reservedWithHire()
    const start = await financialRevisionOf(rental)
    for (let n = 0; n < 3; n += 1) {
      const next = new Date(Date.parse(await endsAtOf(rental)) + DAY).toISOString()
      await extendAs(ownerId, rental, next, 1_000, `Chargeable ${n}`)
    }

    expect(await financialRevisionOf(rental)).toBe(start + 3)
    expect(await amendments(rental)).toHaveLength(3)
  })

  it('files nothing for a SECOND repricing, which moves nothing', async () => {
    const rental = await reservedWithHire()
    await repriceAs(ownerId, rental)
    const afterFirst = (await amendments(rental)).length
    const revisionAfterFirst = await financialRevisionOf(rental)

    // The first repricing recomputes a hand-entered hire from the rate card and
    // is a real financial event. The second finds the work already done.
    await repriceAs(ownerId, rental)

    expect(await amendments(rental)).toHaveLength(afterFirst)
    expect(await financialRevisionOf(rental)).toBe(revisionAfterFirst)
  })
})

describe('the evidence check is reached deterministically, not by deadlock', () => {
  /*
   * The independent concurrency run reaches this refusal through a PostgreSQL
   * deadlock, which proves the restatement did not land but NOT that the
   * evidence requirement is what stopped it. These two reach the enforcement
   * mechanism itself, on one connection, with no contention at all.
   */
  it('refuses because no record exists for the revision', async () => {
    const rental = await makeRental({ status: 'reserved' })
    const hire = await addHire(rental, 15_000)

    const message = await db.expectRejection(() =>
      db.sql(`update public.rental_line_items set amount_minor = 20_000 where id = $1`, [hire]),
    )
    expect(message).toMatch(/restated without recording what changed/i)
    expect(Number((await hireOf(rental))[0]!.amount_minor)).toBe(15_000)
  })

  it('refuses because the record that exists describes a different amount', async () => {
    const rental = await makeRental({ status: 'reserved' })
    const hire = await addHire(rental, 15_000)

    /*
     * A record IS filed for this line and this revision -- it simply claims
     * the hire went somewhere it did not. Unique is not the same as true, and
     * this is the assertion that says so.
     */
    await db.expectRejection(
      () =>
        db.sql(
          `do $$
           begin
             insert into public.rental_pricing_amendments (
               organization_id, rental_id, line_item_id, line_revision_no, kind,
               previous_amount_minor, revised_amount_minor, currency, changes)
             select l.organization_id, l.rental_id, l.id, l.revision_no + 1, 'reprice',
                    15000, 99999, 'EUR', '{}'::jsonb
               from public.rental_line_items l where l.id = ${literal(hire)};
             update public.rental_line_items set amount_minor = 20000
              where id = ${literal(hire)};
           end $$;`,
        ),
      /restated without recording what changed/i,
    )

    expect(Number((await hireOf(rental))[0]!.amount_minor)).toBe(15_000)
  })
})

/*
 * Staging carries two amendment rows today, both on RNT-2026-00004, written
 * before line_revision_no existed. After 20261128120000 they will hold NULL in
 * that column. This block is the evidence for the two claims the migration
 * authorization package makes about them.
 */
describe('amendment rows written before the revision column existed', () => {
  async function historicalAmendment(rentalId: string, lineItemId: string) {
    await db.sql(
      `insert into public.rental_pricing_amendments (
         organization_id, rental_id, line_item_id, line_revision_no, kind,
         previous_amount_minor, revised_amount_minor, currency, changes)
       select l.organization_id, l.rental_id, l.id, null, 'reprice',
              15000, 15000, 'EUR', '{}'::jsonb
         from public.rental_line_items l where l.id = $1`,
      [lineItemId],
    )
    void rentalId
  }

  it('stays readable', async () => {
    const rental = await makeRental({ status: 'reserved' })
    const hire = await addHire(rental, 15_000)
    await historicalAmendment(rental, hire)

    const history = await amendments(rental)
    expect(history).toHaveLength(1)
    expect(Number(history[0]!.revised_amount_minor)).toBe(15_000)
  })

  it('does not collide with another row for the same line', async () => {
    const rental = await makeRental({ status: 'reserved' })
    const hire = await addHire(rental, 15_000)
    // The unique index excludes NULL revisions deliberately, so historical
    // rows cannot block each other or block a new one.
    await historicalAmendment(rental, hire)
    await historicalAmendment(rental, hire)

    expect(await amendments(rental)).toHaveLength(2)
  })

  it('cannot satisfy the evidence requirement for a later restatement', async () => {
    const rental = await makeRental({ status: 'reserved' })
    const hire = await addHire(rental, 15_000)
    await historicalAmendment(rental, hire)

    /*
     * The evidence check asks for a row whose line_revision_no EQUALS the
     * line's revision. NULL equals nothing, including itself, so a historical
     * row can never answer for a future mutation -- the restatement is refused
     * and a fresh record is required. A refusal, never a silent acceptance.
     */
    await db.expectRejection(
      () =>
        db.sql(`update public.rental_line_items set amount_minor = 20_000 where id = $1`, [hire]),
      /restated without recording what changed/i,
    )
    expect(Number((await hireOf(rental))[0]!.amount_minor)).toBe(15_000)
  })
})

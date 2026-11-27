// @vitest-environment node
/**
 * The figures a committed rental is priced from are not editable by hand.
 *
 * The charge LINES have been protected since 20261126130000. The inputs those
 * charges are computed from were not: public.rentals carried an update policy
 * that asked for a role and a billing entitlement and said nothing about the
 * state of the rental. On a completed hire a staff member could PATCH the day
 * rate, the tax rate, the currency, the deposit, the billable days, the return
 * date and the customer the rental belonged to.
 *
 * Every refusal below was a success before this migration. The other half of
 * the file is the part that matters just as much: the authorized workflows
 * still work, because a protection that breaks the desk gets turned off.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { TestDatabase, addMember, signUp } from './support/harness'

let db: TestDatabase

let organizationId: string
let staffId: string
let vehicleId: string
let spareVehicleId: string
let customerId: string
let otherCustomerId: string

let otherOrganizationId: string
let otherVehicleId: string
let otherCustomerIdInOtherOrg: string

const DAY = 24 * 60 * 60 * 1000
let periodCursor = Date.UTC(2032, 0, 1, 9, 0, 0)
let plateCursor = 0

function nextPeriod(days = 3): { startsAt: string; endsAt: string } {
  const start = new Date(periodCursor)
  const end = new Date(periodCursor + days * DAY)
  periodCursor += (days + 10) * DAY
  return { startsAt: start.toISOString(), endsAt: end.toISOString() }
}

async function makeVehicle(orgId: string): Promise<string> {
  plateCursor += 1
  const [row] = await db.sql<{ id: string }>(
    `insert into public.vehicles
       (organization_id, make, model, registration_plate, currency, daily_rate_minor)
     values ($1, 'Test', 'Lifecycle', $2, 'EUR', 5000) returning id`,
    [orgId, `LIF-${String(plateCursor).padStart(4, '0')}`],
  )
  return row!.id
}

async function makeCustomer(orgId: string, name = 'Lifecycle'): Promise<string> {
  const [row] = await db.sql<{ id: string }>(
    `insert into public.customers (organization_id, first_name, last_name)
     values ($1, $2, 'Customer') returning id`,
    [orgId, name],
  )
  return row!.id
}

interface RentalOptions {
  status?: string
  orgId?: string
  vehicle?: string
  customer?: string
  days?: number
  withHandover?: boolean
}

async function makeRental(options: RentalOptions = {}): Promise<string> {
  const period = nextPeriod(options.days ?? 3)
  const [row] = await db.sql<{ id: string }>(
    `insert into public.rentals
       (organization_id, vehicle_id, customer_id, starts_at, ends_at, currency, status,
        deposit_minor, tax_rate_bps, daily_rate_minor, billable_days,
        picked_up_at, returned_at, pickup_odometer, return_odometer)
     values ($1, $2, $3, $4::timestamptz, $5::timestamptz, 'EUR', $6::public.rental_status,
             0, 2000, 5000, 3,
             case when $7 then $4::timestamptz else null end,
             case when $7 then $5::timestamptz else null end,
             case when $7 then 10000 else null end,
             case when $7 then 10750 else null end)
     returning id`,
    [
      options.orgId ?? organizationId,
      options.vehicle ?? vehicleId,
      options.customer ?? customerId,
      period.startsAt,
      period.endsAt,
      options.status ?? 'draft',
      options.withHandover ?? false,
    ],
  )
  return row!.id
}

async function addPrimaryDriver(rentalId: string, orgId = organizationId, customer = customerId) {
  await db.sql(
    `insert into public.rental_drivers (organization_id, rental_id, customer_id, driver_role)
     values ($1, $2, $3, 'primary')`,
    [orgId, rentalId, customer],
  )
}

const patchAs = (userId: string, rentalId: string, assignment: string, params: unknown[] = []) =>
  db.asUser(userId, (session) =>
    session.sql(`update public.rentals set ${assignment} where id = $1`, [rentalId, ...params]),
  )

async function statusOf(rentalId: string): Promise<string> {
  const [row] = await db.sql<{ status: string }>(
    `select status from public.rentals where id = $1`,
    [rentalId],
  )
  return row!.status
}

beforeAll(async () => {
  db = await TestDatabase.create()

  const owner = await signUp(db, {
    email: 'owner@lifecycle.test',
    organizationName: 'Lifecycle Co',
  })
  organizationId = owner.organizationId!

  const staff = await signUp(db, { email: 'staff@lifecycle.test' })
  staffId = staff.userId
  await addMember(db, organizationId, staffId, 'staff')

  vehicleId = await makeVehicle(organizationId)
  spareVehicleId = await makeVehicle(organizationId)
  customerId = await makeCustomer(organizationId)
  otherCustomerId = await makeCustomer(organizationId, 'Second')

  const other = await signUp(db, {
    email: 'owner@lifecycle-other.test',
    organizationName: 'Other Lifecycle',
  })
  otherOrganizationId = other.organizationId!
  otherVehicleId = await makeVehicle(otherOrganizationId)
  otherCustomerIdInOtherOrg = await makeCustomer(otherOrganizationId)
}, 180_000)

afterAll(async () => {
  await db.close()
})

describe('a committed rental cannot be repriced by hand', () => {
  it.each([
    ['the collection date', `starts_at = '2033-01-01T09:00:00Z'`, /collection date/i],
    ['the return date', `ends_at = '2033-02-01T09:00:00Z'`, /return date/i],
    ['the days charged', `billable_days = 99`, /days charged/i],
    ['the day rate', `daily_rate_minor = 1`, /day rate/i],
    ['the tax rate', `tax_rate_bps = 0`, /tax rate/i],
    ['the deposit', `deposit_minor = 999999`, /deposit/i],
    ['the currency', `currency = 'USD'`, /currency/i],
  ])('refuses a direct change to %s on a reserved rental', async (_label, assignment, pattern) => {
    const rental = await makeRental({ status: 'reserved' })

    await db.expectRejection(() => patchAs(staffId, rental, assignment), pattern)
  })

  it('refuses moving a completed rental to a different customer', async () => {
    // Re-pointing a finished hire at somebody else moves the money with it.
    const rental = await makeRental({ status: 'completed', withHandover: true })

    await db.expectRejection(
      () => patchAs(staffId, rental, `customer_id = $2`, [otherCustomerId]),
      /customer of a committed rental/i,
    )
  })

  it('refuses a direct change to a cancelled rental’s dates', async () => {
    const rental = await makeRental({ status: 'cancelled' })

    await db.expectRejection(
      () => patchAs(staffId, rental, `ends_at = '2033-02-01T09:00:00Z'`),
      /return date/i,
    )
  })

  it('refuses rewriting a finished rental’s hand-over record', async () => {
    const rental = await makeRental({ status: 'completed', withHandover: true })

    await db.expectRejection(() => patchAs(staffId, rental, `returned_at = null`), /return time/i)
    await db.expectRejection(() => patchAs(staffId, rental, `return_odometer = 1`), /odometer in/i)
  })

  it('still lets the desk edit a draft, which is what a draft is for', async () => {
    const rental = await makeRental({ status: 'draft' })

    await patchAs(staffId, rental, `daily_rate_minor = 7500`)
    await patchAs(staffId, rental, `deposit_minor = 20000`)

    const [row] = await db.sql<{ daily_rate_minor: number; deposit_minor: number }>(
      `select daily_rate_minor, deposit_minor from public.rentals where id = $1`,
      [rental],
    )
    expect(Number(row!.daily_rate_minor)).toBe(7500)
    expect(Number(row!.deposit_minor)).toBe(20000)
  })

  it('still lets the desk annotate a committed rental', async () => {
    // Notes are not a financial input, and freezing them would be the kind of
    // over-correction that gets a protection switched off.
    const rental = await makeRental({ status: 'completed', withHandover: true })

    await patchAs(staffId, rental, `notes = 'Customer called about the deposit'`)

    const [row] = await db.sql<{ notes: string }>(
      `select notes from public.rentals where id = $1`,
      [rental],
    )
    expect(row!.notes).toBe('Customer called about the deposit')
  })

  it('does not refuse a write that changes nothing', async () => {
    const rental = await makeRental({ status: 'reserved' })

    await patchAs(staffId, rental, `tax_rate_bps = tax_rate_bps`)
  })

  it('refuses across tenants without confirming the rental exists', async () => {
    const theirs = await makeRental({
      status: 'reserved',
      orgId: otherOrganizationId,
      vehicle: otherVehicleId,
      customer: otherCustomerIdInOtherOrg,
    })

    // Row level security hides it, so the write matches nothing.
    await patchAs(staffId, theirs, `daily_rate_minor = 1`)

    const [row] = await db.sql<{ daily_rate_minor: number }>(
      `select daily_rate_minor from public.rentals where id = $1`,
      [theirs],
    )
    expect(Number(row!.daily_rate_minor)).toBe(5000)
  })
})

describe('the authorized workflows still work', () => {
  it('confirms a reservation', async () => {
    const rental = await makeRental({ status: 'draft' })
    await addPrimaryDriver(rental)

    await db.asUser(staffId, (s) => s.sql(`select public.rental_confirm($1)`, [rental]))

    expect(await statusOf(rental)).toBe('reserved')
  })

  it('reschedules a reservation', async () => {
    const rental = await makeRental({ status: 'draft' })
    await addPrimaryDriver(rental)
    await db.asUser(staffId, (s) => s.sql(`select public.rental_confirm($1)`, [rental]))

    const [before] = await db.sql<{ starts_at: Date; ends_at: Date }>(
      `select starts_at, ends_at from public.rentals where id = $1`,
      [rental],
    )
    const starts = new Date(before!.starts_at.getTime() + DAY).toISOString()
    const ends = new Date(before!.ends_at.getTime() + DAY).toISOString()

    await db.asUser(staffId, (s) =>
      s.sql(`select public.rental_reschedule($1, $2::timestamptz, $3::timestamptz, null, false)`, [
        rental,
        starts,
        ends,
      ]),
    )

    const [after] = await db.sql<{ starts_at: Date }>(
      `select starts_at from public.rentals where id = $1`,
      [rental],
    )
    expect(after!.starts_at.toISOString()).toBe(starts)
  })

  it('substitutes the vehicle before collection', async () => {
    const rental = await makeRental({ status: 'draft' })
    await addPrimaryDriver(rental)
    await db.asUser(staffId, (s) => s.sql(`select public.rental_confirm($1)`, [rental]))

    await db.asUser(staffId, (s) =>
      s.sql(`select public.rental_substitute_vehicle($1, $2)`, [rental, spareVehicleId]),
    )

    const [row] = await db.sql<{ vehicle_id: string }>(
      `select vehicle_id from public.rentals where id = $1`,
      [rental],
    )
    expect(row!.vehicle_id).toBe(spareVehicleId)
  })

  it('checks a rental out, back in, and completes it', async () => {
    const rental = await makeRental({ status: 'draft' })
    await addPrimaryDriver(rental)
    await db.asUser(staffId, (s) => s.sql(`select public.rental_confirm($1)`, [rental]))

    await db.asUser(staffId, (s) =>
      s.sql(`select public.rental_check_out($1, 10000, 100::smallint, null, now())`, [rental]),
    )
    expect(await statusOf(rental)).toBe('active')

    await db.asUser(staffId, (s) =>
      s.sql(`select public.rental_check_in($1, 10750, 80::smallint, null, now())`, [rental]),
    )

    await db.asUser(staffId, (s) => s.sql(`select public.rental_complete($1)`, [rental]))
    expect(await statusOf(rental)).toBe('completed')

    const [row] = await db.sql<{ returned_at: Date | null; return_odometer: number | null }>(
      `select returned_at, return_odometer from public.rentals where id = $1`,
      [rental],
    )
    expect(row!.returned_at).not.toBeNull()
    expect(Number(row!.return_odometer)).toBe(10750)
  })

  it('cancels a reservation', async () => {
    const rental = await makeRental({ status: 'draft' })
    await addPrimaryDriver(rental)
    await db.asUser(staffId, (s) => s.sql(`select public.rental_confirm($1)`, [rental]))

    await db.asUser(staffId, (s) =>
      s.sql(`select public.rental_cancel($1, 'changed plans', 0)`, [rental]),
    )

    expect(await statusOf(rental)).toBe('cancelled')
  })

  it('extends an active rental and records the amendment', async () => {
    const rental = await makeRental({ status: 'draft' })
    await addPrimaryDriver(rental)
    await db.asUser(staffId, (s) => s.sql(`select public.rental_confirm($1)`, [rental]))
    await db.sql(
      `insert into public.rental_line_items
         (organization_id, rental_id, kind, description, quantity,
          unit_amount_minor, amount_minor, currency, is_taxable)
       values ($1, $2, 'base_rental', 'Hire', 3, 5000, 15000, 'EUR', true)`,
      [organizationId, rental],
    )
    await db.asUser(staffId, (s) =>
      s.sql(`select public.rental_check_out($1, 10000, 100::smallint, null, now())`, [rental]),
    )

    const [before] = await db.sql<{ ends_at: Date }>(
      `select ends_at from public.rentals where id = $1`,
      [rental],
    )
    const later = new Date(before!.ends_at.getTime() + 2 * DAY).toISOString()

    await db.asUser(staffId, (s) =>
      s.sql(`select public.rental_extend($1, $2::timestamptz, 10000, 'Needed longer', 2)`, [
        rental,
        later,
      ]),
    )

    const [amendment] = await db.sql<{
      previous_amount_minor: number
      revised_amount_minor: number
    }>(
      `select previous_amount_minor, revised_amount_minor
         from public.rental_pricing_amendments where rental_id = $1`,
      [rental],
    )
    expect(Number(amendment!.previous_amount_minor)).toBe(15_000)
    expect(Number(amendment!.revised_amount_minor)).toBe(25_000)
  })

  it('reprices a confirmed reservation', async () => {
    const rental = await makeRental({ status: 'draft' })
    await addPrimaryDriver(rental)
    await db.asUser(staffId, (s) => s.sql(`select public.rental_confirm($1)`, [rental]))
    await db.sql(
      `insert into public.rental_line_items
         (organization_id, rental_id, kind, description, quantity,
          unit_amount_minor, amount_minor, currency, is_taxable)
       values ($1, $2, 'base_rental', 'Hire', 1, 1, 1, 'EUR', true)`,
      [organizationId, rental],
    )

    await db.asUser(staffId, (s) => s.sql(`select public.rental_reprice($1)`, [rental]))

    const [line] = await db.sql<{ amount_minor: number }>(
      `select amount_minor from public.rental_line_items
        where rental_id = $1 and kind = 'base_rental' order by created_at limit 1`,
      [rental],
    )
    expect(Number(line!.amount_minor)).toBe(15_000)
  })

  it('still refuses to substitute a vehicle after collection', async () => {
    const rental = await makeRental({ status: 'draft' })
    await addPrimaryDriver(rental)
    await db.asUser(staffId, (s) => s.sql(`select public.rental_confirm($1)`, [rental]))
    await db.asUser(staffId, (s) =>
      s.sql(`select public.rental_check_out($1, 10000, 100::smallint, null, now())`, [rental]),
    )

    await db.expectRejection(
      () =>
        db.asUser(staffId, (s) =>
          s.sql(`select public.rental_substitute_vehicle($1, $2)`, [rental, spareVehicleId]),
        ),
      /before the customer collects/i,
    )
  })

  it('still refuses another agency’s rental', async () => {
    const theirs = await makeRental({
      status: 'reserved',
      orgId: otherOrganizationId,
      vehicle: otherVehicleId,
      customer: otherCustomerIdInOtherOrg,
    })

    await db.expectRejection(
      () => db.asUser(staffId, (s) => s.sql(`select public.rental_reprice($1)`, [theirs])),
      /not found/i,
    )
  })
})

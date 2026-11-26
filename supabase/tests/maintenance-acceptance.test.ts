// @vitest-environment node
/**
 * Maintenance Management manual acceptance remediation.
 *
 * Each case corresponds to a scenario the owner recorded as failed or pending
 * in the 26-scenario acceptance run, so a regression here is a regression
 * against the acceptance baseline itself rather than against an invented one.
 *
 * These run on the repository's PGlite harness, which replays the real ordered
 * migrations. That covers schema, RLS, triggers and lifecycle arithmetic. It
 * does not cover hosted PostgREST or two genuinely independent transactions,
 * and nothing here should be read as manual acceptance.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { TestDatabase, signUp } from './support/harness'

let db: TestDatabase
let ownerId: string
let organizationId: string
let customerId: string

let plateCounter = 0

async function freshVehicle(): Promise<string> {
  plateCounter += 1
  const [row] = await db.sql<{ id: string }>(
    `insert into public.vehicles
       (organization_id, make, model, registration_plate, currency, daily_rate_minor)
     values ($1, 'Test', 'Remediation', $2, 'EUR', 1000) returning id`,
    [organizationId, `MNT-REM-${String(plateCounter).padStart(3, '0')}`],
  )
  return row!.id
}

/**
 * A vehicle carrying the legacy manual 'maintenance' value. Rows like this
 * exist on staging from before maintenance records became the source of truth.
 * They are written at insert time here because that is the only way they can
 * come into being now -- the status guard refuses the update path outright.
 */
async function legacyMaintenanceVehicle(): Promise<string> {
  plateCounter += 1
  const [row] = await db.sql<{ id: string }>(
    `insert into public.vehicles
       (organization_id, make, model, registration_plate, currency, daily_rate_minor, status)
     values ($1, 'Test', 'Legacy', $2, 'EUR', 1000, 'maintenance') returning id`,
    [organizationId, `MNT-LEG-${String(plateCounter).padStart(3, '0')}`],
  )
  return row!.id
}

async function availableBetween(from: string, to: string): Promise<string[]> {
  const rows = await db.asUser(ownerId, (session) =>
    session.sql<{ vehicles_available_between: string }>(
      `select public.vehicles_available_between($1, $2::timestamptz, $3::timestamptz)`,
      [organizationId, from, to],
    ),
  )
  return rows.map((row) => row.vehicles_available_between)
}

async function schedule(
  vehicleId: string,
  title: string,
  startsAt: string | null,
  endsAt: string | null,
  startImmediately = false,
  incidentId: string | null = null,
): Promise<string> {
  const [row] = await db.asUser(ownerId, (session) =>
    session.sql<{ id: string }>(
      `select id from public.maintenance_create(
         $1, $2, $3, 'mechanical_repair', 'normal',
         $4::timestamptz, $5::timestamptz,
         null, null, null, null, null, null, 'EUR', $6, null, $7, null)`,
      [organizationId, vehicleId, title, startsAt, endsAt, incidentId, startImmediately],
    ),
  )
  return row!.id
}

async function fleetRow<T extends Record<string, unknown>>(
  vehicleId: string,
  columns: string,
): Promise<T | undefined> {
  const [row] = await db.asUser(ownerId, (session) =>
    session.sql<T>(`select ${columns} from public.vehicle_fleet where vehicle_id = $1`, [
      vehicleId,
    ]),
  )
  return row
}

beforeAll(async () => {
  db = await TestDatabase.create()
  const account = await signUp(db, {
    email: 'maintenance-acceptance@test.local',
    fullName: 'Acceptance Owner',
    organizationName: 'Acceptance Organization',
    currency: 'EUR',
  })
  ownerId = account.userId
  organizationId = account.organizationId!
  const [customer] = await db.sql<{ id: string }>(
    `insert into public.customers (organization_id, first_name, last_name)
     values ($1, 'Acceptance', 'Renter') returning id`,
    [organizationId],
  )
  customerId = customer!.id
})

afterAll(async () => db?.close())

describe('period-specific maintenance availability', () => {
  it('keeps a vehicle bookable for periods its future maintenance does not cover', async () => {
    const vehicle = await freshVehicle()
    await schedule(vehicle, 'December service', '2036-12-01 19:22+00', '2036-12-01 21:22+00')

    // Ends before it starts, and starts exactly when it ends: both allowed,
    // because the restriction is half-open like every other period here.
    expect(await availableBetween('2036-12-01 15:00+00', '2036-12-01 18:00+00')).toContain(vehicle)
    expect(await availableBetween('2036-12-01 21:22+00', '2036-12-02 09:00+00')).toContain(vehicle)
    expect(await availableBetween('2036-12-02 09:00+00', '2036-12-02 17:00+00')).toContain(vehicle)

    // Overlapping, and fully spanning: both refused.
    expect(await availableBetween('2036-12-01 20:00+00', '2036-12-01 23:00+00')).not.toContain(
      vehicle,
    )
    expect(await availableBetween('2036-11-30 09:00+00', '2036-12-03 09:00+00')).not.toContain(
      vehicle,
    )
  })

  it('does not restrict a vehicle today because work is booked for December', async () => {
    const vehicle = await freshVehicle()
    await schedule(vehicle, 'Later service', '2036-12-01 19:22+00', '2036-12-01 21:22+00')

    const row = await fleetRow<{
      effective_status: string
      is_available_now: boolean
      upcoming_maintenance_reference: string | null
    }>(vehicle, 'effective_status, is_available_now, upcoming_maintenance_reference')

    expect(row?.effective_status).toBe('available')
    expect(row?.is_available_now).toBe(true)
    // The upcoming work is still visible as context.
    expect(row?.upcoming_maintenance_reference).toBeTruthy()
  })

  it('refuses a reservation that overlaps scheduled maintenance, at the database', async () => {
    const vehicle = await freshVehicle()
    await schedule(vehicle, 'Booked window', '2036-12-01 19:22+00', '2036-12-01 21:22+00')

    await db.expectRejection(
      () =>
        db.sql(
          `insert into public.rentals (organization_id, vehicle_id, customer_id, starts_at, ends_at, currency, status)
           values ($1, $2, $3, '2036-12-01 20:00+00', '2036-12-02 10:00+00', 'EUR', 'reserved')`,
          [organizationId, vehicle, customerId],
        ),
      /unavailable during scheduled maintenance/i,
    )
  })
})

describe('immediate and overdue restrictions', () => {
  it('restricts the vehicle the moment maintenance starts early, keeping the agreed dates', async () => {
    const vehicle = await freshVehicle()
    const record = await schedule(
      vehicle,
      'Early start',
      '2036-12-01 19:22+00',
      '2036-12-01 21:22+00',
    )

    await db.asUser(ownerId, (session) =>
      session.sql(`select public.maintenance_start($1, now(), null)`, [record]),
    )

    const row = await fleetRow<{
      effective_status: string
      is_available_now: boolean
      maintenance_actual_start: string | null
      maintenance_scheduled_start: string
    }>(
      vehicle,
      'effective_status, is_available_now, maintenance_actual_start, maintenance_scheduled_start',
    )

    expect(row?.effective_status).toBe('maintenance')
    expect(row?.is_available_now).toBe(false)
    expect(row?.maintenance_actual_start).not.toBeNull()
    // The scheduled window survives the early start.
    expect(new Date(String(row?.maintenance_scheduled_start)).toISOString()).toBe(
      new Date('2036-12-01 19:22+00').toISOString(),
    )

    const now = new Date()
    const soon = new Date(now.getTime() + 60 * 60 * 1000)
    expect(await availableBetween(now.toISOString(), soon.toISOString())).not.toContain(vehicle)
  })

  it('keeps an overdue repair restrictive and refuses to hand the vehicle over', async () => {
    const vehicle = await freshVehicle()

    // A reservation taken before the vehicle broke down.
    const [rental] = await db.sql<{ id: string }>(
      `insert into public.rentals
         (organization_id, vehicle_id, customer_id, starts_at, ends_at, currency, status, daily_rate_minor, billable_days)
       values ($1, $2, $3, now(), now() + interval '2 days', 'EUR', 'draft', 5000, 2) returning id`,
      [organizationId, vehicle, customerId],
    )
    await db.sql(
      `insert into public.rental_drivers (organization_id, rental_id, customer_id, driver_role)
       values ($1, $2, $3, 'primary')`,
      [organizationId, rental!.id, customerId],
    )
    await db.asUser(ownerId, (session) =>
      session.sql(`select public.rental_confirm($1)`, [rental!.id]),
    )

    // Then it broke down. Urgent work is allowed to be recorded despite the
    // existing contract; that is what urgency means here.
    await db.asUser(ownerId, (session) =>
      session.sql(
        `select public.maintenance_create($1, $2, 'Overdue repair', 'mechanical_repair', 'urgent',
           now() - interval '3 days', now() - interval '1 day',
           null, null, null, null, null, null, 'EUR', null, null, true, null)`,
        [organizationId, vehicle],
      ),
    )

    const row = await fleetRow<{ effective_status: string; maintenance_overdue: boolean }>(
      vehicle,
      'effective_status, maintenance_overdue',
    )
    expect(row?.effective_status).toBe('maintenance')
    expect(row?.maintenance_overdue).toBe(true)

    // The real return date is unknown, so no period is promised.
    const now = new Date()
    const later = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
    expect(await availableBetween(now.toISOString(), later.toISOString())).not.toContain(vehicle)

    // Handing the keys over is refused while the work is open, whatever the
    // contract's own dates say.
    await db.expectRejection(
      () =>
        db.asUser(ownerId, (session) =>
          session.sql(`select public.rental_check_out($1, 12000, null, null, now())`, [rental!.id]),
        ),
      /in maintenance/i,
    )
  })

  it('releases only the restriction that was resolved', async () => {
    const vehicle = await freshVehicle()
    const first = await schedule(vehicle, 'First', null, null, true)
    const second = await schedule(vehicle, 'Second', null, null, true)

    await db.asUser(ownerId, (session) =>
      session.sql(`select public.maintenance_complete($1, now(), null, null, null)`, [first]),
    )

    const during = await fleetRow<{ effective_status: string; open_maintenance_count: number }>(
      vehicle,
      'effective_status, open_maintenance_count',
    )
    expect(during?.effective_status).toBe('maintenance')
    expect(Number(during?.open_maintenance_count)).toBe(1)

    await db.asUser(ownerId, (session) =>
      session.sql(`select public.maintenance_complete($1, now(), null, null, null)`, [second]),
    )
    const after = await fleetRow<{ effective_status: string }>(vehicle, 'effective_status')
    expect(after?.effective_status).toBe('available')
  })
})

describe('standard rental integrity', () => {
  it('does not offer a vehicle out on an overdue unreturned hire', async () => {
    const vehicle = await freshVehicle()
    await db.sql(
      `insert into public.rentals (organization_id, vehicle_id, customer_id, starts_at, ends_at, currency, status)
       values ($1, $2, $3, now() - interval '5 days', now() - interval '1 day', 'EUR', 'active')`,
      [organizationId, vehicle, customerId],
    )

    const from = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
    const to = new Date(Date.now() + 32 * 24 * 60 * 60 * 1000).toISOString()
    expect(await availableBetween(from, to)).not.toContain(vehicle)
  })

  it('still offers an unrestricted vehicle for an ordinary future period', async () => {
    const vehicle = await freshVehicle()
    const from = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString()
    const to = new Date(Date.now() + 12 * 24 * 60 * 60 * 1000).toISOString()
    expect(await availableBetween(from, to)).toContain(vehicle)
  })

  it('reschedules a reservation confirmed outside a member session', async () => {
    const vehicle = await freshVehicle()
    const [rental] = await db.sql<{ id: string }>(
      `insert into public.rentals
         (organization_id, vehicle_id, customer_id, starts_at, ends_at, currency, status, daily_rate_minor, billable_days)
       values ($1, $2, $3, now() + interval '2 days', now() + interval '5 days', 'EUR', 'draft', 5000, 3)
       returning id`,
      [organizationId, vehicle, customerId],
    )
    await db.sql(
      `insert into public.rental_drivers (organization_id, rental_id, customer_id, driver_role)
       values ($1, $2, $3, 'primary')`,
      [organizationId, rental!.id, customerId],
    )
    await db.sql(`select public.rental_confirm($1)`, [rental!.id])

    await db.asUser(ownerId, (session) =>
      session.sql(
        `select public.rental_reschedule($1, now() + interval '3 days', now() + interval '6 days')`,
        [rental!.id],
      ),
    )

    const [moved] = await db.sql<{ status: string }>(
      `select status from public.rentals where id = $1`,
      [rental!.id],
    )
    expect(moved?.status).toBe('reserved')
  })

  it('extends a reservation confirmed outside a member session', async () => {
    /*
     * The second doorway onto the same defect. public.rental_extend reaches
     * app.sync_rental_assignment_schedule for a reserved rental, so a booking
     * with no assignment row could not be lengthened either. Covered here
     * because the repair is deliberately not narrowed to rescheduling.
     */
    const vehicle = await freshVehicle()
    const [rental] = await db.sql<{ id: string }>(
      `insert into public.rentals
         (organization_id, vehicle_id, customer_id, starts_at, ends_at, currency, status, daily_rate_minor, billable_days)
       values ($1, $2, $3, now() + interval '60 days', now() + interval '63 days', 'EUR', 'draft', 5000, 3)
       returning id`,
      [organizationId, vehicle, customerId],
    )
    await db.sql(
      `insert into public.rental_drivers (organization_id, rental_id, customer_id, driver_role)
       values ($1, $2, $3, 'primary')`,
      [organizationId, rental!.id, customerId],
    )
    await db.sql(`select public.rental_confirm($1)`, [rental!.id])

    await db.asUser(ownerId, (session) =>
      session.sql(`select public.rental_extend($1, now() + interval '65 days')`, [rental!.id]),
    )

    const [extended] = await db.sql<{ status: string; ends_at: string }>(
      `select status, ends_at from public.rentals where id = $1`,
      [rental!.id],
    )
    expect(extended?.status).toBe('reserved')
    const [assignment] = await db.sql<{ reason: string }>(
      `select reason from public.rental_vehicle_assignments
        where rental_id = $1 order by sequence_no desc limit 1`,
      [rental!.id],
    )
    // The row records the booking nobody wrote down, not the extension.
    expect(assignment?.reason).toBe('initial')
  })

  it('lets a signed-in member execute the maintenance restriction helper', async () => {
    /*
     * public.vehicles_available_between is SECURITY INVOKER and calls
     * app.maintenance_restriction_range from its body, so the caller's own
     * privileges decide. Without an explicit grant the hosted database raises
     * 'permission denied for function' and no rental can be made anywhere.
     */
    const [row] = await db.sql<{ may: boolean }>(
      `select has_function_privilege(
                'authenticated',
                'app.maintenance_restriction_range(public.maintenance_status, timestamptz, timestamptz, timestamptz)',
                'EXECUTE') as may`,
    )
    expect(row?.may).toBe(true)
  })
})

describe('legacy and independent restrictions', () => {
  it('preserves a legacy maintenance restriction until it is explicitly resolved', async () => {
    // A legacy value, as it exists on rows written before the workflow did.
    const vehicle = await legacyMaintenanceVehicle()

    const flagged = await fleetRow<{
      legacy_maintenance_restriction: boolean
      effective_status: string
    }>(vehicle, 'legacy_maintenance_restriction, effective_status')
    expect(flagged?.legacy_maintenance_restriction).toBe(true)
    expect(flagged?.effective_status).toBe('maintenance')

    const from = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString()
    const to = new Date(Date.now() + 61 * 24 * 60 * 60 * 1000).toISOString()
    expect(await availableBetween(from, to)).not.toContain(vehicle)

    await db.asUser(ownerId, (session) =>
      session.sql(
        `select public.vehicle_resolve_legacy_maintenance($1, 'Inspected and roadworthy')`,
        [vehicle],
      ),
    )
    expect(await availableBetween(from, to)).toContain(vehicle)
  })

  it('refuses to resolve a legacy restriction while real work is open', async () => {
    const vehicle = await legacyMaintenanceVehicle()
    await schedule(vehicle, 'Genuine repair', null, null, true)

    await db.expectRejection(
      () =>
        db.asUser(ownerId, (session) =>
          session.sql(`select public.vehicle_resolve_legacy_maintenance($1, 'Looks fine')`, [
            vehicle,
          ]),
        ),
      /Resolve active maintenance/i,
    )
  })

  it('keeps an off-road restriction when maintenance completes', async () => {
    const vehicle = await freshVehicle()
    const record = await schedule(vehicle, 'Repair', null, null, true)
    await db.asUser(ownerId, (session) =>
      session.sql(`select public.vehicle_take_off_road($1, 'Awaiting insurance decision')`, [
        vehicle,
      ]),
    )

    await db.asUser(ownerId, (session) =>
      session.sql(`select public.maintenance_complete($1, now(), null, null, null)`, [record]),
    )

    const row = await fleetRow<{ effective_status: string; off_road_reason: string }>(
      vehicle,
      'effective_status, off_road_reason',
    )
    expect(row?.effective_status).toBe('unavailable')
    expect(row?.off_road_reason).toBe('Awaiting insurance decision')
  })

  it('refuses to return a vehicle to service while maintenance is open', async () => {
    const vehicle = await freshVehicle()
    await db.asUser(ownerId, (session) =>
      session.sql(`select public.vehicle_take_off_road($1, 'Tyre wear')`, [vehicle]),
    )
    await schedule(vehicle, 'Tyres', null, null, true)

    await db.expectRejection(
      () =>
        db.asUser(ownerId, (session) =>
          session.sql(`select public.vehicle_return_to_service($1)`, [vehicle]),
        ),
      /Resolve active maintenance/i,
    )
  })
})

describe('maintenance downtime', () => {
  async function recordDowntime(
    vehicleId: string,
    title: string,
    actualStart: string,
    actualCompletion: string | null,
  ): Promise<void> {
    const id = await schedule(vehicleId, title, null, null, true)
    await db.sql(
      `update public.maintenance_records
          set actual_start = $2::timestamptz,
              actual_completion = $3::timestamptz,
              status = (case when $3::timestamptz is null then 'in_progress' else 'completed' end)::public.maintenance_status
        where id = $1`,
      [id, actualStart, actualCompletion],
    )
  }

  async function downtime(vehicleId: string, from: string, to: string): Promise<number> {
    const [row] = await db.asUser(ownerId, (session) =>
      session.sql<{ maintenance_vehicle_downtime: number }>(
        `select public.maintenance_vehicle_downtime($1, $2::timestamptz, $3::timestamptz)`,
        [vehicleId, from, to],
      ),
    )
    return Number(row?.maintenance_vehicle_downtime)
  }

  it('counts a finished two-hour repair as 120 minutes', async () => {
    const vehicle = await freshVehicle()
    await recordDowntime(vehicle, 'A', '2036-03-01 10:00+00', '2036-03-01 12:00+00')
    expect(await downtime(vehicle, '2036-03-01 00:00+00', '2036-03-02 00:00+00')).toBe(120)
  })

  it('merges overlapping work, so 10-12 and 11-13 is 180 minutes and not 240', async () => {
    const vehicle = await freshVehicle()
    await recordDowntime(vehicle, 'A', '2036-03-01 10:00+00', '2036-03-01 12:00+00')
    await recordDowntime(vehicle, 'B', '2036-03-01 11:00+00', '2036-03-01 13:00+00')
    expect(await downtime(vehicle, '2036-03-01 00:00+00', '2036-03-02 00:00+00')).toBe(180)
  })

  it('counts only the part of the work inside the reporting period', async () => {
    const vehicle = await freshVehicle()
    await recordDowntime(vehicle, 'A', '2036-03-01 10:00+00', '2036-03-01 12:00+00')
    await recordDowntime(vehicle, 'B', '2036-03-01 11:00+00', '2036-03-01 13:00+00')
    expect(await downtime(vehicle, '2036-03-01 11:00+00', '2036-03-01 12:00+00')).toBe(60)
  })

  it('counts nothing for work that is only scheduled', async () => {
    const vehicle = await freshVehicle()
    await schedule(vehicle, 'Planned only', '2036-04-01 09:00+00', '2036-04-01 17:00+00')
    expect(await downtime(vehicle, '2036-01-01 00:00+00', '2037-01-01 00:00+00')).toBe(0)
  })

  it('accrues unfinished work up to now, not to the end of the window asked about', async () => {
    const vehicle = await freshVehicle()
    const id = await schedule(vehicle, 'Still open', null, null, true)
    await db.sql(
      `update public.maintenance_records set actual_start = now() - interval '2 hours' where id = $1`,
      [id],
    )

    const [row] = await db.asUser(ownerId, (session) =>
      session.sql<{ maintenance_vehicle_downtime: number }>(
        `select public.maintenance_vehicle_downtime($1, now() - interval '1 day', now() + interval '30 days')`,
        [vehicle],
      ),
    )
    const minutes = Number(row?.maintenance_vehicle_downtime)
    expect(minutes).toBeGreaterThanOrEqual(119)
    expect(minutes).toBeLessThanOrEqual(121)
  })
})

describe('incident and maintenance stay independent', () => {
  it('links in both directions and survives resolution on either side', async () => {
    const vehicle = await freshVehicle()
    const [incident] = await db.asUser(ownerId, (session) =>
      session.sql<{ id: string; reference: string }>(
        `select id, reference from public.incident_create(
           $1, $2, null, 'vehicle_damage', now(), null, 'Kerbed the nearside wheel')`,
        [organizationId, vehicle],
      ),
    )

    const record = await schedule(vehicle, 'Wheel refurbishment', null, null, true, incident!.id)

    // The reverse relationship Incident Details reads.
    const related = await db.asUser(ownerId, (session) =>
      session.sql<{ id: string }>(
        `select id from public.maintenance_records where incident_id = $1`,
        [incident!.id],
      ),
    )
    expect(related.map((row) => row.id)).toContain(record)

    // Resolving the incident completes nothing and releases nothing.
    await db.asUser(ownerId, (session) =>
      session.sql(`select public.incident_resolve($1, 'Repaired')`, [incident!.id]),
    )
    const [still] = await db.asUser(ownerId, (session) =>
      session.sql<{ status: string; incident_id: string }>(
        `select status, incident_id from public.maintenance_records where id = $1`,
        [record],
      ),
    )
    expect(still?.status).toBe('in_progress')
    expect(still?.incident_id).toBe(incident!.id)
    expect(
      (await fleetRow<{ effective_status: string }>(vehicle, 'effective_status'))?.effective_status,
    ).toBe('maintenance')

    // Completing the maintenance does not reopen or alter the incident, and the
    // relationship is still there to read afterwards.
    await db.asUser(ownerId, (session) =>
      session.sql(`select public.maintenance_complete($1, now(), null, null, null)`, [record]),
    )
    const [after] = await db.asUser(ownerId, (session) =>
      session.sql<{ status: string }>(`select status from public.incidents where id = $1`, [
        incident!.id,
      ]),
    )
    expect(after?.status).toBe('resolved')

    const stillRelated = await db.asUser(ownerId, (session) =>
      session.sql<{ id: string }>(
        `select id from public.maintenance_records where incident_id = $1`,
        [incident!.id],
      ),
    )
    expect(stillRelated.map((row) => row.id)).toContain(record)
  })

  it('refuses to attach an incident belonging to another vehicle', async () => {
    const vehicle = await freshVehicle()
    const other = await freshVehicle()
    const [incident] = await db.asUser(ownerId, (session) =>
      session.sql<{ id: string }>(
        `select id from public.incident_create($1, $2, null, 'breakdown', now(), null, 'Other car')`,
        [organizationId, other],
      ),
    )

    await db.expectRejection(
      () => schedule(vehicle, 'Wrong incident', null, null, true, incident!.id),
      /Incident not found for vehicle/i,
    )
  })
})

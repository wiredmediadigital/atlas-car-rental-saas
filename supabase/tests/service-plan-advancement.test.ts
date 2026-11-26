// @vitest-environment node
/**
 * Recurring preventive servicing.
 *
 * The owner's scenario 19 asks that completing qualifying maintenance move the
 * plan on. The cases that matter most are the negative ones: an ordinary
 * repair must not touch a plan, a completion with no reading must not invent
 * one, and nothing may advance the same plan twice.
 *
 * Runs on the repository's PGlite harness, which replays the real ordered
 * migrations — so this exercises the migration itself, not a copy of it.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { TestDatabase, signUp } from './support/harness'

let db: TestDatabase
let ownerId: string
let organizationId: string
let plateCounter = 0

async function freshVehicle(odometer = 54375): Promise<string> {
  plateCounter += 1
  const [row] = await db.sql<{ id: string }>(
    `insert into public.vehicles
       (organization_id, make, model, registration_plate, currency, daily_rate_minor, odometer)
     values ($1, 'Kia', 'Forte', $2, 'EUR', 1000, $3) returning id`,
    [organizationId, `SVC-${String(plateCounter).padStart(3, '0')}`, odometer],
  )
  return row!.id
}

async function schedule(
  vehicleId: string,
  title: string,
  category = 'preventive',
): Promise<string> {
  const [row] = await db.asUser(ownerId, (session) =>
    session.sql<{ id: string }>(
      `select id from public.maintenance_create(
         $1, $2, $3, $4::public.maintenance_category, 'normal',
         null, null, null, null, null, null, null, null, 'EUR', null, null, false, null)`,
      [organizationId, vehicleId, title, category],
    ),
  )
  return row!.id
}

async function setPlan(
  maintenanceId: string,
  intervalDays: number | null,
  intervalOdometer: number | null,
  nextOn: string | null,
  nextOdometer: number | null,
): Promise<void> {
  await db.asUser(ownerId, (session) =>
    session.sql(`select public.maintenance_set_service_plan($1, $2, $3, $4::date, $5)`, [
      maintenanceId,
      intervalDays,
      intervalOdometer,
      nextOn,
      nextOdometer,
    ]),
  )
}

async function startAndComplete(
  maintenanceId: string,
  completedAt: string,
  completionOdometer: number | null,
  startOdometer: number | null = null,
): Promise<void> {
  await db.asUser(ownerId, (session) =>
    session.sql(`select public.maintenance_start($1, $2::timestamptz, $3)`, [
      maintenanceId,
      '2026-12-09 08:00+00',
      startOdometer,
    ]),
  )
  await db.asUser(ownerId, (session) =>
    session.sql(`select public.maintenance_complete($1, $2::timestamptz, null, null, $3)`, [
      maintenanceId,
      completedAt,
      completionOdometer,
    ]),
  )
}

interface PlanRow extends Record<string, unknown> {
  next_service_on: string | null
  next_service_odometer: number | null
}

async function planOf(maintenanceId: string): Promise<PlanRow | undefined> {
  const [row] = await db.asUser(ownerId, (session) =>
    session.sql<PlanRow>(
      `select to_char(next_service_on, 'YYYY-MM-DD') as next_service_on,
              next_service_odometer
         from public.maintenance_records where id = $1`,
      [maintenanceId],
    ),
  )
  return row
}

beforeAll(async () => {
  db = await TestDatabase.create()
  const account = await signUp(db, {
    email: 'service-advancement@test.local',
    fullName: 'Service Owner',
    organizationName: 'Service Organization',
    currency: 'EUR',
  })
  ownerId = account.userId
  organizationId = account.organizationId!
  // The agency keeps its own clock; the completion date must be read in it.
  await db.sql(`update public.organizations set time_zone = 'Africa/Casablanca' where id = $1`, [
    organizationId,
  ])
})

afterAll(async () => db?.close())

describe('completing qualifying maintenance advances the plan', () => {
  it('advances both limbs from the completion date and the service reading', async () => {
    const vehicle = await freshVehicle()
    const record = await schedule(vehicle, 'Recurring service')
    await setPlan(record, 180, 5000, '2026-12-10', 55200)

    await startAndComplete(record, '2026-12-10 16:00+00', 55200)

    // The owner's worked example, to the day and to the kilometre.
    expect(await planOf(record)).toMatchObject({
      next_service_on: '2027-06-08',
      next_service_odometer: 60200,
    })
  })

  it('reads the completion day in the agency’s time zone, not UTC', async () => {
    const vehicle = await freshVehicle()
    const record = await schedule(vehicle, 'Late evening completion')
    await setPlan(record, 30, null, '2026-12-10', null)

    // 2026-12-10 23:30 in Casablanca (UTC+1) is 22:30Z — still the 10th there.
    await startAndComplete(record, '2026-12-10 22:30+00', null)

    expect((await planOf(record))?.next_service_on).toBe('2027-01-09')
  })

  it('advances the date alone when only a day interval is set', async () => {
    const vehicle = await freshVehicle()
    const record = await schedule(vehicle, 'Date-only recurrence')
    await setPlan(record, 90, null, '2026-12-10', 70000)

    await startAndComplete(record, '2026-12-10 10:00+00', 56000)

    expect(await planOf(record)).toMatchObject({
      next_service_on: '2027-03-10',
      // Untouched: no distance interval was configured.
      next_service_odometer: 70000,
    })
  })

  it('advances the distance alone when only a distance interval is set', async () => {
    const vehicle = await freshVehicle()
    const record = await schedule(vehicle, 'Distance-only recurrence')
    await setPlan(record, null, 10000, '2026-12-10', 55200)

    await startAndComplete(record, '2026-12-10 10:00+00', 56000)

    expect(await planOf(record)).toMatchObject({
      next_service_on: '2026-12-10',
      next_service_odometer: 66000,
    })
  })

  it('falls back to the reading taken when the vehicle went in', async () => {
    const vehicle = await freshVehicle()
    const record = await schedule(vehicle, 'No completion reading')
    await setPlan(record, null, 5000, null, 55200)

    await startAndComplete(record, '2026-12-10 10:00+00', null, 54900)

    expect((await planOf(record))?.next_service_odometer).toBe(59900)
  })
})

describe('what must NOT advance', () => {
  it('leaves the distance threshold alone when no reading was taken', async () => {
    const vehicle = await freshVehicle(99999)
    const record = await schedule(vehicle, 'Unread odometer')
    await setPlan(record, 180, 5000, '2026-12-10', 55200)

    await startAndComplete(record, '2026-12-10 10:00+00', null, null)

    const plan = await planOf(record)
    // The date limb still advances; the distance limb is untouched rather than
    // guessed from the vehicle's hand-over reading of 99,999.
    expect(plan?.next_service_on).toBe('2027-06-08')
    expect(plan?.next_service_odometer).toBe(55200)
  })

  it('does not reset the plan when unrelated maintenance is completed', async () => {
    const vehicle = await freshVehicle()
    const servicing = await schedule(vehicle, 'The recurring service')
    await setPlan(servicing, 180, 5000, '2027-06-08', 60200)

    const repair = await schedule(vehicle, 'A broken wing mirror', 'mechanical_repair')
    await startAndComplete(repair, '2026-12-10 10:00+00', 56000)

    // The repair carries no plan of its own, and it has not touched the one
    // the servicing record holds.
    expect(await planOf(repair)).toMatchObject({
      next_service_on: null,
      next_service_odometer: null,
    })
    expect(await planOf(servicing)).toMatchObject({
      next_service_on: '2027-06-08',
      next_service_odometer: 60200,
    })
  })

  it('does not advance a one-off reminder that carries no interval', async () => {
    const vehicle = await freshVehicle()
    const record = await schedule(vehicle, 'One-off reminder')
    await setPlan(record, null, null, '2026-12-10', 55200)

    await startAndComplete(record, '2026-12-10 10:00+00', 56000)

    expect(await planOf(record)).toMatchObject({
      next_service_on: '2026-12-10',
      next_service_odometer: 55200,
    })
  })

  it('cannot advance the same plan twice', async () => {
    const vehicle = await freshVehicle()
    const record = await schedule(vehicle, 'Completed once')
    await setPlan(record, 180, 5000, '2026-12-10', 55200)

    await startAndComplete(record, '2026-12-10 16:00+00', 55200)
    const afterFirst = await planOf(record)

    await expect(
      db.asUser(ownerId, (session) =>
        session.sql(`select public.maintenance_complete($1, $2::timestamptz, null, null, $3)`, [
          record,
          '2026-12-11 16:00+00',
          60000,
        ]),
      ),
    ).rejects.toThrow(/Only in-progress maintenance can be completed/)

    expect(await planOf(record)).toMatchObject(afterFirst as Record<string, unknown>)
  })
})

describe('authorization and tenancy are unchanged', () => {
  it('refuses a completion from another agency', async () => {
    const vehicle = await freshVehicle()
    const record = await schedule(vehicle, 'Someone else’s service')
    await setPlan(record, 180, 5000, '2026-12-10', 55200)
    await db.asUser(ownerId, (session) =>
      session.sql(`select public.maintenance_start($1, $2::timestamptz, null)`, [
        record,
        '2026-12-09 08:00+00',
      ]),
    )

    const outsider = await signUp(db, {
      email: 'outsider-advancement@test.local',
      fullName: 'Outsider',
      organizationName: 'Other Agency',
      currency: 'EUR',
    })

    await expect(
      db.asUser(outsider.userId, (session) =>
        session.sql(`select public.maintenance_complete($1, now(), null, null, null)`, [record]),
      ),
    ).rejects.toThrow(/Maintenance record not found/)

    expect((await planOf(record))?.next_service_on).toBe('2026-12-10')
  })
})

describe('fleet downtime', () => {
  it('merges overlapping work on one vehicle and sums across vehicles', async () => {
    const a = await freshVehicle()
    const b = await freshVehicle()

    // Two overlapping records on vehicle A: 09:00-17:00 and 13:00-19:00.
    // Merged that is 09:00-19:00, ten hours, not fourteen.
    for (const [title, start, end] of [
      ['A morning', '2027-03-01 09:00+00', '2027-03-01 17:00+00'],
      ['A afternoon', '2027-03-01 13:00+00', '2027-03-01 19:00+00'],
    ] as const) {
      const id = await schedule(a, title, 'mechanical_repair')
      await db.asUser(ownerId, (session) =>
        session.sql(`select public.maintenance_start($1, $2::timestamptz, null)`, [id, start]),
      )
      await db.asUser(ownerId, (session) =>
        session.sql(`select public.maintenance_complete($1, $2::timestamptz, null, null, null)`, [
          id,
          end,
        ]),
      )
    }

    // Vehicle B: two hours, and a scheduled record that never started.
    const bWork = await schedule(b, 'B work', 'mechanical_repair')
    await db.asUser(ownerId, (session) =>
      session.sql(`select public.maintenance_start($1, $2::timestamptz, null)`, [
        bWork,
        '2027-03-02 09:00+00',
      ]),
    )
    await db.asUser(ownerId, (session) =>
      session.sql(`select public.maintenance_complete($1, $2::timestamptz, null, null, null)`, [
        bWork,
        '2027-03-02 11:00+00',
      ]),
    )
    await schedule(b, 'B never started', 'mechanical_repair')

    const [row] = await db.asUser(ownerId, (session) =>
      session.sql<{ minutes: number }>(
        `select public.maintenance_fleet_downtime($1, $2::timestamptz, $3::timestamptz) as minutes`,
        [organizationId, '2027-03-01 00:00+00', '2027-03-03 00:00+00'],
      ),
    )

    // 600 merged minutes on A plus 120 on B. The unstarted record adds nothing.
    expect(Number(row?.minutes)).toBe(720)
  })

  it('returns nothing to another agency', async () => {
    const outsider = await signUp(db, {
      email: 'outsider-downtime@test.local',
      fullName: 'Outsider',
      organizationName: 'Downtime Outsider',
      currency: 'EUR',
    })
    const [row] = await db.asUser(outsider.userId, (session) =>
      session.sql<{ minutes: number }>(
        `select public.maintenance_fleet_downtime($1, $2::timestamptz, $3::timestamptz) as minutes`,
        [organizationId, '2027-03-01 00:00+00', '2027-03-03 00:00+00'],
      ),
    )
    expect(Number(row?.minutes)).toBe(0)
  })
})

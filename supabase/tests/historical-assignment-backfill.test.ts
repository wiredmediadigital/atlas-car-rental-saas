// @vitest-environment node

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { TestDatabase, signUp } from './support/harness'

let db: TestDatabase
let orgOne: { organizationId: string; userId: string }
let orgTwo: { organizationId: string; userId: string }
let vehicleOne: string
let vehicleTwo: string
let customerOne: string
let customerTwo: string

const base = Date.UTC(2031, 0, 1, 8, 0, 0)
const period = (offsetHours: number) => ({
  starts: new Date(base + offsetHours * 60 * 60 * 1000).toISOString(),
  ends: new Date(base + (offsetHours + 2) * 60 * 60 * 1000).toISOString(),
})

async function createRental(options: {
  organizationId: string
  vehicleId: string
  customerId: string
  reference: string
  status: string
  offsetHours: number
  pickedUpAt?: string | null
  returnedAt?: string | null
  pickupOdometer?: number | null
  returnOdometer?: number | null
  pickupFuel?: number | null
  returnFuel?: number | null
  pickupNotes?: string | null
  returnNotes?: string | null
  pickupRecordedBy?: string | null
  returnRecordedBy?: string | null
}): Promise<string> {
  const times = period(options.offsetHours)
  const [row] = await db.sql<{ id: string }>(
    `insert into public.rentals
       (organization_id, vehicle_id, customer_id, reference, starts_at, ends_at, currency, status,
        picked_up_at, returned_at, pickup_odometer, return_odometer,
        pickup_fuel_percent, return_fuel_percent, pickup_condition_notes,
        return_condition_notes, pickup_recorded_by, return_recorded_by)
     values ($1, $2, $3, $4, $5::timestamptz, $6::timestamptz, 'EUR', $7::public.rental_status,
             $8::timestamptz, $9::timestamptz, $10, $11, $12, $13, $14, $15, $16, $17)
     returning id`,
    [
      options.organizationId,
      options.vehicleId,
      options.customerId,
      options.reference,
      times.starts,
      times.ends,
      options.status,
      options.pickedUpAt ?? null,
      options.returnedAt ?? null,
      options.pickupOdometer ?? null,
      options.returnOdometer ?? null,
      options.pickupFuel ?? null,
      options.returnFuel ?? null,
      options.pickupNotes ?? null,
      options.returnNotes ?? null,
      options.pickupRecordedBy ?? null,
      options.returnRecordedBy ?? null,
    ],
  )
  return row!.id
}

beforeAll(async () => {
  db = await TestDatabase.create()
  const signedOne = await signUp(db, {
    email: 'backfill-owner-one@test.local',
    fullName: 'Backfill Owner One',
    organizationName: 'Backfill One',
    currency: 'EUR',
  })
  const signedTwo = await signUp(db, {
    email: 'backfill-owner-two@test.local',
    fullName: 'Backfill Owner Two',
    organizationName: 'Backfill Two',
    currency: 'EUR',
  })
  if (!signedOne.organizationId || !signedTwo.organizationId)
    throw new Error('Backfill fixture provisioning failed.')
  orgOne = { ...signedOne, organizationId: signedOne.organizationId }
  orgTwo = { ...signedTwo, organizationId: signedTwo.organizationId }

  const [firstVehicle] = await db.sql<{ id: string }>(
    `insert into public.vehicles (organization_id, make, model, registration_plate, currency, odometer)
     values ($1, 'Backfill', 'One', 'BF-001', 'EUR', 1000) returning id`,
    [orgOne.organizationId],
  )
  const [secondVehicle] = await db.sql<{ id: string }>(
    `insert into public.vehicles (organization_id, make, model, registration_plate, currency, odometer)
     values ($1, 'Backfill', 'Two', 'BF-002', 'EUR', 2000) returning id`,
    [orgTwo.organizationId],
  )
  const [firstCustomer] = await db.sql<{ id: string }>(
    `insert into public.customers (organization_id, first_name, last_name)
     values ($1, 'Legacy', 'One') returning id`,
    [orgOne.organizationId],
  )
  const [secondCustomer] = await db.sql<{ id: string }>(
    `insert into public.customers (organization_id, first_name, last_name)
     values ($1, 'Legacy', 'Two') returning id`,
    [orgTwo.organizationId],
  )
  vehicleOne = firstVehicle!.id
  vehicleTwo = secondVehicle!.id
  customerOne = firstCustomer!.id
  customerTwo = secondCustomer!.id
})

afterAll(async () => {
  await db?.close()
})

describe('historical assignment backfill', () => {
  it('maps every normal lifecycle state without changing rental facts', async () => {
    const pickup = new Date(base + 1 * 60 * 60 * 1000).toISOString()
    const returned = new Date(base + 2 * 60 * 60 * 1000).toISOString()
    const ids = {
      draft: await createRental({
        organizationId: orgOne.organizationId,
        vehicleId: vehicleOne,
        customerId: customerOne,
        reference: 'BF-DRAFT',
        status: 'draft',
        offsetHours: 0,
      }),
      reserved: await createRental({
        organizationId: orgOne.organizationId,
        vehicleId: vehicleOne,
        customerId: customerOne,
        reference: 'BF-RESERVED',
        status: 'reserved',
        offsetHours: 4,
      }),
      active: await createRental({
        organizationId: orgOne.organizationId,
        vehicleId: vehicleOne,
        customerId: customerOne,
        reference: 'BF-ACTIVE',
        status: 'active',
        offsetHours: 8,
        pickedUpAt: pickup,
        pickupOdometer: 1100,
        pickupFuel: 80,
        pickupNotes: 'Legacy pickup',
        pickupRecordedBy: orgOne.userId,
      }),
      returnedActive: await createRental({
        organizationId: orgOne.organizationId,
        vehicleId: vehicleOne,
        customerId: customerOne,
        reference: 'BF-RETURNED',
        status: 'active',
        offsetHours: 12,
        pickedUpAt: pickup,
        returnedAt: returned,
        pickupOdometer: 1200,
        returnOdometer: 1300,
        pickupFuel: 75,
        returnFuel: 50,
        returnRecordedBy: orgOne.userId,
      }),
      completed: await createRental({
        organizationId: orgOne.organizationId,
        vehicleId: vehicleOne,
        customerId: customerOne,
        reference: 'BF-COMPLETED',
        status: 'completed',
        offsetHours: 16,
        pickedUpAt: pickup,
        returnedAt: returned,
        pickupOdometer: 1400,
        returnOdometer: 1500,
      }),
      cancelled: await createRental({
        organizationId: orgOne.organizationId,
        vehicleId: vehicleOne,
        customerId: customerOne,
        reference: 'BF-CANCELLED',
        status: 'cancelled',
        offsetHours: 20,
      }),
    }
    const [before] = await db.sql<{ pickup_odometer: number; vehicle_id: string; status: string }>(
      `select pickup_odometer, vehicle_id, status from public.rentals where id = $1`,
      [ids.active],
    )

    const [result] = await db.sql<{
      eligible_rentals: number
      created_assignments: number
      existing_assignments: number
      anomalous_rentals: number
      created_inspections: number
      linked_photos: number
    }>(`select * from app.backfill_historical_rental_assignments()`)

    const rows = await db.sql<{
      reference: string
      state: string
      blocks: boolean
      started_at: string | null
      ended_at: string | null
      pickup_odometer: number | null
      return_odometer: number | null
    }>(
      `select r.reference, a.state, a.blocks_availability as blocks, a.started_at, a.ended_at,
              a.pickup_odometer, a.return_odometer
         from public.rental_vehicle_assignments a
         join public.rentals r on r.id = a.rental_id
        where a.rental_id = any($1::uuid[])
        order by r.reference`,
      [Object.values(ids)],
    )

    expect(result).toMatchObject({
      eligible_rentals: 6,
      created_assignments: 6,
      existing_assignments: 0,
      anomalous_rentals: 0,
      created_inspections: 5,
      linked_photos: 0,
    })
    expect(rows.map((row) => [row.reference, row.state, row.blocks])).toEqual([
      ['BF-ACTIVE', 'in_custody', true],
      ['BF-CANCELLED', 'cancelled', false],
      ['BF-COMPLETED', 'released', false],
      ['BF-DRAFT', 'planned', false],
      ['BF-RESERVED', 'reserved', true],
      ['BF-RETURNED', 'released', true],
    ])
    expect(rows.find((row) => row.reference === 'BF-ACTIVE')).toMatchObject({
      pickup_odometer: 1100,
      started_at: new Date(pickup),
    })
    expect(rows.find((row) => row.reference === 'BF-RETURNED')).toMatchObject({
      pickup_odometer: 1200,
      return_odometer: 1300,
      ended_at: new Date(returned),
    })

    const [after] = await db.sql<{ pickup_odometer: number; vehicle_id: string; status: string }>(
      `select pickup_odometer, vehicle_id, status from public.rentals where id = $1`,
      [ids.active],
    )
    expect(after).toEqual(before)
  })

  it('records malformed rows and availability conflicts without weakening constraints', async () => {
    const pickup = new Date(base + 1 * 60 * 60 * 1000).toISOString()
    const badActive = await createRental({
      organizationId: orgOne.organizationId,
      vehicleId: vehicleOne,
      customerId: customerOne,
      reference: 'BF-BAD-ACTIVE',
      status: 'active',
      offsetHours: 24,
    })
    const badCancelled = await createRental({
      organizationId: orgOne.organizationId,
      vehicleId: vehicleOne,
      customerId: customerOne,
      reference: 'BF-BAD-CANCELLED',
      status: 'cancelled',
      offsetHours: 28,
      pickedUpAt: pickup,
      pickupOdometer: 1600,
    })
    const reversed = await createRental({
      organizationId: orgOne.organizationId,
      vehicleId: vehicleOne,
      customerId: customerOne,
      reference: 'BF-BAD-ORDER',
      status: 'completed',
      offsetHours: 32,
      pickedUpAt: new Date(base + 40 * 60 * 60 * 1000).toISOString(),
      returnedAt: new Date(base + 39 * 60 * 60 * 1000).toISOString(),
    })
    const blocker = await createRental({
      organizationId: orgOne.organizationId,
      vehicleId: vehicleOne,
      customerId: customerOne,
      reference: 'BF-BLOCKER',
      status: 'draft',
      offsetHours: 36,
    })
    const blocked = await createRental({
      organizationId: orgOne.organizationId,
      vehicleId: vehicleOne,
      customerId: customerOne,
      reference: 'BF-BLOCKED',
      status: 'reserved',
      offsetHours: 36,
    })
    await db.sql(
      `insert into public.rental_vehicle_assignments
       (organization_id, rental_id, vehicle_id, sequence_no, state, reason, scheduled_starts_at, scheduled_ends_at, blocks_availability)
       select organization_id, $1, vehicle_id, 1, 'reserved', 'initial', starts_at, ends_at, true
         from public.rentals where id = $1`,
      [blocker],
    )

    const [result] = await db.sql<{ anomalous_rentals: number }>(
      `select * from app.backfill_historical_rental_assignments()`,
    )
    const anomalies = await db.sql<{ reference: string; anomaly_code: string }>(
      `select r.reference, a.anomaly_code
         from public.rental_assignment_backfill_anomalies a
         join public.rentals r on r.id = a.rental_id
        where r.id = any($1::uuid[])
        order by r.reference, a.anomaly_code`,
      [[badActive, badCancelled, reversed, blocked]],
    )

    expect(Number(result?.anomalous_rentals)).toBeGreaterThanOrEqual(4)
    expect(anomalies).toEqual([
      { reference: 'BF-BAD-ACTIVE', anomaly_code: 'active_without_pickup' },
      { reference: 'BF-BAD-CANCELLED', anomaly_code: 'cancelled_with_custody_facts' },
      { reference: 'BF-BAD-ORDER', anomaly_code: 'custody_timestamp_order' },
      { reference: 'BF-BLOCKED', anomaly_code: 'availability_conflict' },
    ])
    await expect(
      db.sql(`select 1 from public.rental_vehicle_assignments where rental_id = $1`, [badActive]),
    ).resolves.toHaveLength(0)
    await expect(
      db.sql(`select 1 from public.rental_vehicle_assignments where rental_id = $1`, [blocked]),
    ).resolves.toHaveLength(0)
    await db.expectRejection(
      () =>
        db.sql(
          `insert into public.rental_vehicle_assignments (organization_id, rental_id, vehicle_id, sequence_no, state, reason, scheduled_starts_at, scheduled_ends_at, blocks_availability) select organization_id, $1, vehicle_id, 2, 'reserved', 'initial', starts_at, ends_at, true from public.rentals where id = $1`,
          [blocked],
        ),
      /rental_vehicle_assignments_no_overlap|conflicting key/i,
    )
  })

  it('links reliable legacy evidence and remains idempotent and tenant-isolated', async () => {
    const photoOnly = await createRental({
      organizationId: orgOne.organizationId,
      vehicleId: vehicleOne,
      customerId: customerOne,
      reference: 'BF-PHOTO',
      status: 'draft',
      offsetHours: 44,
    })
    await db.sql(
      `insert into public.rental_condition_photos (organization_id, rental_id, phase, storage_path, content_type, byte_size)
       values ($1, $2, 'pickup', $3, 'image/jpeg', 100)`,
      [orgOne.organizationId, photoOnly, `${orgOne.organizationId}/legacy.jpg`],
    )
    const secondOrgRental = await createRental({
      organizationId: orgTwo.organizationId,
      vehicleId: vehicleTwo,
      customerId: customerTwo,
      reference: 'BF-TENANT',
      status: 'draft',
      offsetHours: 0,
    })
    const [beforePhotos] = await db.sql<{ count: number }>(
      `select count(*)::int as count from public.rental_condition_photos`,
    )

    await db.sql(`select * from app.backfill_historical_rental_assignments()`)
    const [firstRun] = await db.sql<{ assignments: number; anomalies: number }>(
      `select count(*)::int as assignments,
              (select count(*)::int from public.rental_assignment_backfill_anomalies) as anomalies
         from public.rental_vehicle_assignments`,
    )
    await db.sql(`select * from app.backfill_historical_rental_assignments()`)
    const [secondRun] = await db.sql<{ assignments: number; anomalies: number }>(
      `select count(*)::int as assignments,
              (select count(*)::int from public.rental_assignment_backfill_anomalies) as anomalies
         from public.rental_vehicle_assignments`,
    )
    const [photo] = await db.sql<{ assignment_id: string; inspection_id: string }>(
      `select assignment_id, inspection_id from public.rental_condition_photos where rental_id = $1`,
      [photoOnly],
    )

    expect(secondRun).toEqual(firstRun)
    expect(photo?.assignment_id).toBeTruthy()
    expect(photo?.inspection_id).toBeTruthy()
    expect(
      Number(
        (
          await db.sql<{ count: number }>(
            `select count(*)::int as count from public.rental_condition_photos`,
          )
        )[0]?.count,
      ),
    ).toBe(Number(beforePhotos?.count))

    await db.asUser(orgOne.userId, async (session) => {
      const visible = await session.sql<{ organization_id: string }>(
        `select organization_id from public.rental_vehicle_assignments`,
      )
      expect(visible.length).toBeGreaterThan(0)
      expect(new Set(visible.map((row) => row.organization_id))).toEqual(
        new Set([orgOne.organizationId]),
      )
      const anomalies = await session.sql<{ organization_id: string }>(
        `select organization_id from public.rental_assignment_backfill_anomalies`,
      )
      expect(anomalies.every((row) => row.organization_id === orgOne.organizationId)).toBe(true)
    })
    await db.asUser(orgTwo.userId, async (session) => {
      const visible = await session.sql<{ organization_id: string }>(
        `select organization_id from public.rental_vehicle_assignments`,
      )
      expect(visible.every((row) => row.organization_id === orgTwo.organizationId)).toBe(true)
      expect(visible.some((row) => row.organization_id === orgOne.organizationId)).toBe(false)
    })

    expect(secondOrgRental).toBeTruthy()
  })

  it('can be rolled back without leaving assignment or anomaly rows', async () => {
    const rollbackRental = await createRental({
      organizationId: orgOne.organizationId,
      vehicleId: vehicleOne,
      customerId: customerOne,
      reference: 'BF-ROLLBACK',
      status: 'draft',
      offsetHours: 52,
    })
    await db.exec('begin')
    await db.sql(`select * from app.backfill_historical_rental_assignments()`)
    await db.exec('rollback')
    expect(
      await db.sql(`select 1 from public.rental_vehicle_assignments where rental_id = $1`, [
        rollbackRental,
      ]),
    ).toHaveLength(0)
    expect(
      await db.sql(
        `select 1 from public.rental_assignment_backfill_anomalies where rental_id = $1`,
        [rollbackRental],
      ),
    ).toHaveLength(0)
  })
})

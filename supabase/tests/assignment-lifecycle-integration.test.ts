// @vitest-environment node

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { TestDatabase, signUp } from './support/harness'

let db: TestDatabase
let owner: { userId: string; organizationId: string }
let vehicleOne: string
let vehicleTwo: string
let customer: string
let rentalSequence = 0

async function createRental(status = 'draft') {
  rentalSequence += 1
  const [row] = await db.sql<{ id: string }>(
    `insert into public.rentals
       (organization_id, vehicle_id, customer_id, starts_at, ends_at, currency, status)
     values ($1, $2, $3, $5::timestamptz + ($6::integer * interval '10 days'), $5::timestamptz + (($6::integer * 10 + 2) * interval '1 day'), 'EUR', $4)
     returning id`,
    [owner.organizationId, vehicleOne, customer, status, '2034-01-01 10:00:00+00', rentalSequence],
  )
  await db.sql(
    `insert into public.rental_drivers (organization_id, rental_id, customer_id, driver_role)
     values ($1, $2, $3, 'primary')`,
    [owner.organizationId, row!.id, customer],
  )
  return row!.id
}

async function enabled<T>(fn: (session: { sql: TestDatabase['sql'] }) => Promise<T>) {
  return db.asUser(owner.userId, async (session) => {
    await session.sql(
      `select pg_catalog.set_config('app.assignment_test_harness', 'on', false),
              pg_catalog.set_config('app.assignment_lifecycle_enabled', 'on', false)`,
    )
    return fn(session)
  })
}

beforeAll(async () => {
  db = await TestDatabase.create()
  const account = await signUp(db, {
    email: 'slice2-integration-owner@test.local',
    fullName: 'Slice Two Owner',
    organizationName: 'Slice Two Organization',
    currency: 'EUR',
  })
  if (!account.organizationId) throw new Error('Slice 2 provisioning failed.')
  owner = { userId: account.userId, organizationId: account.organizationId }
  const [first] = await db.sql<{ id: string }>(
    `insert into public.vehicles
       (organization_id, make, model, registration_plate, currency, daily_rate_minor)
     values ($1, 'Test', 'Primary', 'SLICE2-A', 'EUR', 1000) returning id`,
    [owner.organizationId],
  )
  const [second] = await db.sql<{ id: string }>(
    `insert into public.vehicles
       (organization_id, make, model, registration_plate, currency, daily_rate_minor)
     values ($1, 'Test', 'Replacement', 'SLICE2-B', 'EUR', 1200) returning id`,
    [owner.organizationId],
  )
  const [client] = await db.sql<{ id: string }>(
    `insert into public.customers (organization_id, first_name, last_name, email)
     values ($1, 'Slice', 'Customer', 'slice2-customer@test.local') returning id`,
    [owner.organizationId],
  )
  vehicleOne = first!.id
  vehicleTwo = second!.id
  customer = client!.id
})

afterAll(async () => db?.close())

describe('Slice 2 assignment-aware lifecycle integration', () => {
  it('confirm creates and reserves one assignment while preserving the pointer', async () => {
    const rentalId = await createRental()
    await enabled(async (session) => {
      await session.sql(`select public.rental_confirm($1)`, [rentalId])
    })
    const [row] = await db.sql<{ status: string; vehicle_id: string }>(
      `select status, vehicle_id from public.rentals where id = $1`,
      [rentalId],
    )
    const assignments = await db.sql<{
      state: string
      vehicle_id: string
      blocks_availability: boolean
    }>(
      `select state, vehicle_id, blocks_availability from public.rental_vehicle_assignments
       where rental_id = $1 order by sequence_no`,
      [rentalId],
    )
    expect(row).toMatchObject({ status: 'reserved', vehicle_id: vehicleOne })
    expect(assignments).toEqual([
      { state: 'reserved', vehicle_id: vehicleOne, blocks_availability: true },
    ])
  })

  it('reschedules, extends reserved rentals, and substitutes with preserved history', async () => {
    const rentalId = await createRental()
    await enabled(async (session) => {
      await session.sql(`select public.rental_confirm($1)`, [rentalId])
      await session.sql(
        `select public.rental_reschedule($1, '2034-01-02 10:00:00+00', '2034-01-05 10:00:00+00')`,
        [rentalId],
      )
      await session.sql(`select public.rental_extend($1, '2034-01-06 10:00:00+00', 0)`, [rentalId])
      await session.sql(`select public.rental_substitute_vehicle($1, $2)`, [rentalId, vehicleTwo])
      await session.sql(
        `select public.rental_check_out($1::uuid, 10, 80::smallint, 'pickup'::text, '2034-01-02 11:00:00+00'::timestamptz)`,
        [rentalId],
      )
      await session.sql(
        `select public.rental_check_in($1::uuid, 12, 70::smallint, 'return'::text, '2034-01-06 11:00:00+00'::timestamptz)`,
        [rentalId],
      )
      await session.sql(`select public.rental_complete($1::uuid)`, [rentalId])
    })
    const [rental] = await db.sql<{
      vehicle_id: string
      starts_at: string
      ends_at: string
      status: string
    }>(`select vehicle_id, starts_at, ends_at, status from public.rentals where id = $1`, [
      rentalId,
    ])
    const assignments = await db.sql<{
      state: string
      vehicle_id: string
      scheduled_ends_at: string
    }>(
      `select state, vehicle_id, scheduled_ends_at from public.rental_vehicle_assignments
       where rental_id = $1 order by sequence_no`,
      [rentalId],
    )
    expect(rental).toMatchObject({ vehicle_id: vehicleTwo, status: 'completed' })
    expect(assignments).toHaveLength(2)
    expect(assignments[0]?.state).toBe('superseded_before_pickup')
    expect(assignments[1]).toMatchObject({ state: 'released', vehicle_id: vehicleTwo })
    expect(new Date(assignments[1]!.scheduled_ends_at).toISOString()).toBe(
      new Date(rental!.ends_at).toISOString(),
    )
  })

  it('keeps legacy behavior when the assignment flag is not enabled', async () => {
    const rentalId = await createRental()
    await db.asUser(owner.userId, async (session) => {
      await session.sql(
        `select pg_catalog.set_config('app.assignment_lifecycle_enabled', 'off', false)`,
      )
      await session.sql(`select public.rental_confirm($1)`, [rentalId])
    })
    const assignments = await db.sql(
      `select id from public.rental_vehicle_assignments where rental_id = $1`,
      [rentalId],
    )
    expect(assignments).toHaveLength(0)
  })
})

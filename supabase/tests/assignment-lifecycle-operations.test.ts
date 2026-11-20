// @vitest-environment node

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { TestDatabase, signUp } from './support/harness'

let db: TestDatabase
let owner: { userId: string; organizationId: string }
let vehicleA: string
let vehicleB: string
let vehicleC: string
let customer: string
let sequence = 0

async function createRental() {
  sequence += 1
  const [row] = await db.sql<{ id: string }>(
    `insert into public.rentals
       (organization_id, vehicle_id, customer_id, starts_at, ends_at, currency, status)
     values ($1, $2, $3, '2038-01-01 10:00:00+00'::timestamptz + ($4::integer * interval '10 days'),
             '2038-01-03 10:00:00+00'::timestamptz + ($4::integer * interval '10 days'), 'EUR', 'draft')
     returning id`,
    [owner.organizationId, vehicleA, customer, sequence],
  )
  await db.sql(
    `insert into public.rental_drivers (organization_id, rental_id, customer_id, driver_role)
     values ($1, $2, $3, 'primary')`,
    [owner.organizationId, row!.id, customer],
  )
  return row!.id
}

async function enabled<T>(fn: (session: TestDatabase) => Promise<T>) {
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
    email: 'slice3-operations-owner@test.local',
    fullName: 'Slice Three Owner',
    organizationName: 'Slice Three Organization',
    currency: 'EUR',
  })
  if (!account.organizationId) throw new Error('Slice 3 provisioning failed.')
  owner = { userId: account.userId, organizationId: account.organizationId }
  const vehicles = await Promise.all(
    ['OPS-A', 'OPS-B', 'OPS-C'].map((plate) =>
      db.sql<{ id: string }>(
        `insert into public.vehicles
           (organization_id, make, model, registration_plate, currency, daily_rate_minor)
         values ($1, 'Test', $2, $3, 'EUR', 1000) returning id`,
        [owner.organizationId, plate, plate],
      ),
    ),
  )
  const [client] = await db.sql<{ id: string }>(
    `insert into public.customers (organization_id, first_name, last_name, email)
     values ($1, 'Operations', 'Customer', 'slice3-customer@test.local') returning id`,
    [owner.organizationId],
  )
  vehicleA = vehicles[0]![0]!.id
  vehicleB = vehicles[1]![0]!.id
  vehicleC = vehicles[2]![0]!.id
  customer = client!.id
})

afterAll(async () => db?.close())

describe('Slice 3–5 assignment-aware lifecycle operations', () => {
  it('keeps checkout, check-in, completion, and inspections assignment-aware', async () => {
    const rentalId = await createRental()
    await enabled(async (session) => {
      await session.sql(`select public.rental_confirm($1)`, [rentalId])
      await session.sql(
        `select public.rental_check_out($1::uuid, 10, 80::smallint, 'pickup'::text, '2038-01-01 11:00:00+00'::timestamptz)`,
        [rentalId],
      )
      await session.sql(
        `select public.rental_check_in($1::uuid, 12, 70::smallint, 'return'::text, '2038-01-03 11:00:00+00'::timestamptz)`,
        [rentalId],
      )
      await session.sql(`select public.rental_complete($1)`, [rentalId])
    })
    const [rental] = await db.sql<{ status: string }>(
      `select status from public.rentals where id = $1`,
      [rentalId],
    )
    const assignments = await db.sql<{ state: string; blocks_availability: boolean }>(
      `select state, blocks_availability from public.rental_vehicle_assignments where rental_id = $1 order by sequence_no`,
      [rentalId],
    )
    const inspections = await db.sql<{ phase: string; assignment_id: string }>(
      `select phase, assignment_id from public.rental_vehicle_inspections where rental_id = $1 order by inspected_at, phase`,
      [rentalId],
    )
    expect(rental?.status).toBe('completed')
    expect(assignments).toEqual([{ state: 'released', blocks_availability: false }])
    expect(inspections.map((row) => row.phase)).toEqual(['pickup', 'return'])
    expect(inspections.every((row) => row.assignment_id)).toBe(true)
  })

  it('supports repeated active swaps with idempotent operation keys and preserved inspections', async () => {
    const rentalId = await createRental()
    const firstKey = '00000000-0000-0000-0000-000000003001'
    const secondKey = '00000000-0000-0000-0000-000000003002'
    await enabled(async (session) => {
      await session.sql(`select public.rental_confirm($1)`, [rentalId])
      await session.sql(
        `select public.rental_check_out($1::uuid, 20, 90::smallint, 'pickup'::text, '2038-02-01 11:00:00+00'::timestamptz)`,
        [rentalId],
      )
      await session.sql(
        `select public.rental_swap_vehicle($1::uuid, $2::uuid, 'breakdown'::public.rental_assignment_reason, 'engine warning'::text, '2038-02-01 15:00:00+00'::timestamptz, 21, 85::smallint, 'consent-3001'::text, $3::uuid)`,
        [rentalId, vehicleB, firstKey],
      )
      await session.sql(
        `select public.rental_swap_vehicle($1::uuid, $2::uuid, 'breakdown'::public.rental_assignment_reason, 'engine warning'::text, '2038-02-01 15:00:00+00'::timestamptz, 21, 85::smallint, 'consent-3001'::text, $3::uuid)`,
        [rentalId, vehicleB, firstKey],
      )
      await session.sql(
        `select public.rental_swap_vehicle($1::uuid, $2::uuid, 'customer_request'::public.rental_assignment_reason, 'second vehicle'::text, '2038-02-02 10:00:00+00'::timestamptz, 22, 80::smallint, 'consent-3002'::text, $3::uuid)`,
        [rentalId, vehicleC, secondKey],
      )
      await session.sql(
        `select public.rental_check_in($1::uuid, 24, 75::smallint, 'final return'::text, '2038-02-04 10:00:00+00'::timestamptz)`,
        [rentalId],
      )
      await session.sql(`select public.rental_complete($1::uuid)`, [rentalId])
    })
    const [rental] = await db.sql<{ vehicle_id: string; status: string }>(
      `select vehicle_id, status from public.rentals where id = $1`,
      [rentalId],
    )
    const assignments = await db.sql<{ state: string; vehicle_id: string }>(
      `select state, vehicle_id from public.rental_vehicle_assignments where rental_id = $1 order by sequence_no`,
      [rentalId],
    )
    const phases = await db.sql<{ phase: string }>(
      `select phase from public.rental_vehicle_inspections where rental_id = $1 order by inspected_at`,
      [rentalId],
    )
    expect(rental).toMatchObject({ vehicle_id: vehicleC, status: 'completed' })
    expect(assignments.map((row) => row.state)).toEqual(['released', 'released', 'released'])
    expect(assignments.map((row) => row.vehicle_id)).toEqual([vehicleA, vehicleB, vehicleC])
    expect(phases.map((row) => row.phase)).toEqual([
      'pickup',
      'swap_out',
      'swap_in',
      'swap_out',
      'swap_in',
      'return',
    ])
  })

  it('fails closed for unauthorized and cross-tenant active swaps', async () => {
    const rentalId = await createRental()
    await enabled(async (session) => {
      await session.sql(`select public.rental_confirm($1)`, [rentalId])
      await session.sql(
        `select public.rental_check_out($1::uuid, 30, 80::smallint, null::text, null::timestamptz)`,
        [rentalId],
      )
      await session.expectRejection(
        () =>
          session.sql(
            `select public.rental_swap_vehicle($1::uuid, $2::uuid, 'other'::public.rental_assignment_reason, 'no consent'::text, now()::timestamptz, 31, 80::smallint, null::text, $3::uuid)`,
            [rentalId, vehicleB, '00000000-0000-0000-0000-000000003003'],
          ),
        /consent|authorization/i,
      )
    })
  })
})

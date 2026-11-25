// @vitest-environment node

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { TestDatabase, signUp } from './support/harness'

let db: TestDatabase
let userId: string
let organizationId: string
let vehicleOne: string
let vehicleTwo: string
let driverId: string

async function rental(vehicleId: string, startsAt: string, endsAt: string): Promise<string> {
  const [row] = await db.sql<{ id: string }>(
    `insert into public.rentals
       (organization_id, vehicle_id, customer_id, starts_at, ends_at, currency, status)
     values ($1, $2, $3, $4::timestamptz, $5::timestamptz, 'EUR', 'draft')
     returning id`,
    [organizationId, vehicleId, driverId, startsAt, endsAt],
  )
  await db.sql(
    `insert into public.rental_drivers (organization_id, rental_id, customer_id, driver_role)
     values ($1, $2, $3, 'primary')`,
    [organizationId, row!.id, driverId],
  )
  return row!.id
}

beforeAll(async () => {
  db = await TestDatabase.create()
  const account = await signUp(db, {
    email: 'driver-availability-owner@test.local',
    fullName: 'Driver Availability Owner',
    organizationName: 'Driver Availability Organization',
    currency: 'EUR',
  })
  userId = account.userId
  organizationId = account.organizationId!

  const vehicles = await db.sql<{ id: string }>(
    `insert into public.vehicles
       (organization_id, make, model, registration_plate, currency, daily_rate_minor)
     values ($1, 'Test', 'One', 'DRV-A', 'EUR', 1000),
            ($1, 'Test', 'Two', 'DRV-B', 'EUR', 1000)
     returning id`,
    [organizationId],
  )
  vehicleOne = vehicles[0]!.id
  vehicleTwo = vehicles[1]!.id
  const [driver] = await db.sql<{ id: string }>(
    `insert into public.customers (organization_id, first_name, last_name)
     values ($1, 'Driver', 'Conflict') returning id`,
    [organizationId],
  )
  driverId = driver!.id
})

afterAll(async () => db?.close())

describe('driver availability commitments', () => {
  it('rejects overlapping reserved assignments while allowing the half-open boundary', async () => {
    const first = await rental(vehicleOne, '2035-01-01 10:00+00', '2035-01-03 10:00+00')
    await db.sql(`select public.rental_confirm($1)`, [first])

    const overlap = await rental(vehicleTwo, '2035-01-02 10:00+00', '2035-01-04 10:00+00')
    await db.expectRejection(
      () => db.sql(`select public.rental_confirm($1)`, [overlap]),
      /driver availability conflict/i,
    )

    const boundary = await rental(vehicleTwo, '2035-01-03 10:00+00', '2035-01-04 10:00+00')
    await db.sql(`select public.rental_confirm($1)`, [boundary])
  })

  it('returns tenant-scoped availability without exposing driver UUIDs in the UI message fields', async () => {
    const rows = await db.asUser(userId, (session) =>
      session.sql<{
        customer_id: string
        available: boolean
        conflict_reference: string | null
      }>(
        `select customer_id, available, conflict_reference
           from public.driver_availability($1, $2::uuid[], $3::timestamptz, $4::timestamptz)`,
        [organizationId, [driverId], '2035-01-02 10:00+00', '2035-01-04 10:00+00'],
      ),
    )

    expect(rows).toHaveLength(1)
    expect(rows[0]?.available).toBe(false)
    expect(rows[0]?.conflict_reference).toMatch(/^RNT-/)
  })
})

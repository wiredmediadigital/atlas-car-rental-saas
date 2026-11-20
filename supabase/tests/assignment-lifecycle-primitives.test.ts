// @vitest-environment node

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { TestDatabase, signUp } from './support/harness'

let db: TestDatabase
let ownerOne: { userId: string; organizationId: string }
let ownerTwo: { userId: string; organizationId: string }
let rentalOne: string
let vehicleOne: string
let vehicleTwo: string

beforeAll(async () => {
  db = await TestDatabase.create()
  const one = await signUp(db, {
    email: 'slice1-owner-one@test.local',
    fullName: 'Slice One Owner',
    organizationName: 'Slice One One',
    currency: 'EUR',
  })
  const two = await signUp(db, {
    email: 'slice1-owner-two@test.local',
    fullName: 'Slice One Other',
    organizationName: 'Slice One Two',
    currency: 'EUR',
  })
  if (!one.organizationId || !two.organizationId) throw new Error('Slice 1 provisioning failed.')
  ownerOne = { userId: one.userId, organizationId: one.organizationId }
  ownerTwo = { userId: two.userId, organizationId: two.organizationId }

  const seeded: string[] = []
  for (const [organizationId, prefix] of [
    [ownerOne.organizationId, 'ONE'],
    [ownerTwo.organizationId, 'TWO'],
  ] as const) {
    const [vehicle] = await db.sql<{ id: string }>(
      `insert into public.vehicles
         (organization_id, make, model, registration_plate, currency, daily_rate_minor)
       values ($1, 'Test', 'Vehicle', $2, 'EUR', 1000)
       returning id`,
      [organizationId, `SLICE1-${prefix}-A`],
    )
    const [customer] = await db.sql<{ id: string }>(
      `insert into public.customers (organization_id, first_name, last_name, email)
       values ($1, 'Test', 'Customer', $2)
       returning id`,
      [organizationId, `${prefix.toLowerCase()}@slice1.test`],
    )
    const [rental] = await db.sql<{ id: string }>(
      `insert into public.rentals
         (organization_id, vehicle_id, customer_id, starts_at, ends_at, currency, status)
       values ($1, $2, $3, '2032-01-01 10:00:00+00', '2032-01-01 12:00:00+00', 'EUR', 'draft')
       returning id`,
      [organizationId, vehicle!.id, customer!.id],
    )
    seeded.push(rental!.id)
    if (organizationId === ownerOne.organizationId) {
      vehicleOne = vehicle!.id
      rentalOne = rental!.id
      const [secondVehicle] = await db.sql<{ id: string }>(
        `insert into public.vehicles
           (organization_id, make, model, registration_plate, currency, daily_rate_minor)
         values ($1, 'Test', 'Replacement', 'SLICE1-ONE-B', 'EUR', 1000)
         returning id`,
        [organizationId],
      )
      vehicleTwo = secondVehicle!.id
    }
  }

  await db.sql(
    `insert into public.rental_vehicle_assignments
       (organization_id, rental_id, vehicle_id, sequence_no, state,
        scheduled_starts_at, scheduled_ends_at, blocks_availability)
     values ($1, $2, $3, 1, 'planned',
             '2032-01-01 10:00:00+00', '2032-01-01 12:00:00+00', false)`,
    [ownerOne.organizationId, rentalOne, vehicleOne],
  )
})

afterAll(async () => {
  await db?.close()
})

describe('Slice 1 assignment lifecycle primitives', () => {
  it('resolves only a tenant-owned current assignment and allocates monotonic sequence numbers', async () => {
    const result = await db.asUser(ownerOne.userId, async (session) => {
      const [current] = await session.sql<{ id: string; sequence_no: number }>(
        `select (app.resolve_current_rental_assignment($1)).id,
                (app.resolve_current_rental_assignment($1)).sequence_no`,
        [rentalOne],
      )
      const [next] = await session.sql<{ next_sequence: number }>(
        `select app.allocate_rental_assignment_sequence($1) as next_sequence`,
        [rentalOne],
      )
      return { current, next }
    })

    expect(result.current?.id).toEqual(expect.any(String))
    expect(result.current?.sequence_no).toBe(1)
    if (!result.next) throw new Error('Sequence allocation returned no row.')
    expect(result.next.next_sequence).toBe(2)
    await db.asUser(ownerTwo.userId, async (session) => {
      await session.expectRejection(
        () => session.sql(`select app.resolve_current_rental_assignment($1)`, [rentalOne]),
        /not found/i,
      )
    })
  })

  it('opens one idempotent assignment and preserves the rental pointer only through the primitive', async () => {
    const operationKey = '00000000-0000-0000-0000-000000000101'
    await db.asUser(ownerOne.userId, async (session) => {
      const [authorization] = await session.sql<{ allowed: boolean }>(
        `select app.has_min_role($1, 'staff'::public.org_role) as allowed`,
        [ownerOne.organizationId],
      )
      expect(authorization?.allowed).toBe(true)
      await session.expectRejection(
        () =>
          session.sql(
            `select app.open_rental_assignment(
               $1, $2, 'reserved'::public.rental_assignment_state,
               'pre_checkout_swap'::public.rental_assignment_reason, 'wrong state', $3::uuid)`,
            [rentalOne, vehicleTwo, '00000000-0000-0000-0000-000000000100'],
          ),
        /state must match/i,
      )
      await session.sql(
        `select app.open_rental_assignment(
           $1, $2, 'planned'::public.rental_assignment_state,
           'pre_checkout_swap'::public.rental_assignment_reason, 'test replacement', $3::uuid)`,
        [rentalOne, vehicleTwo, operationKey],
      )
      await session.sql(
        `select app.open_rental_assignment(
           $1, $2, 'planned'::public.rental_assignment_state,
           'pre_checkout_swap'::public.rental_assignment_reason, 'test replacement', $3::uuid)`,
        [rentalOne, vehicleTwo, operationKey],
      )
      await session.expectRejection(
        () =>
          session.sql(
            `select app.open_rental_assignment(
               $1, $2, 'planned'::public.rental_assignment_state,
               'pre_checkout_swap'::public.rental_assignment_reason, 'different payload', $3::uuid)`,
            [rentalOne, vehicleOne, operationKey],
          ),
        /payload does not match/i,
      )
    })

    const assignments = await db.sql<{ sequence_no: number; vehicle_id: string }>(
      `select sequence_no, vehicle_id
       from public.rental_vehicle_assignments
       where rental_id = $1 order by sequence_no`,
      [rentalOne],
    )
    expect(assignments).toHaveLength(2)
    expect(assignments[1]).toMatchObject({ sequence_no: 2, vehicle_id: vehicleTwo })

    await db.asUser(ownerOne.userId, async (session) => {
      const [replacement] = await session.sql<{ id: string }>(
        `select id from public.rental_vehicle_assignments where rental_id = $1 and sequence_no = 2`,
        [rentalOne],
      )
      await session.sql(`select app.sync_rental_vehicle_pointer($1, $2)`, [
        rentalOne,
        replacement!.id,
      ])
      await session.expectRejection(
        () =>
          session.exec(
            `select pg_catalog.set_config('app.assignment_lifecycle_enabled', 'off', true);
             select pg_catalog.set_config('app.assignment_write', 'off', true);
             update public.rentals set vehicle_id = '${vehicleOne}' where id = '${rentalOne}';`,
          ),
        /permission denied/i,
      )
      await session.expectRejection(
        () =>
          session.exec(
            `select pg_catalog.set_config('app.assignment_lifecycle_enabled', 'on', true);
             select pg_catalog.set_config('app.assignment_write', 'on', true);
             update public.rentals set vehicle_id = '${vehicleOne}' where id = '${rentalOne}';`,
          ),
        /permission denied/i,
      )
    })
  })

  it('allows only legal assignment transitions and keeps checked-in availability blocked until completion', async () => {
    await db.asUser(ownerOne.userId, async (session) => {
      await session.sql(
        `select app.transition_rental_assignment(
           (select id from public.rental_vehicle_assignments where rental_id = $1 and sequence_no = 2),
           'reserved'::public.rental_assignment_state, '2032-01-01 09:00:00+00'::timestamptz)`,
        [rentalOne],
      )
      await session.sql(
        `select app.transition_rental_assignment(
           (select id from public.rental_vehicle_assignments where rental_id = $1 and sequence_no = 2),
           'in_custody'::public.rental_assignment_state, '2032-01-01 10:00:00+00'::timestamptz, 100, 50::smallint)`,
        [rentalOne],
      )
      await session.sql(
        `select app.transition_rental_assignment(
           (select id from public.rental_vehicle_assignments where rental_id = $1 and sequence_no = 2),
           'released'::public.rental_assignment_state, '2032-01-01 11:00:00+00'::timestamptz,
           null::integer, null::smallint, 110, 45::smallint)`,
        [rentalOne],
      )
    })

    const [assignment] = await db.sql<{
      state: string
      blocks_availability: boolean
      started_at: string
      ended_at: string
    }>(
      `select state, blocks_availability, started_at, ended_at
       from public.rental_vehicle_assignments where rental_id = $1 and sequence_no = 2`,
      [rentalOne],
    )
    expect(assignment?.state).toBe('released')
    expect(assignment?.blocks_availability).toBe(true)
    expect(assignment?.started_at).toBeTruthy()
    expect(assignment?.ended_at).toBeTruthy()

    await db.asUser(ownerOne.userId, async (session) => {
      await session.expectRejection(
        () =>
          session.sql(
            `select app.transition_rental_assignment(
               (select id from public.rental_vehicle_assignments where rental_id = $1 and sequence_no = 2),
               'in_custody'::public.rental_assignment_state, now()::timestamptz)`,
            [rentalOne],
          ),
        /invalid assignment transition/i,
      )
    })
  })

  it('rejects direct assignment writes and cross-tenant primitive calls', async () => {
    await db.asUser(ownerTwo.userId, async (session) => {
      await session.expectRejection(
        () => session.sql(`select app.allocate_rental_assignment_sequence($1)`, [rentalOne]),
        /not found/i,
      )
      await session.expectRejection(
        () =>
          session.sql(
            `select app.sync_rental_vehicle_pointer(
               $1, (select id from public.rental_vehicle_assignments where rental_id = $1 and sequence_no = 2))`,
            [rentalOne],
          ),
        /not found|permission denied/i,
      )
    })

    await db.asAnon(async (session) => {
      await session.expectRejection(
        () =>
          session.sql(`select app.sync_rental_vehicle_pointer($1, $2)`, [
            rentalOne,
            '00000000-0000-0000-0000-000000000000',
          ]),
        /permission denied/i,
      )
    })

    await db.asServiceRole(ownerOne.userId, async (service) => {
      await service.expectRejection(
        () =>
          service.sql(
            `update public.rental_vehicle_assignments
             set reason_notes = 'direct mutation' where rental_id = $1 and sequence_no = 1`,
            [rentalOne],
          ),
        /writable only through an authorized lifecycle path/i,
      )
    })
  })

  it('rolls back a failed transition without changing assignment state', async () => {
    const [before] = await db.sql<{ state: string; blocks_availability: boolean }>(
      `select state, blocks_availability from public.rental_vehicle_assignments
       where rental_id = $1 and sequence_no = 2`,
      [rentalOne],
    )
    await db.asUser(ownerOne.userId, async (session) => {
      await session.expectRejection(
        () =>
          session.sql(
            `select app.transition_rental_assignment(
               (select id from public.rental_vehicle_assignments where rental_id = $1 and sequence_no = 2),
               'cancelled'::public.rental_assignment_state, now())`,
            [rentalOne],
          ),
        /invalid assignment transition/i,
      )
    })
    const [after] = await db.sql<{ state: string; blocks_availability: boolean }>(
      `select state, blocks_availability from public.rental_vehicle_assignments
       where rental_id = $1 and sequence_no = 2`,
      [rentalOne],
    )
    expect(after).toEqual(before)
  })
})

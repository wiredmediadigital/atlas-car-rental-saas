// @vitest-environment node

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { TestDatabase, signUp } from './support/harness'

let db: TestDatabase
let owner: { userId: string; organizationId: string }
let vehicleA: string
let vehicleB: string
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

/**
 * Runs `fn` with the assignment lifecycle genuinely enabled.
 *
 * It used to set `app.assignment_lifecycle_enabled` as a session GUC.
 * 20261128140000 removed that setting from the authorization decision
 * altogether -- a caller-settable flag has no business inside one -- so the
 * feature is now switched on the way the product switches it on: a row in
 * app.assignment_feature_activation.
 */
async function enabled<T>(fn: (session: TestDatabase) => Promise<T>) {
  await db.sql(
    `insert into app.assignment_feature_activation (organization_id, enabled)
     values ($1, true)
     on conflict (organization_id) do update set enabled = true`,
    [owner.organizationId],
  )
  return db.asUser(owner.userId, async (session) => {
    await session.sql(`select pg_catalog.set_config('app.assignment_test_harness', 'on', false)`)
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

  /*
   * The active vehicle swap was WITHDRAWN by 20261124120000, which revoked
   * public.rental_swap_vehicle from public, anon, authenticated and
   * service_role. Its effective ACL is the owner alone.
   *
   * The two tests that used to live here asserted successful swaps and had
   * been carried as "baseline failures" ever since. They are replaced rather
   * than deleted: the behaviour that matters now is that the withdrawal holds
   * and that the history those swaps left behind is still readable.
   */
  it('refuses the active vehicle swap to every browser role', async () => {
    const rentalId = await createRental()

    for (const actor of [owner.userId]) {
      await db.expectRejection(
        () =>
          db.asUser(actor, (session) =>
            session.sql(
              `select public.rental_swap_vehicle($1, $2, 'breakdown'::public.rental_assignment_reason,
                                                 null, now(), null, null, null, null)`,
              [rentalId, vehicleB],
            ),
          ),
        /permission denied|does not exist/i,
      )
    }
  })

  it('grants the swap to nobody but the table owner', async () => {
    const reachable = await db.sql<{ grantee: string }>(
      `select r.rolname as grantee
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
         cross join (values ('anon'), ('authenticated'), ('service_role')) as t(rolname)
         join pg_roles r on r.rolname = t.rolname
        where n.nspname = 'public' and p.proname = 'rental_swap_vehicle'
          and has_function_privilege(r.rolname, p.oid, 'EXECUTE')`,
    )
    expect(reachable).toEqual([])
  })

  it('keeps the assignment history that earlier swaps left behind readable', async () => {
    // Withdrawing the operation must not hide what it already did.
    const rentalId = await createRental()
    await enabled(async (session) => {
      await session.sql(`select public.rental_confirm($1)`, [rentalId])
    })

    const history = await db.asUser(owner.userId, (session) =>
      session.sql<{ state: string }>(
        `select state::text from public.rental_vehicle_assignments where rental_id = $1`,
        [rentalId],
      ),
    )
    expect(history.length).toBeGreaterThan(0)
  })
})

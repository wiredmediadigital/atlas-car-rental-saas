// @vitest-environment node

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { TestDatabase, addMember, signUp } from './support/harness'

let db: TestDatabase
let owner: { userId: string; organizationId: string }
let staff: { userId: string }

beforeAll(async () => {
  db = await TestDatabase.create()
  const ownerAccount = await signUp(db, {
    email: 'stg02-activation-owner@test.local',
    fullName: 'STG02 Activation Owner',
    organizationName: 'STG02 Activation Organization',
  })
  if (!ownerAccount.organizationId) throw new Error('Activation fixture organization missing.')
  owner = { userId: ownerAccount.userId, organizationId: ownerAccount.organizationId }
  const staffAccount = await signUp(db, { email: 'stg02-activation-staff@test.local' })
  staff = { userId: staffAccount.userId }
  await addMember(db, owner.organizationId, staff.userId, 'staff')
})

afterAll(async () => db?.close())

describe('STG-02 server-owned assignment activation', () => {
  it('defaults missing activation to disabled and keeps the decision tenant-scoped', async () => {
    const [row] = await db.asUser(owner.userId, (session) =>
      session.sql<{ enabled: boolean; can_view_history: boolean; can_swap: boolean }>(
        `select * from public.assignment_feature_eligibility($1)`,
        [owner.organizationId],
      ),
    )
    /*
     * The STG-02 default, restored by 20261128140000 after 20261124100000 had
     * quietly inverted it. A missing activation row means the feature is off.
     *
     * can_view_history is TRUE even so, and that is the revised contract
     * rather than a slip: reading what the agency already did is not a feature
     * that has to be switched on, and the history has to stay legible while
     * legacy assignments drain. can_swap is false in every state, because the
     * active vehicle swap is withdrawn and its function is revoked from every
     * browser role.
     */
    expect(row).toEqual({ enabled: false, can_view_history: true, can_swap: false })
  })

  it('still opens no assignment for an agency nobody switched on', async () => {
    // The behaviour behind the flag, not just the flag: with activation off, a
    // confirmed reservation carries no assignment row at all.
    const [vehicle] = await db.sql<{ id: string }>(
      `insert into public.vehicles
         (organization_id, make, model, registration_plate, currency, daily_rate_minor)
       values ($1, 'Test', 'Default', 'STG02-OFF', 'EUR', 5000) returning id`,
      [owner.organizationId],
    )
    const [customer] = await db.sql<{ id: string }>(
      `insert into public.customers (organization_id, first_name, last_name)
       values ($1, 'Default', 'Off') returning id`,
      [owner.organizationId],
    )
    const [rental] = await db.sql<{ id: string }>(
      `insert into public.rentals
         (organization_id, vehicle_id, customer_id, starts_at, ends_at, currency,
          status, daily_rate_minor, billable_days)
       values ($1, $2, $3, now() + interval '90 days', now() + interval '93 days',
               'EUR', 'draft', 5000, 3) returning id`,
      [owner.organizationId, vehicle!.id, customer!.id],
    )
    await db.sql(
      `insert into public.rental_drivers (organization_id, rental_id, customer_id, driver_role)
       values ($1, $2, $3, 'primary')`,
      [owner.organizationId, rental!.id, customer!.id],
    )

    await db.sql(`select public.rental_confirm($1)`, [rental!.id])

    const [count] = await db.sql<{ n: number }>(
      `select count(*)::int as n from public.rental_vehicle_assignments where rental_id = $1`,
      [rental!.id],
    )
    expect(count!.n).toBe(0)
  })

  it('requires AAL2 admin authority and records an audit event for activation', async () => {
    await db.expectRejection(
      () =>
        db.asUser(staff.userId, (session) =>
          session.sql(`select public.set_assignment_feature_enabled($1, true)`, [
            owner.organizationId,
          ]),
        ),
      /permission|admin|not authorized/i,
    )

    await db.asUser(owner.userId, (session) =>
      session.sql(`select public.set_assignment_feature_enabled($1, true)`, [owner.organizationId]),
    )
    const [eligible] = await db.asUser(staff.userId, (session) =>
      session.sql<{ enabled: boolean; can_view_history: boolean; can_swap: boolean }>(
        `select * from public.assignment_feature_eligibility($1)`,
        [owner.organizationId],
      ),
    )
    expect(eligible).toEqual({ enabled: true, can_view_history: true, can_swap: false })

    const [event] = await db.sql<{ enabled: boolean; organization_id: string }>(
      `select enabled, organization_id from app.assignment_feature_activation_events
       where organization_id = $1 order by changed_at desc limit 1`,
      [owner.organizationId],
    )
    expect(event).toEqual({ enabled: true, organization_id: owner.organizationId })
  })

  it('does not let an authenticated session override server state with the harness GUC', async () => {
    await db.asUser(owner.userId, (session) =>
      session.sql(`select public.set_assignment_feature_enabled($1, false)`, [
        owner.organizationId,
      ]),
    )
    await db.asUser(staff.userId, async (session) => {
      await session.sql(`select set_config('app.assignment_lifecycle_enabled', 'on', false)`)
      const [row] = await session.sql<{ enabled: boolean; can_swap: boolean }>(
        `select * from public.assignment_feature_eligibility($1)`,
        [owner.organizationId],
      )
      expect(row).toMatchObject({ enabled: false, can_swap: false })
    })
  })

  it('rejects AAL1 admin activation and disables deterministically', async () => {
    await db.expectRejection(
      () =>
        db.asUser(
          owner.userId,
          (session) =>
            session.sql(`select public.set_assignment_feature_enabled($1, false)`, [
              owner.organizationId,
            ]),
          { aal: 'aal1' },
        ),
      /aal|factor|permission|authorized|administrator/i,
    )
    await db.asUser(owner.userId, (session) =>
      session.sql(`select public.set_assignment_feature_enabled($1, false)`, [
        owner.organizationId,
      ]),
    )
    const [row] = await db.asUser(owner.userId, (session) =>
      session.sql<{ enabled: boolean }>(
        `select enabled from public.assignment_feature_eligibility($1)`,
        [owner.organizationId],
      ),
    )
    expect(row?.enabled).toBe(false)
  })
})

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
    expect(row).toEqual({ enabled: false, can_view_history: false, can_swap: false })
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

// @vitest-environment node
/**
 * Privileged writes require a verified second factor.
 *
 * 20261112100200 gates the helpers behind every RLS policy, which stops a
 * password-only (`aal1`) session READING tenant data. Five SECURITY DEFINER RPCs
 * decide who may act with app.current_role_in alone, so the same session could
 * still take the account over: hand the agency to itself, remove the real owner,
 * promote itself, invite a second account, or start closing the agency.
 *
 * Each is asserted three ways: an aal2 caller still succeeds, an aal1 caller is
 * refused with 42501, and a caller with no `aal` claim at all (a pre-MFA token)
 * is refused with 42501. A refusal must also leave no trace.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { TestDatabase, addMember, signUp } from './support/harness'

type Aal = 'aal1' | null

const WEAK_SESSIONS: ReadonlyArray<{ label: string; aal: Aal }> = [
  { label: 'at aal1', aal: 'aal1' },
  { label: 'with no aal claim', aal: null },
]

let db: TestDatabase
let sequence = 0

interface Agency {
  organizationId: string
  owner: string
  admin: string
  staff: string
}

/** A fresh agency per test, so a successful write never leaks into the next. */
async function seedAgency(): Promise<Agency> {
  sequence += 1
  const tag = `pw${sequence}`
  const founder = await signUp(db, {
    email: `owner-${tag}@privileged.test`,
    organizationName: `Privileged ${tag}`,
    currency: 'EUR',
    timeZone: 'Europe/Lisbon',
  })
  if (!founder.organizationId) throw new Error('Provisioning failed for the test agency.')
  const admin = (await signUp(db, { email: `admin-${tag}@privileged.test` })).userId
  const staff = (await signUp(db, { email: `staff-${tag}@privileged.test` })).userId
  await addMember(db, founder.organizationId, admin, 'admin')
  await addMember(db, founder.organizationId, staff, 'staff')
  return { organizationId: founder.organizationId, owner: founder.userId, admin, staff }
}

async function membershipOf(organizationId: string): Promise<string> {
  const rows = await db.sql<{ user_id: string; role: string; status: string }>(
    `select user_id, role, status from public.organization_members
      where organization_id = $1 order by user_id`,
    [organizationId],
  )
  return JSON.stringify(rows)
}

async function roleOf(organizationId: string, userId: string): Promise<string | undefined> {
  const [row] = await db.sql<{ role: string }>(
    `select role from public.organization_members where organization_id = $1 and user_id = $2`,
    [organizationId, userId],
  )
  return row?.role
}

async function invitationCount(organizationId: string): Promise<number> {
  const [row] = await db.sql<{ n: number }>(
    `select count(*)::int as n from public.organization_invitations where organization_id = $1`,
    [organizationId],
  )
  return row?.n ?? 0
}

async function notificationEventCount(organizationId: string): Promise<number> {
  const [row] = await db.sql<{ n: number }>(
    `select count(*)::int as n from public.notification_events where organization_id = $1`,
    [organizationId],
  )
  return row?.n ?? 0
}

async function closureRequestedAt(organizationId: string): Promise<string | null> {
  const [row] = await db.sql<{ closure_requested_at: string | null }>(
    `select closure_requested_at from public.organizations where id = $1`,
    [organizationId],
  )
  return row?.closure_requested_at ?? null
}

/** Runs `run` as `userId` and returns the SQLSTATE it was refused with, or 'succeeded'. */
async function outcomeOf(
  userId: string,
  aal: Aal | undefined,
  run: (s: TestDatabase) => Promise<unknown>,
): Promise<string> {
  return db.asUser(
    userId,
    async (s) => {
      try {
        await run(s)
      } catch (error) {
        const code = (error as { code?: unknown }).code
        return typeof code === 'string' ? code : 'no-code'
      }
      return 'succeeded'
    },
    aal === undefined ? {} : { aal },
  )
}

beforeAll(async () => {
  db = await TestDatabase.create()
})

afterAll(async () => {
  await db.close()
})

describe('public.transfer_organization_ownership', () => {
  const call = (a: Agency) => (s: TestDatabase) =>
    s.sql(`select public.transfer_organization_ownership($1, $2, 'admin')`, [
      a.organizationId,
      a.admin,
    ])

  it('still lets an owner at aal2 hand the agency over', async () => {
    const a = await seedAgency()
    expect(await outcomeOf(a.owner, undefined, call(a))).toBe('succeeded')
    expect(await roleOf(a.organizationId, a.admin)).toBe('owner')
  })

  it.each(WEAK_SESSIONS)('refuses the owner $label and changes nothing', async ({ aal }) => {
    const a = await seedAgency()
    const before = await membershipOf(a.organizationId)
    expect(await outcomeOf(a.owner, aal, call(a))).toBe('42501')
    expect(await membershipOf(a.organizationId)).toBe(before)
  })
})

describe('public.remove_team_member', () => {
  const call = (a: Agency) => (s: TestDatabase) =>
    s.sql(`select public.remove_team_member($1, $2)`, [a.organizationId, a.staff])

  it('still lets an admin at aal2 remove a staff member', async () => {
    const a = await seedAgency()
    expect(await outcomeOf(a.admin, undefined, call(a))).toBe('succeeded')
    expect(await roleOf(a.organizationId, a.staff)).toBeUndefined()
  })

  it.each(WEAK_SESSIONS)('refuses an admin $label and changes nothing', async ({ aal }) => {
    const a = await seedAgency()
    const before = await membershipOf(a.organizationId)
    expect(await outcomeOf(a.admin, aal, call(a))).toBe('42501')
    expect(await membershipOf(a.organizationId)).toBe(before)
  })
})

describe('public.change_team_member_role', () => {
  const call = (a: Agency) => (s: TestDatabase) =>
    s.sql(`select public.change_team_member_role($1, $2, 'manager')`, [a.organizationId, a.staff])

  it('still lets an admin at aal2 promote a staff member', async () => {
    const a = await seedAgency()
    expect(await outcomeOf(a.admin, undefined, call(a))).toBe('succeeded')
    expect(await roleOf(a.organizationId, a.staff)).toBe('manager')
  })

  it.each(WEAK_SESSIONS)('refuses an admin $label and changes nothing', async ({ aal }) => {
    const a = await seedAgency()
    const before = await membershipOf(a.organizationId)
    expect(await outcomeOf(a.admin, aal, call(a))).toBe('42501')
    expect(await membershipOf(a.organizationId)).toBe(before)
  })
})

describe('public.create_team_invitation', () => {
  const call = (a: Agency) => (s: TestDatabase) =>
    s.sql(
      `select * from public.create_team_invitation($1, 'second-account@privileged.test', 'staff')`,
      [a.organizationId],
    )

  it('still lets an admin at aal2 invite', async () => {
    const a = await seedAgency()
    expect(await outcomeOf(a.admin, undefined, call(a))).toBe('succeeded')
    expect(await invitationCount(a.organizationId)).toBe(1)
  })

  it.each(WEAK_SESSIONS)('refuses an admin $label and writes no invitation', async ({ aal }) => {
    const a = await seedAgency()
    expect(await outcomeOf(a.admin, aal, call(a))).toBe('42501')
    expect(await invitationCount(a.organizationId)).toBe(0)
  })
})

describe('public.organization_request_closure', () => {
  const call = (a: Agency) => (s: TestDatabase) =>
    s.sql(`select * from public.organization_request_closure($1)`, [a.organizationId])

  it('still lets an owner at aal2 start closing the agency', async () => {
    const a = await seedAgency()
    expect(await outcomeOf(a.owner, undefined, call(a))).toBe('succeeded')
    expect(await closureRequestedAt(a.organizationId)).not.toBeNull()
  })

  it.each(WEAK_SESSIONS)('refuses the owner $label and sets no closure state', async ({ aal }) => {
    const a = await seedAgency()
    expect(await outcomeOf(a.owner, aal, call(a))).toBe('42501')
    expect(await closureRequestedAt(a.organizationId)).toBeNull()
    expect(await notificationEventCount(a.organizationId)).toBe(0)
  })
})

describe('public.leave_organization', () => {
  const call = (a: Agency) => (s: TestDatabase) =>
    s.sql(`select public.leave_organization($1)`, [a.organizationId])

  it('still lets a member at aal2 leave', async () => {
    const a = await seedAgency()
    expect(await outcomeOf(a.staff, undefined, call(a))).toBe('succeeded')
    expect(await roleOf(a.organizationId, a.staff)).toBeUndefined()
  })

  it.each(WEAK_SESSIONS)('refuses a member $label and keeps the membership', async ({ aal }) => {
    const a = await seedAgency()
    const before = await membershipOf(a.organizationId)
    expect(await outcomeOf(a.staff, aal, call(a))).toBe('42501')
    expect(await roleOf(a.organizationId, a.staff)).toBe('staff')
    expect(await membershipOf(a.organizationId)).toBe(before)
  })
})

describe('the helper the gate must not touch', () => {
  it('app.current_role_in still answers at aal1, because the vehicle-limit trigger relies on it', async () => {
    const a = await seedAgency()
    const [row] = await db.asUser(
      a.owner,
      (s) => s.sql<{ role: string }>(`select app.current_role_in($1) as role`, [a.organizationId]),
      { aal: 'aal1' },
    )
    expect(row?.role).toBe('owner')
  })
})

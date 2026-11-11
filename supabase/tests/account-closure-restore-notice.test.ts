// @vitest-environment node
/**
 * Restoring an agency tells people, in the same transaction.
 *
 * Closing sends the operator an instruction ("cancel the subscription if it is
 * still live past the purge date"). Nothing ever retracted it, so an agency that
 * changed its mind could have its subscription cancelled by an operator acting on
 * a stale message. Restoring now records an operator notice on the organization
 * row and writes an in-app notification for every owner and administrator.
 * Owners and administrators are NOT emailed on restore: that was decided.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { TestDatabase, addMember, signUp } from './support/harness'

let db: TestDatabase
let organizationId: string
let owner: string
let admin: string
let secondAdmin: string
let manager: string
let staff: string
let seq = 0

const KIND = 'account_closure_restored'

async function newMember(label: string, role: 'admin' | 'manager' | 'staff'): Promise<string> {
  const u = await signUp(db, { email: `${label}${seq}@restore.test`, fullName: `${label} user` })
  await addMember(db, organizationId, u.userId, role)
  return u.userId
}

const requestAs = (userId: string) =>
  db.asUser(userId, (s) =>
    s.sql(`select * from public.organization_request_closure($1)`, [organizationId]),
  )
const restoreAs = (userId: string) =>
  db.asUser(userId, (s) => s.sql(`select * from public.organization_restore($1)`, [organizationId]))

async function eventCount(): Promise<number> {
  const rows = await db.sql(
    `select id from public.notification_events
      where organization_id = $1 and kind = $2::public.notification_kind`,
    [organizationId, KIND],
  )
  return rows.length
}

async function recipients(): Promise<string[]> {
  const rows = await db.sql<{ user_id: string }>(
    `select r.user_id from public.notification_event_recipients r
       join public.notification_events e on e.id = r.event_id
      where e.organization_id = $1 and e.kind = $2::public.notification_kind`,
    [organizationId, KIND],
  )
  return rows.map((r) => r.user_id).sort()
}

const feedAs = (userId: string) =>
  db.asUser(userId, (s) =>
    s.sql<{ kind: string; action_path: string }>(
      `select kind::text, action_path from public.notification_feed($1, 'all', 50, 0)`,
      [organizationId],
    ),
  )

interface RestorePending {
  organization_id: string
  organization_name: string
  restored_at: string
  closing_again: boolean
}

const restorePending = () =>
  db.asServiceRole(owner, (s) =>
    s.sql<RestorePending>(`select * from app.closure_restore_notices_pending($1)`, [
      organizationId,
    ]),
  )

const closurePending = () =>
  db.asServiceRole(owner, (s) =>
    s.sql<{ send_members: boolean; send_operator: boolean }>(
      `select * from app.closure_notices_pending($1)`,
      [organizationId],
    ),
  )

async function restoreColumns() {
  const [row] = await db.sql<{
    state: string | null
    attempts: number
    detail: string | null
    restored_at: string | null
  }>(
    `select closure_restore_notice_state::text as state,
            closure_restore_notice_attempts as attempts,
            closure_restore_notice_detail as detail,
            closure_restored_at::text as restored_at
       from public.organizations where id = $1`,
    [organizationId],
  )
  return row!
}

const recordRestore = (state: string, at: string | null) =>
  db.asServiceRole(owner, (s) =>
    s.sql(`select app.closure_restore_notice_record($1, $2, 'x', $3::timestamptz)`, [
      organizationId,
      state,
      at,
    ]),
  )

beforeAll(async () => {
  db = await TestDatabase.create()
})
afterAll(async () => {
  await db.close()
})

beforeEach(async () => {
  seq += 1
  const o = await signUp(db, {
    email: `owner${seq}@restore.test`,
    fullName: 'Owner One',
    organizationName: `Restore ${seq}`,
    currency: 'EUR',
    timeZone: 'Europe/Paris',
  })
  if (!o.organizationId) throw new Error('provisioning failed')
  organizationId = o.organizationId
  owner = o.userId
  admin = await newMember('admin', 'admin')
  secondAdmin = await newMember('adminb', 'admin')
  manager = await newMember('manager', 'manager')
  staff = await newMember('staff', 'staff')
})

describe('the in-app notification', () => {
  it('is written in the restore transaction for every owner and administrator', async () => {
    await requestAs(owner)
    await restoreAs(admin)

    expect(await eventCount()).toBe(1)
    expect(await recipients()).toEqual([owner, admin, secondAdmin].sort())
  })

  it('is visible to owners and administrators, and to nobody below', async () => {
    await requestAs(owner)
    await restoreAs(admin)

    for (const who of [owner, admin, secondAdmin]) {
      expect((await feedAs(who)).filter((r) => r.kind === KIND)).toHaveLength(1)
    }
    for (const who of [manager, staff]) {
      expect((await feedAs(who)).filter((r) => r.kind === KIND)).toHaveLength(0)
    }
  })

  it('points at Settings', async () => {
    await requestAs(owner)
    await restoreAs(admin)
    const row = (await feedAs(owner)).find((r) => r.kind === KIND)
    expect(row!.action_path).toBe('/settings')
  })

  it('names who restored it', async () => {
    await requestAs(owner)
    await restoreAs(admin)
    const [row] = await db.sql<{ actor_user_id: string }>(
      `select actor_user_id from public.notification_events
        where organization_id = $1 and kind = $2::public.notification_kind`,
      [organizationId, KIND],
    )
    expect(row!.actor_user_id).toBe(admin)
  })

  it('is raised again by every later restore', async () => {
    await requestAs(owner)
    await restoreAs(admin)
    await requestAs(owner)
    await restoreAs(owner)
    expect(await eventCount()).toBe(2)
  })
})

describe('a refused restore leaves no trace', () => {
  it.each([
    ['a manager', () => manager],
    ['staff', () => staff],
  ])('writes nothing when %s tries', async (_label, who) => {
    await requestAs(owner)
    await expect(restoreAs(who())).rejects.toThrow(/only an owner or an administrator/i)

    expect(await eventCount()).toBe(0)
    expect(await restorePending()).toEqual([])
    expect((await restoreColumns()).state).toBeNull()
  })

  it('writes nothing when the agency is not closing', async () => {
    await expect(restoreAs(owner)).rejects.toThrow(/not closing/i)
    expect(await eventCount()).toBe(0)
    expect(await restorePending()).toEqual([])
  })
})

describe('the operator notice', () => {
  it('is recorded as pending by the restore, and names the agency', async () => {
    await requestAs(owner)
    await restoreAs(admin)

    expect((await restoreColumns()).state).toBe('pending')
    const [row] = await restorePending()
    expect(row!.organization_name).toBe(`Restore ${seq}`)
    expect(row!.closing_again).toBe(false)
    expect(row!.restored_at).toBeTruthy()
  })

  it('names the agency by its legal name when it has one, as the closure notice does', async () => {
    await db.sql(
      `update public.organizations set legal_name = 'Atlas Rentals SARL' where id = $1`,
      [organizationId],
    )
    await requestAs(owner)
    await restoreAs(admin)
    expect((await restorePending())[0]!.organization_name).toBe('Atlas Rentals SARL')
  })

  it('is not recorded for an agency that was never closed', async () => {
    expect(await restorePending()).toEqual([])
    expect((await restoreColumns()).state).toBeNull()
  })

  it('carries no address: owners and administrators are not emailed on restore', async () => {
    await requestAs(owner)
    await restoreAs(admin)
    const [row] = await restorePending()
    expect(Object.keys(row!).sort()).toEqual(
      ['closing_again', 'organization_id', 'organization_name', 'restored_at'].sort(),
    )
  })

  it('leaves the closure notices unlisted: a restored agency owes none of them', async () => {
    await requestAs(owner)
    await restoreAs(admin)
    expect(await closurePending()).toEqual([])
  })

  it('stops being pending once the provider accepted it, and only then', async () => {
    await requestAs(owner)
    await restoreAs(admin)
    const { restored_at } = await restoreColumns()

    await recordRestore('failed', restored_at)
    expect(await restorePending()).toHaveLength(1)
    await recordRestore('not_configured', restored_at)
    expect(await restorePending()).toHaveLength(1)

    await recordRestore('accepted_by_provider', restored_at)
    expect(await restorePending()).toEqual([])
  })

  it('is never given up on, however many times it has failed', async () => {
    await requestAs(owner)
    await restoreAs(admin)
    const { restored_at } = await restoreColumns()
    for (let i = 0; i < 6; i += 1) await recordRestore('failed', restored_at)

    expect(await restorePending()).toHaveLength(1)
    expect((await restoreColumns()).attempts).toBe(6)
  })

  it('does not count a notice that was merely not configured', async () => {
    await requestAs(owner)
    await restoreAs(admin)
    const { restored_at } = await restoreColumns()
    for (let i = 0; i < 3; i += 1) await recordRestore('not_configured', restored_at)
    expect((await restoreColumns()).attempts).toBe(0)
  })

  it('is still owed when the closure notices had been accepted before the restore', async () => {
    await requestAs(owner)
    await db.asServiceRole(owner, (s) =>
      s.sql(
        `select app.closure_notice_record($1, 'accepted_by_provider', 'accepted_by_provider', 'x',
                  (select closure_requested_at from public.organizations where id = $1))`,
        [organizationId],
      ),
    )
    await restoreAs(admin)
    expect(await restorePending()).toHaveLength(1)
  })
})

describe('close, restore, close without a drain in between', () => {
  it('keeps an unsent restore notice when the agency closes again', async () => {
    await requestAs(owner)
    await restoreAs(admin)
    const before = await restoreColumns()

    await requestAs(owner)

    const after = await restoreColumns()
    expect(after.state).toBe('pending')
    expect(after.restored_at).toBe(before.restored_at)
    // Both owed, and the restore notice says the agency is closing again.
    expect(await restorePending()).toEqual([expect.objectContaining({ closing_again: true })])
    expect(await closurePending()).toEqual([
      expect.objectContaining({ send_members: true, send_operator: true }),
    ])
  })

  it('does not let the new closure reset the restore notice or its attempts', async () => {
    await requestAs(owner)
    await restoreAs(admin)
    const { restored_at } = await restoreColumns()
    await recordRestore('failed', restored_at)

    await requestAs(owner)
    const after = await restoreColumns()
    expect(after.state).toBe('failed')
    expect(after.attempts).toBe(1)
    expect(after.detail).toBe('x')
  })

  it('a second restore replaces an older unsent one and starts its attempts again', async () => {
    await requestAs(owner)
    await restoreAs(admin)
    const first = (await restoreColumns()).restored_at
    await recordRestore('failed', first)
    await requestAs(owner)
    await restoreAs(admin)

    const after = await restoreColumns()
    expect(after.restored_at).not.toBe(first)
    expect(after.state).toBe('pending')
    expect(after.attempts).toBe(0)
    expect(await restorePending()).toEqual([expect.objectContaining({ closing_again: false })])
    expect(await closurePending()).toEqual([])
  })

  it('ignores an outcome that names a restore the agency has moved on from', async () => {
    await requestAs(owner)
    await restoreAs(admin)
    const first = (await restoreColumns()).restored_at
    await requestAs(owner)
    await restoreAs(admin)
    const second = (await restoreColumns()).restored_at

    await recordRestore('accepted_by_provider', first)
    expect((await restoreColumns()).state).toBe('pending')

    await recordRestore('accepted_by_provider', second)
    expect((await restoreColumns()).state).toBe('accepted_by_provider')
  })

  it('does not let a restore wipe a closure notice that is already owed again', async () => {
    // close, restore (notice unsent), close: the closure's own notices are a fresh
    // pair, and recording the restore outcome must not touch them.
    await requestAs(owner)
    await restoreAs(admin)
    await requestAs(owner)
    const { restored_at } = await restoreColumns()
    await recordRestore('accepted_by_provider', restored_at)

    expect(await restorePending()).toEqual([])
    expect(await closurePending()).toEqual([
      expect.objectContaining({ send_members: true, send_operator: true }),
    ])
  })

  it('does not record a closure outcome onto the restore notice, or the reverse', async () => {
    await requestAs(owner)
    await db.asServiceRole(owner, (s) =>
      s.sql(
        `select app.closure_notice_record($1, null, 'failed', 'closure detail',
                  (select closure_requested_at from public.organizations where id = $1))`,
        [organizationId],
      ),
    )
    await restoreAs(admin)
    const restore = await restoreColumns()
    expect(restore.detail).toBeNull()
    expect(restore.attempts).toBe(0)
  })
})

describe('who can reach it', () => {
  it('cannot be marked sent, listed or recorded by a browser role, even an owner', async () => {
    await requestAs(owner)
    await restoreAs(admin)

    for (const column of [
      `closure_restore_notice_state = 'accepted_by_provider'`,
      `closure_restore_notice_attempts = 9`,
      `closure_restore_notice_detail = 'sent'`,
      `closure_restored_at = now()`,
    ]) {
      await db.asUser(owner, (s) =>
        s.expectRejection(
          () => s.sql(`update public.organizations set ${column} where id = $1`, [organizationId]),
          /closure state/i,
        ),
      )
    }
    await db.asUser(owner, (s) =>
      s.expectRejection(() =>
        s.sql(`select * from app.closure_restore_notices_pending($1)`, [organizationId]),
      ),
    )
    await db.asUser(owner, (s) =>
      s.expectRejection(() =>
        s.sql(`select app.closure_restore_notice_record($1, 'accepted_by_provider', null, now())`, [
          organizationId,
        ]),
      ),
    )
    expect((await restoreColumns()).state).toBe('pending')
  })
})

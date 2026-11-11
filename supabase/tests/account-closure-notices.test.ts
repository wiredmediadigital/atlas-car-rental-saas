// @vitest-environment node
/**
 * Requesting closure tells people, in the same transaction.
 *
 * The request commits or it does not; the in-app notification and the pending
 * email notices commit with it. A refused request must leave no trace at all,
 * because a notification about a closure that did not happen is a false alarm
 * sent to every owner and administrator.
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

const KIND = 'account_closure_requested'

async function newMember(label: string, role: 'admin' | 'manager' | 'staff'): Promise<string> {
  const u = await signUp(db, { email: `${label}${seq}@notices.test`, fullName: `${label} user` })
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

async function noticeColumns() {
  const [row] = await db.sql<{ members: string | null; operator: string | null }>(
    `select closure_members_notice_state::text as members,
            closure_operator_notice_state::text as operator
       from public.organizations where id = $1`,
    [organizationId],
  )
  return row!
}

const feedAs = (userId: string) =>
  db.asUser(userId, (s) =>
    s.sql<{ kind: string; action_path: string }>(
      `select kind::text, action_path from public.notification_feed($1, 'all', 50, 0)`,
      [organizationId],
    ),
  )

const pending = () =>
  db.asServiceRole(owner, (s) =>
    s.sql<{
      organization_id: string
      organization_name: string
      send_members: boolean
      send_operator: boolean
      recipients: string[]
    }>(`select * from app.closure_notices_pending($1)`, [organizationId]),
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
    email: `owner${seq}@notices.test`,
    fullName: 'Owner One',
    organizationName: `Notices ${seq}`,
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
  it('is written in the same transaction, for every owner and administrator', async () => {
    await requestAs(owner)

    expect(await eventCount()).toBe(1)
    expect(await recipients()).toEqual([owner, admin, secondAdmin].sort())
  })

  it('is not addressed to managers or staff', async () => {
    await requestAs(owner)
    const got = await recipients()
    expect(got).not.toContain(manager)
    expect(got).not.toContain(staff)
  })

  it('is visible in the feed of an owner and of an administrator, and of nobody below', async () => {
    await requestAs(owner)

    for (const who of [owner, admin]) {
      expect((await feedAs(who)).filter((r) => r.kind === KIND)).toHaveLength(1)
    }
    for (const who of [manager, staff]) {
      expect((await feedAs(who)).filter((r) => r.kind === KIND)).toHaveLength(0)
    }
  })

  it('points at Settings, where the restore button is', async () => {
    await requestAs(owner)
    const row = (await feedAs(admin)).find((r) => r.kind === KIND)
    expect(row!.action_path).toBe('/settings')
  })

  it('is raised again by a second closure after a restore', async () => {
    await requestAs(owner)
    await restoreAs(admin)
    await requestAs(owner)
    expect(await eventCount()).toBe(2)
  })
})

describe('a refused request leaves no trace', () => {
  it.each([
    ['an administrator', () => admin],
    ['a manager', () => manager],
    ['staff', () => staff],
  ])('writes nothing when %s asks', async (_label, who) => {
    await expect(requestAs(who())).rejects.toThrow(/only an owner can close/i)

    expect(await eventCount()).toBe(0)
    expect(await recipients()).toEqual([])
    expect(await noticeColumns()).toEqual({ members: null, operator: null })
    expect(await pending()).toEqual([])
  })

  it('writes nothing when somebody outside the agency asks', async () => {
    const stranger = await signUp(db, {
      email: `stranger${seq}@notices.test`,
      fullName: 'Stranger',
      organizationName: `Other ${seq}`,
      currency: 'EUR',
      timeZone: 'Europe/Paris',
    })
    await expect(requestAs(stranger.userId)).rejects.toThrow(/only an owner can close/i)
    expect(await eventCount()).toBe(0)
    expect(await pending()).toEqual([])
  })

  it('writes nothing more when the agency is already closing', async () => {
    await requestAs(owner)
    await expect(requestAs(owner)).rejects.toThrow(/already closed or closing/i)

    expect(await eventCount()).toBe(1)
    expect(await recipients()).toHaveLength(3)
  })
})

describe('the email notices', () => {
  it('start out pending, for the members and for the operator', async () => {
    await requestAs(owner)
    expect(await noticeColumns()).toEqual({ members: 'pending', operator: 'pending' })
  })

  it('are listed with the addresses of owners and administrators only', async () => {
    await requestAs(owner)
    const [row] = await pending()

    expect(row!.organization_name).toBe(`Notices ${seq}`)
    expect(row!.send_members).toBe(true)
    expect(row!.send_operator).toBe(true)
    expect([...row!.recipients].sort()).toEqual(
      [`owner${seq}@notices.test`, `admin${seq}@notices.test`, `adminb${seq}@notices.test`].sort(),
    )
  })

  it('stop being pending once the provider accepted them, and only then', async () => {
    await requestAs(owner)

    await db.asServiceRole(owner, (s) =>
      s.sql(`select app.closure_notice_record($1, 'accepted_by_provider', 'failed', 'x')`, [
        organizationId,
      ]),
    )
    const [row] = await pending()
    expect(row!.send_members).toBe(false)
    expect(row!.send_operator).toBe(true)

    await db.asServiceRole(owner, (s) =>
      s.sql(`select app.closure_notice_record($1, null, 'accepted_by_provider', null)`, [
        organizationId,
      ]),
    )
    expect(await pending()).toEqual([])
  })

  it('are not sent for an agency that restored in the meantime', async () => {
    await requestAs(owner)
    await restoreAs(admin)
    expect(await pending()).toEqual([])
  })

  it('cannot be marked sent, listed or read by a browser role, even an owner', async () => {
    await requestAs(owner)
    await db.asUser(owner, (s) =>
      s.expectRejection(
        () =>
          s.sql(
            `update public.organizations
                set closure_operator_notice_state = 'accepted_by_provider' where id = $1`,
            [organizationId],
          ),
        /closure state/i,
      ),
    )
    await db.asUser(owner, (s) =>
      s.expectRejection(() =>
        s.sql(`select * from app.closure_notices_pending($1)`, [organizationId]),
      ),
    )
    await db.asUser(owner, (s) =>
      s.expectRejection(() =>
        s.sql(`select app.closure_notice_record($1, 'accepted_by_provider', null, null)`, [
          organizationId,
        ]),
      ),
    )
    expect(await noticeColumns()).toEqual({ members: 'pending', operator: 'pending' })
  })
})

// @vitest-environment node
/**
 * The security event audit table.
 *
 * Writes arrive only through app.record_security_event; `authenticated` can read
 * rows for an organization it owns and has no write grant of any kind.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { TestDatabase, addMember, signUp } from './support/harness'

let db: TestDatabase
let organizationId: string
let owner: string
let staff: string
let seq = 0

const PERMISSION_DENIED = /permission denied/i

async function record(subject: string, orgId: string | null = organizationId): Promise<string> {
  const [row] = await db.sql<{ id: string }>(
    `select app.record_security_event('factor_enrolled', $1, $2, '{}'::jsonb) as id`,
    [subject, orgId],
  )
  return row!.id
}

beforeAll(async () => {
  db = await TestDatabase.create()
})

afterAll(async () => {
  await db.close()
})

beforeEach(async () => {
  seq += 1
  const o = await signUp(db, {
    email: `owner${seq}@events.test`,
    fullName: 'Owner One',
    organizationName: `Events ${seq}`,
    currency: 'EUR',
    timeZone: 'Europe/Paris',
  })
  if (!o.organizationId) throw new Error('provisioning failed')
  organizationId = o.organizationId
  owner = o.userId
  const s = await signUp(db, { email: `staff${seq}@events.test`, fullName: 'Staff One' })
  staff = s.userId
  await addMember(db, organizationId, staff, 'staff')
})

describe('recording a security event', () => {
  it('inserts one row and returns its id', async () => {
    const id = await record(staff)
    const rows = await db.sql<{ id: string; event_type: string; subject_user_id: string }>(
      `select id, event_type::text as event_type, subject_user_id
         from public.security_events where id = $1`,
      [id],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]!.event_type).toBe('factor_enrolled')
    expect(rows[0]!.subject_user_id).toBe(staff)
  })

  it('accepts an event with no organization', async () => {
    const id = await db.sql<{ organization_id: string | null }>(
      `select organization_id from public.security_events where id = $1`,
      [await record(staff, null)],
    )
    expect(id[0]!.organization_id).toBeNull()
  })

  it('stores an explicit actor in the column, as a service-role caller must', async () => {
    const [row] = await db.sql<{ id: string }>(
      `select app.record_security_event('factor_reset_by_owner', $1, $2, '{}'::jsonb, $3) as id`,
      [staff, organizationId, owner],
    )
    const rows = await db.sql<{ actor_user_id: string | null }>(
      `select actor_user_id from public.security_events where id = $1`,
      [row!.id],
    )
    expect(rows[0]!.actor_user_id).toBe(owner)
  })

  it('falls back to auth.uid() when the actor is omitted', async () => {
    const id = await db.asServiceRole(owner, () => record(staff))
    const rows = await db.sql<{ actor_user_id: string | null }>(
      `select actor_user_id from public.security_events where id = $1`,
      [id],
    )
    expect(rows[0]!.actor_user_id).toBe(owner)
  })

  it('leaves the actor null when it is omitted and there is no session', async () => {
    const rows = await db.sql<{ actor_user_id: string | null }>(
      `select actor_user_id from public.security_events where id = $1`,
      [await record(staff)],
    )
    expect(rows[0]!.actor_user_id).toBeNull()
  })

  it('is not callable by authenticated users directly', async () => {
    await expect(db.asUser(staff, () => record(staff))).rejects.toThrow(PERMISSION_DENIED)
  })
})

describe('reading security events', () => {
  it('shows an owner the rows of their own organization', async () => {
    await record(staff)
    const rows = await db.asUser(owner, (s) => s.sql(`select id from public.security_events`))
    expect(rows).toHaveLength(1)
  })

  it('shows a staff member nothing about anybody else', async () => {
    await record(owner)
    const rows = await db.asUser(staff, (s) => s.sql(`select id from public.security_events`))
    expect(rows).toHaveLength(0)
  })

  it('shows a person the events about themselves, even with no organization', async () => {
    // recovery_code_used and factor_removed are written with no organization at
    // all: an authenticator belongs to a person, not to one of their agencies.
    // Before the subject could read them, nobody could.
    await record(staff, null)
    const rows = await db.asUser(staff, (s) =>
      s.sql<{ subject_user_id: string }>(`select subject_user_id from public.security_events`),
    )
    expect(rows.map((row) => row.subject_user_id)).toEqual([staff])
  })

  it('shows the subject their own event in an agency they are only staff in', async () => {
    await record(staff)
    const rows = await db.asUser(staff, (s) => s.sql(`select id from public.security_events`))
    expect(rows).toHaveLength(1)
  })

  it('still shows them nothing when the subject is somebody else with no organization', async () => {
    await record(owner, null)
    const rows = await db.asUser(staff, (s) => s.sql(`select id from public.security_events`))
    expect(rows).toHaveLength(0)
  })

  it('reaches the person whose factor was removed even at aal1', async () => {
    // The session that needs this most is the one that cannot reach aal2: the
    // user whose second factor has just been taken away.
    await record(staff, null)
    const rows = await db.asUser(staff, (s) => s.sql(`select id from public.security_events`), {
      aal: 'aal1',
    })
    expect(rows).toHaveLength(1)
  })

  it('does not show an owner the events of another organization', async () => {
    const other = await signUp(db, {
      email: `other${seq}@events.test`,
      fullName: 'Other Owner',
      organizationName: `Other ${seq}`,
      currency: 'EUR',
      timeZone: 'Europe/Paris',
    })
    await record(other.userId, other.organizationId)
    const rows = await db.asUser(owner, (s) => s.sql(`select id from public.security_events`))
    expect(rows).toHaveLength(0)
  })
})

describe('recording an enrolment', () => {
  const ENROL = `select public.mfa_record_enrolment()`

  const enrolmentsFor = (userId: string) =>
    db.sql<{ organization_id: string | null; actor_user_id: string | null; detail: string }>(
      `select organization_id, actor_user_id, detail::text as detail
         from public.security_events
        where event_type = 'factor_enrolled' and subject_user_id = $1`,
      [userId],
    )

  it('records one event about the caller, belonging to no agency', async () => {
    await db.asUser(staff, (s) => s.sql(ENROL))

    const rows = await enrolmentsFor(staff)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.organization_id).toBeNull()
    expect(rows[0]!.actor_user_id).toBe(staff)
    expect(rows[0]!.detail).toContain('totp')
  })

  it('is readable by the person it is about', async () => {
    await db.asUser(staff, (s) => s.sql(ENROL))
    const rows = await db.asUser(staff, (s) =>
      s.sql(`select id from public.security_events where event_type = 'factor_enrolled'`),
    )
    expect(rows).toHaveLength(1)
  })

  it('refuses a session that has not verified a second factor', async () => {
    await expect(db.asUser(staff, (s) => s.sql(ENROL), { aal: 'aal1' })).rejects.toThrow(
      /second factor/i,
    )
    expect(await enrolmentsFor(staff)).toHaveLength(0)
  })

  it('refuses a caller with no session at all', async () => {
    await expect(db.sql(ENROL)).rejects.toThrow(/not authenticated/i)
  })

  it('is not emitted when recovery codes are merely regenerated', async () => {
    // Regenerating codes from Settings is not an enrolment. Emitting it there
    // would make the trail claim an authenticator was set up that was not.
    await db.asUser(staff, (s) => s.sql(`select public.mfa_generate_recovery_codes()`))

    expect(await enrolmentsFor(staff)).toHaveLength(0)
  })
})

describe('tampering with security events', () => {
  it('refuses an update by the subject', async () => {
    const id = await record(staff)
    await expect(
      db.asUser(staff, (s) =>
        s.sql(`update public.security_events set detail = '{"x":1}'::jsonb where id = $1`, [id]),
      ),
    ).rejects.toThrow(PERMISSION_DENIED)
  })

  it('refuses a delete by the subject', async () => {
    const id = await record(staff)
    await expect(
      db.asUser(staff, (s) => s.sql(`delete from public.security_events where id = $1`, [id])),
    ).rejects.toThrow(PERMISSION_DENIED)
  })

  it('refuses an insert by an owner', async () => {
    await expect(
      db.asUser(owner, (s) =>
        s.sql(
          `insert into public.security_events (event_type, subject_user_id, organization_id)
           values ('factor_removed', $1, $2)`,
          [staff, organizationId],
        ),
      ),
    ).rejects.toThrow(PERMISSION_DENIED)
  })
})

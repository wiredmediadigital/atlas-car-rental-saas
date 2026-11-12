// @vitest-environment node
/**
 * Single-use MFA recovery codes.
 *
 * public.mfa_generate_recovery_codes is the browser-facing half: it returns the
 * plaintext codes once. app.mfa_consume_recovery_code is server-side only and
 * spends one. The table itself is unreadable: RLS is on and there is no policy.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { TestDatabase, signUp } from './support/harness'

let db: TestDatabase
let alice: string
let bob: string
let seq = 0

const PERMISSION_DENIED = /permission denied/i
const CODE_PATTERN = /^[0-9A-HJKMNP-TV-Z]{10}$/

async function generate(userId: string): Promise<string[]> {
  const rows = await db.asUser(
    userId,
    (s) => s.sql<{ code: string }>(`select public.mfa_generate_recovery_codes() as code`),
    { aal: 'aal2' },
  )
  return rows.map((r) => r.code)
}

async function consume(userId: string, code: string): Promise<boolean> {
  const [row] = await db.asServiceRole(userId, (s) =>
    s.sql<{ ok: boolean }>(`select app.mfa_consume_recovery_code($1, $2) as ok`, [userId, code]),
  )
  return row!.ok
}

async function unusedCount(userId: string): Promise<number> {
  const [row] = await db.sql<{ n: number }>(
    `select count(*)::int as n from public.mfa_recovery_codes
      where user_id = $1 and used_at is null`,
    [userId],
  )
  return row!.n
}

beforeAll(async () => {
  db = await TestDatabase.create()
})

afterAll(async () => {
  await db.close()
})

beforeEach(async () => {
  seq += 1
  alice = (await signUp(db, { email: `alice${seq}@recovery.test`, fullName: 'Alice' })).userId
  bob = (await signUp(db, { email: `bob${seq}@recovery.test`, fullName: 'Bob' })).userId
})

describe('generating recovery codes', () => {
  it('returns ten distinct codes in the Crockford base32 alphabet', async () => {
    const codes = await generate(alice)
    expect(codes).toHaveLength(10)
    expect(new Set(codes).size).toBe(10)
    for (const code of codes) expect(code).toMatch(CODE_PATTERN)
  })

  it('replaces the previous set instead of appending', async () => {
    const first = await generate(alice)
    await generate(alice)
    expect(await unusedCount(alice)).toBe(10)
    expect(await consume(alice, first[0]!)).toBe(false)
  })

  it('does not touch another user’s codes', async () => {
    const bobs = await generate(bob)
    await generate(alice)
    expect(await unusedCount(bob)).toBe(10)
    expect(await consume(bob, bobs[0]!)).toBe(true)
  })

  it('stores hashes, never the plaintext', async () => {
    const [code] = await generate(alice)
    const rows = await db.sql<{ code_hash: string }>(
      `select code_hash from public.mfa_recovery_codes where user_id = $1`,
      [alice],
    )
    for (const row of rows) expect(row.code_hash).not.toContain(code!)
  })

  it('is refused to an anonymous caller', async () => {
    await expect(
      db.asAnon((s) => s.sql(`select public.mfa_generate_recovery_codes()`)),
    ).rejects.toThrow(PERMISSION_DENIED)
  })
})

describe('assurance level required to generate codes', () => {
  const generateSql = `select public.mfa_generate_recovery_codes()`

  it('refuses an aal1 session and leaves the existing codes intact', async () => {
    const [code] = await generate(alice)
    await expect(db.asUser(alice, (s) => s.sql(generateSql), { aal: 'aal1' })).rejects.toThrow(
      /second factor/i,
    )
    expect(await unusedCount(alice)).toBe(10)
    expect(await consume(alice, code!)).toBe(true)
  })

  it('refuses a session with no aal claim and leaves the existing codes intact', async () => {
    await generate(alice)
    await expect(db.asUser(alice, (s) => s.sql(generateSql))).rejects.toThrow(/second factor/i)
    expect(await unusedCount(alice)).toBe(10)
  })

  it('reports the refusal as insufficient privilege (42501)', async () => {
    await expect(
      db.asUser(alice, (s) => s.sql(generateSql), { aal: 'aal1' }),
    ).rejects.toMatchObject({ code: '42501' })
  })

  it('still succeeds for an aal2 session', async () => {
    expect(await generate(alice)).toHaveLength(10)
  })
})

describe('consuming a recovery code', () => {
  it('accepts a valid code once and refuses it the second time', async () => {
    const [code] = await generate(alice)
    expect(await consume(alice, code!)).toBe(true)
    expect(await consume(alice, code!)).toBe(false)
    expect(await unusedCount(alice)).toBe(9)
  })

  it('refuses a code that belongs to a different user', async () => {
    const [code] = await generate(alice)
    await generate(bob)
    expect(await consume(bob, code!)).toBe(false)
    expect(await unusedCount(alice)).toBe(10)
  })

  it('refuses a code that was never issued', async () => {
    await generate(alice)
    expect(await consume(alice, '0000000000')).toBe(false)
  })

  it('records a recovery_code_used event with no organization', async () => {
    const [code] = await generate(alice)
    await consume(alice, code!)
    const rows = await db.sql<{ organization_id: string | null; detail: string }>(
      `select organization_id, detail::text as detail from public.security_events
        where subject_user_id = $1 and event_type = 'recovery_code_used'`,
      [alice],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]!.organization_id).toBeNull()
    expect(rows[0]!.detail).not.toContain(code!)
  })

  it('records no event for a failed attempt', async () => {
    await generate(alice)
    await consume(alice, '0000000000')
    const rows = await db.sql(`select 1 from public.security_events where subject_user_id = $1`, [
      alice,
    ])
    expect(rows).toHaveLength(0)
  })

  it('is not callable by authenticated users', async () => {
    const [code] = await generate(alice)
    await expect(
      db.asUser(alice, (s) =>
        s.sql(`select app.mfa_consume_recovery_code($1, $2)`, [alice, code!]),
      ),
    ).rejects.toThrow(PERMISSION_DENIED)
  })
})

describe('reading the recovery code table', () => {
  it('shows a signed-in user no rows, not even their own', async () => {
    await generate(alice)
    const rows = await db.asUser(alice, (s) => s.sql(`select * from public.mfa_recovery_codes`))
    expect(rows).toHaveLength(0)
  })

  it('refuses a direct write by a signed-in user', async () => {
    await expect(
      db.asUser(alice, (s) =>
        s.sql(`insert into public.mfa_recovery_codes (user_id, code_hash) values ($1, 'x')`, [
          alice,
        ]),
      ),
    ).rejects.toThrow(PERMISSION_DENIED)
  })
})

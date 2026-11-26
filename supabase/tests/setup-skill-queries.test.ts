// @vitest-environment node
/**
 * The read-only queries the atlas-setup skill runs against a user's project.
 *
 * Claude copies them out of SKILL.md verbatim, so they are read from that file
 * here rather than restated: a renamed table or column must fail this test, not
 * a beginner's setup. They run on a freshly migrated schema, then after a
 * sign-up through the same on_auth_user_created trigger the live site uses.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { TestDatabase, signUp } from './support/harness'

const SKILL = readFileSync(
  path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../.claude/skills/atlas-setup/SKILL.md',
  ),
  'utf8',
)

// Prettier may wrap a long statement in the Markdown; a query is one line of SQL.
const statements = [
  ...SKILL.matchAll(/--linked "(select [^"]+)"/g),
  ...SKILL.matchAll(/`(select [^`]+)`/g),
].map(([, sql = '']) => sql.replace(/\s+/g, ' '))

function query(fragment: string): string {
  const found = statements.filter((sql) => sql.includes(fragment))
  expect(found, `exactly one skill query contains "${fragment}"`).toHaveLength(1)
  return found[0] ?? ''
}

let db: TestDatabase

beforeAll(async () => {
  db = await TestDatabase.create()
})

afterAll(async () => {
  await db.close()
})

describe('atlas-setup skill queries', () => {
  it('finds every query the skill runs', () => {
    expect(statements).toHaveLength(5)
  })

  it('reads a just-installed project as unused: no users, no files', async () => {
    const [state] = await db.sql<{ public_tables: number; users: number; files: number }>(
      query('as public_tables'),
    )
    expect(Number(state?.public_tables)).toBeGreaterThan(0)
    expect(Number(state?.users)).toBe(0)
    expect(Number(state?.files)).toBe(0)
  })

  it('confirms row level security, private buckets and the sign-up trigger', async () => {
    const [rls] = await db.sql<{ rls_off: number }>(query('as rls_off'))
    expect(Number(rls?.rls_off)).toBe(0)

    const buckets = await db.sql<{ id: string; public: boolean }>(query('storage.buckets'))
    // Three more arrived with incident and maintenance management, each one
    // private like the rest: incident-photos, incident-documents and
    // maintenance-documents.
    expect(buckets).toHaveLength(10)
    expect(buckets.every((bucket) => bucket.public === false)).toBe(true)

    const triggers = await db.sql<{ tgname: string }>(query('pg_trigger'))
    expect(triggers.map((trigger) => trigger.tgname)).toContain('on_auth_user_created')
  })

  it('finds the first agency and its confirmed Owner after a live-style sign-up', async () => {
    const owner = query('as confirmed')
    expect(await db.sql(owner)).toEqual([])

    await signUp(db, {
      email: 'owner@atlas-setup.test',
      fullName: 'First Owner',
      organizationName: 'Live Rentals',
    })

    expect(await db.sql(owner)).toEqual([{ name: 'Live Rentals', role: 'owner', confirmed: true }])

    // Resuming after this point must not mistake the owner's sign-up for a
    // project that was already in use: the skill skips the state check then.
    const [state] = await db.sql<{ users: number }>(query('as public_tables'))
    expect(Number(state?.users)).toBe(1)
  })
})

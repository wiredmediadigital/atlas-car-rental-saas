// @vitest-environment node
/**
 * A verified second factor is part of the tenant predicate.
 *
 * Supabase raises a session to `aal2` only once GoTrue has verified an enrolled
 * factor. Every RLS policy in this schema is written in terms of a handful of
 * `app.*` helpers, so the requirement is attached there and reaches every
 * policy, every `security_invoker` view and every read model at once.
 *
 * The failure this suite exists to catch is the quiet one: a predicate that
 * passes when the `aal` claim is simply absent would leave every test green
 * while the feature did nothing. A session minted before MFA existed carries no
 * `aal` claim at all, so "absent" is asserted here as deliberately as "aal1".
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { TestDatabase, addMember, signUp } from './support/harness'

let db: TestDatabase
let organizationId: string
let owner: string
let colleague: string

const CUSTOMERS = `select id from public.customers where organization_id = $1`
const DIRECTORY = `select customer_id from public.customer_directory where organization_id = $1`
const REPORT = `select * from public.report_business_summary($1, '2032-07-01'::date, '2032-08-01'::date)`
const PROFILES = `select id from public.profiles order by id`

/** Runs `fn` with a claim set that has no `aal` key — a pre-MFA session. */
async function asPreMfaUser<T>(userId: string, fn: (db: TestDatabase) => Promise<T>): Promise<T> {
  return db.asUser(
    userId,
    async (session) => {
      await session.exec(`set request.jwt.claims = '{"role":"authenticated"}';`)
      return fn(session)
    },
    { aal: null },
  )
}

beforeAll(async () => {
  db = await TestDatabase.create()

  const founder = await signUp(db, {
    email: 'owner@second-factor.test',
    organizationName: 'Second Factor Rentals',
    currency: 'EUR',
    timeZone: 'Europe/Lisbon',
  })
  if (!founder.organizationId) throw new Error('Provisioning failed for the test agency.')
  owner = founder.userId
  organizationId = founder.organizationId

  colleague = (await signUp(db, { email: 'colleague@second-factor.test' })).userId
  await addMember(db, organizationId, colleague, 'staff')

  await db.sql(
    `insert into public.customers (organization_id, first_name, last_name)
     values ($1, 'Amina', 'Benali'), ($1, 'Beto', 'Silva')`,
    [organizationId],
  )
})

afterAll(async () => {
  await db.close()
})

describe('app.has_second_factor', () => {
  const PREDICATE = `select app.has_second_factor() as passed`

  it('passes a session GoTrue has raised to aal2', async () => {
    const [row] = await db.asUser(owner, (s) => s.sql<{ passed: boolean }>(PREDICATE))
    expect(row?.passed).toBe(true)
  })

  it('refuses a session that has only passed the password', async () => {
    const [row] = await db.asUser(owner, (s) => s.sql<{ passed: boolean }>(PREDICATE), {
      aal: 'aal1',
    })
    expect(row?.passed).toBe(false)
  })

  it('refuses a session carrying no aal claim at all', async () => {
    const [row] = await db.asUser(owner, (s) => s.sql<{ passed: boolean }>(PREDICATE), {
      aal: null,
    })
    expect(row?.passed).toBe(false)
  })

  it('refuses a pre-MFA session whose claims exist but name no assurance level', async () => {
    const [row] = await asPreMfaUser(owner, (s) => s.sql<{ passed: boolean }>(PREDICATE))
    expect(row?.passed).toBe(false)
  })
})

describe('the membership helpers', () => {
  const MEMBER = `select app.is_org_member($1) as member, app.has_min_role($1, 'staff') as staff`

  it('hold for an aal2 owner', async () => {
    const [row] = await db.asUser(owner, (s) =>
      s.sql<{ member: boolean; staff: boolean }>(MEMBER, [organizationId]),
    )
    expect(row).toEqual({ member: true, staff: true })
  })

  it('are both false at aal1, however the membership row reads', async () => {
    const [row] = await db.asUser(
      owner,
      (s) => s.sql<{ member: boolean; staff: boolean }>(MEMBER, [organizationId]),
      { aal: 'aal1' },
    )
    expect(row).toEqual({ member: false, staff: false })
  })

  it('are both false with no aal claim at all', async () => {
    const [row] = await db.asUser(
      owner,
      (s) => s.sql<{ member: boolean; staff: boolean }>(MEMBER, [organizationId]),
      { aal: null },
    )
    expect(row).toEqual({ member: false, staff: false })
  })
})

describe('tenant data', () => {
  it('is readable by the owner at aal2', async () => {
    const rows = await db.asUser(owner, (s) => s.sql(CUSTOMERS, [organizationId]))
    expect(rows).toHaveLength(2)
  })

  it('is empty at aal1 through the table', async () => {
    const rows = await db.asUser(owner, (s) => s.sql(CUSTOMERS, [organizationId]), { aal: 'aal1' })
    expect(rows).toEqual([])
  })

  it('is empty at aal1 through the customer_directory view', async () => {
    const rows = await db.asUser(owner, (s) => s.sql(DIRECTORY, [organizationId]), { aal: 'aal1' })
    expect(rows).toEqual([])
  })

  it('is empty with no aal claim at all', async () => {
    const rows = await db.asUser(owner, (s) => s.sql(CUSTOMERS, [organizationId]), { aal: null })
    expect(rows).toEqual([])
  })

  it('is empty for a pre-MFA session whose claims name no assurance level', async () => {
    const rows = await asPreMfaUser(owner, (s) => s.sql(CUSTOMERS, [organizationId]))
    expect(rows).toEqual([])
  })
})

describe('a report read model', () => {
  // Reports do not fall quiet, they refuse: app.assert_report_access raises
  // before a figure is computed, so an aal1 manager gets 42501 rather than a
  // confident zero.
  it('answers an aal2 owner', async () => {
    await expect(db.asUser(owner, (s) => s.sql(REPORT, [organizationId]))).resolves.toBeInstanceOf(
      Array,
    )
  })

  it('refuses an aal1 owner as insufficient privilege', async () => {
    await expect(
      db.asUser(owner, (s) => s.sql(REPORT, [organizationId]), { aal: 'aal1' }),
    ).rejects.toMatchObject({ code: '42501' })
  })

  it('refuses a session with no aal claim at all', async () => {
    await expect(
      db.asUser(owner, (s) => s.sql(REPORT, [organizationId]), { aal: null }),
    ).rejects.toThrow(/not permitted/i)
  })
})

describe('a member’s own profile', () => {
  it('stays readable at aal1, while the colleagues around it do not', async () => {
    const rows = await db.asUser(owner, (s) => s.sql<{ id: string }>(PROFILES), { aal: 'aal1' })
    expect(rows.map((row) => row.id)).toEqual([owner])
  })

  it('is read alongside the colleagues at aal2', async () => {
    const rows = await db.asUser(owner, (s) => s.sql<{ id: string }>(PROFILES))
    expect(rows.map((row) => row.id).sort()).toEqual([owner, colleague].sort())
  })
})

describe('the service role', () => {
  // A service key is not a user session: its JWT has no `aal` claim and never
  // will. It reads tenant data by bypassing RLS, so it never reaches the
  // predicate at all — Edge Functions keep working untouched.
  it('still reads tenant rows with no aal claim', async () => {
    const rows = await db.asServiceRole(owner, (s) => s.sql(CUSTOMERS, [organizationId]))
    expect(rows).toHaveLength(2)
  })

  it('still reads the customer_directory view', async () => {
    const rows = await db.asServiceRole(owner, (s) => s.sql(DIRECTORY, [organizationId]))
    expect(rows).toHaveLength(2)
  })
})

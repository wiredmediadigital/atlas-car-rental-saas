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
let rentalId: string

const CUSTOMERS = `select id from public.customers where organization_id = $1`
/*
 * The two fields the spec names by hand. `date_of_birth` is a column on
 * public.customers and is republished by customer_directory; the driving licence
 * NUMBER has lived in public.customer_documents since 20260814120000 dropped
 * customers.driver_license_number, so that is where it is asked for here.
 */
const BIRTH_DATES = `select date_of_birth from public.customers where organization_id = $1`
const DIRECTORY_BIRTH_DATES = `select date_of_birth from public.customer_directory where organization_id = $1`
const LICENCE_NUMBERS = `select document_number from public.customer_documents
                          where organization_id = $1 and document_type = 'driver_license'`
const ISSUE_CONTRACT = `select snapshot from public.rental_issue_contract($1)`
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
    `insert into public.customers (organization_id, first_name, last_name, date_of_birth)
     values ($1, 'Amina', 'Benali', '1990-04-11'), ($1, 'Beto', 'Silva', '1986-09-02')`,
    [organizationId],
  )

  // Enough of a rental to issue a contract from, because the contract generator
  // is one of the paths the spec names and it embeds a date of birth.
  const [customer] = await db.sql<{ id: string }>(
    `select id from public.customers where organization_id = $1 order by last_name limit 1`,
    [organizationId],
  )
  await db.sql(
    `insert into public.customer_documents
       (organization_id, customer_id, document_type, document_number, issuing_country)
     values ($1, $2, 'driver_license', 'DL-77-4412', 'PT')`,
    [organizationId, customer!.id],
  )
  const [vehicle] = await db.sql<{ id: string }>(
    `insert into public.vehicles (organization_id, make, model, registration_plate, currency)
     values ($1, 'Dacia', 'Sandero', 'AA-11-SF', 'EUR') returning id`,
    [organizationId],
  )
  const [rental] = await db.sql<{ id: string }>(
    `insert into public.rentals
       (organization_id, vehicle_id, customer_id, starts_at, ends_at, currency, status,
        daily_rate_minor)
     values ($1, $2, $3, '2032-07-01T09:00:00Z', '2032-07-04T09:00:00Z', 'EUR', 'reserved', 5000)
     returning id`,
    [organizationId, vehicle!.id, customer!.id],
  )
  rentalId = rental!.id
  await db.sql(
    `insert into public.rental_drivers (organization_id, rental_id, customer_id, driver_role)
     values ($1, $2, $3, 'primary')`,
    [organizationId, rentalId, customer!.id],
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

describe('the two fields the spec names: date of birth and licence number', () => {
  // Neither is ever selected by the rest of this suite, which asks only for
  // `id`. An aal1 session returning an empty set for `id` would return an empty
  // set for these too — but that is the thing worth asserting rather than
  // assuming, because these are the columns the gate exists for.
  it('are readable by the owner at aal2, so the refusals below mean something', async () => {
    const births = await db.asUser(owner, (s) =>
      s.sql<{ date_of_birth: string }>(BIRTH_DATES, [organizationId]),
    )
    const licences = await db.asUser(owner, (s) =>
      s.sql<{ document_number: string }>(LICENCE_NUMBERS, [organizationId]),
    )

    expect(births.map((row) => row.date_of_birth)).toHaveLength(2)
    expect(licences.map((row) => row.document_number)).toEqual(['DL-77-4412'])
  })

  it.each([
    ['aal1', { aal: 'aal1' as const }],
    ['no aal claim at all', { aal: null }],
  ])('are unreadable through the customers table at %s', async (_label, session) => {
    expect(await db.asUser(owner, (s) => s.sql(BIRTH_DATES, [organizationId]), session)).toEqual([])
    expect(
      await db.asUser(owner, (s) => s.sql(LICENCE_NUMBERS, [organizationId]), session),
    ).toEqual([])
  })

  it.each([
    ['aal1', { aal: 'aal1' as const }],
    ['no aal claim at all', { aal: null }],
  ])('are unreadable through the customer_directory view at %s', async (_label, session) => {
    expect(
      await db.asUser(owner, (s) => s.sql(DIRECTORY_BIRTH_DATES, [organizationId]), session),
    ).toEqual([])
  })

  it('are unreadable through either path for a pre-MFA session', async () => {
    expect(await asPreMfaUser(owner, (s) => s.sql(BIRTH_DATES, [organizationId]))).toEqual([])
    expect(await asPreMfaUser(owner, (s) => s.sql(LICENCE_NUMBERS, [organizationId]))).toEqual([])
    expect(
      await asPreMfaUser(owner, (s) => s.sql(DIRECTORY_BIRTH_DATES, [organizationId])),
    ).toEqual([])
  })
})

describe('the contract generator, which embeds a date of birth in its JSON', () => {
  // public.rental_issue_contract is NOT security definer, so RLS reaches the
  // reads inside it and the refusal is structural. It is asserted anyway: this
  // is the path most likely to be turned into a definer one day, and the test
  // is what would notice.
  it('issues a contract for an aal2 owner, carrying the renter’s date of birth', async () => {
    const [row] = await db.asUser(owner, (s) =>
      s.sql<{ snapshot: { renter: { date_of_birth: string | null } } }>(ISSUE_CONTRACT, [rentalId]),
    )

    expect(row?.snapshot.renter.date_of_birth).toBe('1990-04-11')
  })

  it.each([
    ['aal1', { aal: 'aal1' as const }],
    ['no aal claim at all', { aal: null }],
  ])('refuses at %s, finding no rental it is allowed to read', async (_label, session) => {
    await expect(
      db.asUser(owner, (s) => s.sql(ISSUE_CONTRACT, [rentalId]), session),
    ).rejects.toThrow(/rental not found/i)
  })

  it('refuses a pre-MFA session whose claims name no assurance level', async () => {
    await expect(asPreMfaUser(owner, (s) => s.sql(ISSUE_CONTRACT, [rentalId]))).rejects.toThrow(
      /rental not found/i,
    )
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

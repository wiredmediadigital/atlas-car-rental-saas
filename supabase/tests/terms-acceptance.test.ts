// @vitest-environment node
/**
 * Terms acceptance, recorded where it cannot be forged.
 *
 * Two paths write the two nullable columns on public.profiles.
 *
 *   SIGN-UP stamps them from inside app.handle_new_user(), in the same
 *     transaction as the account itself, when the sign-up metadata says the box
 *     was ticked. A follow-up call could fail silently; this cannot.
 *   AN INVITATION never passes through that screen, so
 *     public.record_terms_acceptance() stamps the caller's own row on accept.
 *
 * Neither takes the version from the browser. Both read
 * app.current_terms_version(), so a client claiming to have accepted version 9
 * proves nothing at all.
 *
 * THE TESTS THAT MATTER MOST HERE are not the ones about stamping. The trigger
 * runs inside account creation, so a raise anywhere in it breaks signing up
 * entirely — which is why `profiles.email` is plain text rather than the
 * email_address domain. Every shape of absent, false and malformed metadata
 * below is asserted to still produce an account.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { LEGAL } from '../../src/pages/legal/legal-config'

import { TestDatabase } from './support/harness'

let db: TestDatabase
let seq = 0

interface Stamp {
  version: string | null
  /** PGlite hands back a Date for timestamptz, as the driver would. */
  at: Date | null
}

/**
 * Registers a user the way GoTrue does — a raw insert into auth.users carrying
 * whatever metadata the browser sent — so the metadata can be malformed in ways
 * the harness's typed signUp() helper could not express.
 */
async function register(metadata: string): Promise<string> {
  seq += 1
  const [user] = await db.sql<{ id: string }>(
    `insert into auth.users (email, raw_user_meta_data) values ($1, $2::jsonb) returning id`,
    [`terms${seq}@acceptance.test`, metadata],
  )
  if (!user) throw new Error('auth.users insert returned no row.')
  return user.id
}

/** The profile row, or null when no account was created. */
async function stampOf(userId: string): Promise<Stamp | null> {
  const [row] = await db.sql<Stamp>(
    `select terms_accepted_version as version, terms_accepted_at as at
       from public.profiles where id = $1`,
    [userId],
  )
  return row ?? null
}

async function currentVersion(): Promise<string> {
  const [row] = await db.sql<{ version: string }>(`select app.current_terms_version() as version`)
  return row!.version
}

beforeAll(async () => {
  db = await TestDatabase.create()
}, 180_000)

afterAll(async () => {
  await db?.close()
})

describe('the version constant', () => {
  it('is the date the legal pages print, so the two cannot drift', async () => {
    expect(await currentVersion()).toBe(LEGAL().lastUpdated)
  })

  it('is a constant, not a reading of the clock', async () => {
    expect(await currentVersion()).toBe(await currentVersion())
  })
})

describe('sign-up stamps acceptance from the metadata', () => {
  it('records the version and the moment when the box was ticked', async () => {
    const userId = await register(JSON.stringify({ full_name: 'Ada', terms_accepted: true }))

    const stamp = await stampOf(userId)
    expect(stamp).not.toBeNull()
    expect(stamp!.version).toBe(await currentVersion())
    expect(stamp!.at).not.toBeNull()
  })

  it("stamps the server's version, not one the browser named", async () => {
    const userId = await register(
      JSON.stringify({ terms_accepted: true, terms_accepted_version: 'version 9' }),
    )

    expect((await stampOf(userId))!.version).toBe(await currentVersion())
  })

  it('still provisions the agency alongside the stamp', async () => {
    const userId = await register(
      JSON.stringify({
        full_name: 'Ada',
        organization_name: 'Terms Motors',
        country_code: 'PT',
        default_currency: 'EUR',
        time_zone: 'Europe/Lisbon',
        terms_accepted: true,
      }),
    )

    const [membership] = await db.sql<{ role: string }>(
      `select role from public.organization_members where user_id = $1`,
      [userId],
    )
    expect(membership?.role).toBe('owner')
    expect((await stampOf(userId))!.at).not.toBeNull()
  })
})

describe('an account is created whatever the flag looks like', () => {
  const cases: { name: string; metadata: string }[] = [
    { name: 'absent', metadata: JSON.stringify({ full_name: 'Ada' }) },
    { name: 'false', metadata: JSON.stringify({ terms_accepted: false }) },
    { name: 'the string "true"', metadata: JSON.stringify({ terms_accepted: 'true' }) },
    { name: 'a number', metadata: JSON.stringify({ terms_accepted: 1 }) },
    { name: 'JSON null', metadata: JSON.stringify({ terms_accepted: null }) },
    { name: 'an object', metadata: JSON.stringify({ terms_accepted: { ticked: true } }) },
    { name: 'metadata that is not an object at all', metadata: '"not an object"' },
    { name: 'metadata that is a JSON array', metadata: '[1, 2, 3]' },
    { name: 'no metadata', metadata: '{}' },
  ]

  for (const { name, metadata } of cases) {
    it(`creates the account and leaves both columns null when the flag is ${name}`, async () => {
      const userId = await register(metadata)

      const stamp = await stampOf(userId)
      expect(stamp).not.toBeNull()
      expect(stamp!.version).toBeNull()
      expect(stamp!.at).toBeNull()
    })
  }
})

describe('public.record_terms_acceptance', () => {
  it("stamps the caller's own row", async () => {
    const userId = await register('{}')

    await db.asUser(userId, (session) => session.sql(`select public.record_terms_acceptance()`))

    const stamp = await stampOf(userId)
    expect(stamp!.version).toBe(await currentVersion())
    expect(stamp!.at).not.toBeNull()
  })

  it('is callable by a session that has no second factor yet', async () => {
    // A brand-new invited user arrives at aal1 — they have not enrolled one.
    const userId = await register('{}')

    await db.asUser(userId, (session) => session.sql(`select public.record_terms_acceptance()`), {
      aal: 'aal1',
    })

    expect((await stampOf(userId))!.at).not.toBeNull()
  })

  it('never moves an acceptance that is already recorded', async () => {
    const userId = await register('{}')
    // Seeded past the guard trigger on purpose: the guard would rewrite any
    // first stamp to today, and what is under test here is the function's own
    // refusal to touch a row that already carries a date — the reason a second
    // invitation years later cannot move the original.
    await db.exec(`alter table public.profiles disable trigger profiles_guard_terms_acceptance`)
    try {
      await db.sql(
        `update public.profiles
            set terms_accepted_version = 'an older version',
                terms_accepted_at = timestamptz '2020-01-01 00:00:00+00'
          where id = $1`,
        [userId],
      )
    } finally {
      await db.exec(`alter table public.profiles enable trigger profiles_guard_terms_acceptance`)
    }

    await db.asUser(userId, (session) => session.sql(`select public.record_terms_acceptance()`))

    const stamp = await stampOf(userId)
    expect(stamp!.version).toBe('an older version')
    expect(stamp!.at!.getUTCFullYear()).toBe(2020)
  })

  it('touches nobody else', async () => {
    const caller = await register('{}')
    const bystander = await register('{}')

    await db.asUser(caller, (session) => session.sql(`select public.record_terms_acceptance()`))

    expect((await stampOf(bystander))!.at).toBeNull()
  })

  it('is granted to authenticated and to nobody else', async () => {
    const [row] = await db.sql<{ auth: boolean; anon: boolean; pub: boolean }>(`
      select has_function_privilege('authenticated', 'public.record_terms_acceptance()', 'EXECUTE') as auth,
             has_function_privilege('anon', 'public.record_terms_acceptance()', 'EXECUTE') as anon,
             has_function_privilege('public', 'public.record_terms_acceptance()', 'EXECUTE') as pub
    `)
    expect(row!.auth).toBe(true)
    expect(row!.anon).toBe(false)
    expect(row!.pub).toBe(false)
  })

  it('refuses a request carrying no identity', async () => {
    await db.exec(`reset request.jwt.claim.sub; set role authenticated;`)
    try {
      await db.expectRejection(
        () => db.sql(`select public.record_terms_acceptance()`),
        /not authenticated/i,
      )
    } finally {
      await db.exec(`reset role;`)
    }
  })
})

describe('the record is not the subject’s to rewrite', () => {
  /**
   * `authenticated` holds UPDATE on public.profiles so a person can change their
   * own name, and profiles_update_self lets them reach their own row. Without a
   * guard the two columns sat inside that grant, and a record its own subject can
   * erase or backdate is worse than no record at all. The answer is the one
   * profiles.email already uses: the server rewrites what the client sent rather
   * than refusing the update, so an ordinary name change never fails.
   */
  async function patch(userId: string, version: string | null, at: string | null): Promise<void> {
    await db.asUser(userId, (session) =>
      session.sql(
        `update public.profiles
            set terms_accepted_version = $2, terms_accepted_at = $3::timestamptz
          where id = $1`,
        [userId, version, at],
      ),
    )
  }

  it('cannot be erased by the person it is about', async () => {
    const userId = await register(JSON.stringify({ terms_accepted: true }))

    await patch(userId, null, null)

    const stamp = await stampOf(userId)
    expect(stamp!.version).toBe(await currentVersion())
    expect(stamp!.at).not.toBeNull()
  })

  it('cannot be backdated or pointed at another version', async () => {
    const userId = await register(JSON.stringify({ terms_accepted: true }))
    const before = (await stampOf(userId))!.at

    await patch(userId, 'version 9', '1999-01-01T00:00:00Z')

    const stamp = await stampOf(userId)
    expect(stamp!.version).toBe(await currentVersion())
    expect(stamp!.at).toEqual(before)
  })

  it('says what the server knows when a client stamps an unaccepted row by hand', async () => {
    const userId = await register('{}')

    await patch(userId, 'version 9', '1999-01-01T00:00:00Z')

    const stamp = await stampOf(userId)
    expect(stamp!.version).toBe(await currentVersion())
    expect(stamp!.at!.getUTCFullYear()).toBeGreaterThan(2020)
  })

  it('does not get in the way of an ordinary profile update', async () => {
    const userId = await register(JSON.stringify({ full_name: 'Ada' }))

    await db.asUser(userId, (session) =>
      session.sql(`update public.profiles set full_name = 'Ada L' where id = $1`, [userId]),
    )

    const [row] = await db.sql<{ full_name: string }>(
      `select full_name from public.profiles where id = $1`,
      [userId],
    )
    expect(row!.full_name).toBe('Ada L')
    expect((await stampOf(userId))!.at).toBeNull()
  })
})

describe('the columns themselves', () => {
  it('are nullable, so everyone who signed up before today is grandfathered', async () => {
    const rows = await db.sql<{ column_name: string; is_nullable: string }>(
      `select column_name, is_nullable
         from information_schema.columns
        where table_schema = 'public' and table_name = 'profiles'
          and column_name in ('terms_accepted_version', 'terms_accepted_at')
        order by column_name`,
    )

    expect(rows.map((row) => row.column_name)).toEqual([
      'terms_accepted_at',
      'terms_accepted_version',
    ])
    expect(rows.every((row) => row.is_nullable === 'YES')).toBe(true)
  })
})

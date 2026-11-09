// @vitest-environment node
/**
 * The account-closure runner, against the real purge functions.
 *
 * The pure helpers are tested directly. The orchestration is tested with
 * `ClosureDeps` implemented over the PGlite database, so claim, collect, purge
 * and the ledger are the real migrations; only Storage and Auth are fakes.
 *
 * What these hold in place:
 *   * a run that died at ANY stage is finished by the next run, and a second
 *     run after that does nothing;
 *   * the sweep re-reads closure state and will not delete for a live agency
 *     even when the ledger says to;
 *   * a person with another agency keeps everything; a person with none is
 *     removed from profiles as well as auth;
 *   * an agency that cannot be claimed because it is still billed is named.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  AUTH_USERS_BUCKET,
  authUserKey,
  dueForPurge,
  interpretAuthDelete,
  interpretClaim,
  readAllPages,
  readInChunks,
  removeAuthUsers,
  removeUser,
  isAuthorizedRunner,
  nextSweepBatch,
  parseAuthUserKey,
  runAccountClosure,
  runIfAuthorized,
  sweepStorage,
  usersToRemove,
  type ClosureDeps,
  type ObjectRow,
  type OrganizationRow,
} from '../functions/_shared/account-closure'
import { TestDatabase, addMember, signUp } from './support/harness'

const NOW = new Date('2026-12-01T00:00:00Z')
const ORG = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'
const USER = '33333333-3333-4333-8333-333333333333'

const org = (patch: Partial<OrganizationRow> = {}): OrganizationRow => ({
  id: ORG,
  name: 'Agency',
  legalName: null,
  closureRequestedAt: '2026-10-01T00:00:00Z',
  closurePurgeAfter: '2026-11-01T00:00:00Z',
  purgeStartedAt: null,
  closedAt: null,
  ...patch,
})

const object = (patch: Partial<ObjectRow> = {}): ObjectRow => ({
  id: 'o1',
  organizationId: ORG,
  bucket: 'customer-documents',
  storageKey: `${ORG}/passport.jpg`,
  deletedAt: null,
  ...patch,
})

describe('dueForPurge', () => {
  it('returns only organizations past their purge date', () => {
    const rows = [
      org({ id: 'due' }),
      org({ id: 'later', closurePurgeAfter: '2026-12-15T00:00:00Z' }),
      org({ id: 'open', closureRequestedAt: null, closurePurgeAfter: null }),
    ]
    expect(dueForPurge(rows, NOW)).toEqual(['due'])
  })

  it('skips one already claimed', () => {
    const rows = [
      org({ id: 'claimed', purgeStartedAt: '2026-11-02T00:00:00Z' }),
      org({
        id: 'closed',
        purgeStartedAt: '2026-11-02T00:00:00Z',
        closedAt: '2026-11-02T00:01:00Z',
      }),
    ]
    expect(dueForPurge(rows, NOW)).toEqual([])
  })
})

describe('usersToRemove', () => {
  it('removes a user whose last membership this was', () => {
    expect(usersToRemove([{ userId: 'u1', closing: true }])).toEqual(['u1'])
  })

  it('keeps a user who belongs to another agency', () => {
    expect(
      usersToRemove([
        { userId: 'u1', closing: true },
        { userId: 'u1', closing: false },
        { userId: 'u2', closing: true },
      ]),
    ).toEqual(['u2'])
  })
})

describe('nextSweepBatch', () => {
  it('returns pending objects up to the batch size and skips finished ones', () => {
    const rows = [
      object({ id: 'a', storageKey: `${ORG}/a` }),
      object({ id: 'b', storageKey: `${ORG}/b`, deletedAt: '2026-11-02T00:00:00Z' }),
      object({ id: 'c', storageKey: `${ORG}/c` }),
      object({ id: 'd', storageKey: `${ORG}/d` }),
    ]
    expect(nextSweepBatch(rows, 2).map((k) => k.id)).toEqual(['a', 'c'])
  })

  it('never returns a key outside its own agency, an unknown bucket, or a person record', () => {
    const rows = [
      object({ id: 'x', storageKey: `${OTHER}/theirs.jpg` }),
      object({ id: 'y', bucket: 'auth.users' }),
      object({ id: 'z', bucket: AUTH_USERS_BUCKET, storageKey: authUserKey(ORG, USER) }),
      object({ id: 'w', storageKey: `${ORG}/../${OTHER}/theirs.jpg` }),
    ]
    expect(nextSweepBatch(rows, 10)).toEqual([])
  })
})

describe('caller and claim helpers', () => {
  it('authorizes only the service key', () => {
    const secret = 's'.repeat(40)
    expect(isAuthorizedRunner(`Bearer ${secret}`, secret)).toBe(true)
    expect(isAuthorizedRunner(`Bearer ${'t'.repeat(40)}`, secret)).toBe(false)
    expect(isAuthorizedRunner(`Bearer ${secret}x`, secret)).toBe(false)
    expect(isAuthorizedRunner(`Bearer ${secret.slice(1)}`, secret)).toBe(false)
    expect(isAuthorizedRunner(null, secret)).toBe(false)
    expect(isAuthorizedRunner(secret, secret)).toBe(false) // not a Bearer header
    // An unset or weak configured secret refuses everyone, even a caller who sends it.
    expect(isAuthorizedRunner('Bearer ', '')).toBe(false)
    expect(isAuthorizedRunner('Bearer short', 'short')).toBe(false)
  })

  it('reads a claim: live subscription is a refusal, any other error is thrown', () => {
    expect(interpretClaim(true, null)).toBe('claimed')
    expect(interpretClaim(false, null)).toBe('declined')
    expect(interpretClaim(null, { code: '55000' })).toBe('live-subscription')
    expect(() => interpretClaim(null, { code: 'XX000', message: 'boom' })).toThrow(/boom/)
  })

  it('round-trips a recorded person and rejects anything else', () => {
    const row = object({ bucket: AUTH_USERS_BUCKET, storageKey: authUserKey(ORG, USER) })
    expect(parseAuthUserKey(ORG, row)).toBe(USER)
    expect(parseAuthUserKey(ORG, { ...row, storageKey: `${ORG}/not-a-uuid` })).toBeNull()
    expect(parseAuthUserKey(OTHER, row)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// The runner over the real database
// ---------------------------------------------------------------------------

let db: TestDatabase
let seq = 0

/** Storage and Auth fakes, and counters to prove what was and was not called. */
class World {
  storage = new Set<string>()
  removeCalls: string[] = []
  failStorageAfter: number | null = null
  failUserRemoval = false
  clock = true

  remove(bucket: string, keys: string[]): Promise<void> {
    for (const key of keys) {
      if (this.failStorageAfter !== null && this.removeCalls.length >= this.failStorageAfter) {
        return Promise.reject(new Error('storage unavailable'))
      }
      this.removeCalls.push(`${bucket}/${key}`)
      this.storage.delete(`${bucket}/${key}`)
    }
    return Promise.resolve()
  }
}

const COLUMNS = `id, name, legal_name as "legalName",
  closure_requested_at::text as "closureRequestedAt", closure_purge_after::text as "closurePurgeAfter",
  purge_started_at::text as "purgeStartedAt", closed_at::text as "closedAt"`

function depsFor(world: World): ClosureDeps {
  const q = <T>(sql: string, params: unknown[] = []) => db.sql<T>(sql, params)
  return {
    listClosingOrganizations: () =>
      q<OrganizationRow>(
        `select ${COLUMNS} from public.organizations
          where closure_requested_at is not null and closed_at is null order by name`,
      ),
    // Deliberately wider than the real adapter: it also returns organizations
    // that are NOT closing, so the sweep's own state check is what is on trial.
    listClosedWithPendingWork: () =>
      q<OrganizationRow>(
        `select ${COLUMNS} from public.organizations o
          where (closed_at is not null or closure_requested_at is null)
            and exists (select 1 from public.account_closure_objects x
                         where x.organization_id = o.id and x.deleted_at is null)`,
      ),
    hasLiveSubscription: async (id) =>
      (await q<{ v: boolean }>(`select app.organization_has_live_subscription($1) as v`, [id]))[0]!
        .v,
    claim: async (id) => {
      try {
        const [row] = await q<{ ok: boolean }>(`select app.organization_claim_purge($1) as ok`, [
          id,
        ])
        return interpretClaim(row!.ok, null)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return interpretClaim(null, {
          code: /live subscription/.test(message) ? '55000' : 'XX',
          message,
        })
      }
    },
    closureState: async (id) =>
      (await q<{ s: 'open' }>(`select app.closure_state_of($1)::text as s`, [id]))[0]!.s,
    collectObjects: async (id) =>
      (await q<{ n: number }>(`select app.organization_collect_objects($1) as n`, [id]))[0]!.n,
    listMemberIds: async (id) =>
      (
        await q<{ user_id: string }>(
          `select user_id from public.organization_members where organization_id = $1`,
          [id],
        )
      ).map((r) => r.user_id),
    recordRemovalCandidates: async (id, userIds) => {
      for (const userId of userIds) {
        await q(
          `insert into public.account_closure_objects (organization_id, bucket, storage_key)
           values ($1, $2, $3) on conflict (bucket, storage_key) do nothing`,
          [id, AUTH_USERS_BUCKET, authUserKey(id, userId)],
        )
      }
    },
    listPendingObjects: (id, kind, limit) =>
      q<ObjectRow>(
        `select id, organization_id as "organizationId", bucket, storage_key as "storageKey",
                deleted_at::text as "deletedAt"
           from public.account_closure_objects
          where organization_id = $1 and deleted_at is null
            and ((bucket = $2) = ($3 = 'auth'))
          order by storage_key limit $4`,
        [id, AUTH_USERS_BUCKET, kind, limit],
      ),
    removeFromStorage: (bucket, keys) => world.remove(bucket, keys),
    markDone: async (ids) => {
      await q(
        `update public.account_closure_objects set deleted_at = now() where id = any($1::uuid[])`,
        [ids],
      )
    },
    purgeData: async (id) =>
      (
        await q<{ c: Record<string, number> }>(`select app.organization_purge_data($1) as c`, [id])
      )[0]!.c,
    membershipsOf: async (userIds) =>
      q(
        `select user_id as "userId", organization_id as "organizationId"
           from public.organization_members where user_id = any($1::uuid[])`,
        [userIds],
      ),
    deleteAuthUser: async (userId) => {
      if (world.failUserRemoval) return { status: 500, message: 'auth unavailable' }
      await q(`delete from auth.users where id = $1`, [userId])
      return null
    },
    deleteProfile: async (userId) => {
      await q(`delete from public.profiles where id = $1`, [userId])
    },
    hasTime: () => world.clock,
  }
}

interface Agency {
  organizationId: string
  owner: string
  extra: string
  keys: string[]
}

async function newAgency(world: World, label: string): Promise<Agency> {
  seq += 1
  const owner = await signUp(db, {
    email: `owner${seq}@runner.test`,
    fullName: 'Runner Owner',
    organizationName: `${label} ${seq}`,
    currency: 'EUR',
    timeZone: 'Europe/Paris',
  })
  const organizationId = owner.organizationId!
  const extra = (await signUp(db, { email: `staff${seq}@runner.test`, fullName: 'Runner Staff' }))
    .userId
  await db.sql(`delete from public.organization_members where user_id = $1`, [extra])
  await addMember(db, organizationId, extra, 'staff')
  await db.sql(`update public.organizations set legal_name = $2 where id = $1`, [
    organizationId,
    `${label} LLC`,
  ])

  const keys = [1, 2, 3, 4, 5].map((n) => `${organizationId}/doc-${n}.jpg`)
  const customer = (
    await db.sql<{ id: string }>(
      `insert into public.customers (organization_id, first_name, last_name)
       values ($1, 'A', 'B') returning id`,
      [organizationId],
    )
  )[0]!
  for (const [i, key] of keys.entries()) {
    await db.sql(
      `insert into public.customer_documents
         (organization_id, customer_id, document_type, document_number, file_path, file_mime_type)
       values ($1, $2, 'passport', $3, $4, 'image/jpeg')`,
      [organizationId, customer.id, `P-${i}`, key],
    )
    world.storage.add(`customer-documents/${key}`)
  }
  return { organizationId, owner: owner.userId, extra, keys }
}

const request = (orgId: string, due = true) =>
  db.sql(
    `update public.organizations
        set closure_requested_at = now() - interval '31 days',
            closure_requested_by = $2,
            closure_purge_after = ${due ? "now() - interval '1 day'" : "now() + interval '10 days'"}
      where id = $1`,
    [orgId, null],
  )

const state = async (orgId: string) =>
  (await db.sql<{ s: string }>(`select app.closure_state_of($1)::text as s`, [orgId]))[0]!.s
const count = async (table: string, orgId: string) =>
  Number(
    (
      await db.sql<{ n: number }>(
        `select count(*)::int as n from public.${table} where organization_id = $1`,
        [orgId],
      )
    )[0]!.n,
  )
const userExists = async (id: string) =>
  Number(
    (
      await db.sql<{ n: number }>(
        `select (select count(*) from auth.users where id = $1) + (select count(*) from public.profiles where id = $1) as n`,
        [id],
      )
    )[0]!.n,
  ) > 0

const run = (world: World, batchSize = 2) =>
  runAccountClosure(depsFor(world), { now: new Date(), batchSize })

beforeAll(async () => {
  db = await TestDatabase.create()
}, 120_000)

afterAll(async () => {
  await db.close()
})

describe('a full run', () => {
  it('sweeps Storage, purges rows, and removes accounts and profiles of last memberships only', async () => {
    const world = new World()
    const a = await newAgency(world, 'Alpha')
    const b = await newAgency(world, 'Bravo')
    // Alpha's staff member also belongs to Bravo: they keep everything.
    await addMember(db, b.organizationId, a.extra, 'staff')
    await request(a.organizationId)

    const report = await run(world)

    expect(await state(a.organizationId)).toBe('closed')
    expect(report.outcomes.find((o) => o.organizationId === a.organizationId)).toMatchObject({
      status: 'closed',
      objectsDeleted: 5,
      usersRemoved: 1,
      usersKept: 1,
    })
    for (const key of a.keys) expect(world.storage.has(`customer-documents/${key}`)).toBe(false)
    expect(await count('customer_documents', a.organizationId)).toBe(0)
    expect(await userExists(a.owner)).toBe(false)
    expect(await userExists(a.extra)).toBe(true)
    // Another agency is untouched.
    expect(await state(b.organizationId)).toBe('open')
    for (const key of b.keys) expect(world.storage.has(`customer-documents/${key}`)).toBe(true)
    expect(await userExists(b.owner)).toBe(true)
    expect(report.needsAttention).toBe(false)
  }, 60_000)

  it('is a no-op on a second run against the same organization', async () => {
    const world = new World()
    const a = await newAgency(world, 'Charlie')
    await request(a.organizationId)
    await run(world)
    const calls = world.removeCalls.length
    const events = await count('account_closure_events', a.organizationId)

    const second = await run(world)

    expect(second.outcomes.filter((o) => o.organizationId === a.organizationId)).toEqual([])
    expect(world.removeCalls.length).toBe(calls)
    expect(await count('account_closure_events', a.organizationId)).toBe(events)
    expect(events).toBe(1)
  }, 60_000)
})

describe('resuming', () => {
  it('resumes when the sweep stopped halfway', async () => {
    const world = new World()
    const a = await newAgency(world, 'Delta')
    await request(a.organizationId)
    world.failStorageAfter = 3

    const first = await run(world)

    expect(first.failures).toBe(1)
    expect(first.needsAttention).toBe(true)
    expect(await state(a.organizationId)).toBe('purging') // claimed, rows still there
    expect(await count('customer_documents', a.organizationId)).toBe(5)
    expect(world.removeCalls.length).toBe(3)

    world.failStorageAfter = null
    const second = await run(world)

    expect(await state(a.organizationId)).toBe('closed')
    expect(second.failures).toBe(0)
    // Five objects are gone. Only the batch that was in flight when it died (the
    // one never marked done) is removed again, which Storage treats as a no-op.
    expect(new Set(world.removeCalls).size).toBe(5)
    expect(world.removeCalls.length).toBe(6)
    expect([...world.storage].filter((k) => k.includes(a.organizationId))).toEqual([])
    expect(await userExists(a.owner)).toBe(false)
  }, 60_000)

  it('finishes account removal when the run died after the purge', async () => {
    const world = new World()
    const a = await newAgency(world, 'Echo')
    await request(a.organizationId)
    world.failUserRemoval = true

    const first = await run(world)
    expect(first.failures).toBe(1)
    expect(await state(a.organizationId)).toBe('closed') // rows gone, members gone
    expect(await count('organization_members', a.organizationId)).toBe(0)
    expect(await userExists(a.owner)).toBe(true)

    world.failUserRemoval = false
    await run(world)

    expect(await userExists(a.owner)).toBe(false)
    expect(await userExists(a.extra)).toBe(false)
  }, 60_000)

  it('picks an agency back up when the run died right after the claim', async () => {
    const world = new World()
    const a = await newAgency(world, 'Foxtrot')
    await request(a.organizationId)
    await db.sql(`select app.organization_claim_purge($1)`, [a.organizationId]) // then: crash

    await run(world)

    expect(await state(a.organizationId)).toBe('closed')
    expect(await userExists(a.owner)).toBe(false)
    expect(world.removeCalls.length).toBe(5)
  }, 60_000)

  it('stops cleanly when out of time and the next run finishes', async () => {
    const world = new World()
    const a = await newAgency(world, 'Golf')
    await request(a.organizationId)
    world.clock = false

    const first = await run(world)
    expect(first.outcomes).toEqual([])
    world.clock = true
    await run(world)

    expect(await state(a.organizationId)).toBe('closed')
  }, 60_000)
})

describe('removing an account', () => {
  const never = () => Promise.reject(new Error('not used'))
  const stub = (events: string[], authError: Record<string, unknown> | null): ClosureDeps =>
    ({
      deleteAuthUser: () => {
        events.push('auth')
        return Promise.resolve(authError)
      },
      deleteProfile: () => {
        events.push('profile')
        return Promise.resolve()
      },
      listClosingOrganizations: never,
    }) as unknown as ClosureDeps

  it('deletes the auth account first, then the profile', async () => {
    const events: string[] = []
    await removeUser(stub(events, null), USER)
    expect(events).toEqual(['auth', 'profile'])
  })

  it('treats an account that is already gone as removed, and still cleans the profile', async () => {
    for (const gone of [{ status: 404 }, { code: 'user_not_found' }]) {
      const events: string[] = []
      await removeUser(stub(events, gone), USER)
      expect(events).toEqual(['auth', 'profile'])
    }
  })

  it('throws on any other Auth error and leaves the profile alone', async () => {
    const events: string[] = []
    await expect(removeUser(stub(events, { status: 500, message: 'boom' }), USER)).rejects.toThrow(
      /boom/,
    )
    await expect(
      removeUser(stub(events, { status: 403, code: 'not_admin', message: 'nope' }), USER),
    ).rejects.toThrow(/nope/)
    expect(events).toEqual(['auth', 'auth'])
    expect(interpretAuthDelete(null)).toBe('removed')
  })

  it('stops on a pending record it cannot read instead of looping', async () => {
    const junk: ObjectRow = object({ bucket: AUTH_USERS_BUCKET, storageKey: `${ORG}/not-a-uuid` })
    const deps = {
      closureState: () => Promise.resolve('closed'),
      listPendingObjects: () => Promise.resolve([junk]),
    } as unknown as ClosureDeps
    await expect(removeAuthUsers(deps, ORG)).rejects.toThrow(/could not be read/)
  })
})

describe('reading everything, or failing', () => {
  const source = (n: number, cap: number) => {
    const rows = Array.from({ length: n }, (_, i) => i)
    // Like PostgREST: never more than `cap` rows per request.
    return (from: number, to: number) =>
      Promise.resolve(rows.slice(from, Math.min(to + 1, from + cap)))
  }

  it('reads past the server cap, including when the total is an exact multiple', async () => {
    expect(await readAllPages(source(1234, 1000), 500)).toHaveLength(1234)
    expect(await readAllPages(source(1000, 1000), 500)).toHaveLength(1000)
    expect(await readAllPages(source(0, 1000), 500)).toEqual([])
  })

  it('refuses to return a partial list', async () => {
    await expect(readAllPages(source(5000, 1000), 500, 2000)).rejects.toThrow(/refusing/)
  })

  it('looks keys up in chunks, never in one query', async () => {
    const sizes: number[] = []
    const keys = Array.from({ length: 250 }, (_, i) => i)
    const out = await readInChunks(
      keys,
      100,
      (chunk) => {
        sizes.push(chunk.length)
        return Promise.resolve(chunk)
      },
      500,
    )
    expect(sizes).toEqual([100, 100, 50])
    expect(out).toHaveLength(250)
  })
})

describe('the caller check', () => {
  const SECRET = 'r'.repeat(48)

  async function attempt(authorization: string | null, secret: string) {
    const world = new World()
    const a = await newAgency(world, 'Mike')
    await request(a.organizationId)
    let ran = false
    const result = await runIfAuthorized(authorization, secret, () => {
      ran = true
      return run(world)
    })
    return { result, ran, world, a }
  }

  it('refuses a wrong secret and claims nothing', async () => {
    const { result, ran, world, a } = await attempt(`Bearer ${'x'.repeat(48)}`, SECRET)
    expect(result).toEqual({ status: 401 })
    expect(ran).toBe(false)
    expect(await state(a.organizationId)).toBe('suspended')
    expect(world.removeCalls).toEqual([])
    expect(await count('customer_documents', a.organizationId)).toBe(5)
  }, 60_000)

  it('refuses an absent secret, and an unconfigured one, and claims nothing', async () => {
    const cases: [string | null, string][] = [
      [null, SECRET],
      [`Bearer ${SECRET}`, ''],
      ['', SECRET],
    ]
    for (const [header, secret] of cases) {
      const { result, ran, a } = await attempt(header, secret)
      expect(result).toEqual({ status: 401 })
      expect(ran).toBe(false)
      expect(await state(a.organizationId)).toBe('suspended')
    }
  }, 60_000)

  it('runs for the right secret', async () => {
    const { result, a } = await attempt(`Bearer ${SECRET}`, SECRET)
    expect(result.status).toBe(200)
    expect(await state(a.organizationId)).toBe('closed')
  }, 60_000)
})

describe('what Stripe blocks', () => {
  async function subscribe(orgId: string, status: string) {
    await db.sql(`select app.billing_replace_catalogue($1::jsonb)`, [
      JSON.stringify([
        {
          plan_key: 'standard',
          display_name: 'Standard',
          stripe_price_id: 'price_t',
          currency: 'EUR',
          amount_minor: 4900,
          interval: 'month',
          interval_count: 1,
          mode: 'test',
          sort_order: 0,
        },
      ]),
    ])
    await db.sql(`select app.billing_claim_customer($1, $2, 'test', 'b@agency.test')`, [
      orgId,
      `cus_${orgId.slice(0, 8)}`,
    ])
    await db.sql(
      `select app.billing_apply_subscription($1, $2, 'test', $3::public.stripe_subscription_status,
         'price_t', 'EUR', 4900, 'month', 1, 1, now() - interval '5 days', now() + interval '25 days',
         false, null, null, null, null, null, now(), $4)`,
      [
        `sub_${orgId.slice(0, 8)}`,
        `cus_${orgId.slice(0, 8)}`,
        status,
        `evt_${status}_${orgId.slice(0, 8)}`,
      ],
    )
  }

  it('names an agency it could not claim because it is still billed, and deletes nothing', async () => {
    const world = new World()
    const a = await newAgency(world, 'Hotel')
    await subscribe(a.organizationId, 'active')
    await request(a.organizationId)

    const report = await run(world)

    expect(report.blocked.filter((b) => b.organizationId === a.organizationId)).toEqual([
      expect.objectContaining({ organizationId: a.organizationId, name: 'Hotel LLC', due: true }),
    ])
    expect(report.needsAttention).toBe(true)
    expect(report.failures).toBe(0)
    expect(await state(a.organizationId)).toBe('suspended')
    expect(await count('customer_documents', a.organizationId)).toBe(5)
    expect(world.removeCalls).toEqual([])
    expect(await userExists(a.owner)).toBe(true)
  }, 60_000)

  it('also lists a suspended agency that is billed but not yet due', async () => {
    const world = new World()
    const a = await newAgency(world, 'India')
    await subscribe(a.organizationId, 'trialing')
    await request(a.organizationId, false)

    const report = await run(world)

    expect(report.blocked.filter((b) => b.organizationId === a.organizationId)).toEqual([
      expect.objectContaining({ organizationId: a.organizationId, due: false }),
    ])
  }, 60_000)

  it('is purged on the run after the subscription is cancelled', async () => {
    const world = new World()
    const a = await newAgency(world, 'Juliet')
    await subscribe(a.organizationId, 'active')
    await request(a.organizationId)
    await run(world)
    await subscribe(a.organizationId, 'canceled')

    const report = await run(world)

    expect(report.blocked.find((b) => b.organizationId === a.organizationId)).toBeUndefined()
    expect(await state(a.organizationId)).toBe('closed')
  }, 60_000)
})

describe('the sweep does not trust the ledger', () => {
  it('deletes nothing for a live agency even when the ledger lists its documents', async () => {
    const world = new World()
    const a = await newAgency(world, 'Kilo')
    for (const key of a.keys) {
      await db.sql(
        `insert into public.account_closure_objects (organization_id, bucket, storage_key)
         values ($1, 'customer-documents', $2)`,
        [a.organizationId, key],
      )
    }

    await expect(sweepStorage(depsFor(world), a.organizationId)).rejects.toThrow(/open/)
    const report = await run(world) // the wide listing hands it over; the sweep refuses

    expect(world.removeCalls).toEqual([])
    expect(report.failures).toBe(1)
    expect(await count('customer_documents', a.organizationId)).toBe(5)
    expect(await userExists(a.owner)).toBe(true)
  }, 60_000)

  it('never deletes a row that belongs to another agency, even when handed one', async () => {
    const world = new World()
    const purging = await newAgency(world, 'November')
    const live = await newAgency(world, 'Oscar')
    await request(purging.organizationId)
    await db.sql(`select app.organization_claim_purge($1)`, [purging.organizationId])
    const liveRow = object({
      organizationId: live.organizationId,
      storageKey: live.keys[0]!,
    })
    const deps: ClosureDeps = {
      ...depsFor(world),
      // An adapter regression: another agency's passport scan comes back.
      listPendingObjects: () => Promise.resolve([liveRow]),
    }

    const result = await sweepStorage(deps, purging.organizationId)

    expect(world.removeCalls).toEqual([])
    expect(result.unsweepable).toBe(1)
    expect(world.storage.has(`customer-documents/${live.keys[0]}`)).toBe(true)
  }, 60_000)

  it('refuses a suspended agency too, which can still be restored', async () => {
    const world = new World()
    const a = await newAgency(world, 'Lima')
    await request(a.organizationId, false)
    await db.sql(
      `insert into public.account_closure_objects (organization_id, bucket, storage_key)
       values ($1, 'customer-documents', $2)`,
      [a.organizationId, a.keys[0]],
    )

    await expect(sweepStorage(depsFor(world), a.organizationId)).rejects.toThrow(/suspended/)
    expect(world.removeCalls).toEqual([])
  }, 60_000)
})

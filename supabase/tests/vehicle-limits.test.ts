// @vitest-environment node
/**
 * The vehicle limit of each plan, and the function that resolves an agency's.
 *
 * The limit lives in public.plan_vehicle_limits, a table this repository authors
 * and no sync writes. billing_plans.entitlements looks like the natural home and
 * is not: app.billing_replace_catalogue ends with `entitlements = excluded.entitlements`
 * and the Stripe catalogue refresh sends none, so a limit authored there would
 * become {} at the next sync and every agency would become unlimited. The last
 * test in this file is the proof that the chosen storage is immune to that.
 *
 * A missing limit resolves to null, meaning no limit: failing open never punishes
 * a paying agency for an operator's mistake.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { TestDatabase, signUp } from './support/harness'

let db: TestDatabase
let organizationId: string
let owner: string
let seq = 0

const PLAN_KEYS = [
  'starter_monthly',
  'starter_yearly',
  'pro_monthly',
  'pro_yearly',
  'business_monthly',
  'business_yearly',
  'unlisted_plan',
]

function catalogueEntry(planKey: string) {
  return {
    plan_key: planKey,
    display_name: planKey,
    stripe_price_id: `price_test_${planKey}`,
    currency: 'EUR',
    amount_minor: 4900,
    interval: planKey.endsWith('yearly') ? 'year' : 'month',
    interval_count: 1,
    mode: 'test',
    sort_order: 0,
  }
}

async function replaceCatalogue(planKeys: string[]): Promise<void> {
  await db.sql(`select app.billing_replace_catalogue($1::jsonb)`, [
    JSON.stringify(planKeys.map(catalogueEntry)),
  ])
}

async function subscribe(planKey: string, status = 'active'): Promise<void> {
  const tag = organizationId.slice(0, 8)
  await db.sql(
    `select app.billing_apply_subscription(
       $1, $2, 'test', $3::public.stripe_subscription_status, $4,
       'EUR', 4900, 'month', 1, 1,
       now() - interval '5 days', now() + interval '25 days',
       false, null, null, null, null, null,
       now(), $5
     )`,
    [
      `sub_test_${tag}`,
      `cus_test_${tag}`,
      status,
      `price_test_${planKey}`,
      `evt_${tag}_${planKey}_${status}`,
    ],
  )
}

async function limitOf(): Promise<number | null> {
  const [row] = await db.sql<{ limit: number | null }>(
    `select app.vehicle_limit_of($1) as "limit"`,
    [organizationId],
  )
  return row!.limit
}

/** The supported way in: all three columns together, or all three cleared. */
async function grantOverride(limit: number | null): Promise<void> {
  await db.sql(`select app.set_vehicle_limit_override($1, $2, $3)`, [
    organizationId,
    limit,
    limit === null ? null : owner,
  ])
}

async function addVehicle(plate: string, archived = false): Promise<void> {
  await db.sql(
    `insert into public.vehicles (organization_id, make, model, registration_plate, currency, archived_at)
     values ($1, 'Renault', 'Clio', $2, 'EUR', $3)`,
    [organizationId, plate, archived ? new Date().toISOString() : null],
  )
}

beforeAll(async () => {
  db = await TestDatabase.create()
  await db.sql(`select app.billing_report_platform_state(true, 'test', 'Stripe is configured.')`)
  await replaceCatalogue(PLAN_KEYS)
})

afterAll(async () => {
  await db.close()
})

beforeEach(async () => {
  seq += 1
  const account = await signUp(db, {
    email: `owner${seq}@limits.test`,
    fullName: 'Owner One',
    organizationName: `Limits ${seq}`,
    currency: 'EUR',
    timeZone: 'Europe/Paris',
  })
  if (!account.organizationId) throw new Error('provisioning failed')
  organizationId = account.organizationId
  owner = account.userId
  const tag = organizationId.slice(0, 8)
  await db.sql(`select app.billing_claim_customer($1, $2, 'test', $3)`, [
    organizationId,
    `cus_test_${tag}`,
    'billing@agency.test',
  ])
})

describe('the authored limit of each plan', () => {
  it('resolves 5 for a starter_monthly subscription', async () => {
    await subscribe('starter_monthly')
    expect(await limitOf()).toBe(5)
  })

  it('resolves the same limit for starter_monthly and starter_yearly', async () => {
    await subscribe('starter_monthly')
    const monthly = await limitOf()
    await subscribe('starter_yearly')
    expect(monthly).toBe(5)
    expect(await limitOf()).toBe(monthly)
  })

  it('resolves 20 for pro_monthly and 50 for business_monthly', async () => {
    await subscribe('pro_monthly')
    expect(await limitOf()).toBe(20)
    await subscribe('business_monthly')
    expect(await limitOf()).toBe(50)
  })

  it('authors exactly the six plan keys, a yearly twin per tier', async () => {
    const rows = await db.sql<{ plan_key: string; tier: string; vehicle_limit: number }>(
      `select plan_key, tier, vehicle_limit from public.plan_vehicle_limits order by plan_key`,
    )
    expect(rows).toEqual([
      { plan_key: 'business_monthly', tier: 'business', vehicle_limit: 50 },
      { plan_key: 'business_yearly', tier: 'business', vehicle_limit: 50 },
      { plan_key: 'pro_monthly', tier: 'pro', vehicle_limit: 20 },
      { plan_key: 'pro_yearly', tier: 'pro', vehicle_limit: 20 },
      { plan_key: 'starter_monthly', tier: 'starter', vehicle_limit: 5 },
      { plan_key: 'starter_yearly', tier: 'starter', vehicle_limit: 5 },
    ])
  })

  it('resolves the tier limit for a trialing subscription', async () => {
    await subscribe('pro_monthly', 'trialing')
    expect(await limitOf()).toBe(20)
  })

  it('returns null when the plan key has no authored row', async () => {
    await subscribe('unlisted_plan')
    expect(await limitOf()).toBeNull()
  })

  it('returns null when the agency has no subscription', async () => {
    expect(await limitOf()).toBeNull()
  })
})

describe('the per-agency override', () => {
  it('prefers the per-agency override over the plan limit', async () => {
    await subscribe('starter_monthly')
    expect(await limitOf()).toBe(5)
    await grantOverride(150)
    expect(await limitOf()).toBe(150)
  })

  // The spec: "it records who set it and when". The function writes all three
  // columns or none, so provenance cannot be left behind by a hurried operator.
  it('records who granted the limit and when, in one call', async () => {
    await grantOverride(150)
    const [row] = await db.sql<{
      vehicle_limit_override: number | null
      vehicle_limit_override_set_by: string | null
      recent: boolean | null
    }>(
      `select vehicle_limit_override, vehicle_limit_override_set_by,
              vehicle_limit_override_set_at > now() - interval '1 minute' as recent
         from public.organizations where id = $1`,
      [organizationId],
    )
    expect(row).toEqual({
      vehicle_limit_override: 150,
      vehicle_limit_override_set_by: owner,
      recent: true,
    })
  })

  it('clears all three columns when the limit is withdrawn', async () => {
    await grantOverride(150)
    await grantOverride(null)
    const [row] = await db.sql<{
      vehicle_limit_override: number | null
      vehicle_limit_override_set_by: string | null
      vehicle_limit_override_set_at: string | null
    }>(
      `select vehicle_limit_override, vehicle_limit_override_set_by, vehicle_limit_override_set_at
         from public.organizations where id = $1`,
      [organizationId],
    )
    expect(row).toEqual({
      vehicle_limit_override: null,
      vehicle_limit_override_set_by: null,
      vehicle_limit_override_set_at: null,
    })
    expect(await limitOf()).toBeNull()
  })

  /*
   * The hole this closes. `update organizations set vehicle_limit_override = 150`
   * used to succeed with both provenance columns null, which is a bespoke limit
   * nobody can explain later. Only the WHEN is in the constraint: the WHO is a
   * foreign key with ON DELETE SET NULL, so demanding it beside a live override
   * would turn deleting an operator's account into a failed DELETE.
   */
  it('refuses a bare update that leaves the limit unexplained', async () => {
    await db.expectRejection(
      () =>
        db.sql(`update public.organizations set vehicle_limit_override = 150 where id = $1`, [
          organizationId,
        ]),
      /organizations_vehicle_limit_override_provenance/i,
    )
    expect(await limitOf()).toBeNull()
  })

  it('refuses a grant with no actor, and a limit of zero or less', async () => {
    await db.expectRejection(
      () => db.sql(`select app.set_vehicle_limit_override($1, 150, null)`, [organizationId]),
      /p_actor is required/i,
    )
    await db.expectRejection(
      () => db.sql(`select app.set_vehicle_limit_override($1, 0, $2)`, [organizationId, owner]),
      /greater than zero/i,
    )
    expect(await limitOf()).toBeNull()
  })

  it('is granted to the service role and to no browser role', async () => {
    const signature = 'app.set_vehicle_limit_override(uuid, integer, uuid)'
    const [row] = await db.sql<{ authenticated: boolean; anon: boolean; service: boolean }>(
      `select has_function_privilege('authenticated', $1, 'execute') as authenticated,
              has_function_privilege('anon', $1, 'execute') as anon,
              has_function_privilege('service_role', $1, 'execute') as service`,
      [signature],
    )
    expect(row).toEqual({ authenticated: false, anon: false, service: true })
  })

  it('refuses an authenticated write to vehicle_limit_override', async () => {
    // Control: the same actor can update the same row, so the refusals below
    // are the guard and not row-level security.
    await db.asUser(owner, (session) =>
      session.sql(`update public.organizations set name = 'Renamed' where id = $1`, [
        organizationId,
      ]),
    )
    const [renamed] = await db.sql<{ name: string }>(
      `select name from public.organizations where id = $1`,
      [organizationId],
    )
    expect(renamed!.name).toBe('Renamed')

    for (const assignment of [
      'vehicle_limit_override = 999',
      `vehicle_limit_override_set_by = '${owner}'`,
      'vehicle_limit_override_set_at = now()',
    ]) {
      await db.asUser(owner, (session) =>
        session.expectRejection(
          () =>
            session.sql(`update public.organizations set ${assignment} where id = $1`, [
              organizationId,
            ]),
          /cannot be changed directly/i,
        ),
      )
    }
    expect(await limitOf()).toBeNull()
  })

  it('lets the service role set the override through the function', async () => {
    await db.asServiceRole(owner, (session) =>
      session.sql(`select app.set_vehicle_limit_override($1, 75, $2)`, [organizationId, owner]),
    )
    expect(await limitOf()).toBe(75)
  })
})

describe('a deployment whose billing is not configured', () => {
  async function setPlatformConfigured(configured: boolean): Promise<void> {
    await db.sql(`select app.billing_report_platform_state($1, 'test', 'Stripe state.')`, [
      configured,
    ])
  }

  it('acquires no plan limit from a stale subscription', async () => {
    await subscribe('starter_monthly')
    expect(await limitOf()).toBe(5)
    await setPlatformConfigured(false)
    try {
      const [{ configured }] = (await db.sql<{ configured: boolean }>(
        `select app.billing_platform_configured() as configured`,
      )) as [{ configured: boolean }]
      expect(configured).toBe(false)
      expect(await limitOf()).toBeNull()
    } finally {
      await setPlatformConfigured(true)
    }
  })

  it('also has no plan limit when no billing plan is active', async () => {
    await subscribe('starter_monthly')
    await db.exec(
      `select app.billing_writing(); update public.billing_plans set is_active = false;`,
    )
    try {
      expect(await limitOf()).toBeNull()
    } finally {
      await replaceCatalogue(PLAN_KEYS)
    }
  })

  it('still honours a per-agency override', async () => {
    await subscribe('starter_monthly')
    await grantOverride(150)
    await setPlatformConfigured(false)
    try {
      expect(await limitOf()).toBe(150)
    } finally {
      await setPlatformConfigured(true)
    }
  })
})

describe('who set the override', () => {
  it('must be a real user', async () => {
    await db.expectRejection(
      () =>
        db.sql(`update public.organizations set vehicle_limit_override_set_by = $2 where id = $1`, [
          organizationId,
          '00000000-0000-4000-8000-000000000000',
        ]),
      /foreign key|violates/i,
    )
  })
})

describe('who may call the resolver and read the table', () => {
  it('refuses the functions to an authenticated user and allows the service role', async () => {
    for (const fn of ['vehicle_limit_of', 'vehicle_count_of']) {
      await db.asUser(owner, (session) =>
        session.expectRejection(
          () => session.sql(`select app.${fn}($1)`, [organizationId]),
          /permission denied/i,
        ),
      )
    }
    await subscribe('pro_monthly')
    const [row] = await db.asServiceRole(owner, (session) =>
      session.sql<{ lim: number }>(`select app.vehicle_limit_of($1) as lim`, [organizationId]),
    )
    expect(row!.lim).toBe(20)
    const [count] = await db.asServiceRole(owner, (session) =>
      session.sql<{ n: number }>(`select app.vehicle_count_of($1) as n`, [organizationId]),
    )
    expect(count!.n).toBe(0)
  })

  it('does not let an authenticated user read or write plan_vehicle_limits', async () => {
    await db.asUser(owner, (session) =>
      session.expectRejection(
        () => session.sql(`select * from public.plan_vehicle_limits`),
        /permission denied/i,
      ),
    )
    await db.asUser(owner, (session) =>
      session.expectRejection(
        () => session.sql(`update public.plan_vehicle_limits set vehicle_limit = 9999`),
        /permission denied/i,
      ),
    )
  })
})

describe('the vehicle count', () => {
  it('counts only unarchived vehicles', async () => {
    await addVehicle('LIM-1')
    await addVehicle('LIM-2')
    await addVehicle('LIM-3', true)
    const [row] = await db.sql<{ n: number }>(`select app.vehicle_count_of($1) as n`, [
      organizationId,
    ])
    expect(row!.n).toBe(2)
  })
})

describe('the catalogue sync', () => {
  it('a catalogue replace leaves plan_vehicle_limits untouched', async () => {
    await subscribe('starter_monthly')
    await replaceCatalogue(['starter_monthly'])

    const [row] = await db.sql<{ vehicle_limit: number }>(
      `select vehicle_limit from public.plan_vehicle_limits where plan_key = 'starter_monthly'`,
    )
    expect(row!.vehicle_limit).toBe(5)
    expect(await limitOf()).toBe(5)

    // Restore the wider catalogue for later tests.
    await replaceCatalogue(PLAN_KEYS)
  })
})

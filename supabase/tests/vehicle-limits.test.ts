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
    await db.sql(
      `update public.organizations
          set vehicle_limit_override = 150, vehicle_limit_override_set_by = $2,
              vehicle_limit_override_set_at = now()
        where id = $1`,
      [organizationId, owner],
    )
    expect(await limitOf()).toBe(150)
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

  it('lets the service role set the override', async () => {
    await db.asServiceRole(owner, (session) =>
      session.sql(`update public.organizations set vehicle_limit_override = 75 where id = $1`, [
        organizationId,
      ]),
    )
    expect(await limitOf()).toBe(75)
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

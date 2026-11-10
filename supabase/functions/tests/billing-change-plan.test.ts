// @vitest-environment node
/**
 * The change_plan action: the decision it makes, against a real database, and the
 * request it sends, through the real Stripe client with only the network faked.
 *
 * The rule this exists to enforce: an agency may not move to a tier whose limit
 * is below the number of vehicles it has. The refusal tests share one fixture
 * and differ ONLY in the vehicle count, so a refusal that fires for some other
 * reason cannot pass both.
 *
 * What this file does not exercise is the Deno entry point (`billing/index.ts`),
 * which cannot be imported here: its owner-only gate, the way it reads the
 * request body, and the supabase-js store adapter are covered by inspection.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { TestDatabase, signUp } from '../../tests/support/harness'
import {
  checkFleetAgainstTier,
  describePlansWithoutLimit,
  plansWithoutLimit,
  type LimitReportStore,
} from '../_shared/billing-limit-report.ts'
import { changePlan, type PlanChangeStore } from '../_shared/billing-plan-change.ts'
import { StripeClient } from '../_shared/stripe-api.ts'

let db: TestDatabase
let organizationId: string
let seq = 0
let plate = 0
let ownerId: string

const PLAN_KEYS = ['starter_monthly', 'pro_monthly', 'business_monthly']
const ITEM_ID = 'si_changeplan'

function catalogueEntry(planKey: string) {
  return {
    plan_key: planKey,
    display_name: planKey,
    stripe_price_id: `price_test_${planKey}`,
    currency: 'EUR',
    amount_minor: 4900,
    interval: 'month',
    interval_count: 1,
    mode: 'test',
    sort_order: 0,
  }
}

async function subscribe(planKey: string, status = 'active'): Promise<void> {
  const tag = organizationId.slice(0, 8)
  await db.sql(
    `select app.billing_apply_subscription(
       $1, $2, 'test', $5::public.stripe_subscription_status, $3,
       'EUR', 4900, 'month', 1, 1,
       now() - interval '5 days', now() + interval '25 days',
       false, null, null, null, null, null,
       now(), $4
     )`,
    [
      `sub_test_${tag}`,
      `cus_test_${tag}`,
      `price_test_${planKey}`,
      `evt_${tag}_${planKey}`,
      status,
    ],
  )
}

async function insertVehicles(count: number): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    plate += 1
    await db.sql(
      `insert into public.vehicles (organization_id, make, model, registration_plate, currency)
       values ($1, 'Renault', 'Clio', $2, 'EUR')`,
      [organizationId, `CHG-${plate}`],
    )
  }
}

/** Reads what the Edge Function's service-role store reads, with the same meaning. */
function storeOver(
  database: TestDatabase,
  recorded: { missingLimit: string[] } = { missingLimit: [] },
): PlanChangeStore {
  return {
    reportMissingLimit(planKey) {
      recorded.missingLimit.push(planKey)
      return Promise.resolve()
    },
    async noteChange({ organizationId: id, planKey, subscriptionId, actorUserId }) {
      await database.sql(`select app.billing_note_event($1, 'subscription_updated', $2, $3, $4)`, [
        id,
        `A plan change to ${planKey} was requested.`,
        actorUserId,
        subscriptionId,
      ])
    },
    async resolvePlan(planKey) {
      const [row] = await database.sql<{
        stripe_price_id: string | null
        vehicle_limit: number | null
        tier: string | null
      }>(
        `select p.stripe_price_id, l.vehicle_limit, l.tier
           from app.billing_resolve_plan($1, 'test') p
           left join public.plan_vehicle_limits l on l.plan_key = p.plan_key`,
        [planKey],
      )
      if (!row?.stripe_price_id) return null
      return {
        stripePriceId: row.stripe_price_id,
        vehicleLimit: row.vehicle_limit,
        tier: row.tier,
      }
    },
    async effectiveSubscription(id) {
      const [row] = await database.sql<{ stripe_subscription_id: string | null; status: string }>(
        `select stripe_subscription_id, status::text as status
           from app.billing_effective_subscription($1)`,
        [id],
      )
      if (!row?.stripe_subscription_id) return null
      return {
        stripeSubscriptionId: row.stripe_subscription_id,
        status: row.status as 'active',
      }
    },
    async vehicleLimitOverride(id) {
      const [row] = await database.sql<{ v: number | null }>(
        `select vehicle_limit_override as v from public.organizations where id = $1`,
        [id],
      )
      return row?.v ?? null
    },
    async vehicleCount(id) {
      const [row] = await database.sql<{ n: number }>(`select app.vehicle_count_of($1) as n`, [id])
      return row!.n
    },
  }
}

interface Recorded {
  readonly method: string
  readonly url: string
  readonly body: URLSearchParams
}

/** The real StripeClient over a fake network; the subscription it serves is trialing or not. */
function fakeStripe(options: { trialEnd?: number; initialPrice?: string } = {}) {
  let currentPrice = options.initialPrice ?? 'price_test_current'
  const applied = new Set<string>()
  const changes: string[] = []
  const calls: Recorded[] = []
  const fetchImpl = ((input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers)
    const key = headers.get('Idempotency-Key')
    calls.push({
      method: init?.method ?? 'GET',
      url: typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
      body: new URLSearchParams(typeof init?.body === 'string' ? init.body : ''),
    })
    // Stripe replays a cached response for a repeated idempotency key and does not
    // perform the update again; model that, because it is the failure under test.
    if (init?.method === 'POST' && !(key && applied.has(key))) {
      if (key) applied.add(key)
      const next = new URLSearchParams(init.body as string).get('items[0][price]')
      if (next) {
        currentPrice = next
        changes.push(next)
      }
    }
    const subscription = {
      id: 'sub_stripe_side',
      status: options.trialEnd ? 'trialing' : 'active',
      trial_end: options.trialEnd ?? null,
      items: { data: [{ id: ITEM_ID, price: { id: currentPrice } }] },
    }
    return Promise.resolve(
      new Response(JSON.stringify(subscription), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
  }) as typeof fetch
  const client = new StripeClient({ secretKey: 'sk_test_x', mode: 'test', fetchImpl })
  return { client, calls, changes, posts: () => calls.filter((c) => c.method === 'POST') }
}

const input = (planKey: string) => ({ organizationId, planKey, attempt: 'a1' })

beforeAll(async () => {
  db = await TestDatabase.create()
  await db.sql(`select app.billing_report_platform_state(true, 'test', 'Stripe is configured.')`)
  await db.sql(`select app.billing_replace_catalogue($1::jsonb)`, [
    JSON.stringify(PLAN_KEYS.map(catalogueEntry)),
  ])
})

afterAll(async () => {
  await db.close()
})

beforeEach(async () => {
  seq += 1
  const account = await signUp(db, {
    email: `owner${seq}@changeplan.test`,
    fullName: 'Owner One',
    organizationName: `Change ${seq}`,
    currency: 'EUR',
    timeZone: 'Europe/Paris',
  })
  if (!account.organizationId) throw new Error('provisioning failed')
  organizationId = account.organizationId
  ownerId = account.userId
  const tag = organizationId.slice(0, 8)
  await db.sql(`select app.billing_claim_customer($1, $2, 'test', $3)`, [
    organizationId,
    `cus_test_${tag}`,
    'billing@agency.test',
  ])
})

describe('change_plan', () => {
  it('upgrades immediately', async () => {
    await subscribe('starter_monthly')
    await insertVehicles(3)
    const stripe = fakeStripe()

    const result = await changePlan(storeOver(db), stripe.client, input('pro_monthly'))

    expect(result).toEqual({ ok: true })
    const [post] = stripe.posts()
    expect(post?.url).toContain(`/subscriptions/sub_test_${organizationId.slice(0, 8)}`)
    expect(post?.body.get('items[0][id]')).toBe(ITEM_ID)
    expect(post?.body.get('items[0][price]')).toBe('price_test_pro_monthly')
  })

  it('refuses a downgrade while the fleet exceeds the target tier limit', async () => {
    await subscribe('pro_monthly')
    await insertVehicles(6)
    const stripe = fakeStripe()

    const result = await changePlan(storeOver(db), stripe.client, input('starter_monthly'))

    expect(result).toMatchObject({ ok: false, category: 'over_target_limit', status: 409 })
    if (result.ok) throw new Error('unreachable')
    expect(result.message).toContain('6 vehicles')
    expect(result.message).toContain('Starter')
    expect(result.message).toContain('5')
    expect(result.message).not.toMatch(/55000|ERROR|SQLSTATE|violates/i)
    // The numbers the decision used, for the client to word.
    expect(result.detail).toEqual({ limit: 5, count: 6, tier: 'starter' })
    // Refused before Stripe was asked anything at all.
    expect(stripe.calls).toHaveLength(0)
  })

  it('allows the same downgrade once the fleet is under the target limit', async () => {
    await subscribe('pro_monthly')
    await insertVehicles(5)
    const stripe = fakeStripe()

    const result = await changePlan(storeOver(db), stripe.client, input('starter_monthly'))

    expect(result).toEqual({ ok: true })
    expect(stripe.posts()[0]?.body.get('items[0][price]')).toBe('price_test_starter_monthly')
  })

  it('does not refuse a downgrade for an agency whose per-agency override covers its fleet', async () => {
    await subscribe('pro_monthly')
    await insertVehicles(6)
    await db.sql(`select app.set_vehicle_limit_override($1, 10, $2)`, [organizationId, ownerId])
    const stripe = fakeStripe()

    const result = await changePlan(storeOver(db), stripe.client, input('starter_monthly'))

    expect(result).toEqual({ ok: true })
    expect(stripe.posts()).toHaveLength(1)
  })

  it('reports the override, not the authored limit, when the override is what refused', async () => {
    await subscribe('business_monthly')
    await insertVehicles(4)
    await db.sql(`select app.set_vehicle_limit_override($1, 3, $2)`, [organizationId, ownerId])
    const stripe = fakeStripe()

    const result = await changePlan(storeOver(db), stripe.client, input('starter_monthly'))

    expect(result).toMatchObject({ ok: false, category: 'over_target_limit', status: 409 })
    if (result.ok) throw new Error('unreachable')
    // Starter authors 5, but the override of 3 is what binds: 4 > 3.
    expect(result.detail).toEqual({ limit: 3, count: 4, tier: 'starter' })
    expect(stripe.calls).toHaveLength(0)
  })

  it('refuses when the agency has no live subscription', async () => {
    const stripe = fakeStripe()

    const none = await changePlan(storeOver(db), stripe.client, input('pro_monthly'))
    expect(none).toMatchObject({ ok: false, category: 'no_subscription', status: 409 })

    await subscribe('starter_monthly', 'canceled')
    const canceled = await changePlan(storeOver(db), stripe.client, input('pro_monthly'))
    expect(canceled).toMatchObject({ ok: false, category: 'no_subscription', status: 409 })

    expect(stripe.calls).toHaveLength(0)
  })

  it('resolves the price from the catalogue and never from the request body', async () => {
    await subscribe('starter_monthly')
    const stripe = fakeStripe()
    const tampered = {
      ...input('pro_monthly'),
      stripe_price_id: 'price_evil',
      stripePriceId: 'price_evil',
      priceId: 'price_evil',
    }

    const result = await changePlan(storeOver(db), stripe.client, tampered)

    expect(result).toEqual({ ok: true })
    const sent = stripe.posts()[0]?.body.toString() ?? ''
    expect(sent).toContain('price_test_pro_monthly')
    expect(sent).not.toContain('price_evil')
  })

  it('keeps the remaining trial days when a trialing agency changes tier', async () => {
    await subscribe('starter_monthly', 'trialing')
    const stripe = fakeStripe({ trialEnd: Math.floor(Date.now() / 1000) + 9 * 86_400 })

    const result = await changePlan(storeOver(db), stripe.client, input('pro_monthly'))

    expect(result).toEqual({ ok: true })
    const post = stripe.posts()[0]
    expect(post?.body.get('items[0][price]')).toBe('price_test_pro_monthly')
    // Neither field may be present at all: sending trial_end would move or end the
    // trial, and Stripe rejects a literal zero.
    expect(post?.body.has('trial_end')).toBe(false)
    expect(post?.body.has('trial_period_days')).toBe(false)
    // Proration stays at Stripe's default: 'none' would give an upgrading agency free
    // time and a downgrading one no credit.
    expect(post?.body.has('proration_behavior')).toBe(false)
  })

  it('performs a repeated change A to B to A to B instead of replaying the first', async () => {
    await subscribe('starter_monthly')
    const stripe = fakeStripe({ initialPrice: 'price_test_starter_monthly' })
    const store = storeOver(db)
    const base = Date.now()
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      // No attempt token: the default must not make these the same operation.
      for (const [index, planKey] of ['pro_monthly', 'starter_monthly', 'pro_monthly'].entries()) {
        vi.setSystemTime(base + index * 61_000)
        const result = await changePlan(store, stripe.client, { organizationId, planKey })
        expect(result).toEqual({ ok: true })
      }
    } finally {
      vi.useRealTimers()
    }

    expect(stripe.changes).toEqual([
      'price_test_pro_monthly',
      'price_test_starter_monthly',
      'price_test_pro_monthly',
    ])
  })

  it('refuses rather than build a key when the subscription item has no price', async () => {
    await subscribe('starter_monthly')
    const calls: string[] = []
    const stripe = {
      request: (method: string) => {
        calls.push(method)
        return Promise.resolve({ id: 'sub_x', items: { data: [{ id: ITEM_ID }] } })
      },
    }

    const result = await changePlan(storeOver(db), stripe as never, input('pro_monthly'))

    expect(result).toMatchObject({ ok: false, category: 'plan_change_unavailable' })
    expect(calls).toEqual(['GET'])
  })
})

function limitReportStoreOver(database: TestDatabase): LimitReportStore {
  return {
    async activePlanKeys() {
      const rows = await database.sql<{ plan_key: string }>(
        `select plan_key from public.billing_plans where is_active and mode = 'test'`,
      )
      return rows.map((r) => r.plan_key)
    },
    async authoredLimitKeys() {
      const rows = await database.sql<{ plan_key: string }>(
        `select plan_key from public.plan_vehicle_limits`,
      )
      return rows.map((r) => r.plan_key)
    },
  }
}

describe('reports for configurations that silently misbehave', () => {
  it('reports an active plan with no authored vehicle limit', async () => {
    await subscribe('starter_monthly')
    const recorded = { missingLimit: [] as string[] }
    const store = storeOver(db, recorded)

    // Control: every key the catalogue sells has a limit, so nothing is reported.
    expect(await plansWithoutLimit(limitReportStoreOver(db))).toEqual([])
    expect(await changePlan(store, fakeStripe().client, input('business_monthly'))).toEqual({
      ok: true,
    })
    expect(recorded.missingLimit).toEqual([])

    const [saved] = await db.sql<{ tier: string; vehicle_limit: number }>(
      `delete from public.plan_vehicle_limits where plan_key = 'pro_monthly'
       returning tier, vehicle_limit`,
    )
    try {
      // The zero-row case: the plan RESOLVES (it is sold), but no limit row exists.
      // Fail-open is the specified behaviour and stays: the change is allowed...
      const result = await changePlan(store, fakeStripe().client, input('pro_monthly'))
      expect(result).toEqual({ ok: true })
      // ...but the operator is told which plan is unlimited.
      expect(recorded.missingLimit).toEqual(['pro_monthly'])

      const missing = await plansWithoutLimit(limitReportStoreOver(db))
      expect(missing).toEqual(['pro_monthly'])
      const sentence = describePlansWithoutLimit(missing)
      expect(sentence).toContain('pro_monthly')
      expect(sentence.length).toBeLessThanOrEqual(200)
    } finally {
      await db.sql(
        `insert into public.plan_vehicle_limits (plan_key, tier, vehicle_limit)
         values ('pro_monthly', $1, $2)`,
        [saved!.tier, saved!.vehicle_limit],
      )
    }
  })

  it('reports a subscription whose tier is below the agency fleet size', async () => {
    await subscribe('pro_monthly')
    await insertVehicles(6)
    // An operator edits Stripe directly: the webhook lands the lower tier.
    await subscribe('starter_monthly')

    const notes: string[] = []
    const fleet = {
      vehicleLimit: async (id: string) => {
        const [row] = await db.sql<{ l: number | null }>(`select app.vehicle_limit_of($1) as l`, [
          id,
        ])
        return row!.l
      },
      vehicleCount: (id: string) => storeOver(db).vehicleCount(id),
      lastNote: async (id: string) => {
        const [row] = await db.sql<{ summary: string }>(
          `select summary from public.billing_events
            where organization_id = $1 and kind = 'subscription_updated'
            order by occurred_at desc, id desc limit 1`,
          [id],
        )
        return row?.summary ?? null
      },
      note: async (id: string, summary: string) => {
        notes.push(summary)
        await db.sql(`select app.billing_note_event($1, 'subscription_updated', $2)`, [id, summary])
      },
    }

    const result = await checkFleetAgainstTier(fleet, organizationId)

    expect(result).toEqual({ limit: 5, count: 6 })
    expect(notes).toHaveLength(1)
    expect(notes[0]).toContain('6 vehicles')
    expect(notes[0]).toContain('5')
    const events = await db.sql<{ summary: string }>(
      `select summary from public.billing_events
        where organization_id = $1 and summary = $2`,
      [organizationId, notes[0]],
    )
    expect(events).toHaveLength(1)
    // Nothing is retroactive: every vehicle is still there and none was archived.
    const [kept] = await db.sql<{ total: number; archived: number }>(
      `select count(*)::int as total, count(archived_at)::int as archived
         from public.vehicles where organization_id = $1`,
      [organizationId],
    )
    expect(kept).toEqual({ total: 6, archived: 0 })

    // A second applied event with the same observation (a renewal, say) adds nothing.
    expect(await checkFleetAgainstTier(fleet, organizationId)).toEqual({ limit: 5, count: 6 })
    expect(notes).toHaveLength(1)
    // A changed observation is a new fact and is noted.
    await db.sql(`select app.set_vehicle_limit_override($1, 4, $2)`, [organizationId, ownerId])
    expect(await checkFleetAgainstTier(fleet, organizationId)).toEqual({ limit: 4, count: 6 })
    expect(notes).toHaveLength(2)
    expect(notes[1]).toContain('covers 4')
    await db.sql(`select app.set_vehicle_limit_override($1, null, null)`, [organizationId])

    // Control: a fleet that fits the tier is not reported.
    await db.sql(
      `update public.vehicles set archived_at = now()
        where id = (select id from public.vehicles where organization_id = $1 limit 1)`,
      [organizationId],
    )
    notes.length = 0
    expect(await checkFleetAgainstTier(fleet, organizationId)).toBeNull()
    expect(notes).toEqual([])
  })

  it('records who asked for a plan change', async () => {
    await subscribe('starter_monthly')

    const result = await changePlan(storeOver(db), fakeStripe().client, {
      ...input('pro_monthly'),
      actorUserId: ownerId,
    })

    expect(result).toEqual({ ok: true })
    const [event] = await db.sql<{ kind: string; actor_user_id: string; stripe_object_id: string }>(
      `select kind::text as kind, actor_user_id, stripe_object_id
         from public.billing_events
        where organization_id = $1 and summary like '%pro_monthly%'`,
      [organizationId],
    )
    expect(event).toMatchObject({
      kind: 'subscription_updated',
      actor_user_id: ownerId,
      stripe_object_id: `sub_test_${organizationId.slice(0, 8)}`,
    })
  })
})

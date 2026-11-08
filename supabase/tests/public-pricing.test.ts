// @vitest-environment node
/**
 * The staleness rule and the shape of the public pricing payload.
 *
 * The public pricing path serves whatever billing_plans holds, so the two
 * decisions made here are the ones a visitor sees: when the mirrored rows are
 * too old to trust, and which rows are shown, in what order, at what interval.
 */
import { describe, expect, it } from 'vitest'

import {
  isStale,
  newestUpdatedAt,
  PRICING_TTL_SECONDS,
  REFRESH_RETRY_MS,
  shouldRefresh,
  type PlanRow,
  buildPublicPricing,
  createRefreshGate,
  REFRESH_BACKOFF_MS,
  servePricing,
  toPublicPlans,
  type PricingDeps,
  UNCONFIGURED,
} from '../functions/_shared/public-pricing.ts'

const NOW = new Date('2026-11-08T12:00:00.000Z')

function secondsBefore(seconds: number): string {
  return new Date(NOW.getTime() - seconds * 1000).toISOString()
}

/** An active monthly test-currency row; each test overrides only what it is about. */
function row(overrides: Partial<PlanRow> = {}): PlanRow {
  return {
    plan_key: 'pro_monthly',
    currency: 'USD',
    amount_minor: 4900,
    interval: 'month',
    interval_count: 1,
    is_active: true,
    sort_order: 0,
    updated_at: secondsBefore(0),
    ...overrides,
  }
}

describe('isStale', () => {
  it('is stale when nothing has ever been written', () => {
    expect(isStale(null, NOW)).toBe(true)
  })

  it('is stale one second past the ttl', () => {
    expect(isStale(secondsBefore(PRICING_TTL_SECONDS + 1), NOW)).toBe(true)
  })

  it('is fresh one second inside the ttl', () => {
    expect(isStale(secondsBefore(PRICING_TTL_SECONDS - 1), NOW)).toBe(false)
  })

  it('is fresh at exactly the ttl and stale one millisecond later', () => {
    const exactly = secondsBefore(PRICING_TTL_SECONDS)
    expect(isStale(exactly, NOW)).toBe(false)
    expect(isStale(exactly, new Date(NOW.getTime() + 1))).toBe(true)
  })

  it('honours a ttl passed in', () => {
    expect(isStale(secondsBefore(31), NOW, 30)).toBe(true)
    expect(isStale(secondsBefore(29), NOW, 30)).toBe(false)
  })
})

describe('toPublicPlans', () => {
  it('drops inactive rows', () => {
    const plans = toPublicPlans([
      row({ plan_key: 'pro_monthly' }),
      row({ plan_key: 'legacy', is_active: false }),
    ])
    expect(plans.map((plan) => plan.planKey)).toEqual(['pro_monthly'])
  })

  it('orders by sort_order', () => {
    const plans = toPublicPlans([
      row({ plan_key: 'pro_yearly', sort_order: 2 }),
      row({ plan_key: 'pro_monthly', sort_order: 1 }),
    ])
    expect(plans.map((plan) => plan.planKey)).toEqual(['pro_monthly', 'pro_yearly'])
  })

  it('does not reorder or otherwise mutate its input', () => {
    const rows = [
      row({ plan_key: 'b', sort_order: 2 }),
      row({ plan_key: 'a', sort_order: 1 }),
      row({ plan_key: 'off', is_active: false }),
    ]
    const snapshot = structuredClone(rows)
    toPublicPlans(rows)
    expect(rows).toEqual(snapshot)
  })

  it('carries the interval Stripe reported, not the one the plan key claims', () => {
    const plans = toPublicPlans([row({ plan_key: 'pro_yearly', interval: 'month' })])
    expect(plans[0]?.interval).toBe('month')
  })

  it('drops a weekly or daily plan without hiding the monthly one beside it', () => {
    const plans = toPublicPlans([
      row({ plan_key: 'weekly', interval: 'week', sort_order: 0 }),
      row({ plan_key: 'daily', interval: 'day', sort_order: 1 }),
      row({ plan_key: 'pro_monthly', interval: 'month', sort_order: 2 }),
    ])
    expect(plans.map((plan) => plan.planKey)).toEqual(['pro_monthly'])
  })

  it('shapes a row into the public plan fields and no others', () => {
    const plans = toPublicPlans([
      row({
        plan_key: 'pro_yearly',
        currency: 'EUR',
        amount_minor: 49000,
        interval: 'year',
        interval_count: 1,
      }),
    ])
    expect(plans).toEqual([
      {
        planKey: 'pro_yearly',
        amountMinor: 49000,
        currency: 'EUR',
        interval: 'year',
        intervalCount: 1,
      },
    ])
  })
})

describe('buildPublicPricing', () => {
  it('stays configured when every row is inactive', () => {
    expect(
      buildPublicPricing({ rows: [row({ is_active: false })], trialDays: 0, configured: true }),
    ).toEqual({ configured: true, plans: [], trialDays: 0 })
  })

  it('stays configured with no rows at all: configuration, not row count, decides', () => {
    expect(buildPublicPricing({ rows: [], trialDays: 14, configured: true })).toEqual({
      configured: true,
      plans: [],
      trialDays: 14,
    })
  })

  it('is the unconfigured answer, with no plans and no trial, when not configured', () => {
    expect(buildPublicPricing({ rows: [row()], trialDays: 14, configured: false })).toEqual(
      UNCONFIGURED,
    )
  })

  it('carries the trial it was given and the plans it can show', () => {
    expect(buildPublicPricing({ rows: [row()], trialDays: 14, configured: true })).toEqual({
      configured: true,
      plans: [
        {
          planKey: 'pro_monthly',
          amountMinor: 4900,
          currency: 'USD',
          interval: 'month',
          intervalCount: 1,
        },
      ],
      trialDays: 14,
    })
  })
})

describe('UNCONFIGURED', () => {
  it('returns no plans and no trial', () => {
    expect(UNCONFIGURED).toEqual({ configured: false, plans: [], trialDays: 0 })
  })
})

describe('newestUpdatedAt', () => {
  it('returns null when there are no rows', () => {
    expect(newestUpdatedAt([])).toBeNull()
  })

  it('returns the only row timestamp', () => {
    expect(newestUpdatedAt([row({ updated_at: secondsBefore(30) })])).toBe(secondsBefore(30))
  })

  it('finds the newest of several rows given out of order', () => {
    const rows = [
      row({ updated_at: secondsBefore(500) }),
      row({ updated_at: secondsBefore(5) }),
      row({ updated_at: secondsBefore(60) }),
    ]
    expect(newestUpdatedAt(rows)).toBe(secondsBefore(5))
  })

  it('compares instants, not strings, across offsets', () => {
    // 12:00:00Z is later than 13:30+02:00 (11:30Z) although it sorts earlier as text.
    const rows = [
      row({ updated_at: '2026-11-08T13:30:00.000+02:00' }),
      row({ updated_at: '2026-11-08T12:00:00.000Z' }),
    ]
    expect(newestUpdatedAt(rows)).toBe('2026-11-08T12:00:00.000Z')
  })

  it('ignores unparseable or missing timestamps', () => {
    const rows = [
      row({ updated_at: 'not a date' }),
      row({ updated_at: undefined as unknown as string }),
      row({ updated_at: secondsBefore(90) }),
    ]
    expect(newestUpdatedAt(rows)).toBe(secondsBefore(90))
  })

  it('returns null when no timestamp is usable, so the catalogue counts as stale', () => {
    expect(newestUpdatedAt([row({ updated_at: 'garbage' })])).toBeNull()
    expect(isStale(newestUpdatedAt([row({ updated_at: 'garbage' })]), NOW)).toBe(true)
  })
})

describe('shouldRefresh', () => {
  const nowMs = NOW.getTime()
  const stale = secondsBefore(PRICING_TTL_SECONDS + 1)

  it('is false for fresh data, whatever the attempt history', () => {
    expect(shouldRefresh({ newestUpdatedAt: secondsBefore(5), lastAttemptMs: null, nowMs })).toBe(
      false,
    )
  })

  it('is true for stale data with no prior attempt', () => {
    expect(shouldRefresh({ newestUpdatedAt: stale, lastAttemptMs: null, nowMs })).toBe(true)
  })

  it('is false for stale data with a recent attempt', () => {
    expect(shouldRefresh({ newestUpdatedAt: stale, lastAttemptMs: nowMs - 1000, nowMs })).toBe(
      false,
    )
  })

  it('is true once the retry window has elapsed, exactly at the boundary', () => {
    expect(
      shouldRefresh({
        newestUpdatedAt: stale,
        lastAttemptMs: nowMs - REFRESH_RETRY_MS,
        nowMs,
      }),
    ).toBe(true)
    expect(
      shouldRefresh({
        newestUpdatedAt: stale,
        lastAttemptMs: nowMs - REFRESH_RETRY_MS + 1,
        nowMs,
      }),
    ).toBe(false)
  })

  it('gates a null newest timestamp by the retry window instead of firing every request', () => {
    expect(shouldRefresh({ newestUpdatedAt: null, lastAttemptMs: null, nowMs })).toBe(true)
    expect(shouldRefresh({ newestUpdatedAt: null, lastAttemptMs: nowMs - 1000, nowMs })).toBe(false)
  })

  it('honours custom ttl and retry values', () => {
    expect(
      shouldRefresh({
        newestUpdatedAt: secondsBefore(30),
        lastAttemptMs: nowMs - 5000,
        nowMs,
        ttlSeconds: 10,
        retryMs: 5000,
      }),
    ).toBe(true)
  })
})

/** Dependencies for `servePricing`, each overridable by the test that is about it. */
function deps(overrides: Partial<PricingDeps> = {}): PricingDeps & {
  logged: string[]
  refreshCalls: () => number
} {
  const logged: string[] = []
  let refreshCalls = 0
  const base: PricingDeps = {
    config: { trialDays: 14 },
    hasPlatformCredentials: true,
    readPlans: () => Promise.resolve([row({ updated_at: secondsBefore(5) })]),
    refresh: () => {
      refreshCalls += 1
      return Promise.resolve(1)
    },
    gate: createRefreshGate(),
    nowMs: NOW.getTime(),
    logError: (message) => logged.push(message),
  }
  return { ...base, ...overrides, logged, refreshCalls: () => refreshCalls }
}

const STALE_ROWS = [row({ updated_at: secondsBefore(PRICING_TTL_SECONDS + 60) })]

describe('servePricing', () => {
  it('answers 200 and unconfigured, never touching Stripe, with no configuration', async () => {
    const d = deps({ config: null, readPlans: () => Promise.reject(new Error('no read')) })
    expect(await servePricing(d)).toEqual({ status: 200, body: UNCONFIGURED })
    expect(d.refreshCalls()).toBe(0)
  })

  it('answers 503 and logs when platform credentials are missing', async () => {
    const d = deps({ hasPlatformCredentials: false })
    const decision = await servePricing(d)
    expect(decision.status).toBe(503)
    expect(d.logged).toEqual(['pricing: platform credentials missing'])
  })

  it('answers 503 and logs when the table cannot be read', async () => {
    const d = deps({ readPlans: () => Promise.resolve(null) })
    expect((await servePricing(d)).status).toBe(503)
    expect(d.logged).toEqual(['pricing: catalogue read failed'])
  })

  it('is configured: true even when every price has been archived', async () => {
    const d = deps({
      readPlans: () => Promise.resolve([row({ is_active: false, updated_at: secondsBefore(5) })]),
    })
    expect(await servePricing(d)).toEqual({
      status: 200,
      body: { configured: true, plans: [], trialDays: 14 },
    })
  })

  it('is configured: true with an empty, never-mirrored table', async () => {
    const d = deps({ readPlans: () => Promise.resolve([]) })
    const decision = await servePricing(d)
    expect(decision.status === 200 && decision.body.configured).toBe(true)
  })

  it('does not refresh fresh data', async () => {
    const d = deps()
    await servePricing(d)
    expect(d.refreshCalls()).toBe(0)
  })

  it('serves the rows read after a refresh that advanced the mirror', async () => {
    let reads = 0
    const d = deps({
      readPlans: () => {
        reads += 1
        return Promise.resolve(
          reads === 1 ? STALE_ROWS : [row({ amount_minor: 5900, updated_at: secondsBefore(0) })],
        )
      },
    })
    const decision = await servePricing(d)
    expect(d.refreshCalls()).toBe(1)
    expect(decision.status === 200 && decision.body.plans[0]?.amountMinor).toBe(5900)
    expect(d.gate.retryMs).toBe(REFRESH_RETRY_MS)
    expect(d.gate.lastAttemptMs).toBe(NOW.getTime())
  })

  it('serves the stale rows, logs only the error name, and backs off when refresh throws', async () => {
    const d = deps({
      readPlans: () => Promise.resolve(STALE_ROWS),
      refresh: () => Promise.reject(new TypeError('sk_live_secret in here')),
    })
    const decision = await servePricing(d)
    expect(decision.status).toBe(200)
    expect(d.logged).toEqual(['pricing: catalogue refresh failed (TypeError)'])
    expect(d.logged.join()).not.toContain('sk_live')
    expect(d.gate.retryMs).toBe(REFRESH_BACKOFF_MS)
  })

  it('backs off when refresh succeeds but the mirror does not advance', async () => {
    // Every price archived: the replace touches no row, so updated_at stays put.
    const d = deps({ readPlans: () => Promise.resolve(STALE_ROWS) })
    await servePricing(d)
    expect(d.refreshCalls()).toBe(1)
    expect(d.gate.retryMs).toBe(REFRESH_BACKOFF_MS)
  })

  it('backs off when the re-read after a refresh fails', async () => {
    let reads = 0
    const d = deps({
      readPlans: () => {
        reads += 1
        return Promise.resolve(reads === 1 ? STALE_ROWS : null)
      },
    })
    const decision = await servePricing(d)
    expect(decision.status).toBe(200)
    expect(d.gate.retryMs).toBe(REFRESH_BACKOFF_MS)
  })

  it('does not call Stripe again inside the backed-off window', async () => {
    const gate = createRefreshGate()
    const first = deps({ gate, readPlans: () => Promise.resolve(STALE_ROWS) })
    await servePricing(first)
    expect(first.refreshCalls()).toBe(1)

    // 5 minutes later: past the 60s window, inside the 10 minute one.
    const later = deps({
      gate,
      nowMs: NOW.getTime() + 5 * 60_000,
      readPlans: () => Promise.resolve(STALE_ROWS),
    })
    await servePricing(later)
    expect(later.refreshCalls()).toBe(0)

    const afterWindow = deps({
      gate,
      nowMs: NOW.getTime() + REFRESH_BACKOFF_MS,
      readPlans: () => Promise.resolve(STALE_ROWS),
    })
    await servePricing(afterWindow)
    expect(afterWindow.refreshCalls()).toBe(1)
  })

  it('writes the gate before the refresh resolves, so concurrent requests do not pile on', async () => {
    const gate = createRefreshGate()
    let release: () => void = () => undefined
    const pending = new Promise<void>((resolve) => (release = resolve))
    const first = deps({
      gate,
      readPlans: () => Promise.resolve(STALE_ROWS),
      refresh: () => pending,
    })
    const inFlight = servePricing(first)
    await Promise.resolve()
    await Promise.resolve()

    const second = deps({ gate, readPlans: () => Promise.resolve(STALE_ROWS) })
    await servePricing(second)
    expect(second.refreshCalls()).toBe(0)

    release()
    await inFlight
  })
})

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
  toPublicPricing,
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

  it('honours a ttl passed in', () => {
    expect(isStale(secondsBefore(31), NOW, 30)).toBe(true)
    expect(isStale(secondsBefore(29), NOW, 30)).toBe(false)
  })
})

describe('toPublicPricing', () => {
  it('drops inactive rows', () => {
    const pricing = toPublicPricing(
      [row({ plan_key: 'pro_monthly' }), row({ plan_key: 'legacy', is_active: false })],
      0,
    )
    expect(pricing.plans.map((plan) => plan.planKey)).toEqual(['pro_monthly'])
  })

  it('orders by sort_order', () => {
    const pricing = toPublicPricing(
      [
        row({ plan_key: 'pro_yearly', sort_order: 2 }),
        row({ plan_key: 'pro_monthly', sort_order: 1 }),
      ],
      0,
    )
    expect(pricing.plans.map((plan) => plan.planKey)).toEqual(['pro_monthly', 'pro_yearly'])
  })

  it('carries the interval Stripe reported, not the one the plan key claims', () => {
    const pricing = toPublicPricing([row({ plan_key: 'pro_yearly', interval: 'month' })], 0)
    expect(pricing.plans[0]?.interval).toBe('month')
  })

  it('reports configured with no plans when every row is inactive', () => {
    const pricing = toPublicPricing([row({ is_active: false })], 0)
    expect(pricing).toEqual({ configured: true, plans: [], trialDays: 0 })
  })

  it('shapes a row into the public plan fields and no others', () => {
    const pricing = toPublicPricing(
      [
        row({
          plan_key: 'pro_yearly',
          currency: 'EUR',
          amount_minor: 49000,
          interval: 'year',
          interval_count: 1,
        }),
      ],
      14,
    )
    expect(pricing).toEqual({
      configured: true,
      plans: [
        {
          planKey: 'pro_yearly',
          amountMinor: 49000,
          currency: 'EUR',
          interval: 'year',
          intervalCount: 1,
        },
      ],
      trialDays: 14,
    })
  })

  it('never invents a trial', () => {
    expect(toPublicPricing([], 0).trialDays).toBe(0)
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

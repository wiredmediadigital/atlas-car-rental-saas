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
  PRICING_TTL_SECONDS,
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

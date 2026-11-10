import { describe, expect, it } from 'vitest'

import type { PublicPlan, PublicPricing } from './api'
import {
  formatPlanAmount,
  hasRenderablePricing,
  renderablePlans,
  commonCadences,
  tierOfPlan,
  tierSaving,
} from './renderable-pricing'

const MONTHLY: PublicPlan = {
  planKey: 'pro_monthly',
  amountMinor: 4900,
  currency: 'usd',
  interval: 'month',
  intervalCount: 1,
}

const pricing = (plans: PublicPlan[]): PublicPricing => ({ configured: true, plans, trialDays: 0 })

describe('hasRenderablePricing', () => {
  it('is false while loading, unconfigured, or with no plans', () => {
    expect(hasRenderablePricing(undefined)).toBe(false)
    expect(hasRenderablePricing({ configured: false, plans: [], trialDays: 0 })).toBe(false)
    expect(hasRenderablePricing(pricing([]))).toBe(false)
  })

  it('is true when at least one plan can be formatted', () => {
    expect(hasRenderablePricing(pricing([MONTHLY]))).toBe(true)
  })

  it('is false when the only plan has a currency Intl rejects', () => {
    expect(hasRenderablePricing(pricing([{ ...MONTHLY, currency: 'not-a-currency' }]))).toBe(false)
  })

  it('stays true when a formattable plan survives beside a rejected one', () => {
    const bad = { ...MONTHLY, planKey: 'bad', currency: 'not-a-currency' }
    expect(hasRenderablePricing(pricing([bad, MONTHLY]))).toBe(true)
  })
})

describe('formatPlanAmount', () => {
  it('formats in English regardless of the machine locale', () => {
    expect(formatPlanAmount(MONTHLY)).toBe('$49.00')
    expect(formatPlanAmount({ ...MONTHLY, currency: 'eur', amountMinor: 123456 })).toBe('€1,234.56')
  })

  it('reads ISK as the x100 form Stripe takes: 500 is 5 krona, not 500', () => {
    expect(formatPlanAmount({ ...MONTHLY, currency: 'isk', amountMinor: 500 })).toBe('ISK 5')
    expect(formatPlanAmount({ ...MONTHLY, currency: 'isk', amountMinor: 490000 })).toBe('ISK 4,900')
  })

  it('reads UGX as the x100 form Stripe takes: 500 is 5 shillings, not 500', () => {
    expect(formatPlanAmount({ ...MONTHLY, currency: 'ugx', amountMinor: 500 })).toBe('UGX 5')
  })

  it('keeps HUF and TWD on the ordinary two-decimal rule', () => {
    // Their divisible-by-100 rule is for payouts, not charges; do not widen the ISK/UGX case.
    expect(formatPlanAmount({ ...MONTHLY, currency: 'huf', amountMinor: 150050 })).toBe(
      'HUF 1,500.50',
    )
    expect(formatPlanAmount({ ...MONTHLY, currency: 'twd', amountMinor: 150050 })).toBe(
      'NT$1,500.50',
    )
  })

  it('reads JPY as already major: 500 is 500 yen, where 500 ISK-form is 5', () => {
    // Both show no decimals, but their divisors differ (1 vs 100).
    expect(formatPlanAmount({ ...MONTHLY, currency: 'jpy', amountMinor: 500 })).toBe('¥500')
    expect(formatPlanAmount({ ...MONTHLY, currency: 'isk', amountMinor: 500 })).toBe('ISK 5')
  })

  it('reads three-decimal currencies in thousandths', () => {
    expect(formatPlanAmount({ ...MONTHLY, currency: 'kwd', amountMinor: 4900 })).toBe('KWD 4.900')
  })

  it('uses two decimals for an ordinary currency', () => {
    expect(formatPlanAmount({ ...MONTHLY, currency: 'gbp', amountMinor: 1999 })).toBe('£19.99')
  })
})

const plan = (planKey: string, interval: 'month' | 'year', amountMinor: number): PublicPlan => ({
  ...MONTHLY,
  planKey,
  interval,
  amountMinor,
})

describe('tierOfPlan', () => {
  it('names the tier from the plan key, from the shared tier list', () => {
    expect(tierOfPlan(plan('starter_monthly', 'month', 1))).toMatchObject({ label: 'Starter' })
    expect(tierOfPlan(plan('business_yearly', 'year', 1))).toMatchObject({ limit: 50 })
  })

  it('is undefined for a tier the page has no name for', () => {
    expect(tierOfPlan(plan('enterprise_monthly', 'month', 1))).toBeUndefined()
    expect(tierOfPlan(plan('monthly', 'month', 1))).toBeUndefined()
  })
})

describe('renderablePlans', () => {
  it('drops a plan whose tier has no name, so nothing points at a section that is empty', () => {
    const unknown = plan('enterprise_monthly', 'month', 9900)
    expect(renderablePlans(pricing([unknown, MONTHLY]))).toEqual([MONTHLY])
    expect(hasRenderablePricing(pricing([unknown]))).toBe(false)
  })
})

describe('no cadence covers every tier', () => {
  const starterMonthly = plan('starter_monthly', 'month', 5900)
  const proYearly = plan('pro_yearly', 'year', 119000)

  it('is not renderable pricing, so the section, nav link and FAQ go together', () => {
    expect(hasRenderablePricing(pricing([starterMonthly, proYearly]))).toBe(false)
  })

  it('is renderable once one cadence covers both tiers', () => {
    const proMonthly = plan('pro_monthly', 'month', 11900)
    expect(hasRenderablePricing(pricing([starterMonthly, proYearly, proMonthly]))).toBe(true)
    expect(commonCadences([starterMonthly, proYearly, proMonthly])).toEqual([starterMonthly])
  })
})

describe('tierSaving', () => {
  const both = (tier: string, month: number, year: number): PublicPlan[] => [
    plan(`${tier}_monthly`, 'month', month),
    plan(`${tier}_yearly`, 'year', year),
  ]

  it('is the smallest per-tier saving, so the claim holds for every tier', () => {
    const plans = [
      ...both('starter', 5900, 53100), // 25%
      ...both('pro', 11900, 119000), // 16%
      ...both('business', 19900, 179100), // 25%
    ]
    expect(tierSaving(plans)).toBe(16)
  })

  it('is null when any tier has nothing to compare, rather than claiming for the rest', () => {
    const plans = [...both('starter', 5900, 59000), plan('pro_monthly', 'month', 11900)]
    expect(tierSaving(plans)).toBeNull()
  })

  it('is null when any tier is not cheaper yearly', () => {
    const plans = [...both('starter', 5900, 59000), ...both('pro', 11900, 200000)]
    expect(tierSaving(plans)).toBeNull()
  })

  it('is null for no plans', () => {
    expect(tierSaving([])).toBeNull()
  })
})

import { describe, expect, it } from 'vitest'

import type { PublicPlan, PublicPricing } from './api'
import { formatPlanAmount, hasRenderablePricing } from './renderable-pricing'

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

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
})

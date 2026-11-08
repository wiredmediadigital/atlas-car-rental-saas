import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getSupabaseClient } from '@/lib/supabase/client'

import { annualSaving, fetchPublicPricing, type PublicPlan } from './api'

vi.mock('@/lib/supabase/client', () => ({ getSupabaseClient: vi.fn() }))

const NO_PRICING = { configured: false, plans: [], trialDays: 0 }

function plan(overrides: Partial<PublicPlan>): PublicPlan {
  return {
    planKey: 'plan',
    amountMinor: 1000,
    currency: 'usd',
    interval: 'month',
    intervalCount: 1,
    ...overrides,
  }
}

const monthly = plan({ planKey: 'monthly', amountMinor: 1000, interval: 'month' })
const yearly = plan({ planKey: 'yearly', amountMinor: 10000, interval: 'year' })

describe('annualSaving', () => {
  it('does not lose an exact saving to float error', () => {
    // 12 x 1000 = 12000 against 10800 -> exactly 10%
    expect(annualSaving([monthly, { ...yearly, amountMinor: 10800 }])).toBe(10)
  })

  it('returns the percentage saved by paying yearly', () => {
    // 12 x 1000 = 12000 against 10000 -> 16.67% -> floored to 16, never rounded up to 17
    expect(annualSaving([monthly, yearly])).toBe(16)
  })

  it('does not depend on the order of the plans', () => {
    expect(annualSaving([yearly, monthly])).toBe(16)
  })

  it('returns null across different currencies', () => {
    expect(annualSaving([monthly, { ...yearly, currency: 'eur' }])).toBeNull()
  })

  it('compares currencies case-insensitively', () => {
    expect(annualSaving([monthly, { ...yearly, currency: 'USD' }])).toBe(16)
  })

  it('returns null when both plans bill monthly', () => {
    expect(annualSaving([monthly, { ...monthly, planKey: 'other' }])).toBeNull()
  })

  it('returns null with only one plan', () => {
    expect(annualSaving([monthly])).toBeNull()
    expect(annualSaving([])).toBeNull()
  })

  it('returns null when the yearly price is not actually cheaper', () => {
    expect(annualSaving([monthly, { ...yearly, amountMinor: 12000 }])).toBeNull()
    expect(annualSaving([monthly, { ...yearly, amountMinor: 15000 }])).toBeNull()
  })

  it('returns null when the cadences are not one month and one year', () => {
    expect(annualSaving([{ ...monthly, intervalCount: 3 }, yearly])).toBeNull()
    expect(annualSaving([monthly, { ...yearly, intervalCount: 2 }])).toBeNull()
  })

  it('returns null when the match is ambiguous', () => {
    expect(annualSaving([monthly, yearly, { ...yearly, planKey: 'yearly-2' }])).toBeNull()
  })

  it('returns null for a zero or non-finite amount', () => {
    expect(annualSaving([{ ...monthly, amountMinor: 0 }, yearly])).toBeNull()
    expect(annualSaving([monthly, { ...yearly, amountMinor: Number.NaN }])).toBeNull()
  })
})

describe('fetchPublicPricing', () => {
  const invoke = vi.fn()

  beforeEach(() => {
    invoke.mockReset()
    vi.mocked(getSupabaseClient).mockReturnValue({ functions: { invoke } } as never)
  })

  it('asks the pricing function with a GET', async () => {
    invoke.mockResolvedValue({ data: NO_PRICING, error: null })
    await fetchPublicPricing()
    expect(invoke).toHaveBeenCalledWith('pricing', { method: 'GET' })
  })

  it('returns a configured payload as received', async () => {
    const payload = { configured: true, plans: [monthly, yearly], trialDays: 14 }
    invoke.mockResolvedValue({ data: payload, error: null })
    expect(await fetchPublicPricing()).toEqual(payload)
  })

  it('keeps an empty configured catalogue configured', async () => {
    const payload = { configured: true, plans: [], trialDays: 7 }
    invoke.mockResolvedValue({ data: payload, error: null })
    expect(await fetchPublicPricing()).toEqual(payload)
  })

  it('passes the unconfigured answer through', async () => {
    invoke.mockResolvedValue({ data: NO_PRICING, error: null })
    expect(await fetchPublicPricing()).toEqual(NO_PRICING)
  })

  it('treats a failed call as no pricing rather than throwing', async () => {
    invoke.mockResolvedValue({ data: null, error: new Error('503') })
    expect(await fetchPublicPricing()).toEqual(NO_PRICING)
  })

  it('treats a network error as no pricing', async () => {
    invoke.mockRejectedValue(new TypeError('Failed to fetch'))
    expect(await fetchPublicPricing()).toEqual(NO_PRICING)
  })

  it('treats a client that cannot be built as no pricing', async () => {
    vi.mocked(getSupabaseClient).mockImplementation(() => {
      throw new Error('Supabase is not configured')
    })
    expect(await fetchPublicPricing()).toEqual(NO_PRICING)
  })

  it.each([
    ['null', null],
    ['a string', 'oops'],
    ['an empty object', {}],
    ['plans that is not an array', { configured: true, plans: 'x', trialDays: 0 }],
    ['a missing trialDays', { configured: true, plans: [] }],
    [
      'a plan missing its amount',
      { configured: true, plans: [{ ...monthly, amountMinor: undefined }], trialDays: 0 },
    ],
    [
      'a plan with a string amount',
      { configured: true, plans: [{ ...monthly, amountMinor: '1000' }], trialDays: 0 },
    ],
    [
      'a plan with an unknown interval',
      { configured: true, plans: [{ ...monthly, interval: 'week' }], trialDays: 0 },
    ],
    [
      'one good and one bad plan',
      { configured: true, plans: [monthly, { planKey: 1 }], trialDays: 0 },
    ],
  ])('treats a malformed body (%s) as no pricing', async (_label, data) => {
    invoke.mockResolvedValue({ data, error: null })
    expect(await fetchPublicPricing()).toEqual(NO_PRICING)
  })

  it('never reports plans when the answer says unconfigured', async () => {
    invoke.mockResolvedValue({
      data: { configured: false, plans: [monthly], trialDays: 0 },
      error: null,
    })
    expect(await fetchPublicPricing()).toEqual(NO_PRICING)
  })
})

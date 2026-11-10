import { VEHICLE_TIERS, tierKeyOfPlan } from '@/features/vehicles/limit'

import { annualSaving, type PublicPlan, type PublicPricing } from './api'

/*
 * The marketing page is English (`index.html` declares lang="en"), so amounts
 * are formatted with an explicit 'en': deterministic, and consistent with the
 * copy around them. The currency is always the plan's own.
 */
const LOCALE = 'en'

interface MinorUnits {
  /** What `unit_amount` is divided by to get the major amount. */
  readonly divisor: number
  /** Fraction digits shown. */
  readonly digits: number
}

/*
 * How Stripe's `unit_amount` maps to a displayed amount, per Stripe's
 * Supported Currencies documentation (checked 2026-11-08). This is an API
 * contract, so it is a table here and NOT derived from
 * `Intl.NumberFormat().resolvedOptions()`: ICU's currency digits are a
 * typographic convention that differs from Stripe's rule and varies by ICU
 * version (this repo's Node reports 0 decimals for HUF, which would show a
 * 1,500.50 price as 150,050 -- 100x too high). Do not "simplify" this to
 * resolvedOptions(); that is the bug this table exists to prevent.
 *
 *  - Zero-decimal: unit_amount already is the major amount (500 is JPY 500).
 *  - ISK, UGX: zero-decimal in practice but carried by Stripe x100
 *    ("to charge 5 UGX, provide an amount value of 500"; ISK enforced the
 *    same way since 14 April 2023). So divide by 100, show no decimals.
 *  - Three-decimal (BHD JOD KWD OMR TND): unit_amount is in thousandths.
 *  - Everything else, including HUF and TWD (their divisible-by-100 rule is
 *    for manual payouts, not charges): divide by 100, two decimals.
 */
const ZERO_DECIMAL = new Set([
  'BIF',
  'CLP',
  'DJF',
  'GNF',
  'JPY',
  'KMF',
  'KRW',
  'MGA',
  'PYG',
  'RWF',
  'VND',
  'VUV',
  'XAF',
  'XOF',
  'XPF',
])
const STRIPE_X100_ZERO_DECIMAL = new Set(['ISK', 'UGX'])
const THREE_DECIMAL = new Set(['BHD', 'JOD', 'KWD', 'OMR', 'TND'])

function minorUnits(currency: string): MinorUnits {
  if (ZERO_DECIMAL.has(currency)) return { divisor: 1, digits: 0 }
  if (STRIPE_X100_ZERO_DECIMAL.has(currency)) return { divisor: 100, digits: 0 }
  if (THREE_DECIMAL.has(currency)) return { divisor: 1000, digits: 3 }
  return { divisor: 100, digits: 2 }
}

/** The display amount, or `null` when Intl does not recognise the currency code. */
export function formatPlanAmount(plan: PublicPlan): string | null {
  const currency = plan.currency.toUpperCase()
  const { divisor, digits } = minorUnits(currency)
  try {
    // Intl formats the symbol and grouping and rejects unknown codes; the
    // scale is ours, passed explicitly.
    return new Intl.NumberFormat(LOCALE, {
      style: 'currency',
      currency,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(plan.amountMinor / divisor)
  } catch {
    // An unknown currency code: better no price than a wrong one.
    return null
  }
}

/**
 * The tier a plan sells, from the plan key. The name and the vehicle allowance
 * are page copy read from `VEHICLE_TIERS` (the constant the Vehicles and Billing
 * pages use, pinned to `plan_vehicle_limits` by a database test), not payload
 * fields. `undefined` for a tier the page has no name for.
 */
export function tierOfPlan(plan: PublicPlan) {
  const key = tierKeyOfPlan(plan.planKey)
  return VEHICLE_TIERS.find((tier) => tier.key === key)
}

/**
 * The plans that can be shown truthfully; the rest are dropped, never guessed.
 * A plan is shown only if its price formats AND its tier has a name: a card
 * with a price and no name would be a guess about what is being sold.
 */
export function renderablePlans(pricing: PublicPricing | undefined): PublicPlan[] {
  if (!pricing) return []
  return pricing.plans.filter(
    (plan) => formatPlanAmount(plan) !== null && tierOfPlan(plan) !== undefined,
  )
}

/**
 * The yearly saving that holds for every tier: the smallest per-tier figure. It
 * is `null` as soon as any tier cannot be compared (no yearly price, a different
 * currency, not cheaper), because a claim made for the tiers that can be compared
 * would silently cover the one that cannot.
 */
export function tierSaving(plans: readonly PublicPlan[]): number | null {
  const byTier = new Map<string, PublicPlan[]>()
  for (const plan of plans) {
    const key = tierKeyOfPlan(plan.planKey)
    byTier.set(key, [...(byTier.get(key) ?? []), plan])
  }
  if (byTier.size === 0) return null

  const savings = [...byTier.values()].map((group) => annualSaving(group))
  if (savings.some((saving) => saving === null)) return null
  return Math.min(...(savings as number[]))
}

/** What a visitor picks between: a plan's interval and count. */
export function cadenceKey(plan: PublicPlan): string {
  return `${plan.interval}:${plan.intervalCount}`
}

/**
 * One plan per cadence that EVERY tier on the page has, in the order the payload
 * first shows them. A cadence some tier lacks is never offered: choosing it would
 * make that tier's card vanish, and falling back to that tier's own cadence would
 * put "$59 per month" beside "$1,190 per year", a comparison that is not like for
 * like. When no cadence covers every tier there is nothing true to show.
 */
export function commonCadences(plans: readonly PublicPlan[]): PublicPlan[] {
  const tiers = new Set(plans.map((plan) => tierOfPlan(plan)?.key))
  const seen = new Set<string>()
  return plans.filter((plan) => {
    const key = cadenceKey(plan)
    if (seen.has(key)) return false
    seen.add(key)
    const covered = new Set(
      plans.filter((p) => cadenceKey(p) === key).map((p) => tierOfPlan(p)?.key),
    )
    return covered.size === tiers.size
  })
}

/**
 * The single definition of "there is a pricing section to show". The section
 * renders on exactly this condition, and so do the nav link and the FAQ entry
 * (both call this) -- never `plans.length`, which can be non-zero while the
 * section renders nothing. It requires a cadence that covers every tier: a page
 * with no pricing is honest, a ladder with a missing rung is not.
 */
export function hasRenderablePricing(pricing: PublicPricing | undefined): boolean {
  return commonCadences(renderablePlans(pricing)).length > 0
}

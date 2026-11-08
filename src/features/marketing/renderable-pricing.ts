import type { PublicPlan, PublicPricing } from './api'

/*
 * The marketing page is English (`index.html` declares lang="en"), so amounts
 * are formatted with an explicit 'en': deterministic, and consistent with the
 * copy around them. The currency is always the plan's own.
 */
const LOCALE = 'en'

/*
 * ISK and UGX are the exception to "Intl knows the minor unit". Intl reports
 * zero decimals for both, but Stripe's API takes them in a x100 form: per
 * Stripe's Supported Currencies documentation, "to charge 5 UGX, provide an
 * amount value of 500", and ISK has been enforced the same way since
 * 14 April 2023 (charged amounts are evenly divisible by 100). Dividing by
 * Intl's exponent of 0 would show 500 for a 5 ISK price, a hundred times too
 * high. So these two divide by 100 and display as whole numbers.
 *
 * HUF and TWD are NOT in that group: their divisible-by-100 rule applies to
 * manual payouts, not charges, and Stripe charges them in the ordinary
 * two-decimal minor unit. But Intl cannot be trusted to say so: the ICU
 * bundled with this Node reports 0 decimals for HUF (it varies by ICU
 * version), which would show 150050 for a 1,500.50 price, again 100x too
 * high. So both are pinned to two decimals explicitly rather than inherited.
 * Do not widen the ISK/UGX case to them, and do not "simplify" any of this
 * away; it contradicts Intl on purpose.
 */
const STRIPE_X100_ZERO_DECIMAL = new Set(['ISK', 'UGX'])
const STRIPE_TWO_DECIMAL = new Set(['HUF', 'TWD'])
const X100_DIVISOR = 100

/** The display amount, or `null` when Intl cannot format this plan's currency. */
export function formatPlanAmount(plan: PublicPlan): string | null {
  const currency = plan.currency.toUpperCase()
  try {
    if (STRIPE_X100_ZERO_DECIMAL.has(currency)) {
      return new Intl.NumberFormat(LOCALE, {
        style: 'currency',
        currency,
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      }).format(plan.amountMinor / X100_DIVISOR)
    }
    if (STRIPE_TWO_DECIMAL.has(currency)) {
      return new Intl.NumberFormat(LOCALE, {
        style: 'currency',
        currency,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(plan.amountMinor / X100_DIVISOR)
    }
    const formatter = new Intl.NumberFormat(LOCALE, { style: 'currency', currency })
    const { maximumFractionDigits } = formatter.resolvedOptions()
    return formatter.format(plan.amountMinor / 10 ** (maximumFractionDigits ?? 2))
  } catch {
    // An unknown currency code: better no price than a wrong one.
    return null
  }
}

/** The plans that can be shown truthfully; the rest are dropped, never guessed. */
export function renderablePlans(pricing: PublicPricing | undefined): PublicPlan[] {
  if (!pricing) return []
  return pricing.plans.filter((plan) => formatPlanAmount(plan) !== null)
}

/**
 * The single definition of "there is a pricing section to show". The section
 * renders on exactly this condition, and so must anything that points at it
 * (nav link, FAQ entry) — never `plans.length`, which can be non-zero while
 * the section renders nothing.
 */
export function hasRenderablePricing(pricing: PublicPricing | undefined): boolean {
  return renderablePlans(pricing).length > 0
}

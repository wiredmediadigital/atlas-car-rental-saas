import type { PublicPlan, PublicPricing } from './api'

/*
 * The marketing page is English (`index.html` declares lang="en"), so amounts
 * are formatted with an explicit 'en': deterministic, and consistent with the
 * copy around them. The currency is always the plan's own.
 */
const LOCALE = 'en'

/** The display amount, or `null` when Intl cannot format this plan's currency. */
export function formatPlanAmount(plan: PublicPlan): string | null {
  try {
    const formatter = new Intl.NumberFormat(LOCALE, {
      style: 'currency',
      currency: plan.currency.toUpperCase(),
    })
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

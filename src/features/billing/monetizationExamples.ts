/**
 * Example pricing, for somebody deciding how to sell this product.
 *
 * READ THIS BEFORE USING ANYTHING IN THIS FILE.
 *
 * These are illustrations. They are not Stripe Products, not Stripe Prices, not
 * a subscription, not an entitlement, and not a limit. Nothing here authorizes
 * anything, charges anything, or restricts anything. This build is fully
 * unlocked, and it stays that way whatever these cards say.
 *
 * WHY THE NAMES ARE THIS LONG. There are two catalogues in this module and they
 * must never be confused:
 *
 *   `MONETIZATION_EXAMPLES` (this file)  presentation only. Lives in the browser
 *                                        bundle, because it decides nothing. A
 *                                        `$99` here is a picture of a price.
 *
 *   `public.billing_plans` (the database) server-authoritative. The only thing a
 *                                        Checkout Session can be created from.
 *                                        Populated by the billing service from
 *                                        Stripe, never by this file, and empty
 *                                        in this deployment.
 *
 * The trust boundary between them is the whole point. A browser sends a PLAN KEY
 * and the server turns it into a Stripe price by looking it up in
 * `billing_plans`. The keys below are deliberately absent from that table, so
 * sending one produces `plan_unavailable` — a test asserts exactly that. There is
 * no code path from these numbers to a charge.
 *
 * The tiers are likewise a suggestion, and they differ by fleet size only: the
 * product sells every module at every tier, so nothing here is a feature ladder.
 * Nothing is enforced by this file; every module is available to every role that
 * its own permission allows. If the person who receives this project wants other
 * tiers, or one, or none, they change this file and nothing else breaks.
 */

import { VEHICLE_TIERS } from '@/features/billing/tiers'

/** A tier's billing period, for the preview toggle only. */
export type ExampleInterval = 'monthly' | 'yearly'

/**
 * One illustrative tier.
 *
 * Deliberately NOT shaped like `BillingPlanRow`, the server's sellable plan. No
 * `stripe_price_id`, no `plan_key`, no `currency` domain type, no `amount_minor`
 * — because a type that looked like the real one could be passed somewhere that
 * expects the real one. Amounts here are whole units of display currency and are
 * only ever formatted.
 */
export interface MonetizationExample {
  /** An identifier for React keys and tests. Never sent to a server. */
  readonly id: 'starter' | 'pro' | 'business'
  readonly name: string
  /** Who the tier is pitched at, in one line. */
  readonly audience: string
  readonly monthlyAmount: number
  readonly yearlyAmount: number
  /** ISO 4217, for formatting. Not the currency of any subscription. */
  readonly displayCurrency: 'USD'
  /**
   * What a tier says it covers: the vehicle allowance, then the statement that
   * every module is included. NOT ENFORCED HERE — see the module comment.
   */
  readonly includes: readonly string[]
  /**
   * A restrained note on one tier. Deliberately "Suggested" rather than "Most
   * popular": nothing has been sold yet, so there is no popularity to report.
   */
  readonly isSuggested?: boolean
}

/**
 * The vehicle allowance, read from the same constant the Vehicles page and the
 * pricing page use so a tier's number is written once.
 */
function allowance(key: MonetizationExample['id']): string {
  const tier = VEHICLE_TIERS.find((candidate) => candidate.key === key)
  // Unreachable for the three ids; if a tier is ever renamed, say something true
  // rather than print "undefined".
  return tier ? `Up to ${tier.limit} vehicles` : 'Sized by fleet'
}

/*
 * The tiers differ in fleet size and nothing else: every module is in every
 * tier. A list that handed features out by tier would tell an operator that
 * Reports or GPS are locked behind a bigger plan, which is false.
 */
export const MONETIZATION_EXAMPLES: readonly MonetizationExample[] = [
  {
    id: 'starter',
    name: 'Starter',
    audience: 'For small fleets',
    monthlyAmount: 59,
    yearlyAmount: 590,
    displayCurrency: 'USD',
    includes: [allowance('starter'), 'Every module included', 'Same features as every other tier'],
  },
  {
    id: 'pro',
    name: 'Pro',
    audience: 'For growing fleets',
    monthlyAmount: 119,
    yearlyAmount: 1190,
    displayCurrency: 'USD',
    includes: [allowance('pro'), 'Every module included', 'Same features as every other tier'],
    isSuggested: true,
  },
  {
    id: 'business',
    name: 'Business',
    audience: 'For larger fleets',
    monthlyAmount: 199,
    yearlyAmount: 1990,
    displayCurrency: 'USD',
    includes: [allowance('business'), 'Every module included', 'Same features as every other tier'],
  },
]

/** The amount to show for a tier at the selected interval. */
export function exampleAmount(plan: MonetizationExample, interval: ExampleInterval): number {
  return interval === 'monthly' ? plan.monthlyAmount : plan.yearlyAmount
}

/** "per month" / "per year", for the price line. */
export function exampleIntervalPhrase(interval: ExampleInterval): string {
  return interval === 'monthly' ? 'per month' : 'per year'
}

/**
 * Formats an example amount.
 *
 * Whole units, because these are round illustrative figures and "$49.00" reads
 * like an invoice. Real subscription amounts are minor units and go through
 * formatMoney, which is a different function for a different kind of number.
 */
export function formatExampleAmount(
  plan: MonetizationExample,
  interval: ExampleInterval,
  locale: string,
): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: plan.displayCurrency,
    maximumFractionDigits: 0,
  }).format(exampleAmount(plan, interval))
}

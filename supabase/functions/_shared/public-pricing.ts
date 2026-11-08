/**
 * The public pricing payload, and the rule for when the mirrored catalogue is
 * too old to serve.
 *
 * The public pricing function reads `billing_plans` and answers the marketing
 * page with what Stripe last said. Both decisions here decide what a visitor
 * sees, so they are pure and tested: how stale the rows may be, and which rows
 * are shown. Nothing in this module talks to Supabase or Stripe.
 */

/** The subset of `billing_plans` this module reads. */
export interface PlanRow {
  plan_key: string
  currency: string
  amount_minor: number
  interval: 'month' | 'year'
  interval_count: number
  is_active: boolean
  sort_order: number
  updated_at: string
}

/**
 * One sellable plan as the browser receives it. There is deliberately no display
 * name: the card heading is page copy, and Stripe's nickname would be a second
 * place a product name could disagree with the page.
 */
export interface PublicPlan {
  planKey: string
  amountMinor: number
  currency: string
  interval: 'month' | 'year'
  intervalCount: number
}

export interface PublicPricing {
  configured: boolean
  plans: PublicPlan[]
  trialDays: number
}

/** How long mirrored prices may be served before the catalogue is refreshed. */
export const PRICING_TTL_SECONDS = 600

const MILLISECONDS_PER_SECOND = 1000

/**
 * Whether the newest mirrored row is too old to serve.
 *
 * `null` means nothing has ever been written. An unparseable timestamp is also
 * treated as stale: the comparison is written so that NaN fails the freshness
 * test, rather than silently passing as fresh.
 */
export function isStale(
  newestUpdatedAt: string | null,
  now: Date,
  ttlSeconds: number = PRICING_TTL_SECONDS,
): boolean {
  if (newestUpdatedAt === null) return true
  const ageMilliseconds = now.getTime() - Date.parse(newestUpdatedAt)
  return !(ageMilliseconds <= ttlSeconds * MILLISECONDS_PER_SECOND)
}

/**
 * Shapes mirrored rows into the public payload.
 *
 * Inactive rows are dropped and the rest are ordered by `sort_order`. The
 * interval is the one Stripe reported, never one inferred from the plan key.
 * With no rows at all the catalogue has never been mirrored, so the payload is
 * not configured; with rows but none active it is configured and empty.
 */
export function toPublicPricing(rows: readonly PlanRow[], trialDays: number): PublicPricing {
  const plans = rows
    .filter((row) => row.is_active)
    .toSorted((a, b) => a.sort_order - b.sort_order)
    .map(
      (row): PublicPlan => ({
        planKey: row.plan_key,
        amountMinor: row.amount_minor,
        currency: row.currency,
        interval: row.interval,
        intervalCount: row.interval_count,
      }),
    )

  return { configured: rows.length > 0, plans, trialDays }
}

/** The answer when no pricing is configured. A normal state, not a fault. */
export const UNCONFIGURED: PublicPricing = { configured: false, plans: [], trialDays: 0 }

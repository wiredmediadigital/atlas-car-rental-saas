import { getSupabaseClient } from '@/lib/supabase/client'

/*
 * `PublicPlan` and `PublicPricing` are declared a second time on purpose: the
 * Edge Functions (Deno) and this app (Vite) share no module graph, and importing
 * from `supabase/functions/` would pull Deno-targeted code into the browser
 * bundle. The mirror of `supabase/functions/_shared/public-pricing.ts` is pinned
 * by the tests in `pricing.test.ts`, not by an import.
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

const FUNCTION = 'pricing'
const MONTHS_PER_YEAR = 12

function noPricing(): PublicPricing {
  return { configured: false, plans: [], trialDays: 0 }
}

function isPlan(value: unknown): value is PublicPlan {
  if (typeof value !== 'object' || value === null) return false
  const plan = value as Record<string, unknown>
  return (
    typeof plan.planKey === 'string' &&
    typeof plan.amountMinor === 'number' &&
    Number.isFinite(plan.amountMinor) &&
    typeof plan.currency === 'string' &&
    (plan.interval === 'month' || plan.interval === 'year') &&
    typeof plan.intervalCount === 'number' &&
    Number.isFinite(plan.intervalCount)
  )
}

/**
 * Accepts only a payload that is wholly well-formed. One bad plan voids the
 * lot: a partial list could present a price without the plan it was weighed
 * against, and a page must not show a price it did not receive intact.
 */
function parsePricing(data: unknown): PublicPricing {
  if (typeof data !== 'object' || data === null) return noPricing()
  const body = data as Record<string, unknown>

  if (body.configured !== true) return noPricing()
  if (!Array.isArray(body.plans) || !body.plans.every(isPlan)) return noPricing()
  if (typeof body.trialDays !== 'number' || !Number.isFinite(body.trialDays)) return noPricing()

  return { configured: true, plans: body.plans, trialDays: body.trialDays }
}

/**
 * The public price list, or "no pricing".
 *
 * Every failure (a 503, a network error, a malformed body, the function not
 * being deployed) resolves to the unconfigured-shaped value so the page renders
 * nothing. It never throws and never invents a figure.
 */
export async function fetchPublicPricing(): Promise<PublicPricing> {
  try {
    const result = await getSupabaseClient().functions.invoke<unknown>(FUNCTION, {
      method: 'GET',
    })
    if (result.error) return noPricing()
    return parsePricing(result.data)
  } catch {
    return noPricing()
  }
}

/**
 * The whole-number percentage saved by paying yearly instead of monthly, or
 * `null` whenever the two prices are not directly comparable: not exactly one
 * every-month plan and one every-year plan, different currencies, or a yearly
 * price that is not actually lower. A percentage across currencies would be a
 * fabricated number, so there is no fallback.
 */
export function annualSaving(plans: readonly PublicPlan[]): number | null {
  const monthly = plans.filter((p) => p.interval === 'month' && p.intervalCount === 1)
  const yearly = plans.filter((p) => p.interval === 'year' && p.intervalCount === 1)
  if (monthly.length !== 1 || yearly.length !== 1) return null

  const month = monthly[0]
  const year = yearly[0]
  if (!month || !year) return null
  if (month.currency.toLowerCase() !== year.currency.toLowerCase()) return null
  if (!(month.amountMinor > 0) || !(year.amountMinor > 0)) return null
  if (!Number.isFinite(month.amountMinor) || !Number.isFinite(year.amountMinor)) return null

  const payingMonthly = month.amountMinor * MONTHS_PER_YEAR
  const percent = Math.round((1 - year.amountMinor / payingMonthly) * 100)

  return percent > 0 ? percent : null
}

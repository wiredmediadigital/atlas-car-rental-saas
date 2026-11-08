/**
 * Refreshing the sellable catalogue from Stripe.
 *
 * Shared by the authenticated `billing` function and the public `pricing`
 * function, so there is one set of skip rules and not two that drift. It lives
 * here, and not in an `index.ts`, because an entrypoint is outside tsconfig and
 * no test can reach it.
 *
 * The Supabase client is described by the one shape this module uses rather than
 * imported: an `npm:` or `jsr:` specifier resolves in Deno and not in Vitest,
 * and a real SupabaseClient satisfies this structurally.
 */

import type { StripeClient } from './stripe-api.ts'
import type { BillingConfig } from './stripe-config.ts'

/** The part of a Supabase client the refresh writes through. */
export interface CatalogueStore {
  schema(name: 'app'): {
    rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown }>
  }
}

export interface StripePriceShape {
  id: string
  active?: boolean
  currency?: string
  unit_amount?: number | null
  livemode?: boolean
  lookup_key?: string | null
  product?: string | { id?: string }
  nickname?: string | null
  recurring?: { interval?: string; interval_count?: number } | null
}

/**
 * One Stripe price as a billing_plans row, or null when it must not be sold.
 *
 * A price that is archived at Stripe, that belongs to the other mode, that is
 * not recurring, or that carries no amount is dropped rather than sold.
 */
export function priceToPlanRow(
  price: StripePriceShape,
  planKey: string,
  sortOrder: number,
  mode: 'test' | 'live',
): Record<string, unknown> | null {
  if (price.active === false) return null
  if (!price.recurring?.interval) return null
  if ((price.livemode === true ? 'live' : 'test') !== mode) return null
  if (typeof price.unit_amount !== 'number' || typeof price.currency !== 'string') return null

  /*
   * A Stripe nickname is free text of any length, and the display_name column
   * accepts 1..80 characters. An empty or over-long nickname would fail the
   * whole catalogue refresh — and therefore the Billing page — for every plan,
   * so it falls back to the plan key rather than taking the deployment down.
   */
  const nickname = (price.nickname ?? '').trim()
  const displayName = nickname.length >= 1 && nickname.length <= 80 ? nickname : planKey

  return {
    plan_key: planKey,
    display_name: displayName,
    stripe_price_id: price.id,
    stripe_product_id: typeof price.product === 'string' ? price.product : (price.product?.id ?? null),
    lookup_key: price.lookup_key ?? null,
    currency: price.currency.toUpperCase(),
    amount_minor: price.unit_amount,
    interval: price.recurring.interval,
    interval_count: price.recurring.interval_count ?? 1,
    mode,
    sort_order: sortOrder,
  }
}

/**
 * Refreshes the sellable catalogue from Stripe.
 *
 * The configured entries name a price or a lookup key; the money is read from
 * Stripe and never from configuration, so nobody can publish a plan that says
 * one amount here and charges another there. A price that is archived at
 * Stripe, or that belongs to the other mode, is dropped rather than sold.
 */
export async function refreshCatalogue(
  service: CatalogueStore,
  stripe: StripeClient,
  config: BillingConfig,
): Promise<number> {
  const plans: Record<string, unknown>[] = []

  for (const [index, entry] of config.catalogue.entries()) {
    let price: StripePriceShape

    if (entry.priceId !== undefined) {
      price = await stripe.request('GET', `/prices/${entry.priceId}`)
    } else {
      const found = await stripe.request<{ data?: StripePriceShape[] }>('GET', '/prices', {
        lookup_keys: [entry.lookupKey!],
        active: true,
        limit: 1,
      })
      const first = found.data?.[0]
      if (!first) continue
      price = first
    }

    const row = priceToPlanRow(price, entry.planKey, index, config.mode)
    if (row !== null) plans.push(row)
  }

  const { data } = await service.schema('app').rpc('billing_replace_catalogue', { p_plans: plans })
  return typeof data === 'number' ? data : plans.length
}

/**
 * The public pricing boundary.
 *
 * Serves the marketing page the prices Stripe last reported, to visitors who are
 * not signed in. It composes tested modules and decides nothing itself, with one
 * exception that belongs here because only this boundary knows the answer:
 * `configured`. The shaping module derives it from the row count, which would
 * call a configured deployment whose every price was archived "not configured".
 * Here, configuration present means `configured: true`, however many rows remain.
 *
 * Missing configuration is a state, not a fault: it is answered with HTTP 200 and
 * `UNCONFIGURED`, and Stripe is never contacted.
 *
 * The table is read with the service role, so the browser never touches it and no
 * row-level security changes. The response carries only what a landing page
 * renders: no key, no webhook secret, no app URL, no Stripe identifier.
 *
 * NOTHING HERE LOGS A KEY OR A STRIPE RESPONSE BODY.
 */

import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2'

import { refreshCatalogue } from '../_shared/billing-catalogue.ts'
import {
  isStale,
  newestUpdatedAt,
  toPublicPricing,
  UNCONFIGURED,
  type PlanRow,
  type PublicPricing,
} from '../_shared/public-pricing.ts'
import { StripeClient } from '../_shared/stripe-api.ts'
import { resolveBillingConfig } from '../_shared/stripe-config.ts'

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
}

const CACHE_CONTROL = 'public, max-age=60'

function json(body: unknown, status = 200, cacheable = false): Response {
  const headers: Record<string, string> = { ...CORS_HEADERS, 'Content-Type': 'application/json' }
  if (cacheable) headers['Cache-Control'] = CACHE_CONTROL
  return new Response(JSON.stringify(body), { status, headers })
}

/** Every mirrored row, in display order, or null if the read itself failed. */
async function readPlans(service: SupabaseClient): Promise<PlanRow[] | null> {
  const { data, error } = await service
    .from('billing_plans')
    .select('*')
    .order('sort_order', { ascending: true })
  return error ? null : ((data ?? []) as PlanRow[])
}

/**
 * Whether this instance has already tried to bootstrap an empty catalogue.
 *
 * With no rows, `isStale(null)` is always true, so without this every anonymous
 * request on a deployment whose prices are all archived (or never mirrored)
 * would call Stripe: an unbounded public path to the payment API. This lets the
 * zero-rows case attempt a refresh once per function instance, which bounds
 * Stripe calls by the number of live instances rather than the number of
 * requests, while a cold instance can still populate a never-mirrored table.
 * The ordinary case (rows exist, TTL expired) is unaffected. Do not remove it
 * as a micro-optimisation.
 */
let hasAttemptedEmptyRefresh = false

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })
  if (request.method !== 'GET') return json({ error: 'Use GET.' }, 405)

  const resolved = resolveBillingConfig(Deno.env.toObject())
  /*
   * Invalid configuration is answered exactly like missing configuration: 200
   * and UNCONFIGURED. An anonymous caller must not learn that this deployment's
   * catalogue JSON or keys are malformed. The cost is that an operator with a
   * typo sees the same silence as one who never configured anything; the real
   * diagnosis is in the authenticated billing `status` action, which answers
   * with the specific problem for owners.
   */
  if (!resolved.ok) return json(UNCONFIGURED satisfies PublicPricing, 200, true)
  const config = resolved.config

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  if (supabaseUrl === '' || serviceKey === '') {
    return json({ error: 'Pricing is unavailable right now.' }, 503)
  }

  const service = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  let rows = await readPlans(service)
  if (rows === null) return json({ error: 'Pricing is unavailable right now.' }, 503)

  const isEmpty = rows.length === 0
  const mayRefresh = !isEmpty || !hasAttemptedEmptyRefresh
  if (mayRefresh && isStale(newestUpdatedAt(rows), new Date())) {
    if (isEmpty) hasAttemptedEmptyRefresh = true
    try {
      await refreshCatalogue(
        service,
        new StripeClient({ secretKey: config.secretKey, mode: config.mode }),
        config,
      )
      rows = (await readPlans(service)) ?? rows
    } catch {
      // Stale but real beats nothing: serve whatever is already mirrored.
      console.error('pricing: catalogue refresh failed')
    }
  }

  // The ruling: configuration is present, so this is configured whatever resolved.
  const pricing: PublicPricing = { ...toPublicPricing(rows, config.trialDays), configured: true }
  return json(pricing, 200, true)
})

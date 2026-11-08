/**
 * The public pricing boundary.
 *
 * Serves the marketing page the prices Stripe last reported, to visitors who are
 * not signed in. This file is a Deno shim and decides nothing: it dispatches on
 * the method, builds the effects (Supabase read, Stripe refresh, logging) and
 * hands them to `servePricing` in `_shared/public-pricing.ts`, where the test
 * suite can reach every decision: the `configured` ruling, the refresh gate and
 * both 503 cases. An entrypoint is outside tsconfig and no test can reach it, so
 * keep it that way: a new branch here is a branch nothing checks.
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
  createRefreshGate,
  servePricing,
  type PlanRow,
  type PricingDecision,
} from '../_shared/public-pricing.ts'
import { StripeClient } from '../_shared/stripe-api.ts'
import { resolveBillingConfig } from '../_shared/stripe-config.ts'

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
}

const CACHE_CONTROL = 'public, max-age=60'

function respond(decision: PricingDecision): Response {
  const headers: Record<string, string> = { ...CORS_HEADERS, 'Content-Type': 'application/json' }
  if (decision.status === 200) headers['Cache-Control'] = CACHE_CONTROL
  return new Response(JSON.stringify(decision.body), { status: decision.status, headers })
}

/** Every mirrored row, in display order, or null if the read itself failed. */
async function readPlans(service: SupabaseClient): Promise<PlanRow[] | null> {
  const { data, error } = await service
    .from('billing_plans')
    .select('*')
    .order('sort_order', { ascending: true })
  return error ? null : ((data ?? []) as PlanRow[])
}

/** This instance's refresh memory; see `RefreshGate`. Do not remove it. */
const gate = createRefreshGate()

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })
  if (request.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Use GET.' }), {
      status: 405,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }

  const resolved = resolveBillingConfig(Deno.env.toObject())
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  const config = resolved.ok ? resolved.config : null

  // Created lazily: with no configuration or no credentials it is never built.
  let service: SupabaseClient | null = null
  const getService = (): SupabaseClient => {
    service ??= createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    return service
  }

  const decision = await servePricing({
    config: config === null ? null : { trialDays: config.trialDays },
    hasPlatformCredentials: supabaseUrl !== '' && serviceKey !== '',
    readPlans: () => readPlans(getService()),
    refresh: () =>
      refreshCatalogue(
        getService(),
        new StripeClient({ secretKey: config!.secretKey, mode: config!.mode }),
        config!,
      ),
    gate,
    nowMs: Date.now(),
    logError: (message) => console.error(message),
  })
  return respond(decision)
})

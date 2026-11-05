import { type SupabaseClient, createClient } from '@supabase/supabase-js'

import type { Database } from '@/types/database'

import { PRODUCT_BRAND } from '../config/brand'
import { getEnvironment } from '../config/env'

export class SupabaseNotConfiguredError extends Error {
  constructor() {
    super('Supabase is not configured. See .env.example.')
    this.name = 'SupabaseNotConfiguredError'
  }
}

let client: SupabaseClient<Database> | null = null

/**
 * How this app identifies itself in Supabase's request logs.
 *
 * Derived from the product name rather than written out, because the literal
 * that used to sit here named a product this one had already stopped being —
 * the same drift that left every exported report downloading as `atlas-...`
 * long after the rename. A log label nobody reads is exactly the kind of
 * string that goes stale unnoticed.
 *
 * Slugged because a header value must be a valid HTTP token, and a product
 * name is free text: `fullName` alone contains an em dash and spaces.
 */
export function clientInfoHeader(): string {
  const slug = PRODUCT_BRAND.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `${slug || 'app'}-web`
}

export function isSupabaseConfigured(): boolean {
  return getEnvironment().status === 'ok'
}

/**
 * The single Supabase client for the application.
 *
 * Constructed lazily so that an unconfigured deployment renders an explanatory
 * screen instead of crashing at module-evaluation time before React mounts.
 */
export function getSupabaseClient(): SupabaseClient<Database> {
  if (client) return client

  const result = getEnvironment()
  if (result.status !== 'ok') throw new SupabaseNotConfiguredError()

  client = createClient<Database>(result.env.supabaseUrl, result.env.supabasePublishableKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      // Required so email confirmation and password recovery links establish a
      // session when the user lands back on the app.
      detectSessionInUrl: true,
      // PKCE keeps the authorization code exchange safe in a public client and
      // avoids leaving tokens in the URL fragment.
      flowType: 'pkce',
      /*
       * NOT derived from the product name, and not to be renamed.
       *
       * This is the localStorage key holding the signed-in session. Changing
       * it does not migrate anything: the SDK simply looks for a key that is
       * not there, and every person currently signed in is silently logged
       * out on the next deploy. The old name is the price of not doing that
       * to people.
       */
      storageKey: 'atlas.auth.session',
    },
    global: {
      headers: { 'x-client-info': clientInfoHeader() },
    },
  })

  return client
}

/** For tests: drops the memoised client so a new environment takes effect. */
export function resetSupabaseClient(): void {
  client = null
}

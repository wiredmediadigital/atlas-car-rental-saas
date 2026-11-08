/**
 * What the billing service needs before it can talk to Stripe, and what it does
 * when that is missing.
 *
 * MISSING CONFIGURATION IS A STATE, NOT A FAULT.
 *
 * This deployment has no Stripe credentials. That is the expected condition
 * today, and it must produce a calm, named outcome — `billing_not_configured` —
 * rather than an exception, a half-written row, or a message implying Stripe is
 * having an outage. Every entry point asks this module first.
 *
 * MODE IS CHECKED, NOT ASSUMED.
 *
 * Mixing a test secret key with live prices, or a live key with a test webhook
 * secret, produces failures hours later in someone else's dashboard. Stripe's
 * key prefixes state the mode plainly, so it is checked at the door and the
 * mismatch is reported as a configuration error with no request made.
 */

export type StripeMode = 'test' | 'live'

export interface BillingConfig {
  readonly secretKey: string
  readonly webhookSecret: string | null
  readonly appUrl: string
  readonly mode: StripeMode
  /** Plan keys the deployment is willing to sell, mapped to Stripe prices. */
  readonly catalogue: readonly CatalogueEntry[]
  /**
   * Free days before the first charge, or 0 for none.
   *
   * Deliberately a deployment setting rather than a property of a Stripe price.
   * A default trial configured on the price would apply to EVERY checkout that
   * names it, including a second one after a cancellation, and Stripe does not
   * deduplicate trials per customer. Who is offered a trial is a commercial
   * decision, so it is made here, in code that can see the agency's history.
   */
  readonly trialDays: number
}

export interface CatalogueEntry {
  readonly planKey: string
  /** Either a price id or a lookup key; exactly one is resolved at startup. */
  readonly priceId?: string
  readonly lookupKey?: string
}

export type ConfigProblem =
  | 'missing_secret_key'
  | 'invalid_secret_key'
  | 'missing_app_url'
  | 'invalid_app_url'
  | 'missing_webhook_secret'
  | 'invalid_webhook_secret'
  | 'mode_mismatch'
  | 'invalid_catalogue'
  | 'empty_catalogue'
  | 'invalid_trial_days'

export type ConfigResult =
  | { readonly ok: true; readonly config: BillingConfig }
  | { readonly ok: false; readonly problem: ConfigProblem; readonly detail: string }

/** The names this deployment reads. Documented in README.md and .env.example. */
export const BILLING_ENV_NAMES = {
  secretKey: 'BILLING_STRIPE_SECRET_KEY',
  webhookSecret: 'BILLING_STRIPE_WEBHOOK_SECRET',
  appUrl: 'BILLING_APP_URL',
  catalogue: 'BILLING_PLAN_CATALOGUE',
  trialDays: 'BILLING_TRIAL_DAYS',
} as const

/**
 * Stripe's documented ceiling for `trial_period_days`.
 *
 * Named rather than inlined because it is Stripe's number, not ours: a value
 * above it is rejected by the API at checkout time, which would turn a typo in
 * a deployment variable into a dead Subscribe button discovered by a customer.
 */
export const MAX_TRIAL_DAYS = 730

/**
 * The mode a Stripe secret key belongs to.
 *
 * Stripe's prefixes are the documented source: `sk_test_` / `rk_test_` for a
 * sandbox, `sk_live_` / `rk_live_` for the real account. Anything else is not a
 * secret key, and treating it as one would send a request with a credential of
 * unknown provenance.
 */
export function modeOfSecretKey(key: string): StripeMode | null {
  if (/^(sk|rk)_test_[A-Za-z0-9]/.test(key)) return 'test'
  if (/^(sk|rk)_live_[A-Za-z0-9]/.test(key)) return 'live'
  return null
}

/**
 * The mode a Stripe object identifier belongs to, where the identifier says.
 *
 * Test-mode objects created after Stripe introduced the convention carry
 * `_test_` in the identifier. Older test objects do not, so a `null` here means
 * "the identifier does not say", never "this is live". The caller must treat an
 * unknown mode as unknown — Stripe's `livemode` boolean on the object itself is
 * the authority, and it is what the projection stores.
 */
export function modeOfObjectId(id: string): StripeMode | null {
  if (/_test_/.test(id)) return 'test'
  return null
}

/**
 * The catalogue, as configured for the server.
 *
 * A JSON array of `{ plan_key, price_id }` or `{ plan_key, lookup_key }`. It is
 * deliberately not a list of amounts: the money is the Stripe price's, read from
 * Stripe, so nobody can create a plan that says one thing here and charges
 * another there.
 */
export function parseCatalogue(raw: string | null | undefined): CatalogueEntry[] | ConfigProblem {
  if (raw === null || raw === undefined || raw.trim() === '') return []

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return 'invalid_catalogue'
  }
  if (!Array.isArray(parsed)) return 'invalid_catalogue'

  const entries: CatalogueEntry[] = []
  const seen = new Set<string>()

  for (const item of parsed) {
    if (typeof item !== 'object' || item === null) return 'invalid_catalogue'
    const record = item as Record<string, unknown>

    const planKey = typeof record.plan_key === 'string' ? record.plan_key.trim() : ''
    // The same shape the database's plan_key check constraint accepts, so a
    // catalogue that parses here cannot fail to store.
    if (!/^[a-z][a-z0-9_]{1,48}$/.test(planKey)) return 'invalid_catalogue'
    if (seen.has(planKey)) return 'invalid_catalogue'
    seen.add(planKey)

    const priceId = typeof record.price_id === 'string' ? record.price_id.trim() : ''
    const lookupKey = typeof record.lookup_key === 'string' ? record.lookup_key.trim() : ''

    if (priceId !== '' && !/^price_[A-Za-z0-9_]+$/.test(priceId)) return 'invalid_catalogue'
    if (priceId === '' && lookupKey === '') return 'invalid_catalogue'
    if (priceId !== '' && lookupKey !== '') return 'invalid_catalogue'

    entries.push(priceId !== '' ? { planKey, priceId } : { planKey, lookupKey })
  }

  return entries
}

/**
 * The trial length this deployment offers, in whole days.
 *
 * Unset or empty means no trial, which is what every existing deployment has
 * and must keep having: a billing change may not arrive by accident because a
 * variable was forgotten.
 *
 * Anything that is not a plain non-negative integer is a configuration error
 * rather than a value to round. `14.5`, `-14`, `14 days` and `fourteen` are
 * each somebody meaning something specific, and guessing which would be
 * guessing with a customer's card.
 */
export function parseTrialDays(raw: string | null | undefined): number | ConfigProblem {
  if (raw === null || raw === undefined || raw.trim() === '') return 0

  const text = raw.trim()
  if (!/^\d{1,3}$/.test(text)) return 'invalid_trial_days'

  const days = Number(text)
  if (days > MAX_TRIAL_DAYS) return 'invalid_trial_days'

  return days
}

/**
 * A trusted application origin, or nothing.
 *
 * Return URLs are built from this and from nothing else. A Host header, an
 * Origin header or a `redirect` parameter would each turn a Checkout return
 * into an open redirect, and the invitation boundary already learned that
 * lesson: `_shared/team-email.ts` says the same thing about invitation links.
 */
export function normalizeAppUrl(raw: string | null | undefined): string | null {
  if (!raw) return null

  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return null
  }

  // https everywhere, except a local development host, where there is no
  // transport to protect and no third party to redirect to.
  const isLocal = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
  if (url.protocol !== 'https:' && !(isLocal && url.protocol === 'http:')) return null
  if (url.username !== '' || url.password !== '') return null
  if (url.search !== '' || url.hash !== '') return null

  return url.origin
}

/**
 * A return URL inside the configured application, and nowhere else.
 *
 * Takes a path this code chose — never one a request supplied — and refuses
 * anything that is not a simple absolute path, so a protocol-relative `//evil`
 * or a scheme cannot be smuggled through as a "path".
 */
export function buildReturnUrl(appUrl: string, path: string): string | null {
  if (!path.startsWith('/') || path.startsWith('//')) return null
  if (/[\r\n]/.test(path)) return null

  const origin = normalizeAppUrl(appUrl)
  if (origin === null) return null

  return `${origin}${path}`
}

/**
 * Everything, checked together.
 *
 * `requireWebhookSecret` is true only for the webhook endpoint: a deployment can
 * legitimately be able to create a Checkout session before its webhook endpoint
 * has been registered, but the webhook itself must never run without one. There
 * is no development fallback that trusts unsigned JSON, in any environment.
 */
export function resolveBillingConfig(
  env: Readonly<Record<string, string | undefined>>,
  options: { requireWebhookSecret?: boolean } = {},
): ConfigResult {
  const secretKey = (env[BILLING_ENV_NAMES.secretKey] ?? '').trim()
  if (secretKey === '') {
    return {
      ok: false,
      problem: 'missing_secret_key',
      detail: 'Subscription billing is not configured for this deployment.',
    }
  }

  const mode = modeOfSecretKey(secretKey)
  if (mode === null) {
    return {
      ok: false,
      problem: 'invalid_secret_key',
      detail: 'The billing credential is not a Stripe secret key.',
    }
  }

  const appUrlRaw = (env[BILLING_ENV_NAMES.appUrl] ?? '').trim()
  if (appUrlRaw === '') {
    return {
      ok: false,
      problem: 'missing_app_url',
      detail: 'Subscription billing is not configured for this deployment.',
    }
  }
  const appUrl = normalizeAppUrl(appUrlRaw)
  if (appUrl === null) {
    return {
      ok: false,
      problem: 'invalid_app_url',
      detail: 'The configured application address is not usable.',
    }
  }

  const webhookSecretRaw = (env[BILLING_ENV_NAMES.webhookSecret] ?? '').trim()
  let webhookSecret: string | null = null
  if (webhookSecretRaw !== '') {
    if (!/^whsec_[A-Za-z0-9+/=_-]{8,}$/.test(webhookSecretRaw)) {
      return {
        ok: false,
        problem: 'invalid_webhook_secret',
        detail: 'The billing webhook secret is not in the expected form.',
      }
    }
    webhookSecret = webhookSecretRaw
  } else if (options.requireWebhookSecret) {
    return {
      ok: false,
      problem: 'missing_webhook_secret',
      detail: 'Subscription billing is not configured for this deployment.',
    }
  }

  const catalogue = parseCatalogue(env[BILLING_ENV_NAMES.catalogue])
  if (typeof catalogue === 'string') {
    return {
      ok: false,
      problem: catalogue,
      detail: 'The configured plan catalogue could not be read.',
    }
  }

  /*
   * A price identifier that says it is a test object while the key is live, or
   * the reverse. Checked here because the failure it prevents — a live customer
   * subscribed to a sandbox price — is expensive and confusing, and because the
   * check costs nothing.
   */
  for (const entry of catalogue) {
    if (entry.priceId === undefined) continue
    const priceMode = modeOfObjectId(entry.priceId)
    if (priceMode !== null && priceMode !== mode) {
      return {
        ok: false,
        problem: 'mode_mismatch',
        detail: `The plan "${entry.planKey}" belongs to a different Stripe mode than the configured key.`,
      }
    }
  }

  const trialDays = parseTrialDays(env[BILLING_ENV_NAMES.trialDays])
  if (typeof trialDays === 'string') {
    return {
      ok: false,
      problem: trialDays,
      detail: 'The configured trial length could not be read.',
    }
  }

  return { ok: true, config: { secretKey, webhookSecret, appUrl, mode, catalogue, trialDays } }
}

/**
 * A one-line reason an owner can read, from a configuration problem.
 *
 * Never names an environment variable. An owner cannot set one, and telling the
 * internet which of our secrets is absent is free reconnaissance.
 */
export function describeConfigProblem(problem: ConfigProblem): string {
  switch (problem) {
    case 'missing_secret_key':
    case 'missing_app_url':
    case 'missing_webhook_secret':
      return 'Subscription billing is not configured for this deployment.'
    case 'empty_catalogue':
      return 'No subscription plans have been configured for this deployment.'
    case 'invalid_secret_key':
    case 'invalid_webhook_secret':
    case 'invalid_app_url':
    case 'invalid_catalogue':
    case 'invalid_trial_days':
    case 'mode_mismatch':
      return 'Subscription billing is configured incorrectly. Contact support.'
  }
}

/**
 * Opening a Stripe Customer Portal session with plan switching switched off.
 *
 * WHY. `change_plan` refuses a tier whose vehicle limit is below the agency's
 * fleet. A portal session created with only `{ customer, return_url }` falls
 * through to the Stripe account's DEFAULT portal configuration, and if that
 * allows plan switching an agency can change tier there and never meet the
 * check. Dashboard settings are per-mode and can be flipped back silently, so
 * the closure lives here, in version control.
 *
 * HOW. Stripe is the store: a portal configuration we created is recognised by
 * a metadata marker. It is found (or created once), its id cached in module
 * scope, and passed as `configuration` on every session. No table, no migration.
 *
 * THE RULING. Failing to ensure the configuration NEVER stops the portal from
 * opening. The portal is also how a customer fixes a failed card; blocking it
 * to close a plan-switching hole trades a small risk for a bigger one. On
 * failure the session opens on the account default (exactly today's behaviour,
 * so no regression) and the failure is reported to the operator.
 *
 * Nothing here logs a key or a Stripe response body; only our own error
 * category is ever reported.
 */

import { portalSessionParams } from './billing-domain.ts'
import { StripeApiError, type StripeClient } from './stripe-api.ts'

export const PORTAL_MARKER_KEY = 'pevvy_portal'
export const PORTAL_MARKER_VALUE = 'no_plan_switching'

/** Stripe's maximum page size for list endpoints. */
const LIST_LIMIT = 100

interface PortalConfiguration {
  readonly id?: string
  readonly metadata?: Record<string, string> | null
  readonly features?: { subscription_update?: { enabled?: boolean } } | null
}

/** Resolved ids, per Stripe mode: test and live are different accounts' worth of objects. */
const cachedConfigurationIds = new Map<string, string>()

export function resetPortalConfigurationCache(): void {
  cachedConfigurationIds.clear()
}

/** A configuration is ours only if it carries the marker AND still has plan updates off. */
function isOurs(configuration: PortalConfiguration): boolean {
  return (
    typeof configuration.id === 'string' &&
    configuration.metadata?.[PORTAL_MARKER_KEY] === PORTAL_MARKER_VALUE &&
    configuration.features?.subscription_update?.enabled === false
  )
}

/**
 * What a configuration created here offers.
 *
 * A new configuration does NOT inherit the account default: any feature not
 * named is off. So the three things the portal must keep offering (cancelling,
 * invoice history, payment-method updates) are named explicitly, and the one
 * thing being removed is stated as `enabled=false`. With subscription_update
 * disabled, `products` and `default_allowed_updates` are not required.
 */
function configurationParams(): Record<string, unknown> {
  return {
    features: {
      subscription_update: { enabled: false },
      subscription_cancel: { enabled: true, mode: 'at_period_end' },
      invoice_history: { enabled: true },
      payment_method_update: { enabled: true },
    },
    metadata: { [PORTAL_MARKER_KEY]: PORTAL_MARKER_VALUE },
  }
}

async function ensureConfigurationId(stripe: StripeClient): Promise<string> {
  const cached = cachedConfigurationIds.get(stripe.mode)
  if (cached !== undefined) return cached

  const listed = await stripe.request<{ data?: PortalConfiguration[] }>(
    'GET',
    '/billing_portal/configurations',
    { active: true, limit: LIST_LIMIT },
  )
  const existing = (listed.data ?? []).find(isOurs)

  let id = existing?.id
  if (id === undefined) {
    const created = await stripe.request<{ id?: string }>(
      'POST',
      '/billing_portal/configurations',
      configurationParams() as Record<string, never>,
    )
    if (typeof created.id !== 'string') {
      throw new StripeApiError('malformed_response', 'The portal configuration had no id.')
    }
    id = created.id
  }

  cachedConfigurationIds.set(stripe.mode, id)
  return id
}

function categoryOf(error: unknown): string {
  return error instanceof StripeApiError ? error.category : 'unknown'
}

async function createSession(
  stripe: StripeClient,
  params: Record<string, unknown>,
): Promise<{ url: string } | null> {
  const session = await stripe.request<{ url?: string }>(
    'POST',
    '/billing_portal/sessions',
    params as Record<string, never>,
  )
  return typeof session.url === 'string' ? { url: session.url } : null
}

/**
 * Opens a portal session. Returns null only when the application URL is
 * unusable or Stripe returned no URL; a failure to ensure the configuration is
 * reported through `report` and never prevents the session.
 */
export async function openPortalSession(
  stripe: StripeClient,
  customerId: string,
  appUrl: string,
  report: (reason: string) => Promise<void>,
): Promise<{ url: string } | null> {
  const base = portalSessionParams(customerId, appUrl)
  if (base === null) return null

  const degrade = async (stage: string, error: unknown): Promise<void> => {
    const category = categoryOf(error)
    console.error(`billing portal: ${stage} failed (${category}); opening on the default`)
    try {
      await report(
        `The billing portal opened on the default configuration, so plan switching could not be disabled (${stage}: ${category}).`,
      )
    } catch {
      // Reporting must never be the reason a customer cannot fix their card.
      console.error('billing portal: the failure could not be reported')
    }
  }

  let configurationId: string | null = null
  try {
    configurationId = await ensureConfigurationId(stripe)
  } catch (error) {
    await degrade('ensuring the configuration', error)
  }
  if (configurationId === null) return createSession(stripe, base)

  try {
    return await createSession(stripe, { ...base, configuration: configurationId })
  } catch (error) {
    // The cached id may have been archived since it was resolved. Forget it so
    // the next open re-resolves, and open this one on the default.
    cachedConfigurationIds.delete(stripe.mode)
    await degrade('opening on the configuration', error)
    return createSession(stripe, base)
  }
}

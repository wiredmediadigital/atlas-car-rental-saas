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
 * a metadata marker. It is found (or created once, as a copy of the account's
 * default with plan switching off), its id cached in module scope, and passed
 * as `configuration` on every session. No table, no migration.
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
import { StripeApiError, type FormValue, type StripeClient } from './stripe-api.ts'

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

/** Beyond this many pages we stop, rather than create a duplicate on a guess. */
const MAX_LIST_PAGES = 10

interface ConfigurationPage {
  readonly data?: DefaultConfiguration[]
  readonly has_more?: boolean
}

interface DefaultConfiguration extends PortalConfiguration {
  readonly is_default?: boolean
  readonly business_profile?: Record<string, FormValue> | null
}

/**
 * The minimal feature set, used ONLY when the account's default cannot be
 * copied. It is a guess: a new configuration does not inherit the default, so
 * anything not named here is off. The caller reports that the guess was used.
 */
function minimalParams(): Record<string, FormValue> {
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

/**
 * The account default's `features` and `business_profile`, verbatim, with only
 * plan switching turned off. Everything else the portal offers is preserved by
 * construction, and `business_profile` is whatever the account already has.
 * `subscription_update` is replaced wholesale by `{ enabled: false }`: the
 * products and allowed updates only describe switching, which is now off.
 * `null` values from Stripe's response are dropped by the form encoder.
 */
function cloneParams(source: DefaultConfiguration): Record<string, FormValue> {
  const params: Record<string, FormValue> = {
    features: { ...source.features, subscription_update: { enabled: false } },
    metadata: { [PORTAL_MARKER_KEY]: PORTAL_MARKER_VALUE },
  }
  if (source.business_profile) params.business_profile = source.business_profile
  return params
}

interface Located {
  readonly ours: PortalConfiguration | undefined
  readonly accountDefault: DefaultConfiguration | undefined
}

/** Walks every page (bounded) for our configuration and the account default. */
async function locate(stripe: StripeClient): Promise<Located> {
  let accountDefault: DefaultConfiguration | undefined
  let startingAfter: string | undefined

  for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
    const listed = await stripe.request<ConfigurationPage>(
      'GET',
      '/billing_portal/configurations',
      {
        active: true,
        limit: LIST_LIMIT,
        starting_after: startingAfter,
      },
    )
    const data = listed.data ?? []

    const ours = data.find(isOurs)
    if (ours !== undefined) return { ours, accountDefault }
    accountDefault ??= data.find((c) => c.is_default === true)

    const last = data.at(-1)
    if (listed.has_more !== true || last?.id === undefined)
      return { ours: undefined, accountDefault }
    startingAfter = last.id
  }
  // Not finding ours past the bound is not proof it does not exist.
  throw new StripeApiError('malformed_response', 'Too many portal configurations to search.')
}

async function safeReport(
  report: (reason: string) => Promise<void>,
  reason: string,
): Promise<void> {
  try {
    await report(reason)
  } catch {
    // Reporting must never be the reason a customer cannot fix their card.
    console.error('billing portal: a failure could not be reported')
  }
}

async function ensureConfigurationId(
  stripe: StripeClient,
  report: (reason: string) => Promise<void>,
): Promise<string> {
  const cached = cachedConfigurationIds.get(stripe.mode)
  if (cached !== undefined) return cached

  const { ours, accountDefault } = await locate(stripe)

  let id = ours?.id
  if (id === undefined) {
    const source = accountDefault?.features != null ? accountDefault : undefined
    if (source === undefined) {
      await safeReport(
        report,
        "The plan-switching-off portal configuration was built from a guessed feature set because the account's default portal configuration was not found.",
      )
    }
    const created = await stripe.request<{ id?: string }>(
      'POST',
      '/billing_portal/configurations',
      source === undefined ? minimalParams() : cloneParams(source),
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
    await safeReport(
      report,
      `The billing portal opened on the default configuration, so plan switching could not be disabled (${stage}: ${category}).`,
    )
  }

  let configurationId: string | null = null
  try {
    configurationId = await ensureConfigurationId(stripe, report)
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

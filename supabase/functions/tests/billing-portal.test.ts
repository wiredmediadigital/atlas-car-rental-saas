// @vitest-environment node
/**
 * The portal session, through the real Stripe client with only the network faked.
 *
 * Every assertion is on the request that would have gone to Stripe: its method,
 * path and decoded form body, not on what a mock was called with.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { openPortalSession, resetPortalConfigurationCache } from '../_shared/billing-portal.ts'
import { StripeClient } from '../_shared/stripe-api.ts'

interface Sent {
  readonly method: string
  readonly path: string
  readonly form: URLSearchParams
}

type Responder = (sent: Sent) => { status: number; body: unknown }

function harness(respond: Responder) {
  const sent: Sent[] = []
  const fetchImpl = vi.fn((url: string, init: RequestInit) => {
    const parsed = new URL(url)
    const raw =
      init.method === 'GET'
        ? parsed.search.slice(1)
        : typeof init.body === 'string'
          ? init.body
          : ''
    const entry = {
      method: String(init.method),
      path: parsed.pathname.replace(/^\/v1/, ''),
      form: new URLSearchParams(raw),
    }
    sent.push(entry)
    const { status, body } = respond(entry)
    return Promise.resolve(new Response(JSON.stringify(body), { status }))
  })
  const client = new StripeClient({
    secretKey: 'sk_test_x',
    mode: 'test',
    fetchImpl: fetchImpl as unknown as typeof fetch,
  })
  return { sent, client }
}

function nth<T>(list: readonly T[], index: number): T {
  const item = list[index]
  if (item === undefined) throw new Error('expected request ' + String(index))
  return item
}
const first = <T>(list: readonly T[]): T => nth(list, 0)

const MARKER = 'no_plan_switching'
const APP = 'https://pevvy.io'
const sessionsOf = (sent: Sent[]) => sent.filter((s) => s.path === '/billing_portal/sessions')
const listsOf = (sent: Sent[]) =>
  sent.filter((s) => s.method === 'GET' && s.path === '/billing_portal/configurations')
const createsOf = (sent: Sent[]) =>
  sent.filter((s) => s.method === 'POST' && s.path === '/billing_portal/configurations')

/** What the account's own default portal looks like: more than the minimal set names. */
const DEFAULT_CONFIG = {
  id: 'bpc_default',
  is_default: true,
  metadata: {},
  business_profile: {
    headline: 'Manage billing',
    privacy_policy_url: 'https://pevvy.io/privacy',
    terms_of_service_url: 'https://pevvy.io/terms',
  },
  features: {
    subscription_update: { enabled: true, default_allowed_updates: ['price'], products: [] },
    subscription_cancel: { enabled: true, mode: 'immediately' },
    invoice_history: { enabled: true },
    payment_method_update: { enabled: true },
    customer_update: { enabled: true, allowed_updates: ['address', 'tax_id'] },
  },
}

function stripeWith(existing: unknown[], withDefault = true) {
  const all = withDefault ? [DEFAULT_CONFIG, ...existing] : existing
  return harness((s) => {
    if (s.path === '/billing_portal/configurations' && s.method === 'GET') {
      return { status: 200, body: { data: all, has_more: false } }
    }
    if (s.path === '/billing_portal/configurations') {
      return { status: 200, body: { id: 'bpc_created' } }
    }
    return { status: 200, body: { url: 'https://billing.stripe.com/p/session_1' } }
  })
}

describe('portal session with plan switching disabled', () => {
  beforeEach(() => resetPortalConfigurationCache())

  it('with no default to copy, falls back to the minimal set and reports the guess', async () => {
    const { sent, client } = stripeWith([], false)
    const report = vi.fn(async (_reason: string) => {})

    const result = await openPortalSession(client, 'cus_1', APP, report)

    expect(result).toEqual({ url: 'https://billing.stripe.com/p/session_1' })
    const created = createsOf(sent)
    expect(created).toHaveLength(1)
    expect(first(created).form.get('features[subscription_update][enabled]')).toBe('false')
    expect(first(created).form.get('metadata[pevvy_portal]')).toBe(MARKER)
    // Cancelling, invoices and payment methods are not removed.
    expect(first(created).form.get('features[subscription_cancel][enabled]')).toBe('true')
    expect(first(created).form.get('features[invoice_history][enabled]')).toBe('true')
    expect(first(created).form.get('features[payment_method_update][enabled]')).toBe('true')
    const session = nth(sessionsOf(sent), 0)
    expect(session.form.get('configuration')).toBe('bpc_created')
    expect(session.form.get('customer')).toBe('cus_1')
    expect(report).toHaveBeenCalledTimes(1)
    expect(first(report.mock.calls)[0]).toMatch(/default.*(not found|could not)/i)
  })

  it('copies the default configuration verbatim and flips only plan switching', async () => {
    const { sent, client } = stripeWith([])
    const report = vi.fn(async (_reason: string) => {})

    await openPortalSession(client, 'cus_1', APP, report)

    const form = first(createsOf(sent)).form
    expect(form.get('features[subscription_update][enabled]')).toBe('false')
    expect(form.get('metadata[pevvy_portal]')).toBe(MARKER)
    // Not in the minimal set, so only a copy can have carried them across.
    expect(form.get('features[customer_update][enabled]')).toBe('true')
    expect(form.get('features[customer_update][allowed_updates][1]')).toBe('tax_id')
    // The account's own cancel semantics, not our guess.
    expect(form.get('features[subscription_cancel][mode]')).toBe('immediately')
    expect(form.get('business_profile[privacy_policy_url]')).toBe('https://pevvy.io/privacy')
    // The default is not mutated into ours: no is_default / id leaks into the body.
    expect(form.has('id')).toBe(false)
    expect(form.has('is_default')).toBe(false)
    expect(report).not.toHaveBeenCalled()
  })

  it('finds our marked configuration on a later page instead of creating a duplicate', async () => {
    const ours = {
      id: 'bpc_page2',
      metadata: { pevvy_portal: MARKER },
      features: { subscription_update: { enabled: false } },
    }
    const { sent, client } = harness((s) => {
      if (s.path === '/billing_portal/configurations' && s.method === 'GET') {
        return s.form.get('starting_after') === 'bpc_default'
          ? { status: 200, body: { data: [ours], has_more: false } }
          : { status: 200, body: { data: [DEFAULT_CONFIG], has_more: true } }
      }
      return { status: 200, body: { url: 'https://billing.stripe.com/p/p2' } }
    })

    await openPortalSession(
      client,
      'cus_1',
      APP,
      vi.fn(async (_reason: string) => {}),
    )

    expect(listsOf(sent)).toHaveLength(2)
    expect(createsOf(sent)).toHaveLength(0)
    expect(nth(sessionsOf(sent), 0).form.get('configuration')).toBe('bpc_page2')
  })

  it('opens on the default and reports rather than paging forever', async () => {
    const { sent, client } = harness((s) =>
      s.path === '/billing_portal/configurations' && s.method === 'GET'
        ? { status: 200, body: { data: [{ id: 'bpc_x', metadata: {} }], has_more: true } }
        : { status: 200, body: { url: 'https://billing.stripe.com/p/x' } },
    )
    const report = vi.fn(async (_reason: string) => {})

    const result = await openPortalSession(client, 'cus_1', APP, report)

    expect(result).not.toBeNull()
    expect(listsOf(sent).length).toBeLessThanOrEqual(20)
    expect(createsOf(sent)).toHaveLength(0)
    expect(report).toHaveBeenCalledTimes(1)
  })

  it('reuses an existing marked configuration instead of creating another', async () => {
    const { sent, client } = stripeWith([
      { id: 'bpc_other', metadata: {}, features: { subscription_update: { enabled: true } } },
      {
        id: 'bpc_ours',
        metadata: { pevvy_portal: MARKER },
        features: { subscription_update: { enabled: false } },
      },
    ])

    await openPortalSession(
      client,
      'cus_1',
      APP,
      vi.fn(async (_reason: string) => {}),
    )

    expect(createsOf(sent)).toHaveLength(0)
    expect(nth(sessionsOf(sent), 0).form.get('configuration')).toBe('bpc_ours')
    expect(first(listsOf(sent)).form.get('active')).toBe('true')
  })

  it('does not trust a marked configuration that has plan updates switched back on', async () => {
    const { sent, client } = stripeWith([
      {
        id: 'bpc_flipped',
        metadata: { pevvy_portal: MARKER },
        features: { subscription_update: { enabled: true } },
      },
    ])

    await openPortalSession(
      client,
      'cus_1',
      APP,
      vi.fn(async (_reason: string) => {}),
    )

    expect(createsOf(sent)).toHaveLength(1)
    expect(nth(sessionsOf(sent), 0).form.get('configuration')).toBe('bpc_created')
  })

  it('lists only once across opens in a warm instance', async () => {
    const { sent, client } = stripeWith([])
    const report = vi.fn(async (_reason: string) => {})

    await openPortalSession(client, 'cus_1', APP, report)
    await openPortalSession(client, 'cus_1', APP, report)

    expect(listsOf(sent)).toHaveLength(1)
    expect(createsOf(sent)).toHaveLength(1)
    expect(sessionsOf(sent)).toHaveLength(2)
    expect(nth(sessionsOf(sent), 1).form.get('configuration')).toBe('bpc_created')
  })

  it('still opens the portal, on the default, and reports when the list fails', async () => {
    const { sent, client } = harness((s) =>
      s.path === '/billing_portal/configurations'
        ? { status: 500, body: { error: { message: 'secret detail' } } }
        : { status: 200, body: { url: 'https://billing.stripe.com/p/session_2' } },
    )
    const report = vi.fn(async (_reason: string) => {})

    const result = await openPortalSession(client, 'cus_1', APP, report)

    expect(result).toEqual({ url: 'https://billing.stripe.com/p/session_2' })
    expect(nth(sessionsOf(sent), 0).form.has('configuration')).toBe(false)
    expect(report).toHaveBeenCalledTimes(1)
    expect(first(first(report.mock.calls))).toMatch(/plan switching/i)
    expect(first(first(report.mock.calls))).not.toContain('secret detail')
  })

  it('still opens the portal, on the default, and reports when the create fails', async () => {
    const { sent, client } = harness((s) => {
      if (s.path === '/billing_portal/configurations' && s.method === 'GET') {
        return { status: 200, body: { data: [DEFAULT_CONFIG], has_more: false } }
      }
      if (s.path === '/billing_portal/configurations') {
        return { status: 400, body: { error: { message: 'business profile' } } }
      }
      return { status: 200, body: { url: 'https://billing.stripe.com/p/session_3' } }
    })
    const report = vi.fn(async (_reason: string) => {})

    const result = await openPortalSession(client, 'cus_1', APP, report)

    expect(result).not.toBeNull()
    expect(nth(sessionsOf(sent), 0).form.has('configuration')).toBe(false)
    expect(report).toHaveBeenCalledTimes(1)
  })

  it('opens the portal even when reporting itself throws', async () => {
    const { client } = harness((s) =>
      s.path === '/billing_portal/configurations'
        ? { status: 500, body: {} }
        : { status: 200, body: { url: 'https://billing.stripe.com/p/session_4' } },
    )
    const report = vi.fn(() => {
      return Promise.reject(new Error('db down'))
    })

    const result = await openPortalSession(client, 'cus_1', APP, report)

    expect(result).toEqual({ url: 'https://billing.stripe.com/p/session_4' })
  })

  it('drops a cached configuration Stripe now rejects and retries on the default', async () => {
    let rejectConfiguration = false
    const { sent, client } = harness((s) => {
      if (s.path === '/billing_portal/configurations' && s.method === 'GET') {
        return { status: 200, body: { data: [DEFAULT_CONFIG], has_more: false } }
      }
      if (s.path === '/billing_portal/configurations') return { status: 200, body: { id: 'bpc_1' } }
      if (rejectConfiguration && s.form.has('configuration')) {
        return { status: 400, body: { error: { message: 'archived' } } }
      }
      return { status: 200, body: { url: 'https://billing.stripe.com/p/s' } }
    })
    const report = vi.fn(async (_reason: string) => {})
    await openPortalSession(client, 'cus_1', APP, report)

    rejectConfiguration = true
    const result = await openPortalSession(client, 'cus_1', APP, report)

    expect(result).not.toBeNull()
    expect(report).toHaveBeenCalledTimes(1)
    expect(sessionsOf(sent).at(-1)!.form.has('configuration')).toBe(false)
  })

  it('returns null without calling Stripe when the app URL is unusable', async () => {
    const { sent, client } = stripeWith([])
    const result = await openPortalSession(
      client,
      'cus_1',
      'ftp://x',
      vi.fn(async (_reason: string) => {}),
    )
    expect(result).toBeNull()
    expect(sent).toHaveLength(0)
  })
})

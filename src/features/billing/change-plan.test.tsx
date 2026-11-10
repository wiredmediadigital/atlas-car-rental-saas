import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  WorkspaceContext,
  type WorkspaceContextValue,
} from '@/features/workspace/workspace-context'
import type { BillingOverviewRow, BillingPlanRow, OrgRole } from '@/types/database'

import { changePlan } from './api'
import { PlanList } from './components/PlanList'
import { useBillingOverview, useBillingPlans } from './queries'

const backend = vi.hoisted(
  (): { overview: unknown; plans: unknown; invoke: ReturnType<typeof vi.fn> } => ({
    overview: undefined,
    plans: undefined,
    invoke: vi.fn(),
  }),
)

vi.mock('@/lib/supabase/client', () => ({
  getSupabaseClient: () => ({
    rpc: (name: string) =>
      Promise.resolve({
        data: name === 'billing_overview' ? [backend.overview] : backend.plans,
        error: null,
      }),
    functions: { invoke: backend.invoke },
  }),
}))

const SERVER_SENTENCE = 'You have 12 vehicles and the Starter plan covers 5. Archive 7 vehicles.'

function plan(key: string, name: string, isCurrent: boolean): BillingPlanRow {
  return {
    plan_key: key,
    display_name: name,
    description: null,
    currency: 'usd',
    amount_minor: 4900,
    billing_interval: 'month',
    interval_count: 1,
    entitlements: {},
    is_current: isCurrent,
  }
}

function plansWithCurrent(current: string): BillingPlanRow[] {
  return [
    plan('starter_monthly', 'Starter', current === 'starter_monthly'),
    plan('pro_monthly', 'Pro', current === 'pro_monthly'),
    plan('business_monthly', 'Business', current === 'business_monthly'),
  ]
}

function overviewOf(over: Partial<BillingOverviewRow> = {}): BillingOverviewRow {
  return {
    access_state: 'normal',
    platform_configured: true,
    stripe_configured: true,
    catalog_configured: true,
    mode: 'test',
    has_customer: true,
    billing_email: null,
    subscription_id: 'sub_1',
    status: 'active',
    plan_key: 'pro_monthly',
    plan_name: 'Pro',
    currency: 'usd',
    amount_minor: 4900,
    billing_interval: 'month',
    interval_count: 1,
    current_period_start: null,
    current_period_end: null,
    cancel_scheduled: false,
    cancel_effective_at: null,
    canceled_at: null,
    ended_at: null,
    trial_end: null,
    payment_failed_at: null,
    latest_invoice_status: null,
    synced_at: null,
    pending_checkout: false,
    pending_checkout_at: null,
    active_members: 3,
    active_vehicles: 12,
    ...over,
  }
}

function refusal(category: string, message: string) {
  return {
    data: null,
    error: {
      context: new Response(JSON.stringify({ ok: false, error: { category, message } }), {
        status: 409,
      }),
    },
  }
}

function workspace(role: OrgRole): WorkspaceContextValue {
  return {
    status: 'ready',
    memberships: [],
    organization: { id: 'org-1', locale: 'en-US', name: 'Agency' } as never,
    membership: null,
    role,
    billingAccessState: 'normal',
    error: null,
    switchOrganization: () => undefined,
    refresh: () => Promise.resolve(),
  }
}

const onCheckout = vi.fn()
let client: QueryClient

/** Mirrors how the Billing page feeds the list: the real queries, the real list. */
function Harness() {
  const overview = useBillingOverview()
  const plans = useBillingPlans()
  if (!overview.data || !plans.data) return <p>loading</p>
  return (
    <PlanList
      plans={plans.data}
      overview={overview.data}
      locale="en-US"
      checkoutBusyKey={null}
      onCheckout={onCheckout}
    />
  )
}

async function renderAs(role: OrgRole) {
  render(
    <QueryClientProvider client={client}>
      <WorkspaceContext.Provider value={workspace(role)}>
        <Harness />
      </WorkspaceContext.Provider>
    </QueryClientProvider>,
  )
  await screen.findByText('Business')
}

function card(name: string): HTMLElement {
  return screen.getByText(name).closest('li') as HTMLElement
}

function bodyOf(call: unknown[]): Record<string, unknown> {
  return (call[1] as { body: Record<string, unknown> }).body
}

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  backend.overview = overviewOf()
  backend.plans = plansWithCurrent('pro_monthly')
  backend.invoke.mockReset()
  backend.invoke.mockResolvedValue({ data: { ok: true }, error: null })
  onCheckout.mockReset()
})

describe('changing tier from the Billing page', () => {
  it('offers a higher tier to an owner, and changes the plan in place', async () => {
    const user = userEvent.setup()
    await renderAs('owner')

    await user.click(within(card('Business')).getByRole('button', { name: 'Upgrade to this plan' }))

    await waitFor(() => expect(backend.invoke).toHaveBeenCalledTimes(1))
    expect(bodyOf(backend.invoke.mock.calls[0]!)).toMatchObject({
      action: 'change_plan',
      organizationId: 'org-1',
      planKey: 'business_monthly',
    })
    // A subscribed agency is never sent to Checkout.
    expect(onCheckout).not.toHaveBeenCalled()
  })

  it('does not offer any tier change to a staff member', async () => {
    await renderAs('staff')
    expect(screen.queryAllByRole('button')).toEqual([])
  })

  it('does not offer any tier change to an admin, because billing.manage is owner-only', async () => {
    await renderAs('admin')
    expect(screen.queryAllByRole('button')).toEqual([])
    // The plans are still shown: only the control is withheld.
    expect(screen.getByText('Business')).toBeTruthy()
  })

  it('does not offer any tier change to a manager', async () => {
    await renderAs('manager')
    expect(screen.queryAllByRole('button')).toEqual([])
  })

  it('shows the current tier as current, not as an option', async () => {
    await renderAs('owner')

    const current = card('Pro')
    expect(within(current).getByText('Current')).toBeTruthy()
    const button = within(current).getByRole('button', { name: 'Current plan' })
    expect((button as HTMLButtonElement).disabled).toBe(true)
    expect(within(current).queryByRole('button', { name: /to this plan/ })).toBeNull()
    expect(screen.getAllByText('Current')).toHaveLength(1)
  })

  it('goes to Checkout, not to a plan change, when there is no live subscription', async () => {
    backend.overview = overviewOf({ status: null, plan_key: null, subscription_id: null })
    backend.plans = plansWithCurrent('none')
    const user = userEvent.setup()
    await renderAs('owner')

    await user.click(within(card('Business')).getByRole('button', { name: 'Choose plan' }))

    expect(onCheckout).toHaveBeenCalledWith('business_monthly')
    expect(backend.invoke).not.toHaveBeenCalled()
  })
})

describe('when the server refuses', () => {
  it('shows the gap when a downgrade is refused, in the client wording', async () => {
    backend.invoke.mockResolvedValue(refusal('over_target_limit', SERVER_SENTENCE))
    const user = userEvent.setup()
    await renderAs('owner')

    await user.click(within(card('Starter')).getByRole('button', { name: 'Move to this plan' }))

    expect(
      await screen.findByText('Starter covers 5 vehicles. You have 12. Retire 7 to move down.'),
    ).toBeTruthy()
    // One source for the sentence: the server's own wording is not displayed.
    expect(screen.queryByText(SERVER_SENTENCE)).toBeNull()
  })

  it('treats an unchangeable subscription as a support matter, not the agency fault', async () => {
    backend.invoke.mockResolvedValue(
      refusal('plan_change_unavailable', 'This plan cannot be changed here right now.'),
    )
    const user = userEvent.setup()
    await renderAs('owner')

    await user.click(within(card('Business')).getByRole('button', { name: 'Upgrade to this plan' }))

    const message = await screen.findByText(/can't change this plan automatically/)
    expect(message.textContent).toContain('help@pevvy.io')
    expect(screen.queryByText(/Retire/)).toBeNull()
  })

  it('says so when there is no subscription left to change', async () => {
    backend.invoke.mockResolvedValue(refusal('no_subscription', 'x'))
    const user = userEvent.setup()
    await renderAs('owner')

    await user.click(within(card('Business')).getByRole('button', { name: 'Upgrade to this plan' }))

    expect(await screen.findByText(/no active subscription to change/i)).toBeTruthy()
  })
})

describe('after a change is accepted', () => {
  it('says the change is being applied, not that it failed, until the row catches up', async () => {
    const user = userEvent.setup()
    await renderAs('owner')

    await user.click(within(card('Business')).getByRole('button', { name: 'Upgrade to this plan' }))

    expect(await screen.findByText(/being applied/i)).toBeTruthy()
    // The pre-change tier is not presented as the current one, and nothing reads as failure.
    expect(screen.queryByText('Current')).toBeNull()
    expect(within(card('Business')).getByText('Applying')).toBeTruthy()
    expect(screen.queryByText(/could not be changed/i)).toBeNull()

    // The webhook lands: the next read names the new tier.
    backend.overview = overviewOf({ plan_key: 'business_monthly' })
    backend.plans = plansWithCurrent('business_monthly')
    await client.invalidateQueries()

    await waitFor(() => expect(screen.queryByText(/being applied/i)).toBeNull())
    expect(within(card('Business')).getByText('Current')).toBeTruthy()
  })
})

describe('the attempt token', () => {
  it('is fresh on every call, so a change back to an earlier tier is not swallowed', async () => {
    backend.invoke.mockResolvedValue({ data: { ok: true }, error: null })

    await changePlan('org-1', 'starter_monthly')
    await changePlan('org-1', 'pro_monthly')
    await changePlan('org-1', 'starter_monthly')

    const attempts = backend.invoke.mock.calls.map((call) => bodyOf(call)['attempt'])
    for (const attempt of attempts) {
      expect(typeof attempt).toBe('string')
      expect((attempt as string).length).toBeGreaterThan(0)
    }
    expect(new Set(attempts).size).toBe(3)
  })
})

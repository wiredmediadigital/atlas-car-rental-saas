import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ToastProvider } from '@/components/ui'
import { RestrictedBanner } from '@/features/billing/components/RestrictedBanner'
import { SUPPORT_EMAIL } from '@/features/help/constants'
import { formatDate } from '@/lib/datetime/format'
import {
  WorkspaceContext,
  usePermission,
  type WorkspaceContextValue,
} from '@/features/workspace/workspace-context'
import { PERMISSIONS, isWithdrawnWhenClosing, type Permission } from '@/lib/authz/permissions'
import type { Organization, OrganizationMember, OrgRole } from '@/types/database'

import { requestClosure, restoreAccount } from './api'
import { CloseAccountCard } from './components/CloseAccountCard'
import { ClosureBanner } from './components/ClosureBanner'
import { closureStateOf, type ClosureState } from './closure'

vi.mock('./api', () => ({
  requestClosure: vi.fn(),
  restoreAccount: vi.fn(),
}))

const PURGE_AFTER = '2026-12-08T10:00:00Z'
// However the locale spells it; the test cares that the date is there, not how it is written.
const PURGE_DATE = formatDate(new Date(PURGE_AFTER), { locale: 'en', timeZone: 'UTC' })

function makeOrganization(
  state: ClosureState,
  overrides: Partial<Organization> = {},
): Organization {
  return {
    id: 'org-1',
    name: 'Atlas Cars',
    slug: 'atlas-cars',
    legal_name: null,
    tax_identifier: null,
    default_currency: 'EUR',
    time_zone: 'UTC',
    country_code: null,
    locale: 'en',
    email: null,
    phone: null,
    website: null,
    address_line1: null,
    address_line2: null,
    city: null,
    region: null,
    postal_code: null,
    logo_path: null,
    closure_requested_at: state === 'open' ? null : '2026-11-08T10:00:00Z',
    closure_requested_by: state === 'open' ? null : 'user-1',
    closure_purge_after: state === 'open' ? null : PURGE_AFTER,
    purge_started_at: state === 'purging' || state === 'closed' ? '2026-12-08T10:05:00Z' : null,
    closed_at: state === 'closed' ? '2026-12-08T10:30:00Z' : null,
    // Added by vehicle-tier pricing, which landed on main while this branch
    // was in review: an operator-set ceiling, service-role only.
    vehicle_limit_override: null,
    vehicle_limit_override_set_by: null,
    vehicle_limit_override_set_at: null,
    created_by: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

const refresh = vi.fn(() => Promise.resolve())

function workspace(role: OrgRole, state: ClosureState, membershipCount = 1): WorkspaceContextValue {
  const organization = makeOrganization(state)
  const membership = { organization_id: 'org-1', user_id: 'user-1', role } as OrganizationMember
  return {
    status: 'ready',
    memberships: Array.from({ length: membershipCount }, () => ({ organization, membership })),
    organization,
    membership,
    role,
    billingAccessState: null,
    error: null,
    switchOrganization: () => undefined,
    refresh,
  }
}

function renderWith(value: WorkspaceContextValue, ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter>
          <WorkspaceContext.Provider value={value}>{ui}</WorkspaceContext.Provider>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  )
}

/** Gives "renders nothing" something to be true of: the providers add their own markup. */
function Slot({ children }: { children: ReactNode }) {
  return <div data-testid="slot">{children}</div>
}

const closeButton = () => screen.queryByRole('button', { name: /close this agency/i })
const restoreButton = () => screen.queryByRole('button', { name: /restore/i })

beforeEach(() => {
  vi.mocked(requestClosure).mockReset()
  vi.mocked(restoreAccount).mockReset()
  refresh.mockClear()
})

describe('closureStateOf', () => {
  it('reports the furthest stage the timestamps record', () => {
    expect(closureStateOf(makeOrganization('open'))).toBe('open')
    expect(closureStateOf(makeOrganization('suspended'))).toBe('suspended')
    expect(closureStateOf(makeOrganization('purging'))).toBe('purging')
    expect(closureStateOf(makeOrganization('closed'))).toBe('closed')
  })
})

describe('CloseAccountCard', () => {
  it('lets an owner close an open agency', () => {
    renderWith(workspace('owner', 'open'), <CloseAccountCard />)
    expect(closeButton()).toBeInTheDocument()
  })

  it('shows no close control to an admin, but does show restore', () => {
    const { unmount } = renderWith(workspace('admin', 'open'), <CloseAccountCard />)
    expect(closeButton()).not.toBeInTheDocument()
    expect(screen.getByText(/only an owner can close/i)).toBeInTheDocument()
    unmount()

    renderWith(workspace('admin', 'suspended'), <CloseAccountCard />)
    expect(closeButton()).not.toBeInTheDocument()
    expect(restoreButton()).toBeInTheDocument()
  })

  it('shows nothing to a manager or staff', () => {
    for (const role of ['manager', 'staff'] as const) {
      for (const state of ['open', 'suspended', 'purging', 'closed'] as const) {
        const { unmount } = renderWith(
          workspace(role, state),
          <Slot>
            <CloseAccountCard />
          </Slot>,
        )
        expect(screen.getByTestId('slot')).toBeEmptyDOMElement()
        unmount()
      }
    }
  })

  it('keeps the confirm button disabled until the name matches exactly', async () => {
    const user = userEvent.setup()
    renderWith(workspace('owner', 'open'), <CloseAccountCard />)

    await user.click(closeButton()!)
    const dialog = screen.getByRole('dialog')
    const confirm = within(dialog).getByRole('button', { name: /request closure/i })
    const input = within(dialog).getByLabelText(/type the agency name/i)

    expect(confirm).toBeDisabled()
    await user.type(input, 'atlas cars')
    expect(confirm).toBeDisabled()
    await user.clear(input)
    await user.type(input, 'Atlas Cars ')
    expect(confirm).toBeDisabled()
    await user.clear(input)
    await user.type(input, 'Atlas Cars')
    expect(confirm).toBeEnabled()
  })

  it('warns the owner their own login will be removed', async () => {
    const user = userEvent.setup()
    renderWith(workspace('owner', 'open', 1), <CloseAccountCard />)

    await user.click(closeButton()!)
    const dialog = screen.getByRole('dialog')

    expect(within(dialog).getByText(/your own login will be removed/i)).toBeInTheDocument()
    expect(within(dialog).getByText(/only agency/i)).toBeInTheDocument()
  })

  it('still says so when the owner belongs to other agencies, without promising either way', async () => {
    const user = userEvent.setup()
    renderWith(workspace('owner', 'open', 2), <CloseAccountCard />)

    await user.click(closeButton()!)
    const dialog = screen.getByRole('dialog')

    expect(
      within(dialog).getByText(/if this is the last agency you belong to, your own login/i),
    ).toBeInTheDocument()
  })

  it('says the subscription keeps billing until it is cancelled, at the moment of deciding', async () => {
    /*
     * The Terms say so; the confirmation dialog did not, and that is where the
     * belief forms. Cancelling the Stripe subscription is a deliberate manual
     * operator step, so an owner who closes on the 2nd is still charged on the
     * 5th unless somebody acts.
     */
    const user = userEvent.setup()
    renderWith(workspace('owner', 'open'), <CloseAccountCard />)
    await user.click(closeButton()!)

    const dialog = within(screen.getByRole('dialog')).getByRole('list')
    expect(dialog.textContent ?? '').toMatch(/subscription/i)
    expect(dialog.textContent ?? '').toMatch(/cancel/i)
  })

  it('says purging sooner is a request, and offers no control for it', async () => {
    const user = userEvent.setup()
    renderWith(workspace('owner', 'open'), <CloseAccountCard />)

    await user.click(closeButton()!)
    const dialog = screen.getByRole('dialog')

    expect(within(dialog).getByText(/30 days/i)).toBeInTheDocument()
    expect(within(dialog).getByText(/ask us/i)).toBeInTheDocument()
    expect(within(dialog).getByRole('link', { name: SUPPORT_EMAIL })).toHaveAttribute(
      'href',
      `mailto:${SUPPORT_EMAIL}`,
    )
    expect(within(dialog).queryByRole('button', { name: /now|immediately|delete/i })).toBeNull()
  })

  it('requests closure with the agency id only, then refreshes the workspace', async () => {
    const user = userEvent.setup()
    vi.mocked(requestClosure).mockResolvedValue(makeOrganization('suspended'))
    renderWith(workspace('owner', 'open'), <CloseAccountCard />)

    await user.click(closeButton()!)
    const dialog = screen.getByRole('dialog')
    await user.type(within(dialog).getByLabelText(/type the agency name/i), 'Atlas Cars')
    await user.click(within(dialog).getByRole('button', { name: /request closure/i }))

    await waitFor(() => expect(requestClosure).toHaveBeenCalledWith('org-1'))
    expect(vi.mocked(requestClosure).mock.calls[0]).toHaveLength(1)
    await waitFor(() => expect(refresh).toHaveBeenCalled())
  })

  it('gives a one-click route to a person while suspended', () => {
    renderWith(workspace('owner', 'suspended'), <CloseAccountCard />)
    expect(screen.getByRole('link', { name: SUPPORT_EMAIL })).toHaveAttribute(
      'href',
      `mailto:${SUPPORT_EMAIL}`,
    )
  })

  it('shows the purge date while suspended', () => {
    renderWith(workspace('owner', 'suspended'), <CloseAccountCard />)
    expect(screen.getByText(PURGE_DATE, { exact: false })).toBeInTheDocument()
    expect(closeButton()).not.toBeInTheDocument()
  })

  it('says what restoring does about the subscription, where restore is offered', () => {
    // The restore does not restart a cancelled subscription, and the write gate
    // needs billing unrestricted as well as closure open. Saying "everything is
    // as it was" beside the button would be the same untruth the Terms carried.
    renderWith(workspace('admin', 'suspended'), <CloseAccountCard />)
    expect(document.body.textContent ?? '').toMatch(/subscription/i)
  })

  it('offers restore while suspended, and not once purging', () => {
    const suspended = renderWith(workspace('owner', 'suspended'), <CloseAccountCard />)
    expect(restoreButton()).toBeInTheDocument()
    suspended.unmount()

    for (const state of ['purging', 'closed'] as const) {
      const { unmount } = renderWith(workspace('owner', state), <CloseAccountCard />)
      expect(restoreButton()).not.toBeInTheDocument()
      expect(closeButton()).not.toBeInTheDocument()
      unmount()
    }
  })

  it('restores and refreshes the workspace', async () => {
    const user = userEvent.setup()
    vi.mocked(restoreAccount).mockResolvedValue(makeOrganization('open'))
    renderWith(workspace('admin', 'suspended'), <CloseAccountCard />)

    await user.click(restoreButton()!)

    await waitFor(() => expect(restoreAccount).toHaveBeenCalledWith('org-1'))
    await waitFor(() => expect(refresh).toHaveBeenCalled())
  })

  it('shows a refusal in words, not SQL', async () => {
    const user = userEvent.setup()
    vi.mocked(restoreAccount).mockRejectedValue({
      code: '55000',
      message: 'The purge of this agency has started, so it can no longer be restored.',
    })
    renderWith(workspace('owner', 'suspended'), <CloseAccountCard />)

    await user.click(restoreButton()!)

    expect(await screen.findByText(/purge has started/i)).toBeInTheDocument()
    expect(screen.queryByText(/55000|SQLSTATE/)).toBeNull()
  })
})

describe('ClosureBanner', () => {
  it('renders nothing for an open agency', () => {
    renderWith(
      workspace('owner', 'open'),
      <Slot>
        <ClosureBanner />
      </Slot>,
    )
    expect(screen.getByTestId('slot')).toBeEmptyDOMElement()
  })

  it('tells everyone it is read-only, with the purge date', () => {
    for (const role of ['owner', 'admin', 'manager', 'staff'] as const) {
      const { unmount } = renderWith(workspace(role, 'suspended'), <ClosureBanner />)
      expect(screen.getByText(/read-only/i)).toBeInTheDocument()
      expect(screen.getByText(PURGE_DATE, { exact: false })).toBeInTheDocument()
      unmount()
    }
  })

  it('offers restore to an owner and an admin, and names who to ask for everyone else', () => {
    for (const role of ['owner', 'admin'] as const) {
      const { unmount } = renderWith(workspace(role, 'suspended'), <ClosureBanner />)
      expect(restoreButton()).toBeInTheDocument()
      unmount()
    }
    for (const role of ['manager', 'staff'] as const) {
      const { unmount } = renderWith(workspace(role, 'suspended'), <ClosureBanner />)
      expect(restoreButton()).not.toBeInTheDocument()
      expect(screen.getByText(/ask an owner or administrator/i)).toBeInTheDocument()
      unmount()
    }
  })

  it('gives every role a mailto link to support while suspended', () => {
    for (const role of ['owner', 'admin', 'manager', 'staff'] as const) {
      const { unmount } = renderWith(workspace(role, 'suspended'), <ClosureBanner />)
      expect(screen.getByRole('link', { name: SUPPORT_EMAIL })).toHaveAttribute(
        'href',
        `mailto:${SUPPORT_EMAIL}`,
      )
      unmount()
    }
  })

  it('says the purge is under way and offers no restore once it has started', () => {
    renderWith(workspace('owner', 'purging'), <ClosureBanner />)
    expect(screen.getByText(/being deleted/i)).toBeInTheDocument()
    expect(restoreButton()).not.toBeInTheDocument()
  })

  it('says the agency is closed once it is', () => {
    renderWith(workspace('owner', 'closed'), <ClosureBanner />)
    expect(screen.getByText(/has been closed/i)).toBeInTheDocument()
    expect(restoreButton()).not.toBeInTheDocument()
  })
})

describe('billing banner and closure banner together', () => {
  it('lets closure win over a billing restriction, and does not promise paying will restore work', () => {
    const value = { ...workspace('owner', 'suspended'), billingAccessState: 'restricted' as const }
    renderWith(
      value,
      <>
        <ClosureBanner />
        <RestrictedBanner />
      </>,
    )

    expect(screen.getByText(/suspended and read-only/i)).toBeInTheDocument()
    expect(screen.queryByText(/starting a subscription/i)).toBeNull()
  })

  it('still shows the billing banner for a restricted agency that is open', () => {
    const value = { ...workspace('owner', 'open'), billingAccessState: 'restricted' as const }
    renderWith(value, <RestrictedBanner />)
    expect(screen.getByText(/starting a subscription/i)).toBeInTheDocument()
  })
})

describe('what the rest of the product offers a closing agency', () => {
  function Probe() {
    return <span data-testid="a">{usePermission('rentals.create') ? 'offered' : 'withdrawn'}</span>
  }

  it('withdraws writing while suspended, purging or closed, because the database refuses it', () => {
    for (const state of ['suspended', 'purging', 'closed'] as const) {
      const { unmount } = renderWith(workspace('owner', state), <Probe />)
      expect(screen.getByTestId('a')).toHaveTextContent('withdrawn')
      unmount()
    }
  })

  it('leaves an open agency alone', () => {
    renderWith(workspace('owner', 'open'), <Probe />)
    expect(screen.getByTestId('a')).toHaveTextContent('offered')
  })

  function ProbeFor({ permission }: { permission: Permission }) {
    return <span data-testid="a">{usePermission(permission) ? 'offered' : 'withdrawn'}</span>
  }

  function ask(permission: Permission, role: OrgRole, state: ClosureState): string {
    const { unmount } = renderWith(workspace(role, state), <ProbeFor permission={permission} />)
    const answer = screen.getByTestId('a').textContent ?? ''
    unmount()
    return answer
  }

  it('withdraws billing, because buying a subscription would wedge the purge open', () => {
    /*
     * app.organization_claim_purge refuses while a subscription is live, so an
     * agency that subscribes after asking to close is recorded `blocked` on
     * every run for ever and is never purged. The billing exemption was written
     * for a LAPSED agency, where billing is the way out; for a CLOSING one it is
     * a way to keep the data.
     */
    for (const state of ['suspended', 'purging', 'closed'] as const) {
      expect(ask('billing.manage', 'owner', state)).toBe('withdrawn')
    }
    expect(ask('billing.manage', 'owner', 'open')).toBe('offered')
  })

  it('withdraws changing and removing team members, as the database now does', () => {
    // A compromised sole owner who requested closure must not be able to remove
    // the administrators who could restore the agency.
    for (const state of ['suspended', 'purging', 'closed'] as const) {
      expect(ask('team.remove', 'admin', state)).toBe('withdrawn')
      expect(ask('team.update', 'admin', state)).toBe('withdrawn')
    }
  })

  it('leaves the ways out that closure does not refuse', () => {
    expect(ask('organization.update', 'admin', 'suspended')).toBe('offered')
    expect(ask('team.transferOwnership', 'owner', 'suspended')).toBe('offered')
    expect(ask('rentals.view', 'staff', 'suspended')).toBe('offered')
  })

  it('classifies every permission a closing agency keeps, and the list is visible here', () => {
    const kept = (Object.keys(PERMISSIONS) as Permission[]).filter(
      (permission) => !isWithdrawnWhenClosing(permission),
    )

    expect([...kept].sort()).toEqual([
      'customerDocuments.view',
      'customers.view',
      'expenses.view',
      'financing.view',
      'financingDocuments.view',
      'financingPayments.view',
      'gps.view',
      'lenders.view',
      'organization.update',
      'organization.view',
      'payments.view',
      'rentals.view',
      'reports.view',
      'team.history',
      'team.transferOwnership',
      'team.view',
      'vehicleDocuments.view',
      'vehicles.view',
    ])
  })
})

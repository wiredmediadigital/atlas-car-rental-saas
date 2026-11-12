import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import {
  PERMISSIONS,
  WITHDRAWN_WHEN_RESTRICTED,
  isWithdrawnWhenRestricted,
  type Permission,
} from '@/lib/authz/permissions'
import {
  WorkspaceContext,
  usePermission,
  useIsBillingRestricted,
  type WorkspaceContextValue,
} from '@/features/workspace/workspace-context'
import type { BillingAccessState, OrgRole } from '@/types/database'

import { RestrictedBanner } from './components/RestrictedBanner'

function workspace(
  role: OrgRole,
  billingAccessState: BillingAccessState | null,
): WorkspaceContextValue {
  return {
    status: 'ready',
    memberships: [],
    organization: null,
    membership: null,
    role,
    billingAccessState,
    error: null,
    switchOrganization: () => undefined,
    refresh: () => Promise.resolve(),
  }
}

function wrap(role: OrgRole, state: BillingAccessState | null, children: ReactNode) {
  return (
    <MemoryRouter>
      <WorkspaceContext.Provider value={workspace(role, state)}>
        {children}
      </WorkspaceContext.Provider>
    </MemoryRouter>
  )
}

/** Renders one permission's answer as text so it can be asserted on. */
function Probe({ permission }: { permission: Permission }) {
  return <span data-testid="answer">{usePermission(permission) ? 'offered' : 'withdrawn'}</span>
}

function askFor(permission: Permission, role: OrgRole, state: BillingAccessState | null): string {
  const { unmount } = render(wrap(role, state, <Probe permission={permission} />))
  const answer = screen.getByTestId('answer').textContent ?? ''
  unmount()
  return answer
}

describe('what the interface offers a restricted agency', () => {
  it('withdraws writing', () => {
    expect(askFor('rentals.create', 'staff', 'restricted')).toBe('withdrawn')
    expect(askFor('vehicles.update', 'manager', 'restricted')).toBe('withdrawn')
    expect(askFor('customers.delete', 'admin', 'restricted')).toBe('withdrawn')
    expect(askFor('expenses.create', 'manager', 'restricted')).toBe('withdrawn')
    expect(askFor('financing.create', 'admin', 'restricted')).toBe('withdrawn')
  })

  it('leaves reading alone, which is the whole point', () => {
    expect(askFor('rentals.view', 'staff', 'restricted')).toBe('offered')
    expect(askFor('vehicles.view', 'staff', 'restricted')).toBe('offered')
    expect(askFor('reports.view', 'manager', 'restricted')).toBe('offered')
    expect(askFor('financing.view', 'manager', 'restricted')).toBe('offered')
    expect(askFor('team.history', 'admin', 'restricted')).toBe('offered')
  })

  it('leaves every way out open', () => {
    expect(askFor('billing.manage', 'owner', 'restricted')).toBe('offered')
    expect(askFor('organization.update', 'admin', 'restricted')).toBe('offered')
    expect(askFor('team.remove', 'admin', 'restricted')).toBe('offered')
    expect(askFor('team.update', 'admin', 'restricted')).toBe('offered')
    expect(askFor('team.transferOwnership', 'owner', 'restricted')).toBe('offered')
  })

  it('leaves an owner able to rescue a member locked out of their own account', () => {
    /*
     * The billing gate exists to stop an unpaid agency creating new value, not
     * to strand its staff outside their own records. A member who loses their
     * phone during a lapse would otherwise have no route back at all except the
     * operator running SQL by hand — which this whole design treats as the last
     * resort, not as the billing-restricted default.
     */
    expect(askFor('team.resetFactor', 'owner', 'restricted')).toBe('offered')
  })

  it('withdraws inviting, because that is growth', () => {
    // Matches the guard in public.create_team_invitation. If one of the two
    // changes without the other, the interface offers a control the database
    // refuses — or hides one it would have allowed.
    expect(askFor('team.invite', 'admin', 'restricted')).toBe('withdrawn')
  })

  it('withdraws nothing from an agency that is merely behind on payment', () => {
    // past_due is `attention`, not `restricted`: Stripe is still retrying.
    expect(askFor('rentals.create', 'staff', 'attention')).toBe('offered')
    expect(askFor('vehicles.update', 'manager', 'attention')).toBe('offered')
  })

  it('withdraws nothing while the billing state is still unknown', () => {
    // Otherwise every button on every page renders disabled for a moment on
    // each load, for the overwhelming majority of agencies that are paying.
    expect(askFor('rentals.create', 'staff', null)).toBe('offered')
  })

  it('withdraws nothing in a deployment that never launched billing', () => {
    expect(askFor('rentals.create', 'staff', 'platform_unconfigured')).toBe('offered')
  })

  it('still refuses what the role never allowed', () => {
    // The billing gate is additional, not a replacement. A staff member cannot
    // delete a customer whether or not the subscription is healthy.
    expect(askFor('customers.delete', 'staff', 'normal')).toBe('withdrawn')
    expect(askFor('customers.delete', 'staff', 'restricted')).toBe('withdrawn')
  })

  it('classifies every permission in the matrix, and the list is visible here', () => {
    /*
     * The classification is by naming convention — anything that is not `view`
     * or `history` writes — so the resulting set is written out in full. A new
     * permission that the convention classifies wrongly shows up as a diff on
     * this list rather than as a silently ungated button.
     */
    const kept = (Object.keys(PERMISSIONS) as Permission[]).filter(
      (permission) => !isWithdrawnWhenRestricted(permission),
    )

    expect([...kept].sort()).toEqual([
      'billing.manage',
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
      'team.remove',
      'team.resetFactor',
      'team.transferOwnership',
      'team.update',
      'team.view',
      'vehicleDocuments.view',
      'vehicles.view',
    ])

    // And nothing is in both halves.
    expect(WITHDRAWN_WHEN_RESTRICTED.filter((permission) => kept.includes(permission))).toEqual([])
  })
})

describe('the banner', () => {
  it('says nothing at all when the subscription is healthy', () => {
    render(wrap('owner', 'normal', <RestrictedBanner />))
    expect(screen.queryByText(/read-only/i)).toBeNull()
  })

  it('says nothing when a payment has merely failed', () => {
    render(wrap('owner', 'attention', <RestrictedBanner />))
    expect(screen.queryByText(/read-only/i)).toBeNull()
  })

  it('tells a restricted agency that its records are still there', () => {
    render(wrap('staff', 'restricted', <RestrictedBanner />))

    const text = document.body.textContent ?? ''
    expect(text).toMatch(/read-only/i)
    // The single most important sentence: nothing has been taken away.
    expect(text).toMatch(/still here/i)
    expect(text).toMatch(/exported/i)
  })

  it('offers the owner the way out, and does not tease anybody else with it', () => {
    const { unmount } = render(wrap('owner', 'restricted', <RestrictedBanner />))
    expect(screen.getByRole('link', { name: /billing/i })).toHaveAttribute('href', '/billing')
    unmount()

    render(wrap('manager', 'restricted', <RestrictedBanner />))
    expect(screen.queryByRole('link', { name: /billing/i })).toBeNull()
    expect(document.body.textContent).toMatch(/an owner of this agency/i)
  })
})

describe('useIsBillingRestricted', () => {
  function Flag() {
    return <span data-testid="flag">{useIsBillingRestricted() ? 'yes' : 'no'}</span>
  }

  it.each([
    ['restricted', 'yes'],
    ['attention', 'no'],
    ['normal', 'no'],
    ['platform_unconfigured', 'no'],
  ] as const)('answers %s with %s', (state, expected) => {
    const { unmount } = render(wrap('owner', state, <Flag />))
    expect(screen.getByTestId('flag').textContent).toBe(expected)
    unmount()
  })
})

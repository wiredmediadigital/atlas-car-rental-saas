import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { paths } from '@/app/routes/paths'
import { ToastProvider } from '@/components/ui'
import { SecondFactorContext, type SecondFactorGate } from '@/features/auth/second-factor-context'
import {
  WorkspaceContext,
  type WorkspaceContextValue,
} from '@/features/workspace/workspace-context'
import type { Organization, OrganizationMember, OrgRole } from '@/types/database'

import { SettingsPage } from './SettingsPage'

const mfa = vi.hoisted(() => ({
  removeFactor: vi.fn(),
  generateRecoveryCodes: vi.fn(),
}))

vi.mock('@/features/auth/mfa', () => ({ removeFactor: mfa.removeFactor }))
vi.mock('@/features/auth/mfa-recovery', () => ({
  generateRecoveryCodes: mfa.generateRecoveryCodes,
}))

const CODES = Array.from({ length: 10 }, (_, index) => `CODE00000${index}`)

/** The shared answer the guard above the application is holding. */
const refresh = vi.fn()
const gate: SecondFactorGate = {
  state: { status: 'verified', factorId: 'factor-1' },
  level: 'aal2',
  isLoading: false,
  refresh: () => {
    refresh()
  },
}

// These sections load their own data; the test is about which sections exist.
vi.mock('@/features/rentals/components/ContractTermsSection', () => ({
  ContractTermsSection: () => null,
}))
vi.mock('@/features/notifications/components/NotificationPreferences', () => ({
  NotificationPreferences: () => null,
}))
vi.mock('@/features/settings/components/LogoUploader', () => ({ LogoUploader: () => null }))
vi.mock('@/features/settings/components/AboutSection', () => ({ AboutSection: () => null }))

const organization = {
  id: 'org-1',
  name: 'Atlas Cars',
  slug: 'atlas-cars',
  default_currency: 'EUR',
  time_zone: 'UTC',
  locale: 'en',
  closure_requested_at: null,
  closure_requested_by: null,
  closure_purge_after: null,
  purge_started_at: null,
  closed_at: null,
} as unknown as Organization

function renderSettings(role: OrgRole, hash: string) {
  const membership = { organization_id: 'org-1', user_id: 'user-1', role } as OrganizationMember
  const value: WorkspaceContextValue = {
    status: 'ready',
    memberships: [{ organization, membership }],
    organization,
    membership,
    role,
    billingAccessState: null,
    error: null,
    switchOrganization: () => undefined,
    refresh: () => Promise.resolve(),
  }
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <ToastProvider>
        <SecondFactorContext.Provider value={gate}>
          <MemoryRouter initialEntries={[`/settings${hash}`]}>
            <WorkspaceContext.Provider value={value}>
              <Routes>
                <Route path={paths.settings} element={<SettingsPage />} />
                <Route path={paths.enrollFactor} element={<p>set-up screen</p>} />
              </Routes>
            </WorkspaceContext.Provider>
          </MemoryRouter>
        </SecondFactorContext.Provider>
      </ToastProvider>
    </QueryClientProvider>,
  )
}

describe('SettingsPage close-account section', () => {
  it('does not give a non-admin the account section, even by #account', () => {
    for (const role of ['manager', 'staff'] as const) {
      const { unmount } = renderSettings(role, '#account')
      expect(screen.queryByRole('button', { name: /close this agency/i })).toBeNull()
      expect(screen.queryByRole('region', { name: 'Close account' })).toBeNull()
      expect(screen.getByRole('region', { name: 'General' })).toBeVisible()
      unmount()
    }
  })

  it('gives an owner the section on #account', () => {
    renderSettings('owner', '#account')
    expect(screen.getByRole('button', { name: /close this agency/i })).toBeVisible()
    expect(screen.getByRole('region', { name: 'Close account' })).toBeVisible()
  })
})

// -----------------------------------------------------------------------------

/**
 * The security section.
 *
 * Personal rather than the agency's, like Notifications: every role has an
 * authenticator and every role may replace their own. The regenerate control
 * matters more than it looks — it is the only way back for somebody who
 * finished enrolment without writing their recovery codes down.
 */
describe('SettingsPage security section', () => {
  beforeEach(() => {
    refresh.mockReset()
    mfa.removeFactor.mockReset()
    mfa.generateRecoveryCodes.mockReset()
    mfa.removeFactor.mockResolvedValue(undefined)
    mfa.generateRecoveryCodes.mockResolvedValue(CODES)
  })

  it('says how the account is protected, for every role', () => {
    for (const role of ['owner', 'admin', 'manager', 'staff'] as const) {
      const { unmount } = renderSettings(role, '#security')
      expect(screen.getByRole('region', { name: 'Security' })).toBeVisible()
      expect(screen.getByText(/protected by an authenticator app/i)).toBeVisible()
      unmount()
    }
  })

  it('replaces the authenticator: removes the old one, then asks for the new one', async () => {
    const user = userEvent.setup()
    renderSettings('staff', '#security')

    await user.click(screen.getByRole('button', { name: 'Replace authenticator' }))
    expect(screen.getByText(/stops working straight away/i)).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Remove it and set up a new one' }))

    await waitFor(() => expect(mfa.removeFactor).toHaveBeenCalledWith('factor-1'))
    expect(await screen.findByText('set-up screen')).toBeVisible()
    // The guard above the application is holding "verified"; it has to be told.
    expect(refresh).toHaveBeenCalled()
  })

  it('mints new recovery codes and shows all ten of them once', async () => {
    const user = userEvent.setup()
    renderSettings('staff', '#security')

    await user.click(screen.getByRole('button', { name: 'Generate new recovery codes' }))
    // Replacing them is the whole point, so the old ones are said to be dead
    // before anything is minted.
    expect(screen.getByText(/stop working/i)).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Generate new codes' }))

    const list = await screen.findByRole('list', { name: /recovery codes/i })
    expect(within(list).getAllByRole('listitem')).toHaveLength(10)
    expect(screen.getByText(/shown only once/i)).toBeVisible()
  })

  it('reports a refusal instead of claiming new codes exist', async () => {
    mfa.generateRecoveryCodes.mockRejectedValue(new Error('nope'))
    const user = userEvent.setup()
    renderSettings('staff', '#security')

    await user.click(screen.getByRole('button', { name: 'Generate new recovery codes' }))
    await user.click(screen.getByRole('button', { name: 'Generate new codes' }))

    expect(await screen.findByRole('alert')).toBeVisible()
    expect(screen.queryByRole('list', { name: /recovery codes/i })).toBeNull()
  })
})

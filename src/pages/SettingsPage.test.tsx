import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import { ToastProvider } from '@/components/ui'
import {
  WorkspaceContext,
  type WorkspaceContextValue,
} from '@/features/workspace/workspace-context'
import type { Organization, OrganizationMember, OrgRole } from '@/types/database'

import { SettingsPage } from './SettingsPage'

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
        <MemoryRouter initialEntries={[`/settings${hash}`]}>
          <WorkspaceContext.Provider value={value}>
            <SettingsPage />
          </WorkspaceContext.Provider>
        </MemoryRouter>
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

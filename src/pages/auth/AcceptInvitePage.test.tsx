import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { User } from '@supabase/supabase-js'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { paths } from '@/app/routes/paths'
import { AuthContext, type AuthContextValue } from '@/features/auth/auth-context'

import { AcceptInvitePage } from './AcceptInvitePage'

/**
 * An invited team member never passes through the sign-up screen, and they are
 * the people who will go on to handle renters' identity documents. So the
 * agreement is asked for here, at the one step every invited person takes, and
 * recorded by the server once they are a member.
 */

const team = vi.hoisted(() => ({ previewInvitation: vi.fn(), acceptInvitation: vi.fn() }))
const auth = vi.hoisted(() => ({
  signIn: vi.fn(),
  signUp: vi.fn(),
  recordTermsAcceptance: vi.fn(),
}))

vi.mock('@/features/team/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  previewInvitation: team.previewInvitation,
  acceptInvitation: team.acceptInvitation,
}))

vi.mock('@/features/auth/api', () => ({
  signIn: auth.signIn,
  signUp: auth.signUp,
  recordTermsAcceptance: auth.recordTermsAcceptance,
}))

const TOKEN = 'a-token-long-enough-to-be-read'

const user = { id: 'user-1', email: 'invited@agency.test' } as User

const session: AuthContextValue = {
  status: 'authenticated',
  session: null,
  user,
  isRecoverySession: false,
  signOut: vi.fn(),
}

function renderPage() {
  window.location.hash = `#token=${TOKEN}`
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  return render(
    <QueryClientProvider client={client}>
      <AuthContext.Provider value={session}>
        <MemoryRouter initialEntries={[paths.acceptInvite]}>
          <Routes>
            <Route path={paths.acceptInvite} element={<AcceptInvitePage />} />
            <Route path={paths.overview} element={<p>overview screen</p>} />
          </Routes>
        </MemoryRouter>
      </AuthContext.Provider>
    </QueryClientProvider>,
  )
}

function agreement(): HTMLInputElement {
  return screen.getByRole('checkbox', { name: /i agree to the terms of service/i })
}

async function joinButton(): Promise<HTMLElement> {
  return screen.findByRole('button', { name: /join lovelace motors/i })
}

beforeEach(() => {
  vi.resetAllMocks()
  team.previewInvitation.mockResolvedValue({
    organizationName: 'Lovelace Motors',
    role: 'manager',
    roleLabel: 'Manager',
    expiresAt: null,
    state: 'pending',
    invitedByName: 'Ada',
    emailMasked: 'i•••••@agency.test',
  })
  team.acceptInvitation.mockResolvedValue({
    organization_id: 'org-1',
    organization_name: 'Lovelace Motors',
    role: 'manager',
    outcome: 'joined',
  })
  auth.recordTermsAcceptance.mockResolvedValue(undefined)
})

describe('agreeing to the terms before joining', () => {
  it('starts unticked', async () => {
    renderPage()
    await joinButton()

    expect(agreement()).not.toBeChecked()
  })

  it('refuses to join and says so when the box is left unticked', async () => {
    const actor = userEvent.setup()
    renderPage()

    await actor.click(await joinButton())

    expect(await screen.findByText(/terms of service to continue/i)).toBeVisible()
    expect(team.acceptInvitation).not.toHaveBeenCalled()
  })

  it('joins once the box is ticked', async () => {
    const actor = userEvent.setup()
    renderPage()
    await joinButton()
    await actor.click(agreement())

    await actor.click(await joinButton())

    expect(await screen.findByText('overview screen')).toBeVisible()
    expect(team.acceptInvitation).toHaveBeenCalledWith(TOKEN)
  })

  it('records the acceptance on the server once the membership exists', async () => {
    const actor = userEvent.setup()
    renderPage()
    await joinButton()
    await actor.click(agreement())

    await actor.click(await joinButton())

    expect(await screen.findByText('overview screen')).toBeVisible()
    expect(auth.recordTermsAcceptance).toHaveBeenCalled()
  })

  it('records nothing when the invitation was never accepted', async () => {
    const actor = userEvent.setup()
    renderPage()

    await actor.click(await joinButton())

    expect(await screen.findByText(/terms of service to continue/i)).toBeVisible()
    expect(auth.recordTermsAcceptance).not.toHaveBeenCalled()
  })

  it('points at the terms and at the privacy notice, in this tab', async () => {
    renderPage()
    await joinButton()

    const terms = screen.getByRole('link', { name: /terms of service/i })
    const privacy = screen.getByRole('link', { name: /privacy policy/i })

    expect(terms).toHaveAttribute('href', paths.terms)
    expect(privacy).toHaveAttribute('href', paths.privacy)
    expect(terms).not.toHaveAttribute('target')
    expect(privacy).not.toHaveAttribute('target')
  })

  it('agrees to the terms but is only informed by the privacy notice', async () => {
    renderPage()
    await joinButton()

    expect(agreement()).toHaveAccessibleName(
      'I agree to the Terms of Service and have read the Privacy Policy.',
    )
  })
})

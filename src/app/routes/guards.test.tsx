import type { Session } from '@supabase/supabase-js'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ToastProvider } from '@/components/ui'
import { SecondFactorProvider } from '@/features/auth/SecondFactorProvider'
import { AuthContext, type AuthContextValue, type AuthStatus } from '@/features/auth/auth-context'
import type { AssuranceLevel, FactorState } from '@/features/auth/mfa'
import { SecondFactorContext, type SecondFactorGate } from '@/features/auth/second-factor-context'
import {
  WorkspaceContext,
  type WorkspaceContextValue,
  type WorkspaceStatus,
} from '@/features/workspace/workspace-context'
import { ChallengeFactorPage } from '@/pages/auth/ChallengeFactorPage'
import { EnrollFactorPage } from '@/pages/auth/EnrollFactorPage'
import type { OrgRole } from '@/types/database'

import {
  RequireAnonymous,
  RequireAuth,
  RequireOrganization,
  RequirePermission,
  RequireSecondFactor,
} from './guards'
import { paths } from './paths'

const mfa = vi.hoisted(() => ({
  listFactorState: vi.fn(),
  assuranceLevel: vi.fn(),
  beginEnrolment: vi.fn(),
  completeEnrolment: vi.fn(),
  challenge: vi.fn(),
  generateRecoveryCodes: vi.fn(),
}))

vi.mock('@/features/auth/mfa', () => ({
  listFactorState: mfa.listFactorState,
  assuranceLevel: mfa.assuranceLevel,
  beginEnrolment: mfa.beginEnrolment,
  completeEnrolment: mfa.completeEnrolment,
  challenge: mfa.challenge,
}))
vi.mock('@/features/auth/mfa-recovery', () => ({
  generateRecoveryCodes: mfa.generateRecoveryCodes,
}))

function authValue(status: AuthStatus): AuthContextValue {
  const session = status === 'authenticated' ? ({ user: { id: 'user-1' } } as Session) : null
  return {
    status,
    session,
    user: session?.user ?? null,
    isRecoverySession: false,
    signOut: () => Promise.resolve(),
  }
}

function workspaceValue(
  status: WorkspaceStatus,
  role: OrgRole | null = 'staff',
): WorkspaceContextValue {
  return {
    status,
    memberships: [],
    organization: null,
    membership: null,
    role,
    billingAccessState: null,
    error: null,
    switchOrganization: () => undefined,
    refresh: () => Promise.resolve(),
  }
}

function renderRoutes(options: {
  initialPath: string
  auth: AuthStatus
  workspace?: WorkspaceStatus
  role?: OrgRole | null
  children: ReactNode
}) {
  return render(
    <AuthContext.Provider value={authValue(options.auth)}>
      <WorkspaceContext.Provider
        value={workspaceValue(options.workspace ?? 'ready', options.role ?? 'staff')}
      >
        <MemoryRouter initialEntries={[options.initialPath]}>
          <Routes>
            {options.children}
            <Route path={paths.signIn} element={<p>Sign in screen</p>} />
            <Route path={paths.createAgency} element={<p>Create agency screen</p>} />
          </Routes>
        </MemoryRouter>
      </WorkspaceContext.Provider>
    </AuthContext.Provider>,
  )
}

describe('RequireAuth', () => {
  it('renders the protected page for a signed-in user', () => {
    renderRoutes({
      initialPath: '/protected',
      auth: 'authenticated',
      children: (
        <Route element={<RequireAuth />}>
          <Route path="/protected" element={<p>Protected content</p>} />
        </Route>
      ),
    })

    expect(screen.getByText('Protected content')).toBeInTheDocument()
  })

  it('redirects a signed-out user to sign in', () => {
    renderRoutes({
      initialPath: '/protected',
      auth: 'unauthenticated',
      children: (
        <Route element={<RequireAuth />}>
          <Route path="/protected" element={<p>Protected content</p>} />
        </Route>
      ),
    })

    expect(screen.getByText('Sign in screen')).toBeInTheDocument()
    expect(screen.queryByText('Protected content')).not.toBeInTheDocument()
  })

  it('waits rather than redirecting while the session is being restored', () => {
    // This is what stops a page reload from flashing the sign-in screen at a
    // user who is, in fact, signed in.
    renderRoutes({
      initialPath: '/protected',
      auth: 'loading',
      children: (
        <Route element={<RequireAuth />}>
          <Route path="/protected" element={<p>Protected content</p>} />
        </Route>
      ),
    })

    expect(screen.queryByText('Sign in screen')).not.toBeInTheDocument()
    expect(screen.queryByText('Protected content')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  describe('the publicHome branch', () => {
    it('shows the public home to a signed-out visitor at the root path', () => {
      renderRoutes({
        initialPath: paths.overview,
        auth: 'unauthenticated',
        children: (
          <Route element={<RequireAuth publicHome={<p>Marketing home</p>} />}>
            <Route path={paths.overview} element={<p>Overview</p>} />
          </Route>
        ),
      })

      expect(screen.getByText('Marketing home')).toBeInTheDocument()
      expect(screen.queryByText('Overview')).not.toBeInTheDocument()
      expect(screen.queryByText('Sign in screen')).not.toBeInTheDocument()
    })

    it('still redirects a signed-out visitor away from every other protected path', () => {
      renderRoutes({
        initialPath: '/protected',
        auth: 'unauthenticated',
        children: (
          <Route element={<RequireAuth publicHome={<p>Marketing home</p>} />}>
            <Route path={paths.overview} element={<p>Overview</p>} />
            <Route path="/protected" element={<p>Protected content</p>} />
          </Route>
        ),
      })

      expect(screen.getByText('Sign in screen')).toBeInTheDocument()
      expect(screen.queryByText('Marketing home')).not.toBeInTheDocument()
      expect(screen.queryByText('Protected content')).not.toBeInTheDocument()
    })

    it('renders the authenticated route at the root path for a signed-in user, not the public home', () => {
      renderRoutes({
        initialPath: paths.overview,
        auth: 'authenticated',
        children: (
          <Route element={<RequireAuth publicHome={<p>Marketing home</p>} />}>
            <Route path={paths.overview} element={<p>Overview</p>} />
          </Route>
        ),
      })

      expect(screen.getByText('Overview')).toBeInTheDocument()
      expect(screen.queryByText('Marketing home')).not.toBeInTheDocument()
    })

    it('does not show the public home at the root path when none was provided', () => {
      // Every other caller of RequireAuth omits `publicHome` and must keep
      // redirecting a signed-out visitor at `/`, exactly as before this branch
      // existed.
      renderRoutes({
        initialPath: paths.overview,
        auth: 'unauthenticated',
        children: (
          <Route element={<RequireAuth />}>
            <Route path={paths.overview} element={<p>Overview</p>} />
          </Route>
        ),
      })

      expect(screen.getByText('Sign in screen')).toBeInTheDocument()
      expect(screen.queryByText('Overview')).not.toBeInTheDocument()
    })
  })
})

describe('RequireAnonymous', () => {
  it('keeps a signed-in user off the sign-in screen', () => {
    renderRoutes({
      initialPath: paths.signIn,
      auth: 'authenticated',
      children: (
        <Route element={<RequireAnonymous />}>
          <Route path={paths.signIn} element={<p>Sign in form</p>} />
        </Route>
      ),
    })

    expect(screen.queryByText('Sign in form')).not.toBeInTheDocument()
  })
})

describe('RequireOrganization', () => {
  it('renders the page when an agency is active', () => {
    renderRoutes({
      initialPath: '/app',
      auth: 'authenticated',
      workspace: 'ready',
      children: (
        <Route element={<RequireOrganization />}>
          <Route path="/app" element={<p>Agency workspace</p>} />
        </Route>
      ),
    })

    expect(screen.getByText('Agency workspace')).toBeInTheDocument()
  })

  it('sends a user with no agency to onboarding', () => {
    renderRoutes({
      initialPath: '/app',
      auth: 'authenticated',
      workspace: 'no-organization',
      children: (
        <Route element={<RequireOrganization />}>
          <Route path="/app" element={<p>Agency workspace</p>} />
        </Route>
      ),
    })

    expect(screen.getByText('Create agency screen')).toBeInTheDocument()
  })
})

describe('RequirePermission', () => {
  it('renders the section for a role that holds the permission', () => {
    renderRoutes({
      initialPath: '/reports',
      auth: 'authenticated',
      role: 'manager',
      children: (
        <Route element={<RequirePermission permission="reports.view" />}>
          <Route path="/reports" element={<p>Reports</p>} />
        </Route>
      ),
    })

    expect(screen.getByText('Reports')).toBeInTheDocument()
  })

  it('explains the refusal instead of showing an empty section', () => {
    renderRoutes({
      initialPath: '/reports',
      auth: 'authenticated',
      role: 'staff',
      children: (
        <Route element={<RequirePermission permission="reports.view" />}>
          <Route path="/reports" element={<p>Reports</p>} />
        </Route>
      ),
    })

    expect(screen.queryByText('Reports')).not.toBeInTheDocument()
    expect(screen.getByText(/do not have access to this section/i)).toBeInTheDocument()
    expect(screen.getByText(/owner or administrator/i)).toBeInTheDocument()
  })
})

// -----------------------------------------------------------------------------

/**
 * The second-factor guard.
 *
 * Three things are being protected here, and each of them came out of a review
 * rather than out of taste:
 *
 *   1. The decision order is `isLoading` -> unknown -> status. A refresh keeps
 *      the previous answer while the new read is in flight, so anything that
 *      reads `state` before `isLoading` is reading a superseded answer.
 *   2. Unknown is NOT enrolled. A dropped connection must not become a way past
 *      the whole feature.
 *   3. The second-factor screens themselves are never redirected, or a user with
 *      no factor has nowhere at all to go.
 */

function gate(over: Partial<SecondFactorGate> = {}): SecondFactorGate {
  return {
    state: { status: 'verified', factorId: 'factor-1' },
    level: 'aal2',
    isLoading: false,
    refresh: () => undefined,
    ...over,
  }
}

/** Reports where a redirect said the user had been going. */
function Probe({ label }: { label: string }) {
  const location = useLocation()
  const state = location.state as { from?: string } | null
  return <p>{state?.from ? `${label} from ${state.from}` : label}</p>
}

function renderGuarded(value: SecondFactorGate, initialPath: string = paths.overview) {
  return render(
    <AuthContext.Provider value={authValue('authenticated')}>
      <SecondFactorContext.Provider value={value}>
        <MemoryRouter initialEntries={[initialPath]}>
          <Routes>
            <Route element={<RequireAuth />}>
              <Route path={paths.enrollFactor} element={<Probe label="Set-up screen" />} />
              <Route path={paths.challengeFactor} element={<Probe label="Verify screen" />} />
              <Route path={paths.recoverFactor} element={<Probe label="Recover screen" />} />
            </Route>
            <Route element={<RequireAuth />}>
              <Route element={<RequireSecondFactor />}>
                <Route path={paths.overview} element={<p>Dashboard</p>} />
                <Route path={paths.rentals} element={<p>Rentals</p>} />
              </Route>
            </Route>
          </Routes>
        </MemoryRouter>
      </SecondFactorContext.Provider>
    </AuthContext.Provider>,
  )
}

describe('RequireSecondFactor', () => {
  it('lets an enrolled user with an aal2 session through', () => {
    renderGuarded(gate())

    expect(screen.getByText('Dashboard')).toBeInTheDocument()
  })

  it('sends a user with no factor to enrolment', () => {
    renderGuarded(gate({ state: { status: 'none', factorId: null }, level: 'aal1' }))

    expect(screen.getByText(/Set-up screen/)).toBeInTheDocument()
    expect(screen.queryByText('Dashboard')).not.toBeInTheDocument()
  })

  it('treats an abandoned enrolment as no factor at all', () => {
    renderGuarded(gate({ state: { status: 'unverified', factorId: 'factor-1' }, level: 'aal1' }))

    expect(screen.getByText(/Set-up screen/)).toBeInTheDocument()
  })

  it('fails closed: an unknown factor state is not enrolled', () => {
    // A failed read must never become a bypass of the whole feature.
    renderGuarded(gate({ state: null, level: null }))

    expect(screen.getByText(/Set-up screen/)).toBeInTheDocument()
    expect(screen.queryByText('Dashboard')).not.toBeInTheDocument()
  })

  it('sends an enrolled user whose session is still aal1 to the challenge', () => {
    renderGuarded(gate({ level: 'aal1' }))

    expect(screen.getByText(/Verify screen/)).toBeInTheDocument()
    expect(screen.queryByText('Dashboard')).not.toBeInTheDocument()
  })

  it('fails closed: an unknown assurance level is not aal2', () => {
    renderGuarded(gate({ level: null }))

    expect(screen.getByText(/Verify screen/)).toBeInTheDocument()
    expect(screen.queryByText('Dashboard')).not.toBeInTheDocument()
  })

  it('decides nothing while a read is in flight, even holding a verified state', () => {
    // The order matters: a refresh keeps the previous answer, and letting a
    // stale "verified" through is what checking isLoading first prevents.
    renderGuarded(gate({ isLoading: true }))

    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.queryByText('Dashboard')).not.toBeInTheDocument()
    expect(screen.queryByText(/Set-up screen/)).not.toBeInTheDocument()
  })

  it('decides nothing while a read is in flight, even holding no factor at all', () => {
    renderGuarded(gate({ state: null, level: null, isLoading: true }))

    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.queryByText(/Set-up screen/)).not.toBeInTheDocument()
  })

  it('remembers where the user was going', () => {
    renderGuarded(gate({ state: { status: 'none', factorId: null } }), paths.rentals)

    expect(screen.getByText('Set-up screen from /rentals')).toBeInTheDocument()
  })

  it.each([
    [paths.enrollFactor, 'Set-up screen'],
    [paths.challengeFactor, 'Verify screen'],
    [paths.recoverFactor, 'Recover screen'],
  ])('never redirects %s into a loop', (path, label) => {
    // These sit outside the guard on purpose: redirecting them would leave a
    // user with no factor with nowhere at all to go.
    renderGuarded(gate({ state: null, level: null }), path)

    expect(screen.getByText(label)).toBeInTheDocument()
  })
})

// -----------------------------------------------------------------------------

/**
 * The journeys, end to end.
 *
 * These are the tests that matter. Everything above asserts one decision in
 * isolation; the loop these prevent only appears when the guard, the provider
 * and the enrolment screen run together - the guard's view of the factor state
 * is established before enrolment starts, and if nothing re-reads it, it is
 * still the pre-enrolment answer when the user finishes. The guard then sends
 * them straight back to set-up, forever, on the first sign-in of every account.
 */

const CODES = Array.from({ length: 10 }, (_, index) => `CODE00000${index}`)

let factor: FactorState
let level: AssuranceLevel

function renderJourney(initialPath: string) {
  return render(
    <AuthContext.Provider value={authValue('authenticated')}>
      <ToastProvider>
        <SecondFactorProvider>
          <MemoryRouter initialEntries={[initialPath]}>
            <Routes>
              <Route element={<RequireAuth />}>
                <Route path={paths.enrollFactor} element={<EnrollFactorPage />} />
                <Route path={paths.challengeFactor} element={<ChallengeFactorPage />} />
              </Route>
              <Route element={<RequireAuth />}>
                <Route element={<RequireSecondFactor />}>
                  <Route path={paths.overview} element={<p>Dashboard</p>} />
                  <Route path={paths.rentals} element={<p>Rentals list</p>} />
                </Route>
              </Route>
            </Routes>
          </MemoryRouter>
        </SecondFactorProvider>
      </ToastProvider>
    </AuthContext.Provider>,
  )
}

describe('the second-factor journeys', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    factor = { status: 'none', factorId: null }
    level = 'aal1'

    mfa.listFactorState.mockImplementation(() => Promise.resolve(factor))
    mfa.assuranceLevel.mockImplementation(() => Promise.resolve(level))
    mfa.beginEnrolment.mockResolvedValue({
      factorId: 'factor-1',
      qrCodeSvg: 'data:image/svg+xml;utf-8,<svg xmlns="http://www.w3.org/2000/svg"></svg>',
      secret: 'JBSWY3DPEHPK3PXP',
    })
    mfa.completeEnrolment.mockImplementation(() => {
      // What the auth server does: the factor becomes verified, and the session
      // it was proved on is upgraded to aal2.
      factor = { status: 'verified', factorId: 'factor-1' }
      level = 'aal2'
      return Promise.resolve()
    })
    mfa.challenge.mockImplementation(() => {
      level = 'aal2'
      return Promise.resolve()
    })
    mfa.generateRecoveryCodes.mockResolvedValue(CODES)
  })

  it('takes an unenrolled user through set-up and into the application', async () => {
    const user = userEvent.setup()
    renderJourney(paths.overview)

    expect(
      await screen.findByRole('heading', { name: /set up two-factor authentication/i, level: 1 }),
    ).toBeVisible()

    await user.type(await screen.findByLabelText(/6-digit code/i), '123456')
    await user.click(screen.getByRole('button', { name: /verify and continue/i }))

    await user.click(await screen.findByRole('checkbox', { name: /saved these recovery codes/i }))
    await user.click(screen.getByRole('button', { name: /^continue$/i }))

    expect(await screen.findByText('Dashboard')).toBeVisible()
    // The loop: back at set-up, with no way out, on every account's first sign-in.
    expect(
      screen.queryByRole('heading', { name: /set up two-factor authentication/i, level: 1 }),
    ).toBeNull()
  })

  it('takes an enrolled user through the challenge and on to where they were going', async () => {
    factor = { status: 'verified', factorId: 'factor-1' }
    const user = userEvent.setup()
    renderJourney(paths.rentals)

    expect(
      await screen.findByRole('heading', { name: /verify your sign-in/i, level: 1 }),
    ).toBeVisible()

    await user.type(await screen.findByLabelText(/6-digit code/i), '123456')
    await user.click(screen.getByRole('button', { name: /^verify$/i }))

    expect(await screen.findByText('Rentals list')).toBeVisible()
  })
})

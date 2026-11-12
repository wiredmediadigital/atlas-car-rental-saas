import type { Session } from '@supabase/supabase-js'
import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { SecondFactorProvider } from './SecondFactorProvider'
import { AuthContext, type AuthContextValue } from './auth-context'
import { useSecondFactorGate } from './second-factor-context'

const mfa = vi.hoisted(() => ({
  listFactorState: vi.fn(),
  assuranceLevel: vi.fn(),
}))

vi.mock('./mfa', () => ({
  listFactorState: mfa.listFactorState,
  assuranceLevel: mfa.assuranceLevel,
}))

function sessionFor(userId: string): Session {
  return { user: { id: userId } } as Session
}

function authValue(session: Session | null): AuthContextValue {
  return {
    status: session ? 'authenticated' : 'unauthenticated',
    session,
    user: session?.user ?? null,
    isRecoverySession: false,
    signOut: () => Promise.resolve(),
  }
}

/** Renders the gate as text, so a decision can be asserted on. */
function Probe() {
  const { state, level, isLoading } = useSecondFactorGate()
  return (
    <span data-testid="gate">
      {isLoading ? 'loading' : `${state?.status ?? 'unknown'}/${level ?? 'unknown'}`}
    </span>
  )
}

function renderWith(initial: Session | null) {
  let session = initial
  const view = render(
    <AuthContext.Provider value={authValue(session)}>
      <SecondFactorProvider>
        <Probe />
      </SecondFactorProvider>
    </AuthContext.Provider>,
  )
  return {
    gate: () => screen.getByTestId('gate').textContent ?? '',
    setSession: (next: Session | null) => {
      session = next
      view.rerender(
        <AuthContext.Provider value={authValue(session)}>
          <SecondFactorProvider>
            <Probe />
          </SecondFactorProvider>
        </AuthContext.Provider>,
      )
    },
  }
}

beforeEach(() => {
  mfa.listFactorState.mockReset()
  mfa.assuranceLevel.mockReset()
  mfa.listFactorState.mockResolvedValue({ status: 'verified', factorId: 'factor-1' })
  mfa.assuranceLevel.mockResolvedValue('aal2')
})

describe('SecondFactorProvider', () => {
  it('is loading until both reads have landed', async () => {
    const { gate } = renderWith(sessionFor('u1'))

    expect(gate()).toBe('loading')
    await waitFor(() => expect(gate()).toBe('verified/aal2'))
  })

  it('reports an unknown assurance level when the read fails, never aal2', async () => {
    mfa.assuranceLevel.mockRejectedValue(new Error('offline'))
    const { gate } = renderWith(sessionFor('u1'))

    await waitFor(() => expect(gate()).toBe('verified/unknown'))
  })

  it('knows nothing, and reads nothing, while signed out', () => {
    const { gate } = renderWith(null)

    expect(gate()).toBe('unknown/unknown')
    expect(mfa.listFactorState).not.toHaveBeenCalled()
    expect(mfa.assuranceLevel).not.toHaveBeenCalled()
  })

  it('hides the previous user entirely while the new one is being read', async () => {
    const { gate, setSession } = renderWith(sessionFor('u1'))
    await waitFor(() => expect(gate()).toBe('verified/aal2'))

    setSession(sessionFor('u2'))

    expect(gate()).toBe('loading')
  })

  /*
   * The one the user id alone did not cover.
   *
   * The provider sits above the router, so it does not unmount across a sign
   * out. Keyed on the user id, a sign-out followed by a sign-in AS THE SAME
   * PERSON leaves the previous session's answer in place and reports it as
   * settled — and the new session is aal1 until the challenge is passed. The
   * guard would mount WithWorkspace on it, the database would correctly return
   * nothing, and that empty workspace is cached for a minute: the user ends up
   * being told to create an agency they already own.
   */
  it('does not serve the previous session’s answer after a sign-out and a sign-in as the same user', async () => {
    const { gate, setSession } = renderWith(sessionFor('u1'))
    await waitFor(() => expect(gate()).toBe('verified/aal2'))

    setSession(null)
    expect(gate()).toBe('unknown/unknown')

    mfa.listFactorState.mockResolvedValue({ status: 'none', factorId: null })
    mfa.assuranceLevel.mockResolvedValue('aal1')
    setSession(sessionFor('u1'))

    expect(gate()).toBe('loading')
    await waitFor(() => expect(gate()).toBe('none/aal1'))
  })
})

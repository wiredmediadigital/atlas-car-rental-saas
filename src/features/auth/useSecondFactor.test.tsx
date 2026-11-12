import type { Session } from '@supabase/supabase-js'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AuthProvider } from './AuthProvider'
import { AuthContext, type AuthContextValue } from './auth-context'
import type { FactorState } from './mfa'
import { useSecondFactor } from './useSecondFactor'

interface Harness {
  listFactorState: ReturnType<typeof vi.fn<() => Promise<FactorState>>>
  insideAuthCallback: boolean
  callsInsideAuthCallback: number
  authCallback: ((event: string, session: Session | null) => void) | null
}

const harness = vi.hoisted((): Harness => ({
  listFactorState: vi.fn(),
  insideAuthCallback: false,
  callsInsideAuthCallback: 0,
  authCallback: null,
}))

vi.mock('./mfa', () => ({
  listFactorState: () => {
    if (harness.insideAuthCallback) harness.callsInsideAuthCallback += 1
    return harness.listFactorState()
  },
}))

vi.mock('@/lib/supabase/client', () => ({
  getSupabaseClient: () => ({
    auth: {
      getSession: () => Promise.resolve({ data: { session: null } }),
      onAuthStateChange: (callback: Harness['authCallback']) => {
        harness.authCallback = callback
        return { data: { subscription: { unsubscribe: () => undefined } } }
      },
    },
  }),
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

function renderWith(initial: Session | null) {
  let session = initial
  const wrapper = ({ children }: { children: ReactNode }) => (
    <AuthContext.Provider value={authValue(session)}>{children}</AuthContext.Provider>
  )
  const view = renderHook(() => useSecondFactor(), { wrapper })
  return {
    ...view,
    setSession: (next: Session | null) => {
      session = next
      view.rerender()
    },
  }
}

beforeEach(() => {
  harness.listFactorState = vi.fn()
  harness.insideAuthCallback = false
  harness.callsInsideAuthCallback = 0
  harness.authCallback = null
})

describe('useSecondFactor', () => {
  it('is loading, with no state, until the first read resolves', async () => {
    let resolve: (state: FactorState) => void = () => undefined
    harness.listFactorState.mockReturnValue(
      new Promise<FactorState>((r) => {
        resolve = r
      }),
    )

    const { result } = renderWith(sessionFor('u1'))
    expect(result.current.isLoading).toBe(true)
    expect(result.current.state).toBeNull()

    await act(async () => {
      resolve({ status: 'verified', factorId: 'f1' })
      await Promise.resolve()
    })
    expect(result.current.isLoading).toBe(false)
  })

  it.each<FactorState>([
    { status: 'verified', factorId: 'f1' },
    { status: 'unverified', factorId: 'f2' },
    { status: 'none', factorId: null },
  ])('exposes a successful read of $status', async (factor) => {
    harness.listFactorState.mockResolvedValue(factor)

    const { result } = renderWith(sessionFor('u1'))

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.state).toEqual(factor)
  })

  it('leaves state null when the read fails, so unknown is never read as enrolled', async () => {
    harness.listFactorState.mockRejectedValue(new Error('network down'))

    const { result } = renderWith(sessionFor('u1'))

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.state).toBeNull()
  })

  it('does not read, and is not loading, while signed out', () => {
    const { result } = renderWith(null)

    expect(result.current).toMatchObject({ state: null, isLoading: false })
    expect(harness.listFactorState).not.toHaveBeenCalled()
  })

  it('reads again when refresh is called', async () => {
    harness.listFactorState.mockResolvedValueOnce({ status: 'none', factorId: null })
    const { result } = renderWith(sessionFor('u1'))
    await waitFor(() => expect(result.current.state?.status).toBe('none'))

    harness.listFactorState.mockResolvedValueOnce({ status: 'verified', factorId: 'f1' })
    act(() => result.current.refresh())

    await waitFor(() => expect(result.current.state?.status).toBe('verified'))
    expect(harness.listFactorState).toHaveBeenCalledTimes(2)
  })

  it('does not read again on an unrelated re-render or a refreshed session for the same user', async () => {
    harness.listFactorState.mockResolvedValue({ status: 'verified', factorId: 'f1' })
    const { result, rerender, setSession } = renderWith(sessionFor('u1'))
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    rerender()
    setSession(sessionFor('u1'))

    expect(harness.listFactorState).toHaveBeenCalledTimes(1)
  })

  it('reads again, hiding the previous user state, when the user changes', async () => {
    harness.listFactorState.mockResolvedValueOnce({ status: 'verified', factorId: 'f1' })
    const { result, setSession } = renderWith(sessionFor('u1'))
    await waitFor(() => expect(result.current.state?.status).toBe('verified'))

    harness.listFactorState.mockResolvedValueOnce({ status: 'none', factorId: null })
    setSession(sessionFor('u2'))

    expect(result.current.state).toBeNull()
    expect(result.current.isLoading).toBe(true)
    await waitFor(() => expect(result.current.state?.status).toBe('none'))
    expect(harness.listFactorState).toHaveBeenCalledTimes(2)
  })

  it('does not call into supabase-js from inside an auth-state callback', async () => {
    harness.listFactorState.mockResolvedValue({ status: 'verified', factorId: 'f1' })
    const wrapper = ({ children }: { children: ReactNode }) => (
      <AuthProvider>{children}</AuthProvider>
    )
    const { result } = renderHook(() => useSecondFactor(), { wrapper })
    await waitFor(() => expect(harness.authCallback).not.toBeNull())

    act(() => {
      harness.insideAuthCallback = true
      try {
        harness.authCallback?.('SIGNED_IN', sessionFor('u1'))
      } finally {
        harness.insideAuthCallback = false
      }
    })

    await waitFor(() => expect(result.current.state?.status).toBe('verified'))
    expect(harness.listFactorState).toHaveBeenCalledTimes(1)
    expect(harness.callsInsideAuthCallback).toBe(0)
  })
})

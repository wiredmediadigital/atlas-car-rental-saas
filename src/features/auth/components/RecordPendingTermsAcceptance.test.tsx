import { render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { User } from '@supabase/supabase-js'

import { AuthContext, type AuthContextValue, type AuthStatus } from '../auth-context'
import { TERMS_REQUIRED_FROM } from '../terms'

import { RecordPendingTermsAcceptance } from './RecordPendingTermsAcceptance'

/**
 * The window this closes.
 *
 * Recording the agreement on the invitation screen is awaited before the page
 * navigates, so losing it needs the tab to be closed inside that one request.
 * Write-once plus nullable means a lost stamp looks exactly like a grandfathered
 * account, so nobody could ever find these people again — which is why the next
 * boot finishes the job rather than leaving it to a retry queue.
 *
 * THE DATE CHECK IS THE POINT. Every account created since both screens began
 * refusing to submit without the box must have been asked, so a null there is a
 * lost write. An account older than that was never asked at all, and stamping it
 * would turn "we never put the question to this person" into a record saying
 * they answered it.
 */

const api = vi.hoisted(() => ({ fetchTermsAcceptance: vi.fn(), recordTermsAcceptance: vi.fn() }))

vi.mock('../api', () => ({
  fetchTermsAcceptance: api.fetchTermsAcceptance,
  recordTermsAcceptance: api.recordTermsAcceptance,
}))

const AFTER = '2026-11-20T09:00:00.000Z'
const BEFORE = '2026-02-01T09:00:00.000Z'

function renderWith(status: AuthStatus, userId: string | null = 'user-1') {
  const value: AuthContextValue = {
    status,
    session: null,
    user: userId ? ({ id: userId } as User) : null,
    isRecoverySession: false,
    signOut: vi.fn(),
  }

  return render(
    <AuthContext.Provider value={value}>
      <RecordPendingTermsAcceptance />
    </AuthContext.Provider>,
  )
}

beforeEach(() => {
  vi.resetAllMocks()
  api.recordTermsAcceptance.mockResolvedValue(undefined)
})

describe('finishing a lost acceptance', () => {
  it('records it when the account was created after the box existed', async () => {
    api.fetchTermsAcceptance.mockResolvedValue({ acceptedAt: null, accountCreatedAt: AFTER })

    renderWith('authenticated')

    await waitFor(() => expect(api.recordTermsAcceptance).toHaveBeenCalled())
  })

  it('leaves an account that already carries a date alone', async () => {
    api.fetchTermsAcceptance.mockResolvedValue({
      acceptedAt: '2026-11-20T10:00:00.000Z',
      accountCreatedAt: AFTER,
    })

    renderWith('authenticated')

    await waitFor(() => expect(api.fetchTermsAcceptance).toHaveBeenCalled())
    expect(api.recordTermsAcceptance).not.toHaveBeenCalled()
  })

  it('never stamps a grandfathered account, which was never asked', async () => {
    api.fetchTermsAcceptance.mockResolvedValue({ acceptedAt: null, accountCreatedAt: BEFORE })

    renderWith('authenticated')

    await waitFor(() => expect(api.fetchTermsAcceptance).toHaveBeenCalled())
    expect(api.recordTermsAcceptance).not.toHaveBeenCalled()
  })

  it('treats the cut-off itself as the first moment the question was asked', async () => {
    api.fetchTermsAcceptance.mockResolvedValue({
      acceptedAt: null,
      accountCreatedAt: TERMS_REQUIRED_FROM,
    })

    renderWith('authenticated')

    await waitFor(() => expect(api.recordTermsAcceptance).toHaveBeenCalled())
  })

  it('writes nothing on a guess when the read failed', async () => {
    api.fetchTermsAcceptance.mockResolvedValue(null)

    renderWith('authenticated')

    await waitFor(() => expect(api.fetchTermsAcceptance).toHaveBeenCalled())
    expect(api.recordTermsAcceptance).not.toHaveBeenCalled()
  })

  it('writes nothing for an unreadable creation date', async () => {
    api.fetchTermsAcceptance.mockResolvedValue({ acceptedAt: null, accountCreatedAt: 'not a date' })

    renderWith('authenticated')

    await waitFor(() => expect(api.fetchTermsAcceptance).toHaveBeenCalled())
    expect(api.recordTermsAcceptance).not.toHaveBeenCalled()
  })

  it('survives a read that rejects outright', async () => {
    api.fetchTermsAcceptance.mockRejectedValue(new Error('offline'))
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})

    renderWith('authenticated')

    await waitFor(() => expect(logged).toHaveBeenCalled())
    expect(api.recordTermsAcceptance).not.toHaveBeenCalled()
    logged.mockRestore()
  })

  it('asks nothing at all while the session is still being restored', () => {
    renderWith('loading', null)

    expect(api.fetchTermsAcceptance).not.toHaveBeenCalled()
  })

  it('asks nothing at all when nobody is signed in', () => {
    renderWith('unauthenticated', null)

    expect(api.fetchTermsAcceptance).not.toHaveBeenCalled()
  })
})

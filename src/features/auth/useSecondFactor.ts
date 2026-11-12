import { useCallback, useEffect, useState } from 'react'

import { useAuth } from './auth-context'
import { type FactorState, listFactorState } from './mfa'

export interface SecondFactor {
  /**
   * Null means unknown: no read has finished yet, the user is signed out, or
   * the read failed. Treat it as NOT enrolled. It must never be read as
   * "verified", and a consumer that gates access on it must fail closed.
   */
  readonly state: FactorState | null
  readonly isLoading: boolean
  /** Reads the factor state again, e.g. after enrolment completes. */
  readonly refresh: () => void
}

interface FactorResult {
  readonly userId: string
  readonly reads: number
  readonly state: FactorState | null
}

/**
 * Exposes whether the signed-in user has a second factor.
 *
 * Reads from an effect keyed on the user, never from an `onAuthStateChange`
 * callback: that callback runs while supabase-js holds its internal lock, and a
 * re-entrant call from it can deadlock the app. AuthProvider only publishes the
 * session; this effect reacts to it afterwards, outside the lock.
 */
export function useSecondFactor(): SecondFactor {
  const { session } = useAuth()
  const userId = session?.user.id ?? null

  const [reads, setReads] = useState(0)
  // Which user and which read produced `state`. Deriving the answer from this
  // instead of resetting state inside the effect keeps every setState in the
  // effect asynchronous.
  const [result, setResult] = useState<FactorResult | null>(null)

  /*
   * A SIGN-OUT DISCARDS THE ANSWER.
   *
   * Keying on the user id is not enough. Nothing unmounts this hook across a
   * sign out — its consumers sit above the router — so without this the next
   * session is served the previous one's answer, and reported as settled. After
   * a sign-out and a sign-in as THE SAME PERSON the user id cannot tell the two
   * sessions apart at all, and the new one is aal1 until a factor is proved on
   * it: a guard reading that stale answer admits a user the database is
   * refusing data to.
   *
   * The sign-out is the boundary between two sessions, so it is where the
   * answer is dropped. Keying on the access token instead would also fire for
   * the hourly token renewal, which changes nothing and would re-read for it.
   *
   * Adjusted during render rather than from an effect. An effect would paint
   * one frame of the stale answer before clearing it, and a synchronous
   * setState inside an effect is the cascading-render hazard. React re-runs
   * this immediately and commits nothing in between.
   */
  if (userId === null && result !== null) setResult(null)

  useEffect(() => {
    if (userId === null) return

    let active = true
    listFactorState()
      .then((state) => {
        if (active) setResult({ userId, reads, state })
      })
      .catch(() => {
        // Unknown is not "no factor": null keeps a guard from sending a
        // verified user to enrol again because of a failed read.
        if (active) setResult({ userId, reads, state: null })
      })

    return () => {
      active = false
    }
  }, [userId, reads])

  const refresh = useCallback(() => {
    setReads((count) => count + 1)
  }, [])

  const isCurrentUser = result !== null && result.userId === userId
  const isLoading = userId !== null && !(isCurrentUser && result.reads === reads)

  return { state: isCurrentUser ? result.state : null, isLoading, refresh }
}

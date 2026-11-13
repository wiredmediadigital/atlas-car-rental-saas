import { useEffect } from 'react'

import { fetchTermsAcceptance, recordTermsAcceptance } from '../api'
import { useAuth } from '../auth-context'
import { TERMS_REQUIRED_FROM } from '../terms'

/**
 * Finishes recording an agreement whose write was lost.
 *
 * Renders nothing. It exists because of the one window the invitation screen
 * cannot close by itself: the acceptance is recorded in a request the screen
 * awaits before navigating, so losing it takes a tab closed inside that
 * request — rare, but write-once plus nullable means the result is
 * indistinguishable from a grandfathered account, and nobody would ever be able
 * to find these people again.
 *
 * THE DATE CHECK IS WHAT MAKES THIS HONEST, and it is not optional. Both
 * screens now refuse to submit without the box, so an account created since
 * cannot exist without somebody having been shown the sentence and having
 * ticked it: a null there is a lost write, and completing it records something
 * that really happened. An older account was never asked the question at all,
 * and stamping it would manufacture an answer — turning the deliberate,
 * documented null of a grandfathered user into a claim they accepted terms
 * nobody ever put in front of them.
 *
 * Everything else about it is cheap: one read of two columns from the caller's
 * own profile row per session, and no write at all for anybody already stamped.
 * The function it calls is write-once and takes no arguments, so a double boot
 * cannot double-stamp and there is no retry queue to go stale.
 */
export function RecordPendingTermsAcceptance() {
  const { status, user } = useAuth()
  const userId = status === 'authenticated' ? (user?.id ?? null) : null

  useEffect(() => {
    if (!userId) return
    let active = true

    const run = async () => {
      const state = await fetchTermsAcceptance(userId)
      // Null is a failed read. Writing a legal record on the strength of a
      // question that could not be answered is worse than writing nothing.
      if (!active || state === null) return
      if (state.acceptedAt !== null) return

      const createdAt = Date.parse(state.accountCreatedAt)
      if (Number.isNaN(createdAt) || createdAt < Date.parse(TERMS_REQUIRED_FROM)) return

      await recordTermsAcceptance()
    }

    // Neither call rejects of its own accord, so this catches only the
    // unexpected — and an unexpected failure to tidy up a record must not
    // surface as an unhandled rejection on every page the person opens.
    void run().catch(() => {
      console.error('Could not complete the recording of terms acceptance.')
    })

    return () => {
      active = false
    }
  }, [userId])

  return null
}

import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react'

import { useAuth } from './auth-context'
import { type AssuranceLevel, assuranceLevel } from './mfa'
import { SecondFactorContext, type SecondFactorGate } from './second-factor-context'
import { useSecondFactor } from './useSecondFactor'

interface LevelResult {
  readonly userId: string
  readonly reads: number
  readonly level: AssuranceLevel | null
}

/**
 * Holds the answer to "is this person protected, and have they proved it here?"
 * for the whole application.
 *
 * WHY A PROVIDER RATHER THAN A HOOK IN THE GUARD. The guard sits above the
 * application; the enrolment and challenge screens sit beside it, outside it,
 * because an aal1 session is refused tenant data and the workspace cannot be
 * loaded for one. A per-guard read is therefore established before enrolment
 * begins and is whatever React Router's mounting happens to do with it
 * afterwards — which is a redirect loop the day those routes are nested
 * differently, with nothing to say so. One shared answer that the screens
 * refresh when they change it does not depend on where any route sits.
 *
 * It is also read once per sign-in rather than on every navigation. The guard
 * renders a loader whenever a read is in flight, so a read per navigation would
 * blank the application on every page change.
 *
 * NEITHER READ IS KEYED ON THE ACCESS TOKEN, deliberately. The token is renewed
 * on a timer; keying on it would blank the application for the length of a
 * round trip roughly once an hour, for an answer that cannot have changed.
 */
export function SecondFactorProvider({ children }: { children: ReactNode }) {
  const factor = useSecondFactor()
  const { session } = useAuth()
  const userId = session?.user.id ?? null

  const [reads, setReads] = useState(0)
  // Which user and which read produced `level`. Derived rather than reset inside
  // the effect, so every setState stays asynchronous — the same shape, and for
  // the same reason, as useSecondFactor.
  const [result, setResult] = useState<LevelResult | null>(null)

  useEffect(() => {
    if (userId === null) return

    let active = true
    assuranceLevel()
      .then((level) => {
        if (active) setResult({ userId, reads, level })
      })
      .catch(() => {
        // Unknown, not aal2: a failed read must send the user to the challenge,
        // not past it.
        if (active) setResult({ userId, reads, level: null })
      })

    return () => {
      active = false
    }
  }, [userId, reads])

  const refreshFactor = factor.refresh
  const refresh = useCallback(() => {
    refreshFactor()
    setReads((count) => count + 1)
  }, [refreshFactor])

  const isCurrentUser = result !== null && result.userId === userId
  const isLevelLoading = userId !== null && !(isCurrentUser && result.reads === reads)

  const { state, isLoading: isFactorLoading } = factor
  const level = isCurrentUser ? result.level : null

  const value = useMemo<SecondFactorGate>(
    () => ({ state, level, isLoading: isFactorLoading || isLevelLoading, refresh }),
    [state, level, isFactorLoading, isLevelLoading, refresh],
  )

  return <SecondFactorContext.Provider value={value}>{children}</SecondFactorContext.Provider>
}

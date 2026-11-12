import { createContext, useContext } from 'react'

import type { AssuranceLevel, FactorState } from './mfa'

/**
 * Where the signed-in user stands with their second factor, for everything that
 * has to decide something about it.
 *
 * Both answers are nullable, and null means UNKNOWN in both cases: no read has
 * finished, the user is signed out, or the read failed. Nothing may read either
 * null as permission. A consumer that gates access on this fails closed —
 * unknown is "not enrolled" and "not aal2", never the reverse.
 */
export interface SecondFactorGate {
  /** The user's authenticator, or null when unknown. */
  readonly state: FactorState | null
  /** The assurance level of the current session, or null when unknown. */
  readonly level: AssuranceLevel | null
  /**
   * True while a read is in flight. A refresh keeps the PREVIOUS answers
   * visible, so anything that gates on this must check it first or it will act
   * on an answer that has already been superseded.
   */
  readonly isLoading: boolean
  /** Reads both answers again. Called when something has changed them. */
  readonly refresh: () => void
}

export const SecondFactorContext = createContext<SecondFactorGate | null>(null)

export function useSecondFactorGate(): SecondFactorGate {
  const context = useContext(SecondFactorContext)
  if (!context) {
    throw new Error('useSecondFactorGate must be used inside <SecondFactorProvider>.')
  }
  return context
}

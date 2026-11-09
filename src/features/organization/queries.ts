import { useMutation } from '@tanstack/react-query'

import { useWorkspace } from '@/features/workspace/workspace-context'

import { requestClosure, restoreAccount } from './api'
import { type ClosureState, closureStateOf } from './closure'

export interface ClosureStatus {
  readonly state: ClosureState
}

/**
 * Where the active agency is in its closure.
 *
 * Read from the organization row the workspace already holds rather than from a
 * query of its own, so this answers synchronously and never disagrees with the
 * rest of the shell. An agency that has not loaded yet is `open`: nothing is
 * withdrawn on a guess, which is the same stance usePermission takes for
 * billing.
 */
export function useClosureState(): ClosureStatus {
  const { organization } = useWorkspace()
  return { state: closureStateOf(organization) }
}

/**
 * Both actions end by re-reading the workspace, because the closure state lives
 * on the organization row and every page's banner, permissions and navigation
 * follow it. Without the refresh the person who just pressed the button would
 * be looking at the old state.
 */
export function useRequestClosure() {
  const { refresh } = useWorkspace()
  return useMutation({
    mutationFn: (organizationId: string) => requestClosure(organizationId),
    onSuccess: () => refresh(),
  })
}

export function useRestoreAccount() {
  const { refresh } = useWorkspace()
  return useMutation({
    mutationFn: (organizationId: string) => restoreAccount(organizationId),
    onSuccess: () => refresh(),
  })
}

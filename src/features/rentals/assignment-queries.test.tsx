import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { AuthContext } from '@/features/auth/auth-context'
import {
  WorkspaceContext,
  type WorkspaceContextValue,
} from '@/features/workspace/workspace-context'
import type { AuthContextValue } from '@/features/auth/auth-context'

const assignmentEligibilityRpc = vi.fn()
vi.mock('@/lib/supabase/client', () => ({
  getSupabaseClient: () => ({ rpc: assignmentEligibilityRpc }),
}))

import {
  assignmentKeys,
  rentalKeys,
  useRentalAssignmentHistory,
  useSwapActiveVehicle,
} from './queries'
import { fetchRentalAssignmentHistory, swapActiveVehicle } from './api'
import type * as RentalApi from './api'

vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof RentalApi>()),
  fetchRentalAssignmentHistory: vi.fn(),
  swapActiveVehicle: vi.fn(),
}))

function workspace(organizationId: string | null): WorkspaceContextValue {
  return {
    status: organizationId ? 'ready' : 'no-organization',
    memberships: [],
    organization: organizationId
      ? ({ id: organizationId } as WorkspaceContextValue['organization'])
      : null,
    membership: organizationId
      ? ({ organization_id: organizationId } as WorkspaceContextValue['membership'])
      : null,
    role: organizationId ? 'manager' : null,
    billingAccessState: null,
    error: null,
    switchOrganization: vi.fn(),
    refresh: vi.fn(async () => {}),
  }
}

const auth: AuthContextValue = {
  status: 'authenticated',
  session: null,
  user: { id: 'user-a' } as AuthContextValue['user'],
  isRecoverySession: false,
  signOut: vi.fn(async () => {}),
}

describe('assignment query isolation', () => {
  it('never reads history without a server activation and never reuses another tenant cache', () => {
    assignmentEligibilityRpc.mockResolvedValue({
      data: [{ enabled: false, can_view_history: false, can_swap: false }],
      error: null,
    })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    client.setQueryData(rentalKeys.assignmentHistory('org-a', 'rental-a'), [
      { assignment_id: 'old' },
    ])
    let active = workspace('org-a')
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>
        <AuthContext.Provider value={auth}>
          <WorkspaceContext.Provider value={active}>{children}</WorkspaceContext.Provider>
        </AuthContext.Provider>
      </QueryClientProvider>
    )
    const { result, rerender } = renderHook(() => useRentalAssignmentHistory('rental-a'), {
      wrapper,
    })
    expect(result.current.fetchStatus).toBe('idle')
    expect(result.current.data).toHaveLength(1)
    active = workspace('org-b')
    rerender()
    expect(result.current.data).toBeUndefined()
    expect(result.current.fetchStatus).toBe('idle')
    active = workspace(null)
    rerender()
    expect(result.current.fetchStatus).toBe('idle')
    expect(fetchRentalAssignmentHistory).not.toHaveBeenCalled()
  })

  it('invalidates the active tenant history only after a successful swap', async () => {
    assignmentEligibilityRpc.mockClear()
    assignmentEligibilityRpc.mockResolvedValue({
      data: [{ enabled: true, can_view_history: true, can_swap: true }],
      error: null,
    })
    const client = new QueryClient()
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>
        <AuthContext.Provider value={auth}>
          <WorkspaceContext.Provider value={workspace('org-a')}>
            {children}
          </WorkspaceContext.Provider>
        </AuthContext.Provider>
      </QueryClientProvider>
    )
    vi.mocked(swapActiveVehicle)
      .mockResolvedValueOnce({} as never)
      .mockRejectedValueOnce(new Error('denied'))
    const { result } = renderHook(() => useSwapActiveVehicle('rental-a'), { wrapper })
    await waitFor(() =>
      expect(client.getQueryData(assignmentKeys.eligibility('org-a', 'user-a'))).toMatchObject({
        enabled: true,
        canSwap: true,
      }),
    )
    const input = {
      vehicleId: 'vehicle-b',
      reason: 'breakdown' as const,
      reasonNotes: 'test',
      swapAt: '2026-11-20T00:00:00Z',
      odometer: 1,
      fuelPercent: null,
      consentReference: null,
      operationKey: 'operation-a',
    }
    await act(async () => {
      await result.current.mutateAsync(input)
    })
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: rentalKeys.assignmentHistory('org-a', 'rental-a'),
    })
    invalidate.mockClear()
    await act(async () => {
      await expect(result.current.mutateAsync(input)).rejects.toThrow('denied')
    })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(invalidate).not.toHaveBeenCalled()
  })
})

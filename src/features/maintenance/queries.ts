import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'

import { useOrganization } from '@/features/workspace/workspace-context'
import { invalidateVehicleRestrictions } from '@/features/vehicles/queries'
import {
  changeMaintenance,
  createMaintenance,
  deleteMaintenanceDocument,
  fetchMaintenance,
  fetchMaintenanceActualCost,
  fetchMaintenanceDocuments,
  fetchMaintenanceExpenses,
  fetchMaintenanceForIncident,
  fetchVehicleDowntime,
  linkMaintenanceExpense,
  unlinkMaintenanceExpense,
  uploadMaintenanceDocument,
  type MaintenanceAction,
  type MaintenanceDocument,
} from './api'

export const maintenanceKeys = {
  all: (organizationId: string) => ['organization', organizationId, 'maintenance'] as const,
  forIncident: (organizationId: string, incidentId: string) =>
    ['organization', organizationId, 'maintenance', 'incident', incidentId] as const,
  documents: (organizationId: string, maintenanceId: string) =>
    ['organization', organizationId, 'maintenance', maintenanceId, 'documents'] as const,
  expenses: (organizationId: string, maintenanceId: string) =>
    ['organization', organizationId, 'maintenance', maintenanceId, 'expenses'] as const,
  cost: (organizationId: string, maintenanceId: string) =>
    ['organization', organizationId, 'maintenance', maintenanceId, 'cost'] as const,
  downtime: (organizationId: string, vehicleId: string, from: string, to: string) =>
    ['organization', organizationId, 'maintenance', 'downtime', vehicleId, from, to] as const,
}

/**
 * Everything a maintenance change can be seen through.
 *
 * Starting, completing or rescheduling work changes what the fleet says, what
 * the rental forms may offer, what the calendar shows free, and what the
 * incident it came from displays. Invalidating only the maintenance list left
 * a stale "Bookable now" on screen until the operator reloaded the page, which
 * is what the owner reported. `invalidateVehicleRestrictions` owns that whole
 * set so the two modules cannot drift apart.
 */
async function invalidateMaintenance(client: QueryClient, organizationId: string): Promise<void> {
  await invalidateVehicleRestrictions(client, organizationId)
}

export function useMaintenance() {
  const organization = useOrganization()
  return useQuery({
    queryKey: maintenanceKeys.all(organization.id),
    queryFn: () => fetchMaintenance(organization.id),
    staleTime: 15_000,
  })
}

/** The maintenance raised from one incident, for Incident Details. */
export function useMaintenanceForIncident(incidentId: string | undefined) {
  const organization = useOrganization()
  return useQuery({
    queryKey: maintenanceKeys.forIncident(organization.id, incidentId ?? ''),
    queryFn: () => fetchMaintenanceForIncident(organization.id, incidentId ?? ''),
    enabled: Boolean(incidentId),
    staleTime: 15_000,
  })
}

export function useCreateMaintenance() {
  const client = useQueryClient()
  const organization = useOrganization()
  return useMutation({
    mutationFn: (values: Record<string, unknown>) =>
      createMaintenance({ p_organization_id: organization.id, ...values }),
    onSuccess: () => invalidateMaintenance(client, organization.id),
  })
}

export function useMaintenanceAction(action: MaintenanceAction) {
  const client = useQueryClient()
  const organization = useOrganization()
  return useMutation({
    mutationFn: (values: Record<string, unknown>) => changeMaintenance(action, values),
    onSuccess: () => invalidateMaintenance(client, organization.id),
  })
}

export function useMaintenanceDocuments(maintenanceId: string | undefined) {
  const organization = useOrganization()
  return useQuery({
    queryKey: maintenanceKeys.documents(organization.id, maintenanceId ?? ''),
    queryFn: () => fetchMaintenanceDocuments(maintenanceId ?? ''),
    enabled: Boolean(maintenanceId),
  })
}

export function useUploadMaintenanceDocument(maintenanceId: string) {
  const client = useQueryClient()
  const organization = useOrganization()
  return useMutation({
    mutationFn: (file: File) => uploadMaintenanceDocument(organization.id, maintenanceId, file),
    onSuccess: () =>
      client.invalidateQueries({
        queryKey: maintenanceKeys.documents(organization.id, maintenanceId),
      }),
  })
}

export function useDeleteMaintenanceDocument(maintenanceId: string) {
  const client = useQueryClient()
  const organization = useOrganization()
  return useMutation({
    mutationFn: (document: MaintenanceDocument) => deleteMaintenanceDocument(document),
    onSuccess: () =>
      client.invalidateQueries({
        queryKey: maintenanceKeys.documents(organization.id, maintenanceId),
      }),
  })
}

export function useMaintenanceExpenses(maintenanceId: string | undefined) {
  const organization = useOrganization()
  return useQuery({
    queryKey: maintenanceKeys.expenses(organization.id, maintenanceId ?? ''),
    queryFn: () => fetchMaintenanceExpenses(organization.id, maintenanceId ?? ''),
    enabled: Boolean(maintenanceId),
  })
}

/** The sum of the linked expenses. The expense ledger stays the only ledger. */
export function useMaintenanceActualCost(maintenanceId: string | undefined) {
  const organization = useOrganization()
  return useQuery({
    queryKey: maintenanceKeys.cost(organization.id, maintenanceId ?? ''),
    queryFn: () => fetchMaintenanceActualCost(maintenanceId ?? ''),
    enabled: Boolean(maintenanceId),
  })
}

export function useLinkMaintenanceExpense(maintenanceId: string) {
  const client = useQueryClient()
  const organization = useOrganization()
  return useMutation({
    mutationFn: (expenseId: string) => linkMaintenanceExpense(maintenanceId, expenseId),
    onSuccess: () => invalidateMaintenance(client, organization.id),
  })
}

export function useUnlinkMaintenanceExpense(_maintenanceId: string) {
  const client = useQueryClient()
  const organization = useOrganization()
  return useMutation({
    mutationFn: (expenseId: string) => unlinkMaintenanceExpense(expenseId),
    onSuccess: () => invalidateMaintenance(client, organization.id),
  })
}

export function useVehicleDowntime(vehicleId: string | undefined, from: string, to: string) {
  const organization = useOrganization()
  return useQuery({
    queryKey: maintenanceKeys.downtime(organization.id, vehicleId ?? '', from, to),
    queryFn: () => fetchVehicleDowntime(vehicleId ?? '', from, to),
    enabled: Boolean(vehicleId),
    // Unfinished work accrues against now(), so this answer ages continuously.
    staleTime: 30_000,
  })
}

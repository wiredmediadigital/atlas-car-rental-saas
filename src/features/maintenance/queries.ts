import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'

import { createExpense } from '@/features/expenses/api'
import { invalidateExpenses } from '@/features/expenses/queries'
import type { ExpenseFormValues } from '@/features/expenses/schemas'
import { useOrganization } from '@/features/workspace/workspace-context'
import { invalidateVehicleRestrictions } from '@/features/vehicles/queries'
import {
  changeMaintenance,
  createMaintenance,
  deleteMaintenanceDocument,
  fetchLinkableExpenses,
  fetchMaintenance,
  fetchMaintenanceActualCost,
  fetchMaintenanceDocuments,
  fetchMaintenanceExpenses,
  fetchMaintenanceForIncident,
  fetchMaintenanceForVehicle,
  fetchMaintenanceSpend,
  fetchMaintenanceCostsByRecord,
  fetchMaintenanceStatusCounts,
  fetchFleetDowntime,
  fetchServicingFleet,
  fetchServicePlans,
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
  forVehicle: (organizationId: string, vehicleId: string) =>
    ['organization', organizationId, 'maintenance', 'vehicle', vehicleId] as const,
  documents: (organizationId: string, maintenanceId: string) =>
    ['organization', organizationId, 'maintenance', maintenanceId, 'documents'] as const,
  expenses: (organizationId: string, maintenanceId: string) =>
    ['organization', organizationId, 'maintenance', maintenanceId, 'expenses'] as const,
  cost: (organizationId: string, maintenanceId: string) =>
    ['organization', organizationId, 'maintenance', maintenanceId, 'cost'] as const,
  linkable: (organizationId: string, vehicleId: string) =>
    ['organization', organizationId, 'maintenance', 'linkable-expenses', vehicleId] as const,
  servicePlans: (organizationId: string) =>
    ['organization', organizationId, 'maintenance', 'service-plans'] as const,
  servicingFleet: (organizationId: string) =>
    ['organization', organizationId, 'maintenance', 'servicing-fleet'] as const,
  statusCounts: (organizationId: string) =>
    ['organization', organizationId, 'maintenance', 'status-counts'] as const,
  costsByRecord: (organizationId: string) =>
    ['organization', organizationId, 'maintenance', 'costs-by-record'] as const,
  spend: (organizationId: string, from: string, to: string) =>
    ['organization', organizationId, 'maintenance', 'spend', from, to] as const,
  fleetDowntime: (organizationId: string, from: string, to: string) =>
    ['organization', organizationId, 'maintenance', 'fleet-downtime', from, to] as const,
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

/**
 * Every maintenance record for one vehicle, for Vehicle Details.
 *
 * Under the maintenance key, so `invalidateMaintenance` already refreshes it
 * when work is started, completed or rescheduled, or when a service plan is
 * saved.
 */
export function useMaintenanceForVehicle(vehicleId: string | undefined) {
  const organization = useOrganization()
  return useQuery({
    queryKey: maintenanceKeys.forVehicle(organization.id, vehicleId ?? ''),
    queryFn: () => fetchMaintenanceForVehicle(organization.id, vehicleId ?? ''),
    enabled: Boolean(vehicleId),
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

/**
 * The vehicle costs this record could still be given.
 *
 * Lives under the maintenance key so that linking, unlinking or recording a
 * cost refreshes it through `invalidateMaintenance` — an expense that has just
 * been attached has to leave this list, or the picker keeps offering it.
 */
export function useLinkableMaintenanceExpenses(vehicleId: string | undefined, enabled = true) {
  const organization = useOrganization()
  return useQuery({
    queryKey: maintenanceKeys.linkable(organization.id, vehicleId ?? ''),
    queryFn: () => fetchLinkableExpenses(organization.id, vehicleId ?? ''),
    enabled: enabled && Boolean(vehicleId),
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

/** What a cost recorded from a maintenance record came to. */
export interface CreatedMaintenanceExpense {
  expenseId: string
  /** False when the cost was recorded but attaching it afterwards failed. */
  isLinked: boolean
  /** The reason it was not attached. Never thrown away — the UI says it. */
  linkFailure: unknown
}

/**
 * Record a cost and attach it to this maintenance record.
 *
 * Two steps against one ledger, not a ledger of its own: the insert is the
 * same `createExpense` the Record a cost page uses, and the attachment is the
 * same `maintenance_link_expense` an operator runs by hand. Both are subject
 * to the same constraints and the same row-level policies.
 *
 * A failed attachment is reported rather than thrown, because by then the cost
 * exists. Throwing would show "could not record the cost" over a cost that is
 * sitting in the ledger, and the operator would record it a second time. The
 * caller is given the id and the reason, and the expense shows up in the
 * picker for them to attach.
 */
export function useCreateMaintenanceExpense(maintenanceId: string) {
  const client = useQueryClient()
  const organization = useOrganization()

  return useMutation({
    mutationFn: async (values: ExpenseFormValues): Promise<CreatedMaintenanceExpense> => {
      const expense = await createExpense(organization.id, values)
      try {
        await linkMaintenanceExpense(maintenanceId, expense.id)
        return { expenseId: expense.id, isLinked: true, linkFailure: null }
      } catch (cause) {
        return { expenseId: expense.id, isLinked: false, linkFailure: cause }
      }
    },
    onSuccess: async () => {
      // Both subtrees: the ledger, the reports and the vehicle's economics on
      // one side, the actual cost and the picker on this one.
      await Promise.all([
        invalidateExpenses(client, organization.id),
        invalidateMaintenance(client, organization.id),
      ])
    },
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

/** The fleet, for the preventive servicing list. */
export function useServicingFleet() {
  const organization = useOrganization()
  return useQuery({
    queryKey: maintenanceKeys.servicingFleet(organization.id),
    queryFn: () => fetchServicingFleet(organization.id),
    staleTime: 60_000,
  })
}

/** Status counts for the dashboard, counted by the database rather than the page. */
export function useMaintenanceStatusCounts() {
  const organization = useOrganization()
  return useQuery({
    queryKey: maintenanceKeys.statusCounts(organization.id),
    queryFn: () => fetchMaintenanceStatusCounts(organization.id),
    staleTime: 30_000,
  })
}

/** Actual cost for every maintenance record, keyed by record id. */
export function useMaintenanceCostsByRecord() {
  const organization = useOrganization()
  return useQuery({
    queryKey: maintenanceKeys.costsByRecord(organization.id),
    queryFn: () => fetchMaintenanceCostsByRecord(organization.id),
    staleTime: 60_000,
  })
}

/** Every maintenance record carrying a service plan, for the servicing list. */
export function useServicePlans() {
  const organization = useOrganization()
  return useQuery({
    queryKey: maintenanceKeys.servicePlans(organization.id),
    queryFn: () => fetchServicePlans(organization.id),
    staleTime: 30_000,
  })
}

/** Maintenance spend for a period, per currency. */
export function useMaintenanceSpend(from: string, to: string) {
  const organization = useOrganization()
  return useQuery({
    queryKey: maintenanceKeys.spend(organization.id, from, to),
    queryFn: () => fetchMaintenanceSpend(organization.id, from, to),
    staleTime: 60_000,
  })
}

/** Minutes the whole fleet was actually out of service in a period. */
export function useFleetDowntime(from: string, to: string) {
  const organization = useOrganization()
  return useQuery({
    queryKey: maintenanceKeys.fleetDowntime(organization.id, from, to),
    queryFn: () => fetchFleetDowntime(organization.id, from, to),
    // Work still in progress accrues against now(), so this answer ages.
    staleTime: 30_000,
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

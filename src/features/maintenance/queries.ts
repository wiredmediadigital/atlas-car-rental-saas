import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useOrganization } from '@/features/workspace/workspace-context'
import { vehicleKeys } from '@/features/vehicles/queries'
import { changeMaintenance, createMaintenance, fetchMaintenance } from './api'
export const maintenanceKeys = { all: (id: string) => ['organization', id, 'maintenance'] as const }
export function useMaintenance() { const organization = useOrganization(); return useQuery({ queryKey: maintenanceKeys.all(organization.id), queryFn: () => fetchMaintenance(organization.id), staleTime: 15_000 }) }
export function useCreateMaintenance() { const client = useQueryClient(); const organization = useOrganization(); return useMutation({ mutationFn: (values: Record<string, unknown>) => createMaintenance({ p_organization_id: organization.id, ...values }), onSuccess: () => { void client.invalidateQueries({ queryKey: maintenanceKeys.all(organization.id) }); void client.invalidateQueries({ queryKey: vehicleKeys.all(organization.id) }) } }) }
export function useMaintenanceAction(action: 'maintenance_start' | 'maintenance_complete' | 'maintenance_cancel') { const client = useQueryClient(); const organization = useOrganization(); return useMutation({ mutationFn: (values: Record<string, unknown>) => changeMaintenance(action, values), onSuccess: () => { void client.invalidateQueries({ queryKey: maintenanceKeys.all(organization.id) }); void client.invalidateQueries({ queryKey: vehicleKeys.all(organization.id) }) } }) }

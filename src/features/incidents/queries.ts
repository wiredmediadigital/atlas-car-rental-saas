import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useOrganization } from '@/features/workspace/workspace-context'
import {
  createIncident,
  fetchIncident,
  fetchIncidentAttachments,
  fetchIncidentDashboard,
  fetchIncidentMaintenanceLinks,
  fetchIncidentRentalOption,
  fetchIncidentRentalOptions,
  resolveIncident,
  updateIncident,
  uploadIncidentAttachment,
  type IncidentInput,
  type IncidentUpdateInput,
} from './api'

export const incidentKeys = {
  all: (org: string) => ['organization', org, 'incidents'] as const,
  detail: (org: string, id: string) => ['organization', org, 'incidents', 'detail', id] as const,
  attachments: (org: string, id: string) =>
    ['organization', org, 'incidents', 'attachments', id] as const,
  dashboard: (org: string) => ['organization', org, 'incidents', 'dashboard'] as const,
  maintenanceLinks: (org: string) =>
    ['organization', org, 'incidents', 'maintenance-links'] as const,
}

/**
 * The complete incident list the dashboard counts and lists from.
 *
 * Under `incidentKeys.all`, so reporting, editing and resolving an incident all
 * refresh it through the invalidation those mutations already perform.
 */
export function useIncidentDashboard() {
  const org = useOrganization()
  return useQuery({
    queryKey: incidentKeys.dashboard(org.id),
    queryFn: () => fetchIncidentDashboard(org.id),
    staleTime: 15_000,
  })
}

/**
 * How much maintenance each incident raised, and how much is still open.
 *
 * Deliberately under the INCIDENTS key although it reads `maintenance_records`.
 * `invalidateVehicleRestrictions` — which every maintenance mutation runs —
 * already invalidates the incidents namespace as well as the maintenance one,
 * so starting, completing or cancelling a job refreshes this, and so does
 * resolving an incident. One key, both directions covered.
 */
export function useIncidentMaintenanceLinks() {
  const org = useOrganization()
  return useQuery({
    queryKey: incidentKeys.maintenanceLinks(org.id),
    queryFn: () => fetchIncidentMaintenanceLinks(org.id),
    staleTime: 15_000,
  })
}

export function useIncident(id: string | undefined) {
  const org = useOrganization()
  return useQuery({
    queryKey: incidentKeys.detail(org.id, id ?? 'none'),
    queryFn: () => fetchIncident(id!),
    enabled: Boolean(id),
    retry: false,
  })
}
export function useIncidentAttachments(id: string | undefined) {
  const org = useOrganization()
  return useQuery({
    queryKey: incidentKeys.attachments(org.id, id ?? 'none'),
    queryFn: () => fetchIncidentAttachments(id!),
    enabled: Boolean(id),
  })
}

export function useIncidentRentalOptions(vehicleId: string | undefined) {
  const org = useOrganization()
  return useQuery({
    queryKey: [...incidentKeys.all(org.id), 'rental-options', vehicleId ?? 'none'] as const,
    queryFn: () => fetchIncidentRentalOptions(org.id, vehicleId!),
    enabled: Boolean(vehicleId),
    staleTime: 30_000,
  })
}

export function useIncidentRentalOption(id: string | undefined) {
  const org = useOrganization()
  return useQuery({
    queryKey: [...incidentKeys.all(org.id), 'rental-option', id ?? 'none'] as const,
    queryFn: () => fetchIncidentRentalOption(id!),
    enabled: Boolean(id),
    staleTime: 30_000,
  })
}
export function useCreateIncident() {
  const org = useOrganization()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: IncidentInput) => createIncident(org.id, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: incidentKeys.all(org.id) }),
  })
}
export function useResolveIncident(id: string) {
  const org = useOrganization()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (notes: string) => resolveIncident(id, notes),
    onSuccess: () => qc.invalidateQueries({ queryKey: incidentKeys.all(org.id) }),
  })
}

export function useUpdateIncident(id: string) {
  const org = useOrganization()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: IncidentUpdateInput) => updateIncident(id, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: incidentKeys.all(org.id) }),
  })
}
export function useUploadIncidentAttachment(id: string) {
  const org = useOrganization()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ file, kind }: { file: File; kind: 'photo' | 'document' }) =>
      uploadIncidentAttachment(org.id, id, file, kind),
    onSuccess: () => qc.invalidateQueries({ queryKey: incidentKeys.attachments(org.id, id) }),
  })
}

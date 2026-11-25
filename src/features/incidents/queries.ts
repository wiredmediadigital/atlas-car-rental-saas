import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useOrganization } from '@/features/workspace/workspace-context'
import { createIncident, fetchIncident, fetchIncidentAttachments, fetchIncidents, resolveIncident, uploadIncidentAttachment, type IncidentFilters, type IncidentInput } from './api'

export const incidentKeys = {
  all: (org: string) => ['organization', org, 'incidents'] as const,
  list: (org: string, filters: IncidentFilters) => ['organization', org, 'incidents', 'list', filters] as const,
  detail: (org: string, id: string) => ['organization', org, 'incidents', 'detail', id] as const,
  attachments: (org: string, id: string) => ['organization', org, 'incidents', 'attachments', id] as const,
}

export function useIncidents(filters: IncidentFilters) {
  const org = useOrganization()
  return useQuery({ queryKey: incidentKeys.list(org.id, filters), queryFn: () => fetchIncidents(org.id, filters), staleTime: 10_000 })
}
export function useIncident(id: string | undefined) {
  const org = useOrganization()
  return useQuery({ queryKey: incidentKeys.detail(org.id, id ?? 'none'), queryFn: () => fetchIncident(id!), enabled: Boolean(id), retry: false })
}
export function useIncidentAttachments(id: string | undefined) {
  const org = useOrganization()
  return useQuery({ queryKey: incidentKeys.attachments(org.id, id ?? 'none'), queryFn: () => fetchIncidentAttachments(id!), enabled: Boolean(id) })
}
export function useCreateIncident() {
  const org = useOrganization(); const qc = useQueryClient()
  return useMutation({ mutationFn: (input: IncidentInput) => createIncident(org.id, input), onSuccess: () => qc.invalidateQueries({ queryKey: incidentKeys.all(org.id) }) })
}
export function useResolveIncident(id: string) {
  const org = useOrganization(); const qc = useQueryClient()
  return useMutation({ mutationFn: (notes: string) => resolveIncident(id, notes), onSuccess: () => qc.invalidateQueries({ queryKey: incidentKeys.all(org.id) }) })
}
export function useUploadIncidentAttachment(id: string) {
  const org = useOrganization(); const qc = useQueryClient()
  return useMutation({ mutationFn: ({ file, kind }: { file: File; kind: 'photo' | 'document' }) => uploadIncidentAttachment(org.id, id, file, kind), onSuccess: () => qc.invalidateQueries({ queryKey: incidentKeys.attachments(org.id, id) }) })
}

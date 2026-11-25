import { getSupabaseClient } from '@/lib/supabase/client'
import type { IncidentAttachmentRow, IncidentRow, IncidentStatus, IncidentType, IncidentResponsibility } from '@/types/database'

export type IncidentFilters = { search: string; status: IncidentStatus | 'all'; type: IncidentType | 'all' }
export type IncidentInput = {
  vehicleId: string
  rentalId: string | null
  type: IncidentType
  occurredAt: string
  location: string
  description: string
  responsibility: IncidentResponsibility
  towingProvider: string
  towingReference: string
  insuranceProvider: string
  insuranceClaimReference: string
}

function client() { return getSupabaseClient() }
export async function fetchIncidents(organizationId: string, filters: IncidentFilters): Promise<IncidentRow[]> {
  let query = client().from('incidents').select('*').eq('organization_id', organizationId).order('occurred_at', { ascending: false })
  if (filters.status !== 'all') query = query.eq('status', filters.status)
  if (filters.type !== 'all') query = query.eq('incident_type', filters.type)
  if (filters.search.trim()) {
    const term = filters.search.replace(/[,()]/g, ' ').trim()
    if (term) query = query.or(`reference.ilike.%${term}%,description.ilike.%${term}%,location.ilike.%${term}%`)
  }
  const { data, error } = await query
  if (error) throw error
  return data ?? []
}

export async function fetchIncident(id: string): Promise<IncidentRow> {
  const { data, error } = await client().from('incidents').select('*').eq('id', id).single()
  if (error) throw error
  return data
}

export async function createIncident(organizationId: string, input: IncidentInput): Promise<IncidentRow> {
  const { data, error } = await client().rpc('incident_create', {
    p_organization_id: organizationId, p_vehicle_id: input.vehicleId, p_rental_id: input.rentalId,
    p_incident_type: input.type, p_occurred_at: input.occurredAt, p_location: input.location || null,
    p_description: input.description, p_responsibility: input.responsibility,
    p_towing_provider: input.towingProvider || null, p_towing_reference: input.towingReference || null,
    p_insurance_provider: input.insuranceProvider || null, p_insurance_claim_reference: input.insuranceClaimReference || null,
  })
  if (error) throw error
  return data as IncidentRow
}

export async function resolveIncident(id: string, notes: string): Promise<IncidentRow> {
  const { data, error } = await client().rpc('incident_resolve', { p_incident_id: id, p_resolution_notes: notes || null })
  if (error) throw error
  return data as IncidentRow
}

export async function fetchIncidentAttachments(id: string): Promise<IncidentAttachmentRow[]> {
  const { data, error } = await client().from('incident_attachments').select('*').eq('incident_id', id).order('created_at')
  if (error) throw error
  return data ?? []
}

export async function uploadIncidentAttachment(organizationId: string, incidentId: string, file: File, kind: 'photo' | 'document') {
  const supabase = client()
  const bucket = kind === 'photo' ? 'incident-photos' : 'incident-documents'
  const path = `${organizationId}/${incidentId}/${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
  const upload = await supabase.storage.from(bucket).upload(path, file, { upsert: false, contentType: file.type })
  if (upload.error) throw upload.error
  const { data, error } = await supabase.from('incident_attachments').insert({
    organization_id: organizationId, incident_id: incidentId, kind, storage_path: path,
    file_name: file.name, content_type: file.type, byte_size: file.size,
  }).select('*').single()
  if (error) { await supabase.storage.from(bucket).remove([path]); throw error }
  return data
}

export async function createIncidentSignedUrl(attachment: IncidentAttachmentRow) {
  const bucket = attachment.kind === 'photo' ? 'incident-photos' : 'incident-documents'
  const { data, error } = await client().storage.from(bucket).createSignedUrl(attachment.storage_path, 300)
  if (error) throw error
  return data.signedUrl
}

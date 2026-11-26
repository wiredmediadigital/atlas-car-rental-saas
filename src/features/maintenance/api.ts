/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
import { getSupabaseClient } from '@/lib/supabase/client'

export type MaintenanceStatus = 'scheduled' | 'in_progress' | 'completed' | 'cancelled'
export type MaintenanceCategory =
  | 'preventive'
  | 'oil_filter'
  | 'tire_service'
  | 'brake_service'
  | 'battery_electrical'
  | 'mechanical_repair'
  | 'bodywork_collision'
  | 'vehicle_inspection'
  | 'recall'
  | 'cleaning_detailing'
  | 'other'
export type MaintenancePriority = 'low' | 'normal' | 'high' | 'urgent'

/** The incident a maintenance record was raised from, as a person reads it. */
export interface MaintenanceIncidentSummary {
  id: string
  reference: string
  incident_type: string
  status: string
  occurred_at: string
}

export interface MaintenanceRow {
  id: string
  organization_id: string
  vehicle_id: string
  reference: string
  title: string
  category: MaintenanceCategory
  priority: MaintenancePriority
  status: MaintenanceStatus
  scheduled_start: string | null
  expected_completion: string | null
  actual_start: string | null
  actual_completion: string | null
  description: string | null
  reported_issue: string | null
  work_performed: string | null
  completion_notes: string | null
  service_provider: string | null
  technician: string | null
  provider_reference: string | null
  estimated_cost_minor: number | null
  currency: string
  incident_id: string | null
  start_odometer: number | null
  completion_odometer: number | null
  service_interval_days: number | null
  service_interval_odometer: number | null
  next_service_on: string | null
  next_service_odometer: number | null
  created_at: string
  vehicle?: { make: string; model: string; registration_plate: string; odometer: number } | null
  incident?: MaintenanceIncidentSummary | null
}

export interface MaintenanceDocument {
  id: string
  maintenance_id: string
  organization_id: string
  storage_path: string
  file_name: string
  content_type: string
  byte_size: number
  uploaded_by: string
  created_at: string
}

export interface MaintenanceExpense {
  id: string
  reference: string | null
  description: string | null
  amount_minor: number
  currency: string
  status: string
  incurred_on: string | null
}

export const MAINTENANCE_DOCUMENT_BUCKET = 'maintenance-documents'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = getSupabaseClient() as any

const RECORD_COLUMNS =
  '*, vehicle:vehicles(make,model,registration_plate,odometer), incident:incidents(id,reference,incident_type,status,occurred_at)'

export async function fetchMaintenance(organizationId: string): Promise<MaintenanceRow[]> {
  const { data, error } = await db
    .from('maintenance_records')
    .select(RECORD_COLUMNS)
    .eq('organization_id', organizationId)
    .order('scheduled_start', { ascending: true, nullsFirst: false })
  if (error) throw error
  return (data ?? []) as MaintenanceRow[]
}

/**
 * The maintenance raised from one incident.
 *
 * The relationship already lives on the maintenance row; this reads it from the
 * other end so Incident Details can show what was done about an incident.
 * There is deliberately no second relationship table.
 */
export async function fetchMaintenanceForIncident(
  organizationId: string,
  incidentId: string,
): Promise<MaintenanceRow[]> {
  const { data, error } = await db
    .from('maintenance_records')
    .select(RECORD_COLUMNS)
    .eq('organization_id', organizationId)
    .eq('incident_id', incidentId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as MaintenanceRow[]
}

export async function createMaintenance(values: Record<string, unknown>): Promise<MaintenanceRow> {
  const { data, error } = await db.rpc('maintenance_create', values)
  if (error) throw error
  return data as MaintenanceRow
}

export type MaintenanceAction =
  | 'maintenance_start'
  | 'maintenance_complete'
  | 'maintenance_cancel'
  | 'maintenance_reschedule'
  | 'maintenance_set_service_plan'

export async function changeMaintenance(
  action: MaintenanceAction,
  values: Record<string, unknown>,
): Promise<MaintenanceRow> {
  const { data, error } = await db.rpc(action, values)
  if (error) throw error
  return data as MaintenanceRow
}

/** Minutes the vehicle was actually out of service in a period. */
export async function fetchVehicleDowntime(
  vehicleId: string,
  from: string,
  to: string,
): Promise<number> {
  const { data, error } = await db.rpc('maintenance_vehicle_downtime', {
    p_vehicle_id: vehicleId,
    p_from: from,
    p_to: to,
  })
  if (error) throw error
  return Number(data ?? 0)
}

/** What the linked expenses actually came to. Never a second ledger. */
export async function fetchMaintenanceActualCost(maintenanceId: string): Promise<number> {
  const { data, error } = await db.rpc('maintenance_actual_cost', {
    p_maintenance_id: maintenanceId,
  })
  if (error) throw error
  return Number(data ?? 0)
}

export async function fetchMaintenanceExpenses(
  organizationId: string,
  maintenanceId: string,
): Promise<MaintenanceExpense[]> {
  const { data, error } = await db
    .from('expenses')
    .select('id, reference, description, amount_minor, currency, status, incurred_on')
    .eq('organization_id', organizationId)
    .eq('maintenance_id', maintenanceId)
    .order('incurred_on', { ascending: false })
  if (error) throw error
  return (data ?? []) as MaintenanceExpense[]
}

export interface LinkableExpense {
  id: string
  reference: string | null
  description: string | null
  amount_minor: number
  currency: string
  incurred_on: string | null
}

/** How many unattached vehicle costs the picker will offer at once. */
const LINKABLE_EXPENSE_LIMIT = 50

/**
 * Vehicle costs this maintenance record could still be given.
 *
 * Read from `expenses` rather than the `expense_ledger` view, which predates
 * maintenance and does not carry `maintenance_id`. The filters are the ones
 * `maintenance_link_expense` enforces — same vehicle, vehicle allocation, same
 * tenant — plus two the RPC has no opinion about. A cost already attached to a
 * record is left out, so linking cannot quietly move one off another
 * maintenance record or re-offer one already listed below. A voided cost is
 * left out too, because `maintenance_actual_cost` ignores it and linking it
 * would add nothing to the figure the operator is looking at.
 */
export async function fetchLinkableExpenses(
  organizationId: string,
  vehicleId: string,
): Promise<LinkableExpense[]> {
  const { data, error } = await db
    .from('expenses')
    .select('id, reference, description, amount_minor, currency, incurred_on')
    .eq('organization_id', organizationId)
    .eq('vehicle_id', vehicleId)
    .eq('allocation', 'vehicle')
    .eq('status', 'recorded')
    .is('maintenance_id', null)
    .order('incurred_on', { ascending: false })
    .limit(LINKABLE_EXPENSE_LIMIT)
  if (error) throw error
  return (data ?? []) as LinkableExpense[]
}

export async function linkMaintenanceExpense(
  maintenanceId: string,
  expenseId: string,
): Promise<void> {
  const { error } = await db.rpc('maintenance_link_expense', {
    p_maintenance_id: maintenanceId,
    p_expense_id: expenseId,
  })
  if (error) throw error
}

export async function unlinkMaintenanceExpense(expenseId: string): Promise<void> {
  const { error } = await db.rpc('maintenance_unlink_expense', { p_expense_id: expenseId })
  if (error) throw error
}

export async function fetchMaintenanceDocuments(
  maintenanceId: string,
): Promise<MaintenanceDocument[]> {
  const { data, error } = await db
    .from('maintenance_documents')
    .select('*')
    .eq('maintenance_id', maintenanceId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as MaintenanceDocument[]
}

/**
 * Uploads a supporting document into the private maintenance bucket.
 *
 * The path starts with the organization id because the storage policies read
 * the tenant out of it. Nothing here is public: the file is reached through a
 * signed URL that expires, never a permanent link.
 */
export async function uploadMaintenanceDocument(
  organizationId: string,
  maintenanceId: string,
  file: File,
): Promise<MaintenanceDocument> {
  const { data: auth } = await db.auth.getUser()
  if (!auth.user) throw new Error('You must be signed in to upload a document.')

  const safeName = file.name.replace(/[^\w.\- ]+/g, '_').slice(0, 160)
  const path = `${organizationId}/${maintenanceId}/${crypto.randomUUID()}-${safeName}`

  const { error: uploadError } = await db.storage
    .from(MAINTENANCE_DOCUMENT_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false })
  if (uploadError) throw uploadError

  const { data, error } = await db
    .from('maintenance_documents')
    .insert({
      organization_id: organizationId,
      maintenance_id: maintenanceId,
      storage_path: path,
      file_name: safeName,
      // Both are NOT NULL on the table, and the row is refused without them.
      content_type: file.type || 'application/octet-stream',
      byte_size: file.size,
      // The insert policy checks this against auth.uid(), so it is the
      // uploader's own id or nothing.
      uploaded_by: auth.user.id,
    })
    .select('*')
    .single()

  if (error) {
    // Do not leave an orphaned object behind when the metadata row is refused.
    await db.storage.from(MAINTENANCE_DOCUMENT_BUCKET).remove([path])
    throw error
  }
  return data as MaintenanceDocument
}

export async function maintenanceDocumentUrl(storagePath: string): Promise<string> {
  const { data, error } = await db.storage
    .from(MAINTENANCE_DOCUMENT_BUCKET)
    .createSignedUrl(storagePath, 60)
  if (error) throw error
  return data.signedUrl as string
}

export async function deleteMaintenanceDocument(document: MaintenanceDocument): Promise<void> {
  const { error } = await db.from('maintenance_documents').delete().eq('id', document.id)
  if (error) throw error
  await db.storage.from(MAINTENANCE_DOCUMENT_BUCKET).remove([document.storage_path])
}

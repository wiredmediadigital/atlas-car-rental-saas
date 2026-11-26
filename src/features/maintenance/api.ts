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

/**
 * Every maintenance record for one vehicle, for Vehicle Details.
 *
 * Read for the one vehicle rather than filtering the organization's whole
 * maintenance history in the browser: the fleet list is unbounded, and a page
 * about one car should not pay for every car.
 */
export async function fetchMaintenanceForVehicle(
  organizationId: string,
  vehicleId: string,
): Promise<MaintenanceRow[]> {
  const { data, error } = await db
    .from('maintenance_records')
    .select(RECORD_COLUMNS)
    .eq('organization_id', organizationId)
    .eq('vehicle_id', vehicleId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as MaintenanceRow[]
}

/**
 * How many rows one request may return.
 *
 * `supabase/config.toml` sets `max_rows = 1000`, so a read with no `.range()`
 * stops at a thousand and says nothing about it. For a list that is a
 * truncation an operator can see; for a SUM, or for a count, it is a wrong
 * number that looks authoritative. Everything that totals or enumerates below
 * therefore pages explicitly.
 */
const PAGE_SIZE = 1000

interface PagedResult<TRow> {
  data: TRow[] | null
  error: { message?: string } | null
}

/** Walks every page of a filtered read, applying `onRow` to each row. */
async function forEachPage<TRow>(
  request: (fromRow: number, toRow: number) => PromiseLike<PagedResult<TRow>>,
  onRow: (row: TRow) => void,
): Promise<void> {
  for (let page = 0; ; page += 1) {
    const { data, error } = await request(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)
    if (error) throw new Error(error.message ?? 'The request failed.')
    const rows = data ?? []
    for (const row of rows) onRow(row)
    if (rows.length < PAGE_SIZE) return
  }
}

export interface MaintenanceStatusCounts {
  scheduled: number
  inProgress: number
  completed: number
  vehiclesInMaintenance: number
}

/**
 * The dashboard's status counts, counted by the database.
 *
 * Deliberately not derived from the records list: that read is capped at
 * `max_rows`, and a count taken from a truncated list is wrong while looking
 * exact. `head: true` with `count: 'exact'` transfers no rows at all.
 *
 * The distinct-vehicle figure does read rows, but only the vehicle_id of work
 * actually under way -- a set bounded by how many cars an agency can have in a
 * garage at once, not by its history.
 */
export async function fetchMaintenanceStatusCounts(
  organizationId: string,
): Promise<MaintenanceStatusCounts> {
  async function countOf(status: MaintenanceStatus): Promise<number> {
    const { count, error } = await db
      .from('maintenance_records')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', organizationId)
      .eq('status', status)
    if (error) throw error
    return Number(count ?? 0)
  }

  const [scheduled, inProgress, completed] = await Promise.all([
    countOf('scheduled'),
    countOf('in_progress'),
    countOf('completed'),
  ])

  const { data, error } = await db
    .from('maintenance_records')
    .select('vehicle_id')
    .eq('organization_id', organizationId)
    .eq('status', 'in_progress')
  if (error) throw error

  // A vehicle with two concurrent jobs is one vehicle off the road.
  const rows = (data ?? []) as { vehicle_id: string }[]
  const vehicles = new Set(rows.map((row) => row.vehicle_id))

  return { scheduled, inProgress, completed, vehiclesInMaintenance: vehicles.size }
}

export interface ServicingVehicle {
  id: string
  registration_plate: string
  make: string
  model: string
  odometer: number | null
  /** The pre-Maintenance date, shown for reference only. Never a reminder. */
  next_service_on: string | null
}

/**
 * The fleet, for the preventive servicing list.
 *
 * Includes vehicles with no service plan, because a car nobody has scheduled a
 * service for is exactly the one an operator needs to see. Archived vehicles
 * are left out: they are not in service and cannot become due. Paged, so a
 * fleet larger than `max_rows` is listed in full rather than silently cut.
 */
export async function fetchServicingFleet(organizationId: string): Promise<ServicingVehicle[]> {
  const rows: ServicingVehicle[] = []
  await forEachPage<ServicingVehicle>(
    (fromRow, toRow) =>
      db
        .from('vehicles')
        .select('id, registration_plate, make, model, odometer, next_service_on')
        .eq('organization_id', organizationId)
        .is('archived_at', null)
        .order('registration_plate', { ascending: true })
        .range(fromRow, toRow) as PromiseLike<PagedResult<ServicingVehicle>>,
    (row) => rows.push(row),
  )
  return rows
}

/** Just the plan-bearing columns, for the fleet-wide servicing list. */
export interface ServicePlanRecord {
  id: string
  reference: string
  vehicle_id: string
  status: MaintenanceStatus
  next_service_on: string | null
  next_service_odometer: number | null
  service_interval_days: number | null
  service_interval_odometer: number | null
  created_at: string
}

/**
 * Every maintenance record that carries a service plan.
 *
 * Narrower than the records list in both directions: only the plan columns,
 * and only rows that actually hold a plan. The servicing list used to be built
 * from the full maintenance history, which is capped at `max_rows` -- so on a
 * busy agency a vehicle whose plan sat beyond the cap would have been reported
 * as having no plan at all, which is the opposite of the truth.
 */
export async function fetchServicePlans(organizationId: string): Promise<ServicePlanRecord[]> {
  const rows: ServicePlanRecord[] = []
  await forEachPage<ServicePlanRecord>(
    (fromRow, toRow) =>
      db
        .from('maintenance_records')
        .select(
          'id, reference, vehicle_id, status, next_service_on, next_service_odometer, service_interval_days, service_interval_odometer, created_at',
        )
        .eq('organization_id', organizationId)
        .or(
          'next_service_on.not.is.null,next_service_odometer.not.is.null,service_interval_days.not.is.null,service_interval_odometer.not.is.null',
        )
        .order('id', { ascending: true })
        .range(fromRow, toRow) as PromiseLike<PagedResult<ServicePlanRecord>>,
    (row) => rows.push(row),
  )
  return rows
}

export interface MaintenanceSpendRow {
  currency: string
  total_minor: number
}

/**
 * What the agency spent on maintenance in a period.
 *
 * Read from `public.expenses` rather than the `expense_ledger` view, which
 * predates maintenance and carries no `maintenance_id` -- the same reason
 * fetchLinkableExpenses reads the table. `expenses_maintenance_idx` covers
 * this predicate exactly.
 *
 * Totalled per currency and never across them. Two currencies added together
 * is a number that means nothing, which is why the ledger refuses to do it.
 */
export async function fetchMaintenanceSpend(
  organizationId: string,
  from: string,
  to: string,
): Promise<MaintenanceSpendRow[]> {
  const totals = new Map<string, number>()

  await forEachPage<{ amount_minor: number; currency: string }>(
    (fromRow, toRow) =>
      db
        .from('expenses')
        .select('amount_minor, currency')
        .eq('organization_id', organizationId)
        .eq('status', 'recorded')
        .not('maintenance_id', 'is', null)
        .gte('incurred_on', from)
        .lt('incurred_on', to)
        .order('id', { ascending: true })
        .range(fromRow, toRow) as PromiseLike<
        PagedResult<{ amount_minor: number; currency: string }>
      >,
    (row) => {
      totals.set(row.currency, (totals.get(row.currency) ?? 0) + Number(row.amount_minor))
    },
  )

  return [...totals.entries()]
    .map(([currency, total_minor]) => ({ currency, total_minor }))
    .sort((a, b) => b.total_minor - a.total_minor)
}

/**
 * Actual cost per maintenance record, for the records list.
 *
 * One read for the whole list rather than `maintenance_actual_cost` once per
 * row, which would be a request per record. Voided costs are excluded, exactly
 * as that function excludes them, so the figure here and the figure on a
 * record's own page are the same figure.
 *
 * Totals are summed per record without regard to currency, matching
 * `maintenance_actual_cost`; a record's costs are in the record's currency in
 * every case this product can produce.
 */
export async function fetchMaintenanceCostsByRecord(
  organizationId: string,
): Promise<Record<string, number>> {
  const totals: Record<string, number> = {}

  await forEachPage<{ maintenance_id: string; amount_minor: number }>(
    (fromRow, toRow) =>
      db
        .from('expenses')
        .select('maintenance_id, amount_minor')
        .eq('organization_id', organizationId)
        .eq('status', 'recorded')
        .not('maintenance_id', 'is', null)
        .order('id', { ascending: true })
        .range(fromRow, toRow) as PromiseLike<
        PagedResult<{ maintenance_id: string; amount_minor: number }>
      >,
    (row) => {
      totals[row.maintenance_id] = (totals[row.maintenance_id] ?? 0) + Number(row.amount_minor)
    },
  )

  return totals
}

/** Minutes the whole fleet was actually out of service in a period. */
export async function fetchFleetDowntime(
  organizationId: string,
  from: string,
  to: string,
): Promise<number> {
  const { data, error } = await db.rpc('maintenance_fleet_downtime', {
    p_organization_id: organizationId,
    p_from: from,
    p_to: to,
  })
  if (error) throw error
  return Number(data ?? 0)
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

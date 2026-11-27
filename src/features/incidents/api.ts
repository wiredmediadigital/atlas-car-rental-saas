import { getSupabaseClient } from '@/lib/supabase/client'
import type {
  IncidentAttachmentRow,
  IncidentResponsibility,
  IncidentRow,
  IncidentStatus,
  IncidentType,
  RentalStatus,
} from '@/types/database'

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

export type IncidentUpdateInput = Omit<IncidentInput, 'vehicleId' | 'rentalId'> & {
  status: Exclude<IncidentStatus, 'resolved'>
}

export type IncidentVehicleSummary = {
  readonly id: string
  readonly registration_plate: string
  readonly make: string
  readonly model: string
  readonly model_year: number | null
}

export type IncidentRentalSummary = {
  readonly id: string
  readonly reference: string
  readonly status: RentalStatus
  readonly vehicle_id: string
  readonly customer_id: string | null
  readonly starts_at: string
  readonly ends_at: string
  readonly customer: { readonly id: string; readonly display_name: string } | null
}

export type IncidentPersonSummary = { readonly id: string; readonly full_name: string }

export type IncidentView = IncidentRow & {
  readonly vehicle: IncidentVehicleSummary | null
  readonly rental: IncidentRentalSummary | null
  readonly customer: { readonly id: string; readonly display_name: string } | null
  readonly reportedBy: IncidentPersonSummary | null
  readonly resolvedBy: IncidentPersonSummary | null
}

export type IncidentRentalOption = IncidentRentalSummary

function client() {
  return getSupabaseClient()
}

/**
 * PostgREST stops at `max_rows` (1,000, set in `supabase/config.toml`) and says
 * nothing about it. A total counted from that first page is wrong while looking
 * exact, which is the worst way for a number to be wrong -- nobody checks a
 * figure that looks plausible. Everything the dashboard counts is read through
 * here instead.
 */
const PAGE_SIZE = 1000

/** Batch size for `.in(...)` lookups: short enough to keep the URL sane. */
const LOOKUP_CHUNK = 300

interface PagedResult<TRow> {
  data: TRow[] | null
  error: { message?: string } | null
}

/**
 * Walks every page of a result, and delivers each row exactly once.
 *
 * THE DE-DUPLICATION IS NOT DEFENSIVE PADDING. Offset paging asks for rows
 * 0-999, then 1000-1999, as two separate requests against live data. An
 * incident reported between the two shifts every later row down one position,
 * so the row that was last on the first page is returned again as the first row
 * of the second -- and a dashboard that counts rows would count it twice. The
 * window is small and the agency has to be past a thousand incidents to reach
 * it at all, but the symptom is a total that is quietly wrong, which is the
 * kind of defect nobody goes looking for.
 *
 * `keyOf` is the row's primary key, so the second copy is recognised and
 * dropped. A row that moves the other way can still be missed; closing that
 * needs keyset paging, which PostgREST supports but the rest of this codebase
 * does not use.
 */
async function forEachPage<TRow>(
  request: (fromRow: number, toRow: number) => PromiseLike<PagedResult<TRow>>,
  keyOf: (row: TRow) => string,
  onRow: (row: TRow) => void,
): Promise<void> {
  const seen = new Set<string>()
  for (let start = 0; ; start += PAGE_SIZE) {
    const { data, error } = await request(start, start + PAGE_SIZE - 1)
    if (error) throw new Error(error.message ?? 'Unable to read a page of results.')
    const rows = data ?? []
    for (const row of rows) {
      const key = keyOf(row)
      if (seen.has(key)) continue
      seen.add(key)
      onRow(row)
    }
    if (rows.length < PAGE_SIZE) return
  }
}

function chunk<T>(values: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let index = 0; index < values.length; index += size) {
    out.push(values.slice(index, index + size))
  }
  return out
}

export async function fetchIncident(id: string): Promise<IncidentView> {
  const { data, error } = await client().from('incidents').select('*').eq('id', id).single()
  if (error) throw error
  const [row] = await hydrateIncidents([data])
  return row!
}

async function hydrateIncidents(rows: IncidentRow[]): Promise<IncidentView[]> {
  if (rows.length === 0) return []
  const supabase = client()
  const vehicleIds = [...new Set(rows.map((row) => row.vehicle_id))]
  const rentalIds = [...new Set(rows.flatMap((row) => (row.rental_id ? [row.rental_id] : [])))]
  const customerIds = [
    ...new Set(rows.flatMap((row) => (row.customer_id ? [row.customer_id] : []))),
  ]
  const personIds = [
    ...new Set(
      rows.flatMap((row) => [row.reported_by, row.resolved_by].filter(Boolean) as string[]),
    ),
  ]

  const [vehiclesResult, rentalsResult, customersResult, peopleResult] = await Promise.all([
    supabase
      .from('vehicles')
      .select('id, registration_plate, make, model, model_year')
      .in('id', vehicleIds),
    rentalIds.length
      ? supabase
          .from('rentals')
          .select('id, reference, status, vehicle_id, customer_id, starts_at, ends_at')
          .in('id', rentalIds)
      : Promise.resolve({ data: [], error: null }),
    customerIds.length
      ? supabase.from('customers').select('id, display_name').in('id', customerIds)
      : Promise.resolve({ data: [], error: null }),
    personIds.length
      ? supabase.from('profiles').select('id, full_name').in('id', personIds)
      : Promise.resolve({ data: [], error: null }),
  ])
  for (const result of [vehiclesResult, rentalsResult, customersResult, peopleResult]) {
    if (result.error) throw result.error
  }

  const vehicles = new Map(
    (vehiclesResult.data ?? []).map((row) => [row.id, row as IncidentVehicleSummary]),
  )
  const customers = new Map((customersResult.data ?? []).map((row) => [row.id, row]))
  const people = new Map(
    (peopleResult.data ?? []).map((row) => [row.id, row as IncidentPersonSummary]),
  )
  const rentals = new Map(
    (rentalsResult.data ?? []).map((row) => [
      row.id,
      {
        ...row,
        customer: row.customer_id ? (customers.get(row.customer_id) ?? null) : null,
      },
    ]),
  )

  return rows.map((row) => ({
    ...row,
    vehicle: vehicles.get(row.vehicle_id) ?? null,
    rental: row.rental_id ? (rentals.get(row.rental_id) ?? null) : null,
    customer: row.customer_id ? (customers.get(row.customer_id) ?? null) : null,
    reportedBy: people.get(row.reported_by) ?? null,
    resolvedBy: row.resolved_by ? (people.get(row.resolved_by) ?? null) : null,
  }))
}

export async function fetchIncidentRentalOptions(
  organizationId: string,
  vehicleId: string,
): Promise<IncidentRentalOption[]> {
  const { data, error } = await client()
    .from('rentals')
    .select('id, reference, status, vehicle_id, customer_id, starts_at, ends_at')
    .eq('organization_id', organizationId)
    .eq('vehicle_id', vehicleId)
    .order('starts_at', { ascending: false })
    .limit(500)
  if (error) throw error
  const rentals = (data ?? []) as Array<Omit<IncidentRentalSummary, 'customer'>>
  const customerIds = [
    ...new Set(rentals.flatMap((rental) => (rental.customer_id ? [rental.customer_id] : []))),
  ]
  const customersResult = customerIds.length
    ? await client().from('customers').select('id, display_name').in('id', customerIds)
    : { data: [], error: null }
  if (customersResult.error) throw customersResult.error
  const customers = new Map((customersResult.data ?? []).map((row) => [row.id, row]))
  return rentals.map((rental) => ({
    ...rental,
    customer: rental.customer_id ? (customers.get(rental.customer_id) ?? null) : null,
  }))
}

export async function fetchIncidentRentalOption(id: string): Promise<IncidentRentalOption> {
  const { data, error } = await client()
    .from('rentals')
    .select('id, reference, status, vehicle_id, customer_id, starts_at, ends_at')
    .eq('id', id)
    .single()
  if (error) throw error
  const rental = data as Omit<IncidentRentalSummary, 'customer'>
  const customer = rental.customer_id
    ? await client()
        .from('customers')
        .select('id, display_name')
        .eq('id', rental.customer_id)
        .maybeSingle()
    : { data: null, error: null }
  if (customer.error) throw customer.error
  return { ...rental, customer: customer.data }
}

export async function createIncident(
  organizationId: string,
  input: IncidentInput,
): Promise<IncidentRow> {
  const { data, error } = await client().rpc('incident_create', {
    p_organization_id: organizationId,
    p_vehicle_id: input.vehicleId,
    p_rental_id: input.rentalId,
    p_incident_type: input.type,
    p_occurred_at: input.occurredAt,
    p_location: input.location || null,
    p_description: input.description,
    p_responsibility: input.responsibility,
    p_towing_provider: input.towingProvider || null,
    p_towing_reference: input.towingReference || null,
    p_insurance_provider: input.insuranceProvider || null,
    p_insurance_claim_reference: input.insuranceClaimReference || null,
  })
  if (error) throw error
  return data
}

export async function updateIncident(id: string, input: IncidentUpdateInput): Promise<IncidentRow> {
  const { data, error } = await client().rpc('incident_update', {
    p_incident_id: id,
    p_incident_type: input.type,
    p_occurred_at: input.occurredAt,
    p_location: input.location || null,
    p_description: input.description,
    p_responsibility: input.responsibility,
    p_towing_provider: input.towingProvider || null,
    p_towing_reference: input.towingReference || null,
    p_insurance_provider: input.insuranceProvider || null,
    p_insurance_claim_reference: input.insuranceClaimReference || null,
    p_status: input.status,
  })
  if (error) throw error
  return data
}

export async function resolveIncident(id: string, notes: string): Promise<IncidentRow> {
  const { data, error } = await client().rpc('incident_resolve', {
    p_incident_id: id,
    p_resolution_notes: notes || null,
  })
  if (error) throw error
  return data
}

export async function fetchIncidentAttachments(id: string): Promise<IncidentAttachmentRow[]> {
  const { data, error } = await client()
    .from('incident_attachments')
    .select('*')
    .eq('incident_id', id)
    .order('created_at')
  if (error) throw error
  return data ?? []
}

export async function uploadIncidentAttachment(
  organizationId: string,
  incidentId: string,
  file: File,
  kind: 'photo' | 'document',
) {
  const supabase = client()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) throw new Error('You must be signed in to upload an attachment.')
  const bucket = kind === 'photo' ? 'incident-photos' : 'incident-documents'
  const path = `${organizationId}/${incidentId}/${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
  const upload = await supabase.storage
    .from(bucket)
    .upload(path, file, { upsert: false, contentType: file.type })
  if (upload.error) throw upload.error
  const { data, error } = await supabase
    .from('incident_attachments')
    .insert({
      organization_id: organizationId,
      incident_id: incidentId,
      kind,
      storage_path: path,
      file_name: file.name,
      content_type: file.type,
      byte_size: file.size,
      uploaded_by: auth.user.id,
    })
    .select('*')
    .single()
  if (error) {
    await supabase.storage.from(bucket).remove([path])
    throw error
  }
  return data
}

export async function createIncidentSignedUrl(attachment: IncidentAttachmentRow) {
  const bucket = attachment.kind === 'photo' ? 'incident-photos' : 'incident-documents'
  const { data, error } = await client()
    .storage.from(bucket)
    .createSignedUrl(attachment.storage_path, 300)
  if (error) throw error
  return data.signedUrl
}

/** An incident as the dashboard needs it: business identifiers, no UUIDs on show. */
export interface IncidentDashboardRow {
  readonly id: string
  readonly reference: string
  readonly incident_type: IncidentType
  readonly status: IncidentStatus
  readonly responsibility: IncidentResponsibility
  readonly occurred_at: string
  readonly vehicle_id: string
  readonly rental_id: string | null
  readonly customer_id: string | null
  /** Searched, never displayed in the table. */
  readonly location: string | null
  /** Searched, never displayed in the table. */
  readonly description: string
  readonly vehicle: IncidentVehicleSummary | null
  readonly rental: { readonly id: string; readonly reference: string } | null
  readonly customer: { readonly id: string; readonly display_name: string } | null
}

/*
 * `location` and `description` are carried although the table never shows them:
 * the list this replaces searched both, and a search that silently stopped
 * matching what an operator typed last week would be a regression in an
 * accepted feature. They cost nothing new -- the page they replace selected
 * `*`, so these bytes were already being fetched.
 */
const DASHBOARD_COLUMNS =
  'id, reference, incident_type, status, responsibility, occurred_at, vehicle_id, rental_id, customer_id, location, description'

interface RawDashboardRow {
  id: string
  reference: string
  incident_type: IncidentType
  status: IncidentStatus
  responsibility: IncidentResponsibility
  occurred_at: string
  vehicle_id: string
  rental_id: string | null
  customer_id: string | null
  location: string | null
  description: string
}

/**
 * Every incident in the agency, with the names an operator reads.
 *
 * ONE READ, NOT TWO. The six summary figures and the records table are both
 * computed from this single list. Counting with one query and listing with
 * another would let two tiles disagree with the table beneath them whenever the
 * two ran a moment apart -- and "open incidents: 4" above a list of five is the
 * kind of thing that destroys trust in every other figure on the page.
 *
 * COMPLETE, NOT THE FIRST PAGE. Paged to the end, because a dashboard total
 * taken from a truncated read is wrong while looking exact.
 *
 * NO PER-RECORD REQUESTS. The names are resolved with three batched lookups
 * over the distinct ids, however many incidents there are -- the same approach
 * `hydrateIncidents` already takes for the detail view, which is why it is
 * reused in shape here rather than replaced.
 */
export async function fetchIncidentDashboard(
  organizationId: string,
): Promise<IncidentDashboardRow[]> {
  const rows: RawDashboardRow[] = []
  await forEachPage<RawDashboardRow>(
    (fromRow, toRow) =>
      client()
        .from('incidents')
        .select(DASHBOARD_COLUMNS)
        .eq('organization_id', organizationId)
        .order('occurred_at', { ascending: false })
        .order('id', { ascending: true })
        .range(fromRow, toRow),
    (row) => row.id,
    (row) => rows.push(row),
  )

  const vehicleIds = [...new Set(rows.map((row) => row.vehicle_id))]
  const rentalIds = [...new Set(rows.flatMap((row) => (row.rental_id ? [row.rental_id] : [])))]
  const customerIds = [
    ...new Set(rows.flatMap((row) => (row.customer_id ? [row.customer_id] : []))),
  ]

  const vehicles = new Map<string, IncidentVehicleSummary>()
  const rentals = new Map<string, { id: string; reference: string }>()
  const customers = new Map<string, { id: string; display_name: string }>()

  await Promise.all([
    ...chunk(vehicleIds, LOOKUP_CHUNK).map(async (ids) => {
      const { data, error } = await client()
        .from('vehicles')
        .select('id, registration_plate, make, model, model_year')
        .in('id', ids)
      if (error) throw error
      for (const row of data ?? []) vehicles.set(row.id, row)
    }),
    ...chunk(rentalIds, LOOKUP_CHUNK).map(async (ids) => {
      const { data, error } = await client().from('rentals').select('id, reference').in('id', ids)
      if (error) throw error
      for (const row of data ?? []) rentals.set(row.id, row)
    }),
    ...chunk(customerIds, LOOKUP_CHUNK).map(async (ids) => {
      const { data, error } = await client()
        .from('customers')
        .select('id, display_name')
        .in('id', ids)
      if (error) throw error
      for (const row of data ?? []) customers.set(row.id, row)
    }),
  ])

  return rows.map((row) => ({
    ...row,
    vehicle: vehicles.get(row.vehicle_id) ?? null,
    rental: row.rental_id ? (rentals.get(row.rental_id) ?? null) : null,
    customer: row.customer_id ? (customers.get(row.customer_id) ?? null) : null,
  }))
}

/** How much maintenance one incident raised, and how much is still open. */
export interface IncidentMaintenanceLink {
  readonly total: number
  readonly outstanding: number
}

export type IncidentMaintenanceStatus = 'scheduled' | 'in_progress' | 'completed' | 'cancelled'

/**
 * Work that is still to be done.
 *
 * Exported so the rule can be tested directly. It used to be an inline
 * condition inside the paging loop, where the only way to exercise it was to
 * stand up a database.
 *
 * Cancelled work is NOT outstanding -- nobody is going to do it -- and it is
 * not completed either; it still counts towards the incident's total, because
 * the record exists and an operator opening the incident will see it.
 */
export function isOutstandingMaintenance(status: IncidentMaintenanceStatus): boolean {
  return status === 'scheduled' || status === 'in_progress'
}

interface RawLinkRow {
  id: string
  incident_id: string | null
  status: IncidentMaintenanceStatus
}

/**
 * The exact query surface this file needs from `maintenance_records`.
 *
 * `maintenance_records` is missing from the generated `Database` types, which
 * is why `features/maintenance/api.ts` keeps an untyped client of its own. An
 * `any` client would work here too and would also switch off every type rule
 * for the whole chain; declaring the four calls actually used keeps the cast to
 * one line and keeps the result typed.
 */
interface LinkQuery {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (
        column: string,
        value: string,
      ) => {
        not: (
          column: string,
          operator: string,
          value: null,
        ) => {
          order: (
            column: string,
            options: { ascending: boolean },
          ) => {
            range: (from: number, to: number) => PromiseLike<PagedResult<RawLinkRow>>
          }
        }
      }
    }
  }
}

/**
 * One page of the incident-to-maintenance link.
 *
 * The client is resolved lazily HERE rather than at module scope, deliberately:
 * a module-scope client makes importing this file require a configured
 * environment, and that turns a page test which never touches Supabase into an
 * import-time failure. `features/maintenance/api.ts` has exactly that problem.
 */
function readLinkPage(
  organizationId: string,
  fromRow: number,
  toRow: number,
): PromiseLike<PagedResult<RawLinkRow>> {
  const db = getSupabaseClient() as unknown as LinkQuery
  return db
    .from('maintenance_records')
    .select('id, incident_id, status')
    .eq('organization_id', organizationId)
    .not('incident_id', 'is', null)
    .order('id', { ascending: true })
    .range(fromRow, toRow)
}

/**
 * Maintenance raised from incidents, counted per incident.
 *
 * "Outstanding" is scheduled or in progress. Cancelled work is NOT outstanding
 * and is not counted as done either -- it counts towards the total, because the
 * record exists and an operator opening the incident will see it.
 *
 * Read in one pass rather than per incident: a request per row would be
 * hundreds of round trips for a page showing twenty-five of them.
 */
export async function fetchIncidentMaintenanceLinks(
  organizationId: string,
): Promise<Record<string, IncidentMaintenanceLink>> {
  const links: Record<string, { total: number; outstanding: number }> = {}

  await forEachPage<RawLinkRow>(
    (fromRow, toRow) => readLinkPage(organizationId, fromRow, toRow),
    (row) => row.id,
    (row) => {
      if (!row.incident_id) return
      const entry = (links[row.incident_id] ??= { total: 0, outstanding: 0 })
      entry.total += 1
      if (isOutstandingMaintenance(row.status)) entry.outstanding += 1
    },
  )

  return links
}

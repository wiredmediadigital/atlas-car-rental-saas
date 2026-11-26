import { getSupabaseClient } from '@/lib/supabase/client'
import type {
  IncidentAttachmentRow,
  IncidentResponsibility,
  IncidentRow,
  IncidentStatus,
  IncidentType,
  RentalStatus,
} from '@/types/database'

export type IncidentFilters = {
  search: string
  status: IncidentStatus | 'all'
  type: IncidentType | 'all'
}
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
export async function fetchIncidents(
  organizationId: string,
  filters: IncidentFilters,
): Promise<IncidentView[]> {
  let query = client()
    .from('incidents')
    .select('*')
    .eq('organization_id', organizationId)
    .order('occurred_at', { ascending: false })
  if (filters.status !== 'all') query = query.eq('status', filters.status)
  if (filters.type !== 'all') query = query.eq('incident_type', filters.type)
  const { data, error } = await query
  if (error) throw error
  const hydrated = await hydrateIncidents((data ?? []) as IncidentRow[])
  const term = filters.search.trim().toLowerCase()
  if (!term) return hydrated
  return hydrated.filter((row) =>
    [
      row.reference,
      row.description,
      row.location ?? '',
      row.vehicle
        ? `${row.vehicle.registration_plate} ${row.vehicle.make} ${row.vehicle.model}`
        : '',
      row.rental?.reference ?? '',
    ].some((value) => value.toLowerCase().includes(term)),
  )
}

export async function fetchIncident(id: string): Promise<IncidentView> {
  const { data, error } = await client().from('incidents').select('*').eq('id', id).single()
  if (error) throw error
  const [row] = await hydrateIncidents([data as IncidentRow])
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
  const customers = new Map(
    (customersResult.data ?? []).map((row) => [
      row.id,
      row as { id: string; display_name: string },
    ]),
  )
  const people = new Map(
    (peopleResult.data ?? []).map((row) => [row.id, row as IncidentPersonSummary]),
  )
  const rentals = new Map(
    (rentalsResult.data ?? []).map((row) => [
      row.id,
      {
        ...row,
        customer: row.customer_id ? (customers.get(row.customer_id) ?? null) : null,
      } as IncidentRentalSummary,
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
  const customers = new Map(
    (customersResult.data ?? []).map((row) => [
      row.id,
      row as { id: string; display_name: string },
    ]),
  )
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
  return { ...rental, customer: customer.data as { id: string; display_name: string } | null }
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
  return data as IncidentRow
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
  return data as IncidentRow
}

export async function resolveIncident(id: string, notes: string): Promise<IncidentRow> {
  const { data, error } = await client().rpc('incident_resolve', {
    p_incident_id: id,
    p_resolution_notes: notes || null,
  })
  if (error) throw error
  return data as IncidentRow
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

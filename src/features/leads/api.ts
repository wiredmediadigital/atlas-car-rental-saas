import { getSupabaseClient } from '@/lib/supabase/client'
import { AppError, toAppError } from '@/lib/supabase/errors'

/** The statuses a lead moves through. Mirrors public.booking_lead_status. */
export type LeadStatus = 'new' | 'contacted' | 'converted' | 'declined' | 'lapsed'

/** Worked, or waiting to be: the ones that still hold a claim on a car. */
export const LIVE_STATUSES: readonly LeadStatus[] = ['new', 'contacted']

export interface Lead {
  id: string
  reference: string
  status: LeadStatus
  vehicleId: string
  vehicleLabel: string
  startsAt: string
  endsAt: string
  fullName: string
  email: string
  phone: string | null
  note: string | null
  currency: string
  dailyRateMinor: number
  billableDays: number
  quotedTotalMinor: number
  convertedRentalId: string | null
  createdAt: string
}

interface LeadRow {
  id: string
  reference: string
  status: LeadStatus
  vehicle_id: string
  starts_at: string
  ends_at: string
  full_name: string
  email: string
  phone: string | null
  note: string | null
  currency: string
  daily_rate_minor: number
  billable_days: number
  quoted_total_minor: number
  converted_rental_id: string | null
  created_at: string
  vehicles: { make: string; model: string } | { make: string; model: string }[] | null
}

function vehicleLabel(row: LeadRow): string {
  const vehicle = Array.isArray(row.vehicles) ? row.vehicles[0] : row.vehicles
  if (vehicle === null || vehicle === undefined) return 'Vehicle'
  return `${vehicle.make} ${vehicle.model}`
}

function toLead(row: LeadRow): Lead {
  return {
    id: row.id,
    reference: row.reference,
    status: row.status,
    vehicleId: row.vehicle_id,
    vehicleLabel: vehicleLabel(row),
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    fullName: row.full_name,
    email: row.email,
    phone: row.phone,
    note: row.note,
    currency: row.currency,
    dailyRateMinor: Number(row.daily_rate_minor),
    billableDays: row.billable_days,
    quotedTotalMinor: Number(row.quoted_total_minor),
    convertedRentalId: row.converted_rental_id,
    createdAt: row.created_at,
  }
}

/**
 * Every request this agency has received, oldest first.
 *
 * OLDEST FIRST, which is the opposite of most lists here. A lead is somebody
 * waiting for an answer, and the one who has waited longest is the one whose
 * patience is nearest its end. Sorting newest-first would bury them under
 * every request that arrived after.
 */
export async function fetchLeads(organizationId: string): Promise<Lead[]> {
  const { data, error } = await getSupabaseClient()
    .from('booking_leads')
    .select(
      `id, reference, status, vehicle_id, starts_at, ends_at, full_name, email, phone, note,
       currency, daily_rate_minor, billable_days, quoted_total_minor, converted_rental_id,
       created_at, vehicles ( make, model )`,
    )
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: true })

  if (error) throw toAppError(error)
  return ((data ?? []) as unknown as LeadRow[]).map(toLead)
}

export async function setLeadStatus(leadId: string, status: LeadStatus): Promise<void> {
  const { error } = await getSupabaseClient()
    .from('booking_leads')
    .update({ status })
    .eq('id', leadId)
  if (error) throw toAppError(error)
}

/**
 * Deletes a lead outright.
 *
 * The DPA promises an agency can act on a renter's request to be forgotten,
 * and without this the promise is empty. A manager's decision, enforced by the
 * delete policy (20261113100900), not by hiding the button.
 */
export async function deleteLead(leadId: string): Promise<void> {
  const { error } = await getSupabaseClient().from('booking_leads').delete().eq('id', leadId)
  if (error) throw toAppError(error)
}

/**
 * The leads that are asking for the same car over the same dates as another.
 *
 * WHY THIS MATTERS AT ALL: a lead holds nothing. Two people can ask for the
 * same car on the same weekend, and both will sit in the queue looking equally
 * answerable until somebody converts one and the other turns into an apology.
 * Flagging the collision is the difference between choosing which to answer
 * and finding out afterwards.
 *
 * Only LIVE leads collide. A converted lead already took the car -- the rental
 * is the thing holding it now, and the conversion dialog re-checks that
 * anyway. A declined or lapsed one is nobody's claim. Including either would
 * mean flagging every new request against the history of its own vehicle, and
 * a warning that is always on is a warning nobody reads.
 *
 * Touching at the boundary is not an overlap: one hire ending at ten and
 * another starting at ten is the back-to-back booking the exclusion constraint
 * already allows (`[)` ranges, 20260813090400).
 */
export function overlappingLeadIds(leads: readonly Lead[]): Set<string> {
  const live = leads.filter((lead) => LIVE_STATUSES.includes(lead.status))
  const flagged = new Set<string>()

  for (let i = 0; i < live.length; i += 1) {
    for (let j = i + 1; j < live.length; j += 1) {
      const a = live[i]!
      const b = live[j]!
      if (a.vehicleId !== b.vehicleId) continue
      if (
        Date.parse(a.startsAt) < Date.parse(b.endsAt) &&
        Date.parse(b.startsAt) < Date.parse(a.endsAt)
      ) {
        flagged.add(a.id)
        flagged.add(b.id)
      }
    }
  }

  return flagged
}

export interface ConvertedLead {
  customerId: string
  rentalId: string
}

/** Corrections staff make on the way through. Everything is optional. */
export interface CustomerOverrides {
  first_name?: string
  last_name?: string
  email?: string
  phone?: string
}

/**
 * Turns a lead into a customer and a reserved rental.
 *
 * One call, one transaction. The function locks the lead before it reads the
 * status, re-checks that the car is still free, and prices the rental from the
 * vehicle as it is today -- so everything this returns either happened wholly
 * or not at all.
 */
export async function convertLead(
  leadId: string,
  overrides: CustomerOverrides = {},
): Promise<ConvertedLead> {
  const { data, error } = await getSupabaseClient().rpc('convert_booking_lead', {
    p_lead_id: leadId,
    p_customer_overrides: overrides as never,
  })

  if (error) throw toAppError(error)
  const row = data?.[0]
  if (!row) throw new AppError('unknown', 'The booking request could not be converted.')
  return { customerId: row.customer_id, rentalId: row.rental_id }
}

/**
 * What the car costs per day now, against what the lead was quoted.
 *
 * Read separately rather than carried on the lead on purpose: the snapshot is
 * what the renter was told, and this is what the rental will charge. Staff are
 * shown both and decide; neither figure is applied quietly over the other.
 */
export async function fetchCurrentDailyRate(
  vehicleId: string,
): Promise<{ dailyRateMinor: number; currency: string } | null> {
  const { data, error } = await getSupabaseClient()
    .from('vehicles')
    .select('daily_rate_minor, currency')
    .eq('id', vehicleId)
    .maybeSingle()

  if (error) throw toAppError(error)
  if (!data) return null
  return { dailyRateMinor: Number(data.daily_rate_minor), currency: data.currency }
}

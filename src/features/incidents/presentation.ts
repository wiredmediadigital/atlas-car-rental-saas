import type { IncidentResponsibility, IncidentStatus, IncidentType } from '@/types/database'

export const incidentTypeLabels: Record<IncidentType, string> = {
  breakdown: 'Breakdown',
  accident: 'Accident',
  vehicle_damage: 'Vehicle damage',
  theft: 'Theft',
  other: 'Other',
}

export const incidentStatusLabels: Record<IncidentStatus, string> = {
  open: 'Open',
  in_progress: 'In progress',
  resolved: 'Resolved',
}

export const incidentResponsibilityLabels: Record<IncidentResponsibility, string> = {
  customer: 'Customer',
  agency: 'Rental agency',
  third_party: 'Third party',
  undetermined: 'Undetermined',
}

export function vehicleLabel(
  vehicle: {
    registration_plate: string
    make: string
    model: string
    model_year?: number | null
  } | null,
) {
  if (!vehicle) return 'Vehicle unavailable'
  const year = vehicle.model_year ? ` (${vehicle.model_year})` : ''
  return `${vehicle.registration_plate} — ${vehicle.make} ${vehicle.model}${year}`
}

export function rentalLabel(
  rental: { reference: string; status: string; customer?: { display_name: string } | null } | null,
) {
  if (!rental) return 'No related rental'
  return `${rental.reference} — ${rental.customer?.display_name ?? 'Customer unavailable'} — ${rental.status.replace('_', ' ')}`
}

export function statusTone(status: IncidentStatus) {
  return status === 'resolved' ? 'positive' : status === 'in_progress' ? 'info' : 'caution'
}

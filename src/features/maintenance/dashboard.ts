import {
  evaluateVehicleServicing,
  type ServiceOptions,
  type ServiceState,
  type ServiceStatus,
} from '@/lib/compliance/service'

import type { MaintenanceRow, ServicePlanRecord, ServicingVehicle } from './api'

/**
 * The figures on the Maintenance dashboard, derived rather than queried.
 *
 * Everything here is computed from rows the page already has, through the same
 * `evaluateServicePlan` that Vehicle Details and the record's own card use. A
 * second definition of "due soon" -- in SQL, say -- is how two screens end up
 * disagreeing about the same car on the same day, which is the defect this
 * work package exists to close.
 *
 * Money, downtime and the status counts are NOT here: those are real
 * aggregates and come from the server (`fetchMaintenanceSpend`,
 * `fetchMaintenanceStatusCounts`, `maintenance_fleet_downtime`), because a
 * figure derived from a list that `max_rows` has truncated is wrong while
 * looking exact.
 */

export interface VehicleServicing {
  vehicle: ServicingVehicle
  /** The maintenance record carrying the plan, when there is one. */
  record: ServicePlanRecord | null
  status: ServiceStatus
}

/**
 * Every vehicle with its servicing state, including the ones nobody has
 * planned a service for.
 *
 * A vehicle with no plan is the most actionable row on the list, so it is
 * included and labelled `not_configured` rather than filtered out.
 */
export function buildServicingRows(
  vehicles: readonly ServicingVehicle[],
  records: readonly ServicePlanRecord[],
  options: ServiceOptions,
): VehicleServicing[] {
  const byVehicle = new Map<string, ServicePlanRecord[]>()
  for (const row of records) {
    const existing = byVehicle.get(row.vehicle_id)
    if (existing) existing.push(row)
    else byVehicle.set(row.vehicle_id, [row])
  }

  return vehicles.map((vehicle) => {
    const { record, status } = evaluateVehicleServicing(
      byVehicle.get(vehicle.id) ?? [],
      vehicle.odometer,
      options,
    )
    return { vehicle, record, status }
  })
}

/** How urgent a row is, for sorting the servicing list worst-first. */
const SERVICING_ORDER: Record<ServiceState, number> = {
  overdue: 0,
  due: 1,
  due_soon: 2,
  up_to_date: 3,
  not_configured: 4,
}

export function sortServicingRows(rows: readonly VehicleServicing[]): VehicleServicing[] {
  return [...rows].sort((a, b) => {
    const order = SERVICING_ORDER[a.status.state] - SERVICING_ORDER[b.status.state]
    if (order !== 0) return order
    // Within a state, the one furthest past its date first.
    const aDays = a.status.byDate.remaining ?? Number.POSITIVE_INFINITY
    const bDays = b.status.byDate.remaining ?? Number.POSITIVE_INFINITY
    if (aDays !== bDays) return aDays - bDays
    return a.vehicle.registration_plate.localeCompare(b.vehicle.registration_plate)
  })
}

export interface ServicingCounts {
  dueSoon: number
  overdue: number
  notConfigured: number
}

/**
 * Due soon and overdue, counted so that they do not overlap.
 *
 * `due` — the threshold reached today — is counted with overdue rather than
 * with due soon, because an operator reading "overdue" wants everything that
 * needs doing now, and a service due today needs doing today.
 */
export function countServicing(rows: readonly VehicleServicing[]): ServicingCounts {
  let dueSoon = 0
  let overdue = 0
  let notConfigured = 0

  for (const row of rows) {
    if (row.status.state === 'due_soon') dueSoon += 1
    else if (row.status.state === 'due' || row.status.state === 'overdue') overdue += 1
    else if (row.status.state === 'not_configured') notConfigured += 1
  }

  return { dueSoon, overdue, notConfigured }
}

export interface MaintenanceListFilters {
  search: string
  status: MaintenanceRow['status'] | 'any'
  vehicleId: string
  category: string
  priority: string
  from: string
  to: string
}

/**
 * The records list, narrowed.
 *
 * Searching covers the reference, the title and the vehicle as an operator
 * reads it — plate, make and model — because those are the four things anybody
 * has to hand when they go looking for a job.
 *
 * The scheduled-date filter is deliberately separate from the dashboard's
 * period. The period governs the spend and downtime figures; a records list
 * that silently hid next month's scheduled work would be useless to the person
 * planning it.
 */
export function filterMaintenanceRows(
  rows: readonly MaintenanceRow[],
  filters: MaintenanceListFilters,
): MaintenanceRow[] {
  const term = filters.search.trim().toLowerCase()

  return rows.filter((row) => {
    if (filters.status !== 'any' && row.status !== filters.status) return false
    if (filters.vehicleId !== '' && row.vehicle_id !== filters.vehicleId) return false
    if (filters.category !== 'any' && row.category !== filters.category) return false
    if (filters.priority !== 'any' && row.priority !== filters.priority) return false

    if (filters.from !== '' || filters.to !== '') {
      // A record with no scheduled start cannot satisfy a date window, and
      // guessing a date for it would put unscheduled work in a month nobody
      // scheduled it for.
      if (!row.scheduled_start) return false
      const day = row.scheduled_start.slice(0, 10)
      if (filters.from !== '' && day < filters.from) return false
      if (filters.to !== '' && day > filters.to) return false
    }

    if (term === '') return true
    const haystack = [
      row.reference,
      row.title,
      row.vehicle?.registration_plate,
      row.vehicle?.make,
      row.vehicle?.model,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
    return haystack.includes(term)
  })
}

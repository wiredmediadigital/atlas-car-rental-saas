import { toIsoDateInTimeZone } from '@/lib/datetime/timezone'
import type { IncidentResponsibility, IncidentStatus, IncidentType } from '@/types/database'

import type { IncidentDashboardRow, IncidentMaintenanceLink } from './api'

/**
 * The figures on the Incidents dashboard, derived rather than queried.
 *
 * All of it is computed from one complete list the page already holds, so the
 * tiles and the table beneath them cannot disagree. Counting server-side with
 * one query and listing with another would let "Open incidents: 4" sit above a
 * list of five whenever the two ran a moment apart, and a summary that
 * contradicts the thing it summarises poisons every other figure on the page.
 *
 * Nothing here is a real SQL aggregate for the same reason it is not derived
 * from a page of rows: `fetchIncidentDashboard` pages to the end, so the list
 * is the whole dataset rather than whatever `max_rows` returned first.
 */

/** A reporting window, as instants. */
export interface IncidentPeriod {
  /** Inclusive. */
  readonly fromInstant: string
  /** Exclusive. */
  readonly toInstant: string
}

/**
 * `occurred_at` is a `timestamptz`, so the window is compared as instants.
 *
 * Not as strings: Postgres returns `2026-11-26T12:00:00+00:00` while
 * `Date.toISOString()` produces `2026-11-26T12:00:00.000Z`, and comparing those
 * two spellings lexicographically gives the wrong answer for perfectly ordinary
 * dates. The bounds are parsed once by the caller of `inPeriod`.
 */
function parseBounds(period: IncidentPeriod | null): { from: number; to: number } | null {
  if (!period) return null
  const from = Date.parse(period.fromInstant)
  const to = Date.parse(period.toInstant)
  return Number.isNaN(from) || Number.isNaN(to) ? null : { from, to }
}

function inBounds(occurredAt: string, bounds: { from: number; to: number } | null): boolean {
  if (!bounds) return true
  const at = Date.parse(occurredAt)
  if (Number.isNaN(at)) return false
  return at >= bounds.from && at < bounds.to
}

/** An incident that has not been resolved, whatever stage it is at. */
export function isOpenIncident(row: { status: IncidentStatus }): boolean {
  return row.status !== 'resolved'
}

export function outstandingFor(
  row: { id: string },
  links: Readonly<Record<string, IncidentMaintenanceLink>>,
): number {
  return links[row.id]?.outstanding ?? 0
}

export function maintenanceTotalFor(
  row: { id: string },
  links: Readonly<Record<string, IncidentMaintenanceLink>>,
): number {
  return links[row.id]?.total ?? 0
}

export interface IncidentSummaryFigures {
  /** Reported in the selected period. */
  readonly total: number
  /** Reported in the selected period and since resolved. */
  readonly resolved: number
  /** Reported in the selected period against a rental. */
  readonly rentalRelated: number
  /** Not resolved, whenever it happened. */
  readonly open: number
  /** Distinct vehicles with at least one unresolved incident, whenever it happened. */
  readonly vehiclesAffected: number
  /** Incidents with scheduled or in-progress maintenance, whenever they happened. */
  readonly withOutstandingMaintenance: number
}

/**
 * Six figures, of two kinds, and the difference matters.
 *
 * THREE ARE PERIOD FIGURES — total, resolved and rental-related. They answer
 * "what happened in November".
 *
 * THREE ARE CURRENT STATE — open, vehicles affected, and outstanding
 * maintenance. They are deliberately NOT bounded by the period, because an
 * incident opened in March and never closed is exactly the thing an operator
 * needs to find, and a dashboard that hid it behind a month selector would
 * hide its most important row. The brief requires open work to stay
 * discoverable regardless of the original incident date; this is where that is
 * enforced, and the tile captions say so on screen.
 *
 * An incident with three maintenance records counts ONCE towards outstanding
 * maintenance. The figure counts incidents, not jobs.
 */
export function summariseIncidents(
  rows: readonly IncidentDashboardRow[],
  links: Readonly<Record<string, IncidentMaintenanceLink>>,
  period: IncidentPeriod | null,
): IncidentSummaryFigures {
  const bounds = parseBounds(period)

  let total = 0
  let resolved = 0
  let rentalRelated = 0
  let open = 0
  let withOutstandingMaintenance = 0
  const affected = new Set<string>()

  for (const row of rows) {
    if (inBounds(row.occurred_at, bounds)) {
      total += 1
      if (row.status === 'resolved') resolved += 1
      if (row.rental_id !== null) rentalRelated += 1
    }

    if (isOpenIncident(row)) {
      open += 1
      affected.add(row.vehicle_id)
    }

    if (outstandingFor(row, links) > 0) withOutstandingMaintenance += 1
  }

  return {
    total,
    resolved,
    rentalRelated,
    open,
    vehiclesAffected: affected.size,
    withOutstandingMaintenance,
  }
}

export interface IncidentListFilters {
  readonly search: string
  /**
   * `unresolved` is open OR in progress.
   *
   * It exists because "Open incidents" counts everything that is not resolved,
   * and a drill-down that set the literal status `open` would hide every
   * in-progress incident -- the tile would say nine and the list beneath it
   * would show six, with no way to tell which was lying.
   */
  readonly status: IncidentStatus | 'any' | 'unresolved'
  readonly type: IncidentType | 'any'
  readonly responsibility: IncidentResponsibility | 'any'
  readonly vehicleId: string
  /** Inclusive ISO date on the incident's calendar day. */
  readonly from: string
  /** Inclusive ISO date. */
  readonly to: string
  readonly maintenance: 'any' | 'outstanding' | 'none'
  /** Whether the incident happened against a rental. */
  readonly rental: 'any' | 'rental' | 'standalone'
}

export const EMPTY_INCIDENT_FILTERS: IncidentListFilters = {
  search: '',
  status: 'any',
  type: 'any',
  responsibility: 'any',
  vehicleId: '',
  from: '',
  to: '',
  maintenance: 'any',
  rental: 'any',
}

export function countActiveFilters(filters: IncidentListFilters): number {
  return (
    (filters.status !== 'any' ? 1 : 0) +
    (filters.type !== 'any' ? 1 : 0) +
    (filters.responsibility !== 'any' ? 1 : 0) +
    (filters.vehicleId !== '' ? 1 : 0) +
    (filters.from !== '' ? 1 : 0) +
    (filters.to !== '' ? 1 : 0) +
    (filters.maintenance !== 'any' ? 1 : 0) +
    (filters.rental !== 'any' ? 1 : 0)
  )
}

/**
 * The records list, narrowed.
 *
 * Search covers what somebody actually has to hand when they go looking: the
 * incident reference, the vehicle as it is read — plate, make, model — the
 * rental reference, the customer's name, and the free text of the report
 * itself. The last two are why `location` and `description` are carried on the
 * row at all.
 *
 * The explicit date filter is a calendar-day comparison on the incident's own
 * day, separate from the period that governs the three period tiles. Two
 * controls, two jobs: one says which month the figures describe, the other
 * narrows the list.
 */
export function filterIncidentRows(
  rows: readonly IncidentDashboardRow[],
  links: Readonly<Record<string, IncidentMaintenanceLink>>,
  filters: IncidentListFilters,
  period: IncidentPeriod | null,
  timeZone: string,
): IncidentDashboardRow[] {
  const bounds = parseBounds(period)
  const term = filters.search.trim().toLowerCase()
  const needsDay = filters.from !== '' || filters.to !== ''

  return rows.filter((row) => {
    if (!inBounds(row.occurred_at, bounds)) return false

    if (filters.status === 'unresolved') {
      if (!isOpenIncident(row)) return false
    } else if (filters.status !== 'any' && row.status !== filters.status) {
      return false
    }

    if (filters.type !== 'any' && row.incident_type !== filters.type) return false
    if (filters.responsibility !== 'any' && row.responsibility !== filters.responsibility) {
      return false
    }
    if (filters.vehicleId !== '' && row.vehicle_id !== filters.vehicleId) return false

    if (filters.maintenance === 'outstanding' && outstandingFor(row, links) === 0) return false
    if (filters.maintenance === 'none' && maintenanceTotalFor(row, links) > 0) return false

    if (filters.rental === 'rental' && row.rental_id === null) return false
    if (filters.rental === 'standalone' && row.rental_id !== null) return false

    if (needsDay) {
      /*
       * The AGENCY's calendar day, not the UTC one.
       *
       * `occurred_at` is an instant, and slicing the first ten characters of
       * its UTC spelling gives the wrong day either side of midnight: an
       * incident at 23:30Z is already tomorrow in Casablanca. The table shows
       * the agency's day, so a filter reading the UTC day would exclude a row
       * whose own displayed date sits inside the range the operator typed --
       * and there is no way to tell from the screen why it vanished.
       */
      const day = toIsoDateInTimeZone(new Date(row.occurred_at), timeZone)
      if (filters.from !== '' && day < filters.from) return false
      if (filters.to !== '' && day > filters.to) return false
    }

    if (term === '') return true
    const haystack = [
      row.reference,
      row.vehicle?.registration_plate,
      row.vehicle?.make,
      row.vehicle?.model,
      row.rental?.reference,
      row.customer?.display_name,
      row.location,
      row.description,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
    return haystack.includes(term)
  })
}

/** Vehicles that actually appear in the incident list, for the vehicle filter. */
export function incidentVehicleOptions(
  rows: readonly IncidentDashboardRow[],
): { id: string; label: string }[] {
  const byId = new Map<string, string>()
  for (const row of rows) {
    if (byId.has(row.vehicle_id)) continue
    byId.set(
      row.vehicle_id,
      row.vehicle
        ? `${row.vehicle.make} ${row.vehicle.model} · ${row.vehicle.registration_plate}`
        : 'Vehicle unavailable',
    )
  }
  return [...byId]
    .map(([id, label]) => ({ id, label }))
    .sort((a, b) => a.label.localeCompare(b.label))
}

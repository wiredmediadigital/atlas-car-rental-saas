import type { BadgeTone } from '@/components/ui'

import type { MaintenanceCategory, MaintenancePriority, MaintenanceRow } from './api'

export const maintenanceStatusLabels: Record<MaintenanceRow['status'], string> = {
  scheduled: 'Scheduled',
  in_progress: 'In progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
}

export const maintenanceStatusTones: Record<MaintenanceRow['status'], BadgeTone> = {
  scheduled: 'info',
  in_progress: 'caution',
  completed: 'positive',
  cancelled: 'neutral',
}

export const maintenanceCategoryLabels: Record<MaintenanceCategory, string> = {
  preventive: 'Preventive service',
  oil_filter: 'Oil and filter',
  tire_service: 'Tire service',
  brake_service: 'Brake service',
  battery_electrical: 'Battery / electrical',
  mechanical_repair: 'Mechanical repair',
  bodywork_collision: 'Bodywork / collision',
  vehicle_inspection: 'Vehicle inspection',
  recall: 'Recall',
  cleaning_detailing: 'Cleaning / detailing',
  other: 'Other',
}

export const maintenancePriorityLabels: Record<MaintenancePriority, string> = {
  low: 'Low',
  normal: 'Normal',
  high: 'High',
  urgent: 'Urgent',
}

export const incidentTypeLabels: Record<string, string> = {
  breakdown: 'Breakdown',
  accident: 'Accident',
  vehicle_damage: 'Vehicle damage',
  theft: 'Theft',
  other: 'Other',
}

export const incidentStatusLabels: Record<string, string> = {
  open: 'Open',
  in_progress: 'In progress',
  resolved: 'Resolved',
}

/**
 * Work that is still open past the completion it was given.
 *
 * Only in-progress work can be overdue: a record nobody started has not failed
 * to finish, it has failed to begin, which is a different thing and is shown as
 * scheduled.
 */
export function isOverdue(row: Pick<MaintenanceRow, 'status' | 'expected_completion'>): boolean {
  if (row.status !== 'in_progress' || !row.expected_completion) return false
  return new Date(row.expected_completion).getTime() < Date.now()
}

/** Started before the date it was booked for. */
export function startedEarly(
  row: Pick<MaintenanceRow, 'actual_start' | 'scheduled_start'>,
): boolean {
  if (!row.actual_start || !row.scheduled_start) return false
  return new Date(row.actual_start).getTime() < new Date(row.scheduled_start).getTime()
}

/**
 * How long the vehicle was, or has been, out of service for this record alone.
 *
 * Returns null when the work has not started: a plan is not downtime. Work that
 * is still open counts up to this moment, which is why the caller re-reads it
 * rather than caching the number.
 */
export function actualDurationMinutes(
  row: Pick<MaintenanceRow, 'actual_start' | 'actual_completion'>,
  now: number = Date.now(),
): number | null {
  if (!row.actual_start) return null
  const end = row.actual_completion ? new Date(row.actual_completion).getTime() : now
  return Math.max(0, Math.round((end - new Date(row.actual_start).getTime()) / 60_000))
}

/** The duration that was planned, when both ends of the window are known. */
export function plannedDurationMinutes(
  row: Pick<MaintenanceRow, 'scheduled_start' | 'expected_completion'>,
): number | null {
  if (!row.scheduled_start || !row.expected_completion) return null
  return Math.max(
    0,
    Math.round(
      (new Date(row.expected_completion).getTime() - new Date(row.scheduled_start).getTime()) /
        60_000,
    ),
  )
}

/** "3 d 4 h 05 m", trimmed to the units that matter. */
export function formatDuration(minutes: number | null): string {
  if (minutes === null) return '—'
  if (minutes < 1) return 'Under a minute'
  const days = Math.floor(minutes / (60 * 24))
  const hours = Math.floor((minutes % (60 * 24)) / 60)
  const rest = minutes % 60
  const parts: string[] = []
  if (days > 0) parts.push(`${days} d`)
  if (hours > 0) parts.push(`${hours} h`)
  if (rest > 0 && days === 0) parts.push(`${rest} m`)
  return parts.join(' ') || `${minutes} m`
}

/**
 * Whether work booked for later would be starting ahead of its date.
 *
 * Kept out of the page so the clock is read when the operator clicks, rather
 * than captured when the page rendered — a page left open for an hour would
 * otherwise still think the start is early.
 */
export function startsLaterThanNow(scheduledStart: string | null): boolean {
  if (!scheduledStart) return false
  return new Date(scheduledStart).getTime() > Date.now()
}

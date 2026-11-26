/**
 * The one rule for "is this vehicle due for a service?".
 *
 * Maintenance Management, Vehicle Details and the fleet-wide servicing list all
 * ask this, and they are required not to disagree. So, exactly as
 * [`evaluateCompliance`](./expiry.ts) does for renewal dates, the calculation
 * lives here and nowhere else.
 *
 * Two horizons, not one. A service falls due on a date, or at an odometer
 * reading, or at whichever of the two arrives first — so each limb is
 * evaluated on its own and the more urgent one decides. "First threshold
 * reached" and "worst of the two" are the same sentence read from opposite
 * ends.
 *
 * What this deliberately does NOT do:
 *
 *   - It does not convert distances. The odometer is a bare integer in whatever
 *     unit the agency works in; no conversion factor exists anywhere in this
 *     product, and inventing one here would silently reinterpret every stored
 *     reading. The warning distance is therefore expressed in the same stored
 *     unit (see DEFAULT_SERVICE_LEAD_DISTANCE).
 *   - It does not decide anything operational. A due service is a reminder. It
 *     does not take a vehicle off the road, block a rental or touch a
 *     maintenance record; only recorded maintenance does that.
 */

import { toIsoDateInTimeZone } from '@/lib/datetime/timezone'

import type { ComplianceOptions } from './expiry'

export type ServiceState = 'not_configured' | 'up_to_date' | 'due_soon' | 'due' | 'overdue'

/** Which limb of the plan fell due first. */
export type ServiceTrigger = 'date' | 'odometer'

/**
 * The warning distance, in the agency's own odometer unit.
 *
 * 500 is the figure the owner specified. It is applied in stored units rather
 * than converted, because nothing in this product converts an odometer and a
 * reading has no unit attached to it. For an agency working in miles this is a
 * wider window than 500 km would be; it is a single named constant and an
 * explicit option so it can be changed in one place when that matters.
 *
 * The DATE side has no equivalent constant on purpose: it reuses the agency's
 * own `compliance_reminder_lead_days`, which Vehicle Details already advertises
 * over this very row ("Warnings begin N days before a renewal date").
 */
export const DEFAULT_SERVICE_LEAD_DISTANCE = 500

export interface ServicePlan {
  readonly next_service_on: string | null
  readonly next_service_odometer: number | null
  readonly service_interval_days?: number | null
  readonly service_interval_odometer?: number | null
}

export interface ServiceOptions extends ComplianceOptions {
  /** Warning distance in STORED odometer units. Never kilometres-by-definition. */
  readonly leadDistance?: number
}

export interface ServiceLimb {
  /** False when this limb of the plan was never set. */
  readonly configured: boolean
  /**
   * Days, or odometer units, until the threshold. Negative once passed.
   * Null when the limb is not configured, or when the odometer is unknown.
   */
  readonly remaining: number | null
  readonly state: ServiceState
}

export interface ServiceStatus {
  readonly state: ServiceState
  /** Which limb produced `state`, or null when nothing is configured. */
  readonly trigger: ServiceTrigger | null
  readonly byDate: ServiceLimb
  readonly byOdometer: ServiceLimb
  readonly nextServiceOn: string | null
  readonly nextServiceOdometer: number | null
  /** False when a distance threshold is set but no current reading was supplied. */
  readonly odometerKnown: boolean
}

const NOT_CONFIGURED_LIMB: ServiceLimb = {
  configured: false,
  remaining: null,
  state: 'not_configured',
}

/** Worst first, so the two limbs can be reduced to the one that decides. */
const SEVERITY: Record<ServiceState, number> = {
  overdue: 4,
  due: 3,
  due_soon: 2,
  up_to_date: 1,
  not_configured: 0,
}

export function serviceSeverity(state: ServiceState): number {
  return SEVERITY[state]
}

function parseIsoDateParts(value: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null
  const [, year, month, day] = match
  return { year: Number(year), month: Number(month), day: Number(day) }
}

/**
 * Whole days from the agency's today until a `date` column value.
 *
 * Both sides are reduced to a calendar day in the agency's zone and then
 * measured in UTC, so no offset and no daylight-saving change can move the
 * answer across a boundary. Comparing `new Date('2026-11-26')` — which is
 * midnight UTC — against `Date.now()` cannot do this: a New York agency would
 * see a service fall due at seven the previous evening.
 */
function daysUntilDate(value: string, timeZone: string, now: Date): number | null {
  const target = parseIsoDateParts(value)
  const today = parseIsoDateParts(toIsoDateInTimeZone(now, timeZone))
  if (!target || !today) return null

  const targetUtc = Date.UTC(target.year, target.month - 1, target.day)
  const todayUtc = Date.UTC(today.year, today.month - 1, today.day)
  return Math.round((targetUtc - todayUtc) / 86_400_000)
}

/**
 * Classifies one limb from how much is left before its threshold.
 *
 * The threshold day, and the threshold reading, are "due" rather than
 * "overdue": a service due on the 14th is due for the whole of the 14th, the
 * same inclusive reading `evaluateCompliance` gives a certificate.
 */
function classify(remaining: number, lead: number): ServiceState {
  if (remaining < 0) return 'overdue'
  if (remaining === 0) return 'due'
  if (remaining <= Math.max(0, lead)) return 'due_soon'
  return 'up_to_date'
}

/**
 * @param currentOdometer The vehicle's reading now, or null when unknown. A
 *   distance threshold cannot be judged without one, so the limb reports
 *   `not_configured` and the date limb — if there is one — decides alone.
 *   Guessing from a stale reading would be worse than saying nothing.
 */
export function evaluateServicePlan(
  plan: ServicePlan | null | undefined,
  currentOdometer: number | null | undefined,
  options: ServiceOptions,
): ServiceStatus {
  const {
    timeZone,
    leadDays,
    leadDistance = DEFAULT_SERVICE_LEAD_DISTANCE,
    now = new Date(),
  } = options

  const nextServiceOn = plan?.next_service_on ?? null
  const nextServiceOdometer = plan?.next_service_odometer ?? null

  let byDate: ServiceLimb = NOT_CONFIGURED_LIMB
  if (nextServiceOn) {
    const remaining = daysUntilDate(nextServiceOn, timeZone, now)
    byDate =
      remaining === null
        ? NOT_CONFIGURED_LIMB
        : { configured: true, remaining, state: classify(remaining, leadDays) }
  }

  const odometerKnown = typeof currentOdometer === 'number' && Number.isFinite(currentOdometer)

  let byOdometer: ServiceLimb = NOT_CONFIGURED_LIMB
  if (nextServiceOdometer !== null && odometerKnown) {
    const remaining = nextServiceOdometer - currentOdometer
    byOdometer = { configured: true, remaining, state: classify(remaining, leadDistance) }
  }

  // The first threshold reached is the most urgent one, which is the same
  // thing as the worst of the two states.
  let state: ServiceState = 'not_configured'
  let trigger: ServiceTrigger | null = null

  if (byDate.configured) {
    state = byDate.state
    trigger = 'date'
  }
  if (byOdometer.configured && SEVERITY[byOdometer.state] > SEVERITY[state]) {
    state = byOdometer.state
    trigger = 'odometer'
  }

  return {
    state,
    trigger,
    byDate,
    byOdometer,
    nextServiceOn,
    nextServiceOdometer,
    odometerKnown: nextServiceOdometer === null ? true : odometerKnown,
  }
}

export const SERVICE_STATE_LABELS: Record<ServiceState, string> = {
  not_configured: 'Not configured',
  up_to_date: 'Up to date',
  due_soon: 'Due soon',
  due: 'Due',
  overdue: 'Overdue',
}

/** Matches the Badge tones used for maintenance status, so the two read alike. */
export const SERVICE_STATE_TONES: Record<
  ServiceState,
  'neutral' | 'positive' | 'caution' | 'critical'
> = {
  not_configured: 'neutral',
  up_to_date: 'positive',
  due_soon: 'caution',
  due: 'caution',
  overdue: 'critical',
}

/** "Due in 12 days", "8 days overdue", "Due today". */
export function describeServiceDate(limb: ServiceLimb): string | null {
  if (!limb.configured || limb.remaining === null) return null
  const days = limb.remaining
  if (days === 0) return 'Due today'
  if (days < 0) {
    const past = Math.abs(days)
    return past === 1 ? '1 day overdue' : `${past} days overdue`
  }
  return days === 1 ? 'Due tomorrow' : `Due in ${days} days`
}

/** "Due in 420 km", "120 km overdue". Distance is already in the agency's unit. */
export function describeServiceDistance(limb: ServiceLimb, distanceUnit: string): string | null {
  if (!limb.configured || limb.remaining === null) return null
  const remaining = limb.remaining
  if (remaining === 0) return `Due now (${distanceUnit})`
  if (remaining < 0) return `${Math.abs(remaining).toLocaleString()} ${distanceUnit} overdue`
  return `Due in ${remaining.toLocaleString()} ${distanceUnit}`
}

/**
 * The plan that answers "when is this vehicle next due?".
 *
 * A vehicle's plan lives on its maintenance records, because that is where
 * `maintenance_set_service_plan` puts it -- one recurrence rule travelling
 * with the record that last serviced the car, advanced each time qualifying
 * work is completed. A vehicle can therefore carry several, and choosing
 * between them is a real decision rather than a detail:
 *
 *   - Cancelled records are ignored. A cancelled job's reminder is not a
 *     commitment.
 *   - A live record -- scheduled or in progress -- beats a completed one.
 *     Without this, a years-old completed one-off reminder would win on date
 *     for ever and report a vehicle permanently overdue while the plan
 *     somebody actually configured sat unread beside it.
 *   - Within a group, the most recently created record wins, because that is
 *     the plan somebody set last. Ties are then broken on id, so the answer
 *     does not depend on the order rows happened to arrive in -- Vehicle
 *     Details and the fleet list sort their inputs differently and must still
 *     agree.
 */
export interface VehicleServiceResult<T> {
  /** The record whose plan decided the status, or null when none is configured. */
  record: T | null
  status: ServiceStatus
}

/**
 * The servicing state of one vehicle, across every plan it carries.
 *
 * Evaluates each candidate and returns the most urgent, rather than picking a
 * record first and evaluating only that one. The question an operator is
 * asking is "does this car need a service?", and a car whose second record has
 * already passed its odometer threshold needs one even if the record chosen on
 * date terms looks fine. Picking first would have made that invisible.
 *
 * Ties -- including the ordinary case of a single plan -- fall through to
 * `selectVehicleServicePlan`, so the record offered for editing is still the
 * one somebody configured last.
 */
export function evaluateVehicleServicing<
  T extends ServicePlan & { id?: string; status?: string | null; created_at?: string | null },
>(
  records: readonly T[],
  currentOdometer: number | null | undefined,
  options: ServiceOptions,
): VehicleServiceResult<T> {
  const governing = selectVehicleServicePlan(records)
  if (!governing) {
    return { record: null, status: evaluateServicePlan(null, currentOdometer, options) }
  }

  let best: VehicleServiceResult<T> = {
    record: governing,
    status: evaluateServicePlan(governing, currentOdometer, options),
  }

  for (const row of records) {
    if (row === governing) continue
    if (row.status === 'cancelled') continue
    if (row.next_service_on === null && row.next_service_odometer === null) continue

    const status = evaluateServicePlan(row, currentOdometer, options)
    if (SEVERITY[status.state] > SEVERITY[best.status.state]) best = { record: row, status }
  }

  return best
}

export function selectVehicleServicePlan<
  T extends ServicePlan & { id?: string; status?: string | null; created_at?: string | null },
>(records: readonly T[]): T | null {
  const candidates = records.filter(
    (row) =>
      row.status !== 'cancelled' &&
      (row.next_service_on !== null ||
        row.next_service_odometer !== null ||
        row.service_interval_days != null ||
        row.service_interval_odometer != null),
  )
  if (candidates.length === 0) return null

  const rank = (row: T): number => (row.status === 'completed' ? 1 : 0)

  return candidates.reduce((best, row) => {
    const byStatus = rank(row) - rank(best)
    if (byStatus !== 0) return byStatus < 0 ? row : best

    const a = best.created_at ?? ''
    const b = row.created_at ?? ''
    if (a !== b) return b > a ? row : best

    // Deterministic last resort, so two equally-ranked records cannot swap
    // depending on which screen loaded them.
    return (row.id ?? '') > (best.id ?? '') ? row : best
  })
}

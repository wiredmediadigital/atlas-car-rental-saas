/**
 * Reading what somebody typed into the preventive servicing form.
 *
 * Kept out of the component because the rules are the interesting part and
 * they need testing on their own. Every rule here mirrors a CHECK constraint
 * or a guard in `public.maintenance_set_service_plan`; this layer exists so a
 * person sees the problem on the field they are typing in, not so the database
 * can be trusted less.
 *
 * The rule that matters most is that an unreadable entry is an ERROR, never a
 * null. `maintenance_set_service_plan` overwrites all four columns on every
 * call, so a box quietly parsed to null does not leave the stored value alone
 * -- it erases it. Typing "5,000" used to wipe the recurrence rule and report
 * success.
 */

export interface ServicePlanFormInput {
  nextOn: string
  nextOdometer: string
  intervalDays: string
  intervalOdometer: string
}

export interface ServicePlanPayload {
  p_next_service_on: string | null
  p_next_service_odometer: number | null
  p_interval_days: number | null
  p_interval_odometer: number | null
}

export type ServicePlanErrors = Partial<Record<keyof ServicePlanFormInput | 'form', string>>

export interface ServicePlanParseResult {
  payload: ServicePlanPayload | null
  errors: ServicePlanErrors
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/** A whole number, or a statement that it is not one. Never a silent null. */
function wholeNumber(raw: string): { empty: true } | { value: number } | { invalid: true } {
  const trimmed = raw.trim()
  if (trimmed === '') return { empty: true }
  // Deliberately strict: no thousands separators, no units, no decimals. A
  // lenient parse here is what let "5 000 km" through as nothing at all.
  if (!/^\d+$/.test(trimmed)) return { invalid: true }
  const value = Number(trimmed)
  return Number.isSafeInteger(value) ? { value } : { invalid: true }
}

export function parseServicePlanForm(input: ServicePlanFormInput): ServicePlanParseResult {
  const errors: ServicePlanErrors = {}

  const nextOn = input.nextOn.trim()
  let dateValue: string | null = null
  if (nextOn !== '') {
    // Round-tripped, not just parsed: `new Date('2027-02-30')` does not fail,
    // it rolls over to 2 March, and a date that silently becomes a different
    // date is worse than one that is refused.
    const parsed = new Date(`${nextOn}T00:00:00Z`)
    const roundTrips =
      ISO_DATE.test(nextOn) &&
      !Number.isNaN(parsed.getTime()) &&
      parsed.toISOString().slice(0, 10) === nextOn
    if (!roundTrips) {
      errors.nextOn = 'Choose a valid date.'
    } else {
      dateValue = nextOn
    }
  }

  const odometer = wholeNumber(input.nextOdometer)
  let odometerValue: number | null = null
  if ('invalid' in odometer) {
    errors.nextOdometer = 'Enter the reading as a whole number, with no units or separators.'
  } else if ('value' in odometer) {
    odometerValue = odometer.value
  }

  // Mirrors `service_interval_days > 0`. Zero is not "no interval"; it is a
  // recurrence that would fall due the instant it was saved.
  const days = wholeNumber(input.intervalDays)
  let daysValue: number | null = null
  if ('invalid' in days) {
    errors.intervalDays = 'Enter the number of days as a whole number.'
  } else if ('value' in days) {
    if (days.value === 0) errors.intervalDays = 'An interval has to be at least one day.'
    else daysValue = days.value
  }

  // Mirrors `service_interval_odometer > 0`.
  const distance = wholeNumber(input.intervalOdometer)
  let distanceValue: number | null = null
  if ('invalid' in distance) {
    errors.intervalOdometer = 'Enter the distance as a whole number.'
  } else if ('value' in distance) {
    if (distance.value === 0) errors.intervalOdometer = 'An interval has to be more than nothing.'
    else distanceValue = distance.value
  }

  if (Object.keys(errors).length > 0) return { payload: null, errors }

  if (
    dateValue === null &&
    odometerValue === null &&
    daysValue === null &&
    distanceValue === null
  ) {
    return {
      payload: null,
      errors: { form: 'Set at least one reminder: a date, a distance, or an interval.' },
    }
  }

  return {
    payload: {
      p_next_service_on: dateValue,
      p_next_service_odometer: odometerValue,
      p_interval_days: daysValue,
      p_interval_odometer: distanceValue,
    },
    errors: {},
  }
}

export interface StoredServicePlan {
  service_interval_days: number | null
  service_interval_odometer: number | null
  next_service_on: string | null
  next_service_odometer: number | null
}

/** The stored row as form text, for first render and for re-syncing after a save. */
export function servicePlanToForm(record: StoredServicePlan): ServicePlanFormInput {
  return {
    nextOn: record.next_service_on ?? '',
    nextOdometer: record.next_service_odometer === null ? '' : String(record.next_service_odometer),
    intervalDays: record.service_interval_days === null ? '' : String(record.service_interval_days),
    intervalOdometer:
      record.service_interval_odometer === null ? '' : String(record.service_interval_odometer),
  }
}

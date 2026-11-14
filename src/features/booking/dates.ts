/**
 * The window a visitor is offered before they choose one, and how a hire is
 * counted.
 *
 * TWO RULES THAT LOOK ALIKE AND ARE NOT.
 *
 * Which days to offer is a LOCAL question: "tomorrow" means tomorrow where the
 * agency's counter is, so a Paris agency looked up from Auckland should offer
 * tomorrow in Paris. That is `defaultWindow`, and it needs the time zone.
 *
 * How many days to charge is NOT local: `public.rental_billable_days` counts
 * elapsed 24-hour days deliberately (20260815100200, "immune to time-zone and
 * DST shifts"), and the rental created at conversion uses it. Counting local
 * calendar days here would make the page disagree with the conversion dialog
 * for every hire crossing a local midnight. That is `billableDays`, and it
 * needs no zone at all — it is the twin of `src/features/rentals/pricing.ts`,
 * which is the twin of the SQL.
 *
 * This module mirrors `defaultWindow` in
 * `supabase/functions/_shared/public-booking.ts`. The server is the authority —
 * its answer arrives in the payload as `window` — and this copy exists so the
 * date picker can offer the same starting point without a round trip.
 */

const MILLISECONDS_PER_DAY = 86_400_000
/** Picking a car up at ten in the morning is nobody's surprise. */
const PICKUP_HOUR = 10
/** Long enough to be a trip, short enough to leave room to extend. */
const DEFAULT_NIGHTS = 3

export interface BookingWindow {
  from: Date
  to: Date
}

/** Tomorrow at ten, in the agency's zone, for three days. */
export function defaultWindow(timeZone: string, now: Date): BookingWindow {
  const start = atLocalHour(new Date(now.getTime() + MILLISECONDS_PER_DAY), timeZone, PICKUP_HOUR)
  return {
    from: new Date(start),
    to: new Date(start + DEFAULT_NIGHTS * MILLISECONDS_PER_DAY),
  }
}

/**
 * Chargeable days: elapsed time divided into 24-hour days, rounded up, minimum
 * one. The twin of `public.rental_billable_days` and of `billableDays` in
 * `src/features/rentals/pricing.ts`.
 */
export function billableDays(from: Date, to: Date): number {
  const elapsed = to.getTime() - from.getTime()
  if (!Number.isFinite(elapsed)) return 1
  return Math.max(1, Math.ceil(elapsed / MILLISECONDS_PER_DAY))
}

/** The instant at which `hour` o'clock begins, that day, in that zone. */
function atLocalHour(day: Date, timeZone: string, hour: number): number {
  const parts = localParts(day, timeZone)
  if (parts === null) {
    // An unknown zone is a misconfigured agency, not a reason to offer nothing.
    const utc = new Date(day)
    utc.setUTCHours(hour, 0, 0, 0)
    return utc.getTime()
  }
  const guess = Date.UTC(parts.year, parts.month - 1, parts.day, hour, 0, 0, 0)
  // Date.UTC read the local calendar date as though it were UTC, so it is out
  // by exactly the zone's offset at that moment; measuring it there corrects it.
  return guess - offsetAt(guess, timeZone)
}

function localParts(
  at: Date,
  timeZone: string,
): { year: number; month: number; day: number } | null {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(at)
    const find = (type: string) => Number(parts.find((part) => part.type === type)?.value)
    const year = find('year')
    const month = find('month')
    const day = find('day')
    if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null
    return { year, month, day }
  } catch {
    return null
  }
}

/** How far ahead of UTC the zone is at that instant, in milliseconds. */
function offsetAt(instantMs: number, timeZone: string): number {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(new Date(instantMs))
    const find = (type: string) => Number(parts.find((part) => part.type === type)?.value)
    const asUtc = Date.UTC(
      find('year'),
      find('month') - 1,
      find('day'),
      find('hour') % 24,
      find('minute'),
      find('second'),
    )
    return asUtc - instantMs
  } catch {
    return 0
  }
}

/**
 * The window as a person reads it, in the agency's zone.
 *
 * In the AGENCY's zone rather than the visitor's, so that the dates on the page
 * are the dates the counter will expect. A visitor in another country reading
 * their own local dates would book a day either side of what they meant.
 */
export function formatWindow(period: BookingWindow, timeZone: string, locale = 'en-GB'): string {
  const format = (at: Date) => {
    try {
      return new Intl.DateTimeFormat(locale, {
        timeZone,
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(at)
    } catch {
      return at.toISOString().slice(0, 16).replace('T', ' ')
    }
  }
  return `${format(period.from)} to ${format(period.to)}`
}

/** The value a `datetime-local` input wants, in the agency's zone. */
export function toLocalInputValue(at: Date, timeZone: string): string {
  const parts = localParts(at, timeZone)
  if (parts === null) return at.toISOString().slice(0, 16)
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  }).format(at)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${time}`
}

/** The instant a `datetime-local` value means in the agency's zone. */
export function fromLocalInputValue(value: string, timeZone: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value)
  if (match === null) return null
  const [, year, month, day, hour, minute] = match.map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ]
  const guess = Date.UTC(year, month - 1, day, hour, minute, 0, 0)
  return new Date(guess - offsetAt(guess, timeZone))
}

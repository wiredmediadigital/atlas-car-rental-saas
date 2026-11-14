/**
 * Every decision the public booking surface makes.
 *
 * One Edge Function is the whole public surface of this feature, and this is
 * where it thinks. The entrypoint (`public-booking/index.ts`) is a Deno shim
 * that builds effects and dispatches; an entrypoint is outside tsconfig and no
 * test can reach it, so a branch there is a branch nothing checks.
 *
 * THE BROWSER NEVER TOUCHES THE DATABASE. `anon` has no grant on any table or
 * function in this feature. The effects below are the service role calling
 * app.public_booking_agency, app.public_booking_vehicles and
 * app.public_booking_create_lead, each of which checks for itself.
 *
 * WHAT A STRANGER MAY LEARN IS DECIDED HERE AS WELL AS IN SQL. The database
 * refuses to answer for an agency that is not publishing; this module makes
 * sure the refusal reads the same as one for an agency that does not exist, and
 * that a database error never reaches the browser in words. Those messages name
 * whether an agency stopped paying or withdrew a car, which is the agency's
 * business and not the visitor's.
 */

import {
  ADDRESS_RULE,
  EMAIL_RULE,
  checkRate,
  looksAutomated,
  type RateState,
} from './public-booking-rates.ts'

// ---------------------------------------------------------------- shapes ----

/** Mirrors the organizations.slug check in 20260813090100. */
const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,60}[a-z0-9])?$/

const MAX_DAYS = 370
const MILLISECONDS_PER_DAY = 86_400_000
/** A visitor whose clock or timezone puts this morning in the past is fine. */
const PAST_GRACE_MS = MILLISECONDS_PER_DAY

const MAX_NAME = 120
const MAX_EMAIL = 320
const MAX_PHONE = 40
const MAX_NOTE = 2000

/** How long a signed URL for a logo or a photograph lives. */
export const IMAGE_URL_TTL_SECONDS = 600

export interface BookingQuery {
  slug: string
  /** Absent when the visitor has not chosen; the agency's default window is used. */
  from: string | null
  to: string | null
}

export interface RequestSubmission {
  slug: string
  vehicleId: string
  from: string
  to: string
  fullName: string
  email: string
  phone: string | null
  note: string | null
  honeypot: string | null
  startedAt: number | null
}

export interface BookingError {
  error: true
  status: 400 | 404 | 429 | 503
  /** A fixed phrase. Never a database message, never the reason a rule fired. */
  message: string
}

export interface AgencyRow {
  organization_id: string
  name: string
  logo_path: string | null
  phone: string | null
  time_zone: string
  default_currency: string
  accepts_requests: boolean
}

export interface VehicleRow {
  vehicle_id: string
  make: string
  model: string
  model_year: number | null
  category: string | null
  transmission: string | null
  fuel_type: string | null
  seats: number | null
  doors: number | null
  image_path: string | null
  currency: string
  daily_rate_minor: number
  billable_days: number
  quoted_total_minor: number
  is_available: boolean
}

export interface BookingDeps {
  findAgency(slug: string): Promise<AgencyRow | null>
  listVehicles(organizationId: string, from: string, to: string): Promise<VehicleRow[]>
  createLead(input: {
    organizationId: string
    vehicleId: string
    from: string
    to: string
    fullName: string
    email: string
    phone: string | null
    note: string | null
  }): Promise<{ leadId: string; reference: string }>
  /** Short-lived URLs for a logo and photographs held in private buckets. */
  signImages(paths: readonly string[]): Promise<Map<string, string>>
  now(): number
  rate: RateState
  /** The caller's address, for rate limiting only. Never stored. */
  address: string
  log(message: string): void
}

export type BookingDecision = { status: number; body: unknown }

// ------------------------------------------------------------- messages ----

/*
 * Every message a visitor can be shown. Fixed phrases, chosen so that none of
 * them distinguishes a case the visitor has no business distinguishing: an
 * agency that does not exist and one that switched its page off share NOT_FOUND
 * byte for byte, and every refusal of a submission that is not about what the
 * visitor typed shares UNAVAILABLE.
 */
const NOT_FOUND = 'This booking page is not available.'
const BAD_DATES = 'Please choose a pick-up date and a return date in the future.'
const BAD_DETAILS = 'Please check the details and try again.'
const UNAVAILABLE = 'That car is not available for those dates.'
const CLOSED_TO_REQUESTS = 'This agency is not taking requests online at the moment.'
const TOO_MANY = 'Please wait a little before sending another request.'
const TROUBLE = 'Something went wrong. Please try again shortly.'

function fail(status: BookingError['status'], message: string): BookingError {
  return { error: true, status, message }
}

export function isError(value: unknown): value is BookingError {
  return typeof value === 'object' && value !== null && (value as BookingError).error === true
}

// --------------------------------------------------------------- parsing ----

function trimmed(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (text === '' || text.length > max) return null
  return text
}

/** Absent, or the trimmed text, or TOO_LONG -- which is not the same as absent. */
const TOO_LONG = Symbol('too long')

/**
 * An optional field, kept separate from `trimmed` so that "they left it blank"
 * and "they wrote more than the column takes" cannot collapse into one answer.
 * Folding them together drops what somebody actually typed and tells them
 * nothing, which is the worst of the three things this could do.
 */
function optional(value: unknown, max: number): string | null | typeof TOO_LONG {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') return TOO_LONG
  const text = value.trim()
  if (text === '') return null
  return text.length > max ? TOO_LONG : text
}

/** ISO instants only, which is what the page sends and what Postgres stores. */
function instant(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim() === '') return null
  const at = Date.parse(value)
  return Number.isFinite(at) ? new Date(at).toISOString() : null
}

/**
 * Whether a window is one this product will quote.
 *
 * Shared by the page read and the submission so that a visitor cannot be shown
 * a quote the write would refuse. The same three rules live in
 * app.public_booking_create_lead; these exist to say so in a sentence rather
 * than to be the only check.
 */
export function windowProblem(from: string, to: string, now: number): string | null {
  const start = Date.parse(from)
  const end = Date.parse(to)
  if (!Number.isFinite(start) || !Number.isFinite(end)) return BAD_DATES
  if (end <= start) return BAD_DATES
  if (start < now - PAST_GRACE_MS) return BAD_DATES
  if (Math.ceil((end - start) / MILLISECONDS_PER_DAY) > MAX_DAYS) return BAD_DATES
  return null
}

export function parseBookingQuery(url: URL): BookingQuery | BookingError {
  const slug = (url.searchParams.get('slug') ?? '').trim().toLowerCase()
  if (!SLUG_PATTERN.test(slug)) return fail(404, NOT_FOUND)

  const rawFrom = url.searchParams.get('from')
  const rawTo = url.searchParams.get('to')
  if (rawFrom === null && rawTo === null) return { slug, from: null, to: null }

  const from = instant(rawFrom)
  const to = instant(rawTo)
  if (from === null || to === null) return fail(400, BAD_DATES)
  return { slug, from, to }
}

export function parseRequestBody(raw: unknown): RequestSubmission | BookingError {
  if (typeof raw !== 'object' || raw === null) return fail(400, BAD_DETAILS)
  const body = raw as Record<string, unknown>

  const slug = (typeof body.slug === 'string' ? body.slug : '').trim().toLowerCase()
  if (!SLUG_PATTERN.test(slug)) return fail(404, NOT_FOUND)

  const vehicleId = trimmed(body.vehicleId, 64)
  const from = instant(body.from)
  const to = instant(body.to)
  const fullName = trimmed(body.fullName, MAX_NAME)
  const email = trimmed(body.email, MAX_EMAIL)

  if (vehicleId === null || fullName === null || email === null) return fail(400, BAD_DETAILS)
  // Shape only. The email_address domain is what actually decides, and a
  // stricter rule here would reject addresses the database would have taken.
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return fail(400, BAD_DETAILS)
  if (from === null || to === null) return fail(400, BAD_DATES)

  const phone = optional(body.phone, MAX_PHONE)
  const note = optional(body.note, MAX_NOTE)
  if (phone === TOO_LONG || note === TOO_LONG) return fail(400, BAD_DETAILS)

  return {
    slug,
    vehicleId,
    from,
    to,
    fullName,
    email,
    phone,
    note,
    honeypot: typeof body.company === 'string' ? body.company : null,
    startedAt: typeof body.startedAt === 'number' ? body.startedAt : null,
  }
}

// ------------------------------------------------------- the default window ----

/**
 * The window a visitor sees before choosing one: tomorrow to three days later,
 * in the agency's own time zone, at a civilised hour.
 *
 * IN THE AGENCY'S TIME ZONE, because "tomorrow" is a local idea. A Paris agency
 * looked up by someone in Auckland should offer tomorrow in Paris -- the day
 * its counter is open -- and the server's own zone is nobody's answer.
 *
 * The quote itself is NOT computed from local dates: public.rental_billable_days
 * counts elapsed 24-hour days deliberately. The time zone belongs to choosing
 * which days to offer, not to counting them.
 */
export function defaultWindow(timeZone: string, now: number): { from: string; to: string } {
  const start = atLocalHour(new Date(now + MILLISECONDS_PER_DAY), timeZone, 10)
  return {
    from: new Date(start).toISOString(),
    to: new Date(start + 3 * MILLISECONDS_PER_DAY).toISOString(),
  }
}

/** The instant at which `hour` o'clock begins, that day, in that zone. */
function atLocalHour(day: Date, timeZone: string, hour: number): number {
  const parts = localParts(day, timeZone)
  if (parts === null) {
    // An unknown zone is a misconfigured agency, not a reason to serve nothing.
    const utc = new Date(day)
    utc.setUTCHours(hour, 0, 0, 0)
    return utc.getTime()
  }
  const guess = Date.UTC(parts.year, parts.month - 1, parts.day, hour, 0, 0, 0)
  // Date.UTC treated the local calendar date as UTC, so it is wrong by exactly
  // the zone's offset at that moment. Measuring the offset there corrects it.
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

// --------------------------------------------------------------- serving ----

interface PublicAgency {
  name: string
  phone: string | null
  logoUrl: string | null
  timeZone: string
  currency: string
  acceptsRequests: boolean
}

/**
 * The page: the agency, the window used, and every opted-in vehicle.
 *
 * NO UTILISATION FIGURE. The body carries a list and nothing counting it: no
 * total, no number free, no number taken. How busy an agency is on a given
 * weekend is commercially theirs, and a competitor polling this endpoint daily
 * would otherwise have a fleet-utilisation report for free.
 */
export async function serveBooking(
  deps: BookingDeps,
  query: BookingQuery,
): Promise<BookingDecision> {
  let agency: AgencyRow | null
  try {
    agency = await deps.findAgency(query.slug)
  } catch (error) {
    deps.log(`public-booking: agency lookup failed: ${describe(error)}`)
    return { status: 503, body: { error: TROUBLE } }
  }

  // Unknown slug, switched off, or winding down: one answer, byte for byte.
  if (agency === null) return { status: 404, body: { error: NOT_FOUND } }

  const now = deps.now()
  const chosen =
    query.from !== null && query.to !== null
      ? { from: query.from, to: query.to }
      : defaultWindow(agency.time_zone, now)

  const problem = windowProblem(chosen.from, chosen.to, now)
  if (problem !== null) return { status: 400, body: { error: problem } }

  let vehicles: VehicleRow[]
  try {
    vehicles = await deps.listVehicles(agency.organization_id, chosen.from, chosen.to)
  } catch (error) {
    deps.log(`public-booking: fleet read failed: ${describe(error)}`)
    return { status: 503, body: { error: TROUBLE } }
  }

  const paths = [
    ...(agency.logo_path === null ? [] : [agency.logo_path]),
    ...vehicles.flatMap((vehicle) => (vehicle.image_path === null ? [] : [vehicle.image_path])),
  ]
  let urls = new Map<string, string>()
  try {
    if (paths.length > 0) urls = await deps.signImages(paths)
  } catch (error) {
    // A page without photographs is still a page. Losing the images must not
    // lose the fleet.
    deps.log(`public-booking: signing images failed: ${describe(error)}`)
  }

  const publicAgency: PublicAgency = {
    name: agency.name,
    phone: agency.phone,
    logoUrl: agency.logo_path === null ? null : (urls.get(agency.logo_path) ?? null),
    timeZone: agency.time_zone,
    currency: agency.default_currency,
    acceptsRequests: agency.accepts_requests,
  }

  return {
    status: 200,
    body: {
      agency: publicAgency,
      window: chosen,
      vehicles: vehicles.map((vehicle) => ({
        id: vehicle.vehicle_id,
        make: vehicle.make,
        model: vehicle.model,
        year: vehicle.model_year,
        category: vehicle.category,
        transmission: vehicle.transmission,
        fuelType: vehicle.fuel_type,
        seats: vehicle.seats,
        doors: vehicle.doors,
        imageUrl: vehicle.image_path === null ? null : (urls.get(vehicle.image_path) ?? null),
        currency: vehicle.currency,
        dailyRateMinor: Number(vehicle.daily_rate_minor),
        billableDays: vehicle.billable_days,
        quotedTotalMinor: Number(vehicle.quoted_total_minor),
        isAvailable: vehicle.is_available,
      })),
    },
  }
}

/**
 * The submission.
 *
 * The order of the checks is the order of what they cost: the free ones first,
 * then the ones that touch the database. A machine filling the honeypot never
 * reaches a query.
 */
export async function serveRequest(
  deps: BookingDeps,
  submission: RequestSubmission,
): Promise<BookingDecision> {
  const now = deps.now()

  const automation = looksAutomated({
    honeypot: submission.honeypot,
    startedAt: submission.startedAt,
    now,
  })
  if (automation.automated) {
    // Logged with its reason, answered without one: a bot that learns which
    // rule caught it is a bot that stops tripping that rule.
    deps.log(`public-booking: refused a submission (${automation.reason})`)
    return { status: 400, body: { error: BAD_DETAILS } }
  }

  const problem = windowProblem(submission.from, submission.to, now)
  if (problem !== null) return { status: 400, body: { error: problem } }

  const byAddress = checkRate(deps.rate, `ip:${deps.address}`, now, ADDRESS_RULE)
  const byEmail = checkRate(deps.rate, `email:${submission.email.toLowerCase()}`, now, EMAIL_RULE)
  // Both are counted before either is judged, so one key cannot shelter behind
  // the other being refused first.
  const limited = !byAddress.allowed ? byAddress : !byEmail.allowed ? byEmail : null
  if (limited !== null) {
    return {
      status: 429,
      body: { error: TOO_MANY, retryAfterSeconds: limited.retryAfterSeconds },
    }
  }

  let agency: AgencyRow | null
  try {
    agency = await deps.findAgency(submission.slug)
  } catch (error) {
    deps.log(`public-booking: agency lookup failed: ${describe(error)}`)
    return { status: 503, body: { error: TROUBLE } }
  }
  if (agency === null) return { status: 404, body: { error: NOT_FOUND } }
  if (!agency.accepts_requests) return { status: 409, body: { error: CLOSED_TO_REQUESTS } }

  try {
    const created = await deps.createLead({
      organizationId: agency.organization_id,
      vehicleId: submission.vehicleId,
      from: submission.from,
      to: submission.to,
      fullName: submission.fullName,
      email: submission.email,
      phone: submission.phone,
      note: submission.note,
    })
    return { status: 201, body: { reference: created.reference } }
  } catch (error) {
    /*
     * THE DATABASE'S WORDS DO NOT REACH THE BROWSER. Its refusals name whether
     * an agency stopped paying, whether a car was withdrawn, and whether one
     * exists at all -- the agency's business, not the visitor's. The log keeps
     * the detail so an operator can tell a refusal from a fault.
     */
    deps.log(`public-booking: lead refused: ${describe(error)}`)
    return { status: 409, body: { error: UNAVAILABLE } }
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error.'
}

import { getEnvironment } from '@/lib/config/env'

/*
 * `PublicAgency`, `PublicVehicle` and `PublicBookingPage` are declared a second
 * time on purpose, exactly as the marketing page's pricing payload is. The Edge
 * Functions (Deno) and this app (Vite) share no module graph, and importing
 * from `supabase/functions/` would pull Deno-targeted code into the browser
 * bundle. `booking-shape.check.ts` pins this copy to the function's at `tsc`
 * time; it is not a tautology and should not be deleted as one.
 */

export interface PublicAgency {
  name: string
  phone: string | null
  logoUrl: string | null
  timeZone: string
  currency: string
  acceptsRequests: boolean
}

export interface PublicVehicle {
  id: string
  make: string
  model: string
  year: number | null
  category: string | null
  transmission: string | null
  fuelType: string | null
  seats: number | null
  doors: number | null
  imageUrl: string | null
  currency: string
  dailyRateMinor: number
  billableDays: number
  quotedTotalMinor: number
  isAvailable: boolean
}

export interface PublicBookingPage {
  agency: PublicAgency
  window: { from: string; to: string }
  vehicles: PublicVehicle[]
}

const FUNCTION = 'public-booking'

/**
 * What a page fetch can come back as.
 *
 * `not-found` is its own outcome rather than an error with a message, because
 * it is the ordinary answer for a slug nobody owns, an agency that switched its
 * page off, and one that is closing — the server cannot tell them apart and
 * neither should this.
 */
export type BookingPageResult =
  | { status: 'ok'; page: PublicBookingPage }
  | { status: 'not-found' }
  | { status: 'unavailable'; message: string }

const UNAVAILABLE = 'This page could not be loaded. Please try again shortly.'

function isString(value: unknown): value is string {
  return typeof value === 'string'
}

function nullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

function nullableNumber(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isFinite(value))
}

function isVehicle(value: unknown): value is PublicVehicle {
  if (typeof value !== 'object' || value === null) return false
  const vehicle = value as Record<string, unknown>
  return (
    isString(vehicle.id) &&
    isString(vehicle.make) &&
    isString(vehicle.model) &&
    nullableNumber(vehicle.year) &&
    nullableString(vehicle.category) &&
    nullableString(vehicle.transmission) &&
    nullableString(vehicle.fuelType) &&
    nullableNumber(vehicle.seats) &&
    nullableNumber(vehicle.doors) &&
    nullableString(vehicle.imageUrl) &&
    isString(vehicle.currency) &&
    typeof vehicle.dailyRateMinor === 'number' &&
    Number.isFinite(vehicle.dailyRateMinor) &&
    typeof vehicle.billableDays === 'number' &&
    Number.isFinite(vehicle.billableDays) &&
    typeof vehicle.quotedTotalMinor === 'number' &&
    Number.isFinite(vehicle.quotedTotalMinor) &&
    typeof vehicle.isAvailable === 'boolean'
  )
}

function isAgency(value: unknown): value is PublicAgency {
  if (typeof value !== 'object' || value === null) return false
  const agency = value as Record<string, unknown>
  return (
    isString(agency.name) &&
    nullableString(agency.phone) &&
    nullableString(agency.logoUrl) &&
    isString(agency.timeZone) &&
    isString(agency.currency) &&
    typeof agency.acceptsRequests === 'boolean'
  )
}

/**
 * Accepts only a payload that is wholly well-formed, like the pricing parser
 * and for a sharper version of the same reason: a half-read vehicle could show
 * a car at a price that belongs to another, or offer one the server said was
 * taken. A page that cannot read its answer shows nothing and says so.
 */
export function parseBookingPage(data: unknown): PublicBookingPage | null {
  if (typeof data !== 'object' || data === null) return null
  const body = data as Record<string, unknown>

  if (!isAgency(body.agency)) return null
  if (typeof body.window !== 'object' || body.window === null) return null
  const period = body.window as Record<string, unknown>
  if (!isString(period.from) || !isString(period.to)) return null
  if (!Array.isArray(body.vehicles) || !body.vehicles.every(isVehicle)) return null

  return {
    agency: body.agency,
    window: { from: period.from, to: period.to },
    vehicles: body.vehicles,
  }
}

function endpoint(path: string): string | null {
  const environment = getEnvironment()
  if (environment.status !== 'ok') return null
  return `${environment.env.supabaseUrl.replace(/\/$/, '')}/functions/v1/${path}`
}

/**
 * The agency's page and its fleet for a window.
 *
 * Plain `fetch` rather than the Supabase client on purpose: this is the one
 * screen in the product with no session at all, nothing to read from the
 * database, and no key to hold. The function is reached by its address and
 * answers the same to everyone.
 */
export async function fetchBookingPage(
  slug: string,
  period?: { from: Date; to: Date },
): Promise<BookingPageResult> {
  const query = new URLSearchParams({ slug })
  if (period !== undefined) {
    query.set('from', period.from.toISOString())
    query.set('to', period.to.toISOString())
  }

  const url = endpoint(`${FUNCTION}?${query.toString()}`)
  if (url === null) return { status: 'unavailable', message: UNAVAILABLE }

  let response: Response
  try {
    response = await fetch(url, { headers: { accept: 'application/json' } })
  } catch {
    return { status: 'unavailable', message: UNAVAILABLE }
  }

  if (response.status === 404) return { status: 'not-found' }

  const body: unknown = await response.json().catch((): null => null)

  if (!response.ok) {
    // The server's own sentence when it has one: those are written for
    // visitors (a window in the past, too many requests), never a database
    // message. Anything else gets the neutral one.
    const message =
      typeof body === 'object' && body !== null && isString((body as { error?: unknown }).error)
        ? (body as { error: string }).error
        : UNAVAILABLE
    return { status: 'unavailable', message }
  }

  const page = parseBookingPage(body)
  if (page === null) return { status: 'unavailable', message: UNAVAILABLE }
  return { status: 'ok', page }
}

/** What a submission can come back as. `message` is always shown to the visitor. */
export type BookingRequestResult =
  { status: 'sent'; reference: string } | { status: 'failed'; message: string }

export interface BookingRequestInput {
  slug: string
  vehicleId: string
  from: string
  to: string
  fullName: string
  email: string
  phone: string | null
  note: string | null
  /** The honeypot, named as the field a machine would expect to find. */
  company: string
  /**
   * When the form was built, so the server can judge an impossible speed. Null
   * when the page could not measure it; the server does not hold that against
   * the visitor.
   */
  startedAt: number | null
}

const REQUEST_FAILED = 'Your request could not be sent. Please try again shortly.'

/**
 * Sends a booking request.
 *
 * Every failure resolves rather than throwing, and carries a sentence fit to
 * show a stranger. The server writes those sentences; this never invents one
 * from a status code it does not recognise, and never repeats a database
 * message, because the function deliberately does not send one.
 */
export async function submitBookingRequest(
  input: BookingRequestInput,
): Promise<BookingRequestResult> {
  const url = endpoint(FUNCTION)
  if (url === null) return { status: 'failed', message: REQUEST_FAILED }

  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(input),
    })
  } catch {
    return { status: 'failed', message: REQUEST_FAILED }
  }

  const body: unknown = await response.json().catch((): null => null)
  const field = (key: string): string | null => {
    if (typeof body !== 'object' || body === null) return null
    const value = (body as Record<string, unknown>)[key]
    return typeof value === 'string' ? value : null
  }

  if (response.ok) {
    const reference = field('reference')
    // A 2xx without a reference is a contract this page cannot honour: it
    // would leave a visitor believing a request exists with nothing to quote.
    if (reference === null) return { status: 'failed', message: REQUEST_FAILED }
    return { status: 'sent', reference }
  }

  return { status: 'failed', message: field('error') ?? REQUEST_FAILED }
}

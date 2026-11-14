/**
 * The public booking boundary.
 *
 * The whole public surface of the booking feature: one GET that renders an
 * agency's page and one POST that records a request. Visitors are not signed in
 * and never will be, so the platform JWT check is off (see config.toml) and
 * there is nothing to authenticate -- which is exactly why every decision about
 * what a stranger may learn, and every refusal, lives in
 * `_shared/public-booking.ts` where the test suite reaches it.
 *
 * This file is a Deno shim and decides nothing: it dispatches on the method,
 * builds the effects (three RPCs with the service role, two Storage signings,
 * a clock, a rate-limit map, a logger) and hands them over. An entrypoint is
 * outside tsconfig and no test can reach it, so keep it that way: a new branch
 * here is a branch nothing checks.
 *
 * THE SERVICE ROLE NEVER LEAVES THIS FILE. The browser holds no key for this
 * feature and `anon` is granted nothing; the three app.public_booking_*
 * functions are granted to service_role alone and each re-checks its own
 * conditions, so a bug here cannot widen what they answer.
 *
 * NOTHING HERE LOGS A KEY, AN ADDRESS, OR A RENTER'S DETAILS. The address is
 * used for rate limiting and never stored or printed; the log lines come from
 * `_shared`, which writes reasons and never fields.
 */

import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2'

import { createRateState, forgetExpired, type RateState } from '../_shared/public-booking-rates.ts'
import { deliverMessage } from '../_shared/team-email.ts'
import {
  isError,
  parseBookingQuery,
  parseRequestBody,
  serveBooking,
  serveRequest,
  type AgencyRow,
  type BookingDecision,
  type BookingDeps,
  type VehicleRow,
} from '../_shared/public-booking.ts'

/** One row of app.public_booking_lead_notice. Raw values; formatting is `_shared`. */
interface NoticeRow {
  reference: string
  vehicle_label: string
  starts_at: string
  ends_at: string
  currency: string
  quoted_total_minor: number
  renter_name: string
  renter_email: string
  agency_name: string
  agency_phone: string | null
  agency_email: string | null
  time_zone: string
  recipients: string[]
}

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

/**
 * Matches SIGNED_URL_TTL_SECONDS in src/features/customers/documents.ts. Long
 * enough to read a page and short enough that a shared link stops working.
 */
const SIGNED_URL_TTL_SECONDS = 300

const LOGO_BUCKET = 'organization-logos'
const PHOTO_BUCKET = 'vehicle-photos'

/** Page reads may be cached briefly; availability moves, so not for long. */
const CACHE_CONTROL = 'public, max-age=30'

/**
 * Lives as long as this instance does, which is the whole of what the rate
 * limit is worth -- see the module comment in `_shared/public-booking-rates.ts`.
 */
const rate: RateState = createRateState()

function respond(decision: BookingDecision, method: string): Response {
  const headers: Record<string, string> = { ...CORS_HEADERS, 'Content-Type': 'application/json' }
  if (method === 'GET' && decision.status === 200) headers['Cache-Control'] = CACHE_CONTROL
  if (decision.status === 429) {
    const after = (decision.body as { retryAfterSeconds?: number }).retryAfterSeconds
    if (typeof after === 'number') headers['Retry-After'] = String(after)
  }
  return new Response(JSON.stringify(decision.body), { status: decision.status, headers })
}

/** The caller's address, for rate limiting only. Never stored, never logged. */
function addressOf(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for') ?? ''
  const first = forwarded.split(',')[0]?.trim()
  return first !== undefined && first !== '' ? first : 'unknown'
}

function depsFor(service: SupabaseClient, request: Request): BookingDeps {
  const app = () => service.schema('app')

  const must = <T>(result: { data: T; error: { message: string } | null }): T => {
    if (result.error !== null) throw new Error(result.error.message)
    return result.data
  }

  return {
    findAgency: async (slug) => {
      const rows = must(await app().rpc('public_booking_agency', { p_slug: slug })) as
        AgencyRow[] | null
      return rows !== null && rows.length > 0 ? rows[0]! : null
    },

    listVehicles: async (organizationId, from, to) =>
      (must(
        await app().rpc('public_booking_vehicles', {
          p_organization_id: organizationId,
          p_from: from,
          p_to: to,
        }),
      ) as VehicleRow[] | null) ?? [],

    createLead: async (input) => {
      const rows = must(
        await app().rpc('public_booking_create_lead', {
          p_organization_id: input.organizationId,
          p_vehicle_id: input.vehicleId,
          p_from: input.from,
          p_to: input.to,
          p_full_name: input.fullName,
          p_email: input.email,
          p_phone: input.phone,
          p_note: input.note,
        }),
      ) as { lead_id: string; reference: string; created: boolean }[] | null
      const created = rows !== null && rows.length > 0 ? rows[0]! : null
      if (created === null) throw new Error('The request was not recorded.')
      return {
        leadId: created.lead_id,
        reference: created.reference,
        created: created.created,
      }
    },

    /*
     * Both messages, sent inline, because nothing in this deployment drains a
     * queue -- the arrangement account-closure-notice already uses.
     *
     * NOTHING HERE THROWS. Every failure is caught and logged: the lead is
     * written and the renter is about to be shown their reference, so a
     * provider having a bad minute must not become an error on their screen.
     * Nothing is retried either -- a retry loop inside a request handler is how
     * one slow provider becomes a queue of held-open connections.
     */
    announce: async (lead, agency) => {
      try {
        const from = Deno.env.get('TEAM_EMAIL_FROM')
        const provider = Deno.env.get('TEAM_EMAIL_PROVIDER')
        const apiKey = Deno.env.get('TEAM_EMAIL_API_KEY')
        // No provider configured is an ordinary state, not a fault: the request
        // is recorded and the agency sees it in the product either way.
        if (!from || !provider || !apiKey) return

        const rows = must(
          await app().rpc('public_booking_lead_notice', { p_lead_id: lead.leadId }),
        ) as NoticeRow[] | null
        const notice = rows !== null && rows.length > 0 ? rows[0]! : null
        if (notice === null) return

        const summary: LeadSummary = {
          reference: notice.reference,
          vehicleLabel: notice.vehicle_label,
          startsAt: notice.starts_at,
          endsAt: notice.ends_at,
          currency: notice.currency,
          quotedTotalMinor: Number(notice.quoted_total_minor),
          renterName: notice.renter_name,
          renterEmail: notice.renter_email,
        }
        const agencySummary: AgencySummary = {
          name: notice.agency_name,
          phone: notice.agency_phone,
          timeZone: notice.time_zone,
          contactEmail: notice.agency_email,
          leadsUrl: `${(Deno.env.get('TEAM_APP_URL') ?? '').replace(/\/+$/, '')}/leads`,
        }

        const transport = { provider, apiKey, from }
        const sender = senderFor(agencySummary, from)

        // The renter first: they are waiting, and the agency can see the
        // request in the product whether or not this sends.
        await deliverMessage(renterAcknowledgement(summary, agencySummary), {
          ...transport,
          from: sender.from,
          replyTo: sender.replyTo,
        })

        for (const recipient of notice.recipients) {
          await deliverMessage(agencyNotification(summary, agencySummary, recipient), transport)
        }
      } catch (error) {
        console.log(
          `public-booking: announcing a lead failed: ${
            error instanceof Error ? error.message : 'unknown error'
          }`,
        )
      }
    },

    /*
     * Both buckets are private, and they stay private: a logo and a photograph
     * are published by minting a short-lived URL per request, not by making a
     * bucket public. The same object key in a public bucket would be readable
     * by anyone who ever saw it, for as long as it existed.
     */
    signImages: async ({ logo, photos }) => {
      const signed = new Map<string, string>()
      const work: [string, readonly string[]][] = [
        [LOGO_BUCKET, logo === null ? [] : [logo]],
        [PHOTO_BUCKET, photos],
      ]
      for (const [bucket, keys] of work) {
        if (keys.length === 0) continue
        const { data, error } = await service.storage
          .from(bucket)
          .createSignedUrls([...keys], SIGNED_URL_TTL_SECONDS)
        if (error !== null) throw new Error(error.message)
        for (const entry of data ?? []) {
          if (entry.signedUrl !== null && entry.path !== null) {
            signed.set(entry.path, entry.signedUrl)
          }
        }
      }
      return signed
    },

    now: () => Date.now(),
    rate,
    address: addressOf(request),
    log: (message) => console.log(message),
  }
}

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })

  const service = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { persistSession: false } },
  )

  forgetExpired(rate, Date.now())
  const deps = depsFor(service, request)

  if (request.method === 'GET') {
    const query = parseBookingQuery(new URL(request.url))
    if (isError(query))
      return respond({ status: query.status, body: { error: query.message } }, 'GET')
    return respond(await serveBooking(deps, query), 'GET')
  }

  if (request.method === 'POST') {
    let raw: unknown = null
    try {
      raw = await request.json()
    } catch {
      raw = null
    }
    const submission = parseRequestBody(raw)
    if (isError(submission)) {
      return respond({ status: submission.status, body: { error: submission.message } }, 'POST')
    }
    return respond(await serveRequest(deps, submission), 'POST')
  }

  return respond({ status: 405, body: { error: 'Method not allowed.' } }, request.method)
})

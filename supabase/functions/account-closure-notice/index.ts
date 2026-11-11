/**
 * The account-closure notice boundary.
 *
 * Sends the emails that follow a closure request: one to every owner and
 * administrator, and one to the operator saying to cancel the agency's Stripe
 * subscription. The browser calls it right after a successful request; Task 7
 * will also drain it on a schedule, so a closed tab never loses an email.
 *
 * AUTHORIZATION. `verify_jwt` is off (this project's keys are not JWTs), so the
 * caller is established here: the Authorization header must be a live user
 * session, and that user must be able to see the agency named in the body
 * (row-level security answers that through their own client). What the call can
 * cause is bounded by the database: it sends only what `closure_notices_pending`
 * says is still pending for that one agency, so a member calling repeatedly
 * cannot make it send anything that was not already owed.
 *
 * This file is a Deno shim and decides nothing: the messages, their order and
 * the recorded outcomes live in `_shared/closure-notice.ts`, where they are
 * tested. The service-role client is used only for the two functions that are
 * granted to it alone.
 *
 * A FAILED EMAIL NEVER FAILS THE CALLER'S REQUEST: this endpoint answers 200 with
 * a count whatever the provider did. NOTHING HERE LOGS AN ADDRESS, A BODY OR A KEY.
 */

import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2'

import {
  sendClosureNotices,
  type NoticeDeps,
  type PendingNotice,
} from '../_shared/closure-notice.ts'
import { resolveAppOrigin } from '../_shared/team-email.ts'

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Referrer-Policy': 'no-referrer',
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}

// deno-lint-ignore no-explicit-any
function toNotice(row: any): PendingNotice {
  return {
    organizationId: row.organization_id,
    organizationName: row.organization_name,
    requestedByName: row.requested_by_name ?? '',
    purgeAfter: row.purge_after,
    sendMembers: row.send_members === true,
    sendOperator: row.send_operator === true,
    recipients: Array.isArray(row.recipients) ? row.recipients : [],
  }
}

function buildDeps(service: SupabaseClient, organizationId: string): NoticeDeps {
  return {
    listPending: async () => {
      const { data, error } = await service.schema('app').rpc('closure_notices_pending', {
        p_organization_id: organizationId,
      })
      if (error) throw new Error('pending lookup failed')
      return (data ?? []).map(toNotice)
    },
    record: async (id, update) => {
      const { error } = await service.schema('app').rpc('closure_notice_record', {
        p_organization_id: id,
        p_members_state: update.members ?? null,
        p_operator_state: update.operator ?? null,
        p_detail: update.detail ?? null,
      })
      if (error) throw new Error('record failed')
    },
  }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })
  if (request.method !== 'POST') return json({ ok: false }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !anonKey || !serviceKey) return json({ ok: false }, 500)

  const authorization = request.headers.get('Authorization') ?? ''
  if (!authorization.toLowerCase().startsWith('bearer ')) return json({ ok: false }, 401)

  let organizationId = ''
  try {
    const body = (await request.json()) as Record<string, unknown>
    organizationId = typeof body.organization_id === 'string' ? body.organization_id : ''
  } catch {
    return json({ ok: false }, 400)
  }
  if (!UUID.test(organizationId)) return json({ ok: false }, 400)

  try {
    const asUser = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data: auth, error: authError } = await asUser.auth.getUser()
    if (authError || !auth?.user) return json({ ok: false }, 401)

    // Row-level security: only a member of the agency can read its row.
    const { data: visible } = await asUser
      .from('organizations')
      .select('id')
      .eq('id', organizationId)
      .maybeSingle()
    if (!visible) return json({ ok: false }, 403)

    const service = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    const report = await sendClosureNotices(buildDeps(service, organizationId), {
      transport: {
        provider: Deno.env.get('TEAM_EMAIL_PROVIDER'),
        apiKey: Deno.env.get('TEAM_EMAIL_API_KEY'),
        from: Deno.env.get('TEAM_EMAIL_FROM'),
      },
      operatorAddress: Deno.env.get('CLOSURE_OPERATOR_EMAIL'),
      appOrigin: resolveAppOrigin(Deno.env.get('TEAM_APP_URL')),
    })

    return json({ ok: true, organizations: report.organizations })
  } catch (error) {
    // The category only: an exception around a fetch can carry the request.
    console.error(
      `account-closure-notice failed: ${error instanceof Error ? error.name : 'unknown'}`,
    )
    return json({ ok: false }, 500)
  }
})

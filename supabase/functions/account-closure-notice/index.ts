/**
 * The account-closure notice boundary.
 *
 * Sends the emails that follow a closure request: one to every owner and
 * administrator, and one to the operator as a backstop (the agency is asked to
 * cancel its own Stripe subscription; the operator acts only if it is still live
 * past the purge date). It also sends the operator the email that follows a
 * RESTORE, which withdraws that backstop and says a cancelled subscription has
 * to be restarted by a person. Owners and administrators are not emailed on
 * restore. The browser calls it right after a successful request;
 * also drained daily (see .github/workflows/account-closure.yml) with the
 * runner secret, so a closed tab never loses an email.
 *
 * AUTHORIZATION. `verify_jwt` is off (this project's keys are not JWTs), so the
 * caller is established here, and there are TWO kinds:
 *   - the scheduler: the Authorization bearer equals ACCOUNT_CLOSURE_RUNNER_SECRET
 *     (`resolveNoticeCaller`, constant time, a short or unset secret never
 *     matches). It drains every agency with an owed notice and needs no body.
 *   - a user: any other bearer must be a live user session, and that user must be
 *     able to see the agency named in the body (row-level security answers that
 *     through their own client). It sends only what `closure_notices_pending`
 *     says is still owed for that one agency, so a member calling repeatedly
 *     cannot make it send anything that was not already owed.
 * No bearer at all is a bare 401. A user session can never reach the drain.
 *
 * This file is a Deno shim and decides nothing: the messages, their order and
 * the recorded outcomes live in `_shared/closure-notice.ts`, where they are
 * tested. The service-role client is used only for the two functions that are
 * granted to it alone.
 *
 * A FAILED EMAIL NEVER FAILS A USER'S REQUEST: the user path answers 200 with a
 * count whatever the provider did. The RUNNER path differs on purpose: it answers
 * 500 when an operator notice was not accepted (or a run could not read or
 * record), so the scheduled job goes red. The operator email is the only prompt
 * to cancel the Stripe subscription. NOTHING HERE LOGS AN ADDRESS, A BODY OR A KEY.
 */

import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2'

import {
  sendClosureNotices,
  type NoticeDeps,
  resolveNoticeCaller,
  type PendingNotice,
  type PendingRestoreNotice,
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
    requestedAt: row.requested_at,
    purgeAfter: row.purge_after,
    sendMembers: row.send_members === true,
    sendOperator: row.send_operator === true,
    recipients: Array.isArray(row.recipients) ? row.recipients : [],
  }
}

// deno-lint-ignore no-explicit-any
function toRestoreNotice(row: any): PendingRestoreNotice {
  return {
    organizationId: row.organization_id,
    organizationName: row.organization_name,
    restoredAt: row.restored_at,
    closingAgain: row.closing_again === true,
  }
}

/** `organizationId` null drains every agency with an owed notice (the scheduled run). */
function buildDeps(service: SupabaseClient, organizationId: string | null): NoticeDeps {
  return {
    listPending: async (onlyOrganizationId) => {
      const { data, error } = await service.schema('app').rpc('closure_notices_pending', {
        p_organization_id: onlyOrganizationId ?? organizationId,
      })
      if (error) throw new Error('pending lookup failed')
      return (data ?? []).map(toNotice)
    },
    record: async (notice, update) => {
      const { error } = await service.schema('app').rpc('closure_notice_record', {
        p_organization_id: notice.organizationId,
        p_members_state: update.members ?? null,
        p_operator_state: update.operator ?? null,
        p_detail: update.detail ?? null,
        // The closure this attempt was for. A restore and a second closure in
        // between make the write a no-op rather than a false "sent".
        p_requested_at: notice.requestedAt,
      })
      if (error) throw new Error('record failed')
    },
    // A restored agency has closure_requested_at null, so closure_notices_pending
    // can never list it: the restore notices have their own finder.
    listRestorePending: async (onlyOrganizationId) => {
      const { data, error } = await service.schema('app').rpc('closure_restore_notices_pending', {
        p_organization_id: onlyOrganizationId ?? organizationId,
      })
      if (error) throw new Error('restore pending lookup failed')
      return (data ?? []).map(toRestoreNotice)
    },
    recordRestore: async (notice, update) => {
      const { error } = await service.schema('app').rpc('closure_restore_notice_record', {
        p_organization_id: notice.organizationId,
        p_state: update.state,
        p_detail: update.detail,
        // The restore this attempt was for: a newer restore makes this a no-op.
        p_restored_at: notice.restoredAt,
      })
      if (error) throw new Error('restore record failed')
    },
  }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })
  if (request.method !== 'POST') return json({ ok: false }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !anonKey || !serviceKey)
    return json({ ok: false, reason: 'not configured' }, 500)

  const runnerSecret = Deno.env.get('ACCOUNT_CLOSURE_RUNNER_SECRET') ?? ''
  const authorization = request.headers.get('Authorization')
  const caller = resolveNoticeCaller(authorization, runnerSecret)
  if (caller === 'refused') return json({ ok: false }, 401)

  const config = {
    transport: {
      provider: Deno.env.get('TEAM_EMAIL_PROVIDER'),
      apiKey: Deno.env.get('TEAM_EMAIL_API_KEY'),
      from: Deno.env.get('TEAM_EMAIL_FROM'),
    },
    operatorAddress: Deno.env.get('CLOSURE_OPERATOR_EMAIL'),
    appOrigin: resolveAppOrigin(Deno.env.get('TEAM_APP_URL')),
  }

  if (caller === 'runner') {
    // The scheduled drain: every agency with an owed notice. A failed operator
    // send stays pending and is retried next run, but must not pass silently, so
    // it (or a run that could not read or record) answers 500 and fails the job.
    try {
      const service = createClient(supabaseUrl, serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
      const report = await sendClosureNotices(buildDeps(service, null), config)
      // An operator notice nobody accepted is a failed run, not a quiet success.
      const ok = report.operatorUndelivered === 0
      return json(
        ok
          ? { ok, organizations: report.organizations }
          : {
              ok,
              organizations: report.organizations,
              operatorUndelivered: report.operatorUndelivered,
              reason: 'operator notice not accepted',
            },
        ok ? 200 : 500,
      )
    } catch (error) {
      console.error(
        `account-closure-notice drain failed: ${error instanceof Error ? error.name : 'unknown'}`,
      )
      return json({ ok: false, reason: 'drain aborted' }, 500)
    }
  }

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

    const report = await sendClosureNotices(buildDeps(service, organizationId), config)

    return json({ ok: true, organizations: report.organizations })
  } catch (error) {
    // The category only: an exception around a fetch can carry the request.
    console.error(
      `account-closure-notice failed: ${error instanceof Error ? error.name : 'unknown'}`,
    )
    return json({ ok: false }, 500)
  }
})

/**
 * The factor-reset boundary.
 *
 * POST { mode: 'self', recoveryCode }
 *   The caller removes their OWN second factor with a recovery code. Works at aal1:
 *   this is the path for someone who has lost their authenticator and so cannot
 *   produce a second factor.
 * POST { mode: 'member', subjectUserId, organizationId }
 *   An owner removes a member's factor. Requires an aal2 session: without it, a
 *   password-only attacker holding an owner's password could strip every member's
 *   second factor in the agency.
 *
 * The decisions live in ../_shared/mfa-reset.ts. This file only parses the body,
 * authenticates the caller, builds the service-role dependencies and maps the
 * outcome to HTTP.
 *
 * The aal is read from the payload of the caller's JWT, and only after
 * auth.getUser() has verified that same token with the auth server. It is never
 * read from the request body.
 *
 * Dependencies use the SERVICE-ROLE client: app.record_security_event is granted to
 * service_role only, and an aal1 session is refused tenant data by RLS.
 *
 * Deliberately no application-level rate limiting (recorded, accepted risk).
 * NOTHING HERE LOGS OR RETURNS A RECOVERY CODE, TOKEN OR SECRET. Failures log only
 * the fixed error code of the dependency that failed.
 */

import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2'

import {
  resetMemberFactor,
  resetOwnFactor,
  type Membership,
  type ResetDeps,
  type ResetOutcome,
} from '../_shared/mfa-reset.ts'
import { hasRequiredAal, parseResetRequest } from '../_shared/mfa-reset-request.ts'

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const STATUS_BY_REASON = {
  invalid_code: 400,
  not_permitted: 403,
  no_factor: 404,
} as const

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}

function failure(category: string, message: string, status: number): Response {
  return json({ ok: false, error: { category, message } }, status)
}

function outcomeResponse(outcome: ResetOutcome): Response {
  if (outcome.ok) return json({ ok: true, factorsRemoved: outcome.factorsRemoved })
  return json({ ok: false, reason: outcome.reason }, STATUS_BY_REASON[outcome.reason])
}

function realDeps(service: SupabaseClient): ResetDeps {
  return {
    async consumeRecoveryCode(userId, code) {
      const { data, error } = await service
        .schema('app')
        .rpc('mfa_consume_recovery_code', { p_user_id: userId, p_code: code })
      if (error) throw new Error('consume_recovery_code_failed')
      return data === true
    },
    async findMembership(organizationId, userId): Promise<Membership | null> {
      // BOTH filters are required: the module trusts this for tenant isolation.
      const { data, error } = await service
        .from('organization_members')
        .select('role, status')
        .eq('organization_id', organizationId)
        .eq('user_id', userId)
        .maybeSingle()
      if (error) throw new Error('find_membership_failed')
      return (data as Membership | null) ?? null
    },
    async listFactorIds(userId) {
      const { data, error } = await service.auth.admin.mfa.listFactors({ userId })
      if (error) throw new Error('list_factors_failed')
      return (data?.factors ?? []).map((factor) => factor.id)
    },
    async deleteFactor(userId, factorId) {
      const { error } = await service.auth.admin.mfa.deleteFactor({ id: factorId, userId })
      if (error) throw new Error('delete_factor_failed')
    },
    async recordSecurityEvent(event) {
      const { error } = await service.schema('app').rpc('record_security_event', {
        p_event_type: event.eventType,
        p_subject_user_id: event.subjectUserId,
        p_organization_id: event.organizationId,
        p_detail: event.detail,
        p_actor_user_id: event.actorUserId,
      })
      if (error) throw new Error('record_security_event_failed')
    },
  }
}

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })
  if (request.method !== 'POST') return failure('method_not_allowed', 'Use POST.', 405)

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return failure('malformed_request', 'That request could not be read.', 400)
  }

  const parsed = parseResetRequest(body)
  if (!parsed.ok) return failure('malformed_request', parsed.message, 400)
  const reset = parsed.request

  const authorization = request.headers.get('Authorization') ?? ''
  if (authorization === '') return failure('auth_error', 'Sign in first.', 401)

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  if (supabaseUrl === '' || anonKey === '' || serviceKey === '') {
    return failure('not_configured', 'This is unavailable right now.', 500)
  }

  const asUser = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: auth, error: authError } = await asUser.auth.getUser()
  if (authError || !auth?.user) return failure('auth_error', 'Sign in first.', 401)

  try {
    // Fail closed: an unreadable or missing aal claim is not aal2 (it throws).
    if (!hasRequiredAal(reset.mode, authorization)) {
      return failure('second_factor_required', 'Verify your second factor first.', 403)
    }

    const service = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const deps = realDeps(service)

    const outcome =
      reset.mode === 'self'
        ? await resetOwnFactor(deps, { userId: auth.user.id, recoveryCode: reset.recoveryCode })
        : await resetMemberFactor(deps, {
            actorUserId: auth.user.id,
            subjectUserId: reset.subjectUserId,
            organizationId: reset.organizationId,
          })
    return outcomeResponse(outcome)
  } catch (error) {
    // Every error here carries a fixed, secret-free code (see realDeps and
    // readAalClaim), so the message is safe to log. The response says nothing.
    console.error('mfa-reset failed:', error instanceof Error ? error.message : 'unknown_error')
    return failure('server_error', 'The reset could not be completed.', 500)
  }
})

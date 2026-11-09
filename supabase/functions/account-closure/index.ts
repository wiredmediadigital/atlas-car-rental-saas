/**
 * The account-closure runner boundary.
 *
 * Called from outside the deployment (Task 7 adds the scheduler) with the
 * SERVICE ROLE KEY as the bearer token. `verify_jwt = true` only proves the
 * token is some signed-in user's JWT, which is not enough to destroy an agency,
 * so `isAuthorizedRunner` also requires it to BE the service key.
 *
 * This file is a Deno shim and decides nothing: it authenticates, builds
 * `ClosureDeps` from a service client (each method is one call), and hands them
 * to `runAccountClosure` in `_shared/account-closure.ts`, where the order of
 * stages, the resumability and the live-subscription report are tested. An
 * entrypoint is outside tsconfig and no test can reach it, so a new branch here
 * is a branch nothing checks.
 *
 * IT NEVER HOLDS A STRIPE KEY. See the module comment in `_shared`.
 * NOTHING HERE LOGS A KEY, A FILE NAME, OR A PERSON'S DETAILS.
 */

import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2'

import {
  AUTH_USERS_BUCKET,
  authUserKey,
  interpretClaim,
  isAuthorizedRunner,
  runAccountClosure,
  type ClosureDeps,
  type ClosureState,
  type ObjectRow,
  type OrganizationRow,
} from '../_shared/account-closure.ts'

const RUN_BUDGET_MS = 120_000
const PAGE = 1000
const ORG_COLUMNS =
  'id, name, legal_name, closure_requested_at, closure_purge_after, purge_started_at, closed_at'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}

function must<T>(result: { data: T; error: { message: string } | null }): T {
  if (result.error) throw new Error(result.error.message)
  return result.data
}

// deno-lint-ignore no-explicit-any
function toOrganization(row: any): OrganizationRow {
  return {
    id: row.id,
    name: row.name,
    legalName: row.legal_name,
    closureRequestedAt: row.closure_requested_at,
    closurePurgeAfter: row.closure_purge_after,
    purgeStartedAt: row.purge_started_at,
    closedAt: row.closed_at,
  }
}

function buildDeps(service: SupabaseClient, deadline: number): ClosureDeps {
  const app = () => service.schema('app')
  return {
    listClosingOrganizations: async () =>
      (
        must(
          await service
            .from('organizations')
            .select(ORG_COLUMNS)
            .not('closure_requested_at', 'is', null)
            .is('closed_at', null),
        ) ?? []
      ).map(toOrganization),

    listClosedWithPendingWork: async () => {
      const rows =
        must(
          await service
            .from('account_closure_objects')
            .select('organization_id')
            .is('deleted_at', null)
            .limit(PAGE),
        ) ?? []
      const ids = [...new Set(rows.map((r: { organization_id: string }) => r.organization_id))]
      if (ids.length === 0) return []
      return (
        must(
          await service
            .from('organizations')
            .select(ORG_COLUMNS)
            .in('id', ids)
            .not('closed_at', 'is', null),
        ) ?? []
      ).map(toOrganization)
    },

    hasLiveSubscription: async (id) =>
      must(await app().rpc('organization_has_live_subscription', { p_organization_id: id })) ===
      true,

    claim: async (id) => {
      const { data, error } = await app().rpc('organization_claim_purge', { p_organization_id: id })
      return interpretClaim(data, error)
    },

    closureState: async (id) =>
      must(await app().rpc('closure_state_of', { p_organization_id: id })) as ClosureState,

    collectObjects: async (id) =>
      Number(must(await app().rpc('organization_collect_objects', { p_organization_id: id }))),

    listMemberIds: async (id) =>
      (
        must(
          await service.from('organization_members').select('user_id').eq('organization_id', id),
        ) ?? []
      ).map((r: { user_id: string }) => r.user_id),

    recordRemovalCandidates: async (id, userIds) => {
      if (userIds.length === 0) return
      must(
        await service.from('account_closure_objects').upsert(
          userIds.map((userId) => ({
            organization_id: id,
            bucket: AUTH_USERS_BUCKET,
            storage_key: authUserKey(id, userId),
          })),
          { onConflict: 'bucket,storage_key', ignoreDuplicates: true },
        ),
      )
    },

    listPendingObjects: async (id, kind, limit) => {
      const query = service
        .from('account_closure_objects')
        .select('id, organization_id, bucket, storage_key, deleted_at')
        .eq('organization_id', id)
        .is('deleted_at', null)
      const filtered =
        kind === 'auth'
          ? query.eq('bucket', AUTH_USERS_BUCKET)
          : query.neq('bucket', AUTH_USERS_BUCKET)
      return (must(await filtered.order('storage_key').limit(limit)) ?? []).map(
        // deno-lint-ignore no-explicit-any
        (r: any): ObjectRow => ({
          id: r.id,
          organizationId: r.organization_id,
          bucket: r.bucket,
          storageKey: r.storage_key,
          deletedAt: r.deleted_at,
        }),
      )
    },

    removeFromStorage: async (bucket, keys) => {
      const { error } = await service.storage.from(bucket).remove(keys)
      if (error) throw new Error(`Storage removal failed: ${error.message}`)
    },

    markDone: async (ids) => {
      must(
        await service
          .from('account_closure_objects')
          .update({ deleted_at: new Date().toISOString() })
          .in('id', ids),
      )
    },

    purgeData: async (id) =>
      must(await app().rpc('organization_purge_data', { p_organization_id: id })) as Record<
        string,
        number
      >,

    membershipsOf: async (userIds) =>
      (
        must(
          await service
            .from('organization_members')
            .select('user_id, organization_id')
            .in('user_id', userIds),
        ) ?? []
      ).map((r: { user_id: string; organization_id: string }) => ({
        userId: r.user_id,
        organizationId: r.organization_id,
      })),

    removeUser: async (userId) => {
      must(await service.from('profiles').delete().eq('id', userId))
      const { error } = await service.auth.admin.deleteUser(userId)
      // Already gone is success: a re-run after a crash lands here.
      if (error && error.status !== 404 && error.code !== 'user_not_found') {
        throw new Error(`Auth removal failed: ${error.message}`)
      }
    },

    hasTime: () => Date.now() < deadline,
  }
}

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  if (supabaseUrl === '' || serviceKey === '') return json({ error: 'Not configured.' }, 503)
  if (!isAuthorizedRunner(request.headers.get('Authorization'), serviceKey)) {
    return json({ error: 'Unauthorized.' }, 401)
  }

  const service = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  try {
    const report = await runAccountClosure(buildDeps(service, Date.now() + RUN_BUDGET_MS), {
      now: new Date(),
      logError: (message) => console.error(message),
    })
    return json(report, report.failures > 0 ? 500 : 200)
  } catch (error) {
    console.error(`account-closure: run aborted: ${error instanceof Error ? error.message : error}`)
    return json({ error: 'The run aborted before it finished; run it again.' }, 500)
  }
})

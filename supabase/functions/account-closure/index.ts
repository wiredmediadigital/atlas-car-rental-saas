/**
 * The account-closure runner boundary.
 *
 * Called from outside the deployment (Task 7 adds the scheduler). The platform
 * JWT check is OFF (see config.toml: this project's keys are not JWTs and could
 * not satisfy it). In its place the caller must send
 * `Authorization: Bearer <ACCOUNT_CLOSURE_RUNNER_SECRET>`, a secret that only the
 * scheduler holds and that is NOT the service key: asking "is it time to run"
 * must not require the key that can read every agency. The comparison is
 * constant-time (`isAuthorizedRunner`); a refusal is a bare 401 and claims
 * nothing, because `runIfAuthorized` never calls the runner.
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
  readAllPages,
  readInChunks,
  runAccountClosure,
  runIfAuthorized,
  type ClosureDeps,
  type ClosureState,
  type ObjectRow,
  type OrganizationRow,
} from '../_shared/account-closure.ts'

const RUN_BUDGET_MS = 120_000
// Below config.toml max_rows (1000), so a short page really is the last one.
const PAGE = 500
const IN_CHUNK = 100
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
        await readAllPages(
          async (from, to) =>
            must(
              await service
                .from('organizations')
                .select(ORG_COLUMNS)
                .not('closure_requested_at', 'is', null)
                .is('closed_at', null)
                .order('id')
                .range(from, to),
            ) ?? [],
          PAGE,
        )
      ).map(toOrganization),

    /*
     * Closed agencies that still have ledger rows to sweep.
     *
     * ONE PAGE, DELIBERATELY, AND IT IS NOT A FAIR SAMPLE. PostgREST has no
     * DISTINCT, so this reads one page of pending rows and takes the
     * organizations they name. An agency with thousands of outstanding objects
     * therefore fills the page on its own and is the only one resumed, every
     * run, until it drains -- and it does drain, because each run deletes what
     * it swept, so the next page is different rows. The cost is latency for
     * anybody queued behind it, never a missed agency: nothing leaves this list
     * except by being finished.
     *
     * If that latency ever matters, the fix is an RPC returning distinct
     * organization ids, not a larger page: a larger page moves the same
     * monopoly further along.
     */
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
        await readAllPages(
          async (from, to) =>
            must(
              await service
                .from('organization_members')
                .select('user_id')
                .eq('organization_id', id)
                .order('user_id')
                .range(from, to),
            ) ?? [],
          PAGE,
        )
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
        await readInChunks(
          userIds,
          IN_CHUNK,
          async (chunk, from, to) =>
            must(
              await service
                .from('organization_members')
                .select('user_id, organization_id')
                .in('user_id', chunk)
                .order('user_id')
                .order('organization_id')
                .range(from, to),
            ) ?? [],
          PAGE,
        )
      ).map((r: { user_id: string; organization_id: string }) => ({
        userId: r.user_id,
        organizationId: r.organization_id,
      })),

    // One call each. The order and the "already gone" ruling are in _shared.
    deleteAuthUser: async (userId) => (await service.auth.admin.deleteUser(userId)).error,

    deleteProfile: async (userId) => {
      must(await service.from('profiles').delete().eq('id', userId))
    },

    hasTime: () => Date.now() < deadline,
  }
}

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  const runnerSecret = Deno.env.get('ACCOUNT_CLOSURE_RUNNER_SECRET') ?? ''
  if (runnerSecret === '')
    console.error('account-closure: ACCOUNT_CLOSURE_RUNNER_SECRET is not set')
  if (supabaseUrl === '' || serviceKey === '') return json({ error: 'Not configured.' }, 503)

  const service = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  try {
    const result = await runIfAuthorized(request.headers.get('Authorization'), runnerSecret, () =>
      runAccountClosure(buildDeps(service, Date.now() + RUN_BUDGET_MS), {
        now: new Date(),
        logError: (message) => console.error(message),
      }),
    )
    if (result.status === 401) return json({ error: 'Unauthorized.' }, 401)
    return json(result.report, result.status)
  } catch (error) {
    console.error(`account-closure: run aborted: ${error instanceof Error ? error.message : error}`)
    return json({ error: 'The run aborted before it finished; run it again.' }, 500)
  }
})

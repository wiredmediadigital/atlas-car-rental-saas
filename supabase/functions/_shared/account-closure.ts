/**
 * The account-closure runner: every decision, and the order things happen in.
 *
 * Thirty days after an owner asks to close an agency, its data is destroyed. The
 * database side (claim, collect, purge) lives in 20261108100200; this module
 * drives it from outside, in the one order that is safe:
 *
 *   claim -> collect -> sweep storage -> purge rows -> remove auth users
 *
 *   * CLAIM FIRST. After it, `organization_restore` is refused. A restore racing
 *     a half-finished purge is unrecoverable.
 *   * COLLECT BEFORE DELETING ROWS. The rows are the only record of which
 *     Storage objects exist.
 *   * EVERY STAGE IS SKIPPABLE. Storage is not transactional with the database,
 *     so a run that died halfway is the normal case. Each stage reads what is
 *     still outstanding and does only that, so a re-run completes.
 *
 * THIS JOB NEVER TOUCHES STRIPE. Cancelling a closing agency's subscription is a
 * manual step in the Stripe dashboard; one unattended process able to delete a
 * tenant's data and move money is a bigger blast radius than the action it would
 * replace. `organization_claim_purge` refuses while a subscription is live, and
 * this module's job is to SAY SO, by name, every run (see `blocked`).
 *
 * `index.ts` is outside tsconfig and untested, so it only builds `ClosureDeps`
 * from a Supabase client. Everything that decides anything is here.
 *
 * NOTHING HERE LOGS A KEY, A FILE NAME, OR A PERSON'S DETAILS.
 */

export type ClosureState = 'open' | 'suspended' | 'purging' | 'closed'

/** The columns of `organizations` the runner reads. Timestamps are ISO strings. */
export interface OrganizationRow {
  id: string
  name: string
  legalName: string | null
  closureRequestedAt: string | null
  closurePurgeAfter: string | null
  purgeStartedAt: string | null
  closedAt: string | null
}

/** One row of `account_closure_objects`. */
export interface ObjectRow {
  id: string
  organizationId: string
  bucket: string
  storageKey: string
  deletedAt: string | null
}

/** A Storage object the sweep may delete. `id` is the `account_closure_objects` row. */
export interface StorageKey {
  id: string
  bucket: string
  key: string
}

/**
 * One person's membership, as `usersToRemove` sees it. `closing` is true for the
 * membership in the agency being closed, false for any other agency.
 */
export interface Membership {
  userId: string
  closing: boolean
}

/** The buckets the sweep may delete from: exactly the ones the collector fills. */
export const STORAGE_BUCKETS: readonly string[] = [
  'customer-documents',
  'rental-documents',
  'vehicle-documents',
  'vehicle-photos',
  'expense-receipts',
  'financing-documents',
  'organization-logos',
]

/**
 * `account_closure_objects` is the one resumable ledger the schema gives us, and
 * the member list is gone the moment the purge commits (the memberships are
 * deleted with everything else). So the people to remove are written down BEFORE
 * the purge, in the same ledger, as `<organization_id>/<user_id>` in this
 * pseudo-bucket. It is never a Storage bucket and the sweep never reads it.
 */
export const AUTH_USERS_BUCKET = 'auth-users'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const DEFAULT_SWEEP_BATCH = 100

/**
 * Agencies that have been asked to close, whose date has passed, and that nobody
 * has claimed yet. A claimed agency is NOT returned: finishing one is resuming,
 * not starting (see `resumable`).
 */
export function dueForPurge(rows: readonly OrganizationRow[], now: Date): string[] {
  return rows
    .filter(
      (row) =>
        row.closureRequestedAt !== null &&
        row.closurePurgeAfter !== null &&
        row.purgeStartedAt === null &&
        row.closedAt === null &&
        Date.parse(row.closurePurgeAfter) <= now.getTime(),
    )
    .map((row) => row.id)
}

/** Agencies the purge has claimed and not finished: the ones a re-run must pick up. */
export function resumable(rows: readonly OrganizationRow[]): string[] {
  return rows.filter((row) => row.purgeStartedAt !== null && row.closedAt === null).map((r) => r.id)
}

/**
 * Of the people who belonged to the closing agency, those it was the LAST
 * membership of. `memberships` holds, for each of those people, their membership
 * in the closing agency (`closing: true`) and every membership they still have
 * anywhere else (`closing: false`). Anyone with a `closing: false` row belongs
 * to another agency and keeps everything.
 */
export function usersToRemove(memberships: readonly Membership[]): string[] {
  const keep = new Set(memberships.filter((m) => !m.closing).map((m) => m.userId))
  const candidates = memberships.filter((m) => m.closing).map((m) => m.userId)
  return [...new Set(candidates)].filter((userId) => !keep.has(userId))
}

function isSweepable(o: ObjectRow): boolean {
  return (
    o.deletedAt === null &&
    STORAGE_BUCKETS.includes(o.bucket) &&
    o.storageKey.startsWith(`${o.organizationId}/`) &&
    !o.storageKey.includes('..')
  )
}

/**
 * The next batch of Storage objects to delete. Pure, and deliberately the second
 * line of defence: it returns only objects that are still pending, in a bucket
 * the collector fills, whose key sits under their own agency's `<id>/` prefix.
 * A row that fails any of those is never returned, so a mistaken row cannot
 * name another agency's file or an unrelated bucket.
 */
export function nextSweepBatch(objects: readonly ObjectRow[], batchSize: number): StorageKey[] {
  const size = Math.max(0, Math.floor(batchSize))
  return objects
    .filter(isSweepable)
    .slice(0, size)
    .map((o) => ({ id: o.id, bucket: o.bucket, key: o.storageKey }))
}

/** Pending storage rows `nextSweepBatch` will never return: reported, not retried. */
export function unsweepable(objects: readonly ObjectRow[]): ObjectRow[] {
  return objects.filter((o) => o.deletedAt === null && !isSweepable(o))
}

export function authUserKey(organizationId: string, userId: string): string {
  return `${organizationId}/${userId}`
}

/** The user id recorded for `organizationId`, or null if the row is not such a record. */
export function parseAuthUserKey(organizationId: string, row: ObjectRow): string | null {
  if (row.bucket !== AUTH_USERS_BUCKET || row.organizationId !== organizationId) return null
  const prefix = `${organizationId}/`
  if (!row.storageKey.startsWith(prefix)) return null
  const userId = row.storageKey.slice(prefix.length)
  return UUID.test(userId) ? userId : null
}

/** Constant-time comparison of the caller's bearer token with the service key. */
export function isAuthorizedRunner(authorization: string | null, serviceKey: string): boolean {
  if (serviceKey === '' || authorization === null) return false
  const match = /^Bearer (.+)$/i.exec(authorization.trim())
  if (!match) return false
  const given = match[1]!
  let diff = given.length ^ serviceKey.length
  for (let i = 0; i < serviceKey.length; i += 1) {
    diff |= (given.charCodeAt(i) || 0) ^ serviceKey.charCodeAt(i)
  }
  return diff === 0
}

export type ClaimResult = 'claimed' | 'declined' | 'live-subscription'

/**
 * Reads the answer of `app.organization_claim_purge`. Its only raise is the
 * live-subscription refusal (errcode 55000); any other error is a real failure
 * and is thrown, never mistaken for "declined".
 */
export function interpretClaim(
  data: unknown,
  error: { code?: string; message?: string } | null,
): ClaimResult {
  if (error) {
    if (error.code === '55000') return 'live-subscription'
    throw new Error(`Claim failed: ${error.message ?? 'unknown error'}`)
  }
  return data === true ? 'claimed' : 'declined'
}

export function displayName(org: OrganizationRow): string {
  return org.legalName?.trim() ? org.legalName : org.name
}

/** Everything the runner does to the outside world. `index.ts` builds the real one. */
export interface ClosureDeps {
  /** Organizations with a closure requested and not yet closed. */
  listClosingOrganizations(): Promise<OrganizationRow[]>
  /** Organizations that are closed but still have unfinished ledger rows. */
  listClosedWithPendingWork(): Promise<OrganizationRow[]>
  hasLiveSubscription(organizationId: string): Promise<boolean>
  claim(organizationId: string): Promise<ClaimResult>
  /** Authoritative, from the database: not a value read earlier in the run. */
  closureState(organizationId: string): Promise<ClosureState>
  collectObjects(organizationId: string): Promise<number>
  listMemberIds(organizationId: string): Promise<string[]>
  /** Idempotent: a record already there is left alone. */
  recordRemovalCandidates(organizationId: string, userIds: string[]): Promise<void>
  /** Pending ledger rows. `kind` picks Storage objects or recorded people. */
  listPendingObjects(
    organizationId: string,
    kind: 'storage' | 'auth',
    limit: number,
  ): Promise<ObjectRow[]>
  /** Must succeed for an object that is already gone. Throws on failure. */
  removeFromStorage(bucket: string, keys: string[]): Promise<void>
  markDone(ids: string[]): Promise<void>
  purgeData(organizationId: string): Promise<Record<string, number>>
  /** Memberships these people still hold, in any agency. */
  membershipsOf(userIds: string[]): Promise<{ userId: string; organizationId: string }[]>
  /** Removes the `profiles` row, then the auth account. Both already gone is success. */
  removeUser(userId: string): Promise<void>
  /** Called between units of work; false stops the run cleanly. */
  hasTime(): boolean
}

export interface OrganizationOutcome {
  organizationId: string
  name: string
  status: 'closed' | 'incomplete' | 'failed' | 'skipped'
  objectsDeleted: number
  usersRemoved: number
  usersKept: number
  unsweepableKeys: number
  detail: string
}

export interface BlockedOrganization {
  organizationId: string
  name: string
  purgeAfter: string | null
  /** True when its date has passed and this run tried to claim it. */
  due: boolean
}

export interface RunReport {
  /** Suspended and still billing. */
  blocked: BlockedOrganization[]
  outcomes: OrganizationOutcome[]
  failures: number
  /** True when a person has something to do: blocked, failed or unsweepable. */
  needsAttention: boolean
}

const SWEEPABLE: readonly ClosureState[] = ['purging', 'closed']

interface SweepResult {
  deleted: number
  unsweepable: number
  complete: boolean
}

/**
 * Deletes the agency's pending Storage objects, a batch at a time.
 *
 * THE STATE IS RE-READ BEFORE EVERY BATCH, FROM THE DATABASE. The ledger names
 * real objects, passport and licence scans among them; a stale or mistaken row
 * for a live agency must delete nothing. If the agency is not purging or closed,
 * the sweep refuses and throws.
 *
 * A row is marked done only after Storage confirmed the removal, so a crash
 * between the two repeats a deletion that is a no-op, and never skips one.
 */
export async function sweepStorage(
  deps: ClosureDeps,
  organizationId: string,
  batchSize: number = DEFAULT_SWEEP_BATCH,
): Promise<SweepResult> {
  let deleted = 0
  for (;;) {
    const state = await deps.closureState(organizationId)
    if (!SWEEPABLE.includes(state)) {
      throw new Error(`Refusing to sweep Storage for an agency that is ${state}.`)
    }
    const pending = await deps.listPendingObjects(organizationId, 'storage', batchSize * 5)
    const batch = nextSweepBatch(pending, batchSize)
    if (batch.length === 0) {
      return { deleted, unsweepable: unsweepable(pending).length, complete: true }
    }
    if (!deps.hasTime()) return { deleted, unsweepable: 0, complete: false }

    const byBucket = new Map<string, StorageKey[]>()
    for (const object of batch) {
      byBucket.set(object.bucket, [...(byBucket.get(object.bucket) ?? []), object])
    }
    for (const [bucket, objects] of byBucket) {
      await deps.removeFromStorage(
        bucket,
        objects.map((o) => o.key),
      )
      await deps.markDone(objects.map((o) => o.id))
      deleted += objects.length
    }
  }
}

interface AuthResult {
  removed: number
  kept: number
}

/**
 * Removes the people recorded for this agency whose last membership it was.
 *
 * Runs only once the agency is closed, i.e. after its membership rows are gone.
 * Everyone is re-checked against the memberships that exist NOW, so a person who
 * joined another agency in the meantime is kept. A kept person's record is
 * marked done: if they belong to another closing agency, that agency recorded
 * them itself.
 */
export async function removeAuthUsers(
  deps: ClosureDeps,
  organizationId: string,
): Promise<AuthResult> {
  const state = await deps.closureState(organizationId)
  if (state !== 'closed') {
    throw new Error(`Refusing to remove accounts for an agency that is ${state}.`)
  }
  const rows = await deps.listPendingObjects(organizationId, 'auth', 1000)
  const recorded = rows
    .map((row) => ({ row, userId: parseAuthUserKey(organizationId, row) }))
    .filter((entry): entry is { row: ObjectRow; userId: string } => entry.userId !== null)
  if (recorded.length === 0) return { removed: 0, kept: 0 }

  const userIds = recorded.map((entry) => entry.userId)
  const elsewhere = await deps.membershipsOf(userIds)
  const toRemove = new Set(
    usersToRemove([
      ...userIds.map((userId) => ({ userId, closing: true })),
      ...elsewhere.map((m) => ({ userId: m.userId, closing: false })),
    ]),
  )

  let removed = 0
  for (const entry of recorded) {
    if (toRemove.has(entry.userId)) {
      await deps.removeUser(entry.userId)
      removed += 1
    }
    await deps.markDone([entry.row.id])
  }
  return { removed, kept: recorded.length - removed }
}

function emptyOutcome(org: OrganizationRow): OrganizationOutcome {
  return {
    organizationId: org.id,
    name: displayName(org),
    status: 'skipped',
    objectsDeleted: 0,
    usersRemoved: 0,
    usersKept: 0,
    unsweepableKeys: 0,
    detail: '',
  }
}

const OUT_OF_TIME = 'Ran out of time sweeping Storage; it resumes next run.'

/**
 * Takes a claimed (or already closed) agency through whatever is left of
 * collect, sweep, purge and account removal. Each stage reads the database and
 * does only what is outstanding, so this is the same call for a first run and
 * for a re-run after a failure at any point.
 */
export async function finishOrganization(
  deps: ClosureDeps,
  org: OrganizationRow,
  batchSize: number = DEFAULT_SWEEP_BATCH,
): Promise<OrganizationOutcome> {
  const id = org.id
  let swept = 0

  if ((await deps.closureState(id)) === 'purging') {
    await deps.collectObjects(id)
    await deps.recordRemovalCandidates(id, await deps.listMemberIds(id))
    const before = await sweepStorage(deps, id, batchSize)
    swept = before.deleted
    if (!before.complete) {
      return {
        ...emptyOutcome(org),
        status: 'incomplete',
        objectsDeleted: swept,
        detail: OUT_OF_TIME,
      }
    }
    await deps.purgeData(id)
  }

  // After the purge: purge_data collects again itself, so anything it found that
  // the first sweep did not know about is deleted here.
  const after = await sweepStorage(deps, id, batchSize)
  swept += after.deleted
  if (!after.complete) {
    return {
      ...emptyOutcome(org),
      status: 'incomplete',
      objectsDeleted: swept,
      detail: OUT_OF_TIME,
    }
  }

  const people = await removeAuthUsers(deps, id)
  return {
    ...emptyOutcome(org),
    status: 'closed',
    objectsDeleted: swept,
    usersRemoved: people.removed,
    usersKept: people.kept,
    unsweepableKeys: after.unsweepable,
    detail:
      after.unsweepable > 0
        ? `${after.unsweepable} ledger rows name keys outside this agency and were not deleted.`
        : '',
  }
}

export interface RunOptions {
  now: Date
  batchSize?: number
  logError?: (message: string) => void
}

function blockedEntry(org: OrganizationRow, due: boolean): BlockedOrganization {
  return {
    organizationId: org.id,
    name: displayName(org),
    purgeAfter: org.closurePurgeAfter,
    due,
  }
}

/** One pass over every closing agency. See the module comment for the order. */
export async function runAccountClosure(
  deps: ClosureDeps,
  options: RunOptions,
): Promise<RunReport> {
  const batchSize = options.batchSize ?? DEFAULT_SWEEP_BATCH
  const closing = await deps.listClosingOrganizations()
  const lingering = await deps.listClosedWithPendingWork()
  const byId = new Map([...closing, ...lingering].map((org) => [org.id, org]))

  const due = dueForPurge(closing, options.now)
  const resuming = [...new Set([...resumable(closing), ...lingering.map((org) => org.id)])]

  const blocked: BlockedOrganization[] = []
  const outcomes: OrganizationOutcome[] = []

  // Suspended, unclaimed, not yet due, but being billed: reported too. Waiting
  // out the date does not make an invoice for a read-only account acceptable.
  for (const org of closing) {
    if (
      org.purgeStartedAt === null &&
      !due.includes(org.id) &&
      (await deps.hasLiveSubscription(org.id))
    ) {
      blocked.push(blockedEntry(org, false))
    }
  }

  for (const id of [...due, ...resuming]) {
    const org = byId.get(id)!
    if (!deps.hasTime()) break
    try {
      if (due.includes(id)) {
        const claim = await deps.claim(id)
        if (claim === 'live-subscription') {
          blocked.push(blockedEntry(org, true))
          continue
        }
        if (claim === 'declined') {
          outcomes.push({
            ...emptyOutcome(org),
            detail: 'Not claimed: no longer due, or already taken.',
          })
          continue
        }
      }
      outcomes.push(await finishOrganization(deps, org, batchSize))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      options.logError?.(`account-closure: ${id} failed: ${message}`)
      outcomes.push({ ...emptyOutcome(org), status: 'failed', detail: message })
    }
  }

  for (const entry of blocked) {
    options.logError?.(
      `account-closure: BLOCKED ${entry.organizationId} "${entry.name}" is suspended with a live subscription` +
        ` (purge ${entry.due ? 'DUE' : `after ${entry.purgeAfter}`}). Cancel it in the Stripe dashboard.`,
    )
  }

  const failures = outcomes.filter((o) => o.status === 'failed').length
  return {
    blocked,
    outcomes,
    failures,
    needsAttention:
      blocked.length > 0 || failures > 0 || outcomes.some((o) => o.unsweepableKeys > 0),
  }
}

/**
 * Resetting a lost second factor.
 *
 * A recovery code cannot grant access: Supabase raises a session to aal2 only
 * when it verifies an enrolled factor itself, so a code checked in our own SQL
 * leaves the session at aal1. A recovery code therefore authorises DELETING the
 * lost factor, after which the user enrols a new one. Two paths:
 *
 *   resetOwnFactor     the user, holding an aal1 session and a recovery code.
 *   resetMemberFactor  an active owner resetting an active member of their agency.
 *
 * AUTHORISATION IS DECIDED HERE, NOT BY app.has_min_role. That helper requires
 * aal2, and resetOwnFactor is called by exactly the people who cannot produce a
 * second factor. All database work goes through the injected service-role
 * dependencies and the membership check is made in TypeScript.
 *
 * ORDER IS LOAD-BEARING. The recovery code, or the owner's role, is verified
 * BEFORE any factor is deleted. A refused reset deletes nothing.
 *
 * A FACTOR IS PER PERSON, SO A RESET IS FELT IN EVERY AGENCY THEY WORK IN.
 * resetMemberFactor therefore writes one event PER ORGANIZATION the subject is an
 * active member of, each row carrying that organization's own id — the only id
 * its owners can read, since the select policy filters on that column. Recording
 * only the acting agency's id left every other agency unable to see that its
 * member's protection had been removed. The events deliberately do NOT name the
 * other organizations: each agency learns that its own member was reset, not
 * where else that person works.
 *
 * NOT ATOMIC, BY CHOICE. The code is spent before the factors are deleted, and the
 * security events are written after them. There is no transaction spanning the
 * GoTrue admin API and Postgres, so a deletion that fails part-way has already
 * spent one of the user's ten codes, and an event can in principle go missing.
 * Both are accepted: deleting before verifying would let any wrong code destroy a
 * factor, and splitting verify from consume would open a code-reuse window.
 * A part-way failure records an event for the factors it did remove, and a
 * failure to record that trace never replaces the error that stopped the reset.
 *
 * Nothing here logs, returns or records a recovery code.
 *
 * No Deno.serve, no network and no client construction: the entrypoint builds the
 * real dependencies and calls these functions.
 */

export type SecurityEventType = 'factor_removed' | 'factor_reset_by_owner'

export interface SecurityEventInput {
  readonly eventType: SecurityEventType
  readonly subjectUserId: string
  /** Who performed the reset; stored in security_events.actor_user_id. */
  readonly actorUserId: string
  readonly organizationId: string | null
  readonly detail: Readonly<Record<string, string | number>>
}

export interface Membership {
  readonly role: 'owner' | 'admin' | 'manager' | 'staff'
  readonly status: 'active' | 'suspended'
}

export interface ResetDeps {
  /** app.mfa_consume_recovery_code: spends one matching unused code. */
  consumeRecoveryCode(userId: string, code: string): Promise<boolean>
  /** The caller's row in public.organization_members, or null. */
  findMembership(organizationId: string, userId: string): Promise<Membership | null>
  /** Every organization the user is an ACTIVE member of. Order is not relied on. */
  listActiveOrganizationIds(userId: string): Promise<readonly string[]>
  /** Ids of every MFA factor the user has enrolled. */
  listFactorIds(userId: string): Promise<readonly string[]>
  /** Admin MFA delete of one factor. */
  deleteFactor(userId: string, factorId: string): Promise<void>
  /** app.record_security_event. */
  recordSecurityEvent(event: SecurityEventInput): Promise<void>
}

export type ResetOutcome =
  | { readonly ok: true; readonly factorsRemoved: number }
  | { readonly ok: false; readonly reason: 'invalid_code' | 'not_permitted' | 'no_factor' }

/**
 * Codes are Crockford base32, shown to the user in a readable form.
 * app.mfa_consume_recovery_code compares exactly what it is given, so the code is
 * reduced to its bare characters here: every character that cannot be part of a
 * code (whitespace, hyphens, dashes, dots, underscores) is dropped, then upper-cased.
 *
 * The ambiguous letters are then folded the way Crockford base32 does: O -> 0 and
 * I or L -> 1. The generator's alphabet deliberately excludes I, L, O and U, so a
 * generated code never contains them and the fold is unambiguous: any O a user
 * types is a misread 0, any I or L a misread 1. (U is excluded and not folded.)
 */
export function normaliseRecoveryCode(raw: string): string {
  return raw
    .replace(/[^0-9A-Za-z]/g, '')
    .toUpperCase()
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1')
}

async function removeAllFactors(
  deps: ResetDeps,
  userId: string,
  factorIds: readonly string[],
  record: (removed: number) => Promise<void>,
): Promise<number> {
  let removed = 0
  try {
    for (const factorId of factorIds) {
      await deps.deleteFactor(userId, factorId)
      removed += 1
    }
  } catch (error) {
    // Part of the reset happened: leave a trace of what did, then let the caller
    // see the failure. The trace is best-effort — a second failure while writing
    // it must not become the error that is reported, because the one that
    // stopped the reset is the one worth seeing.
    if (removed > 0) {
      try {
        await record(removed)
      } catch {
        // Deliberately swallowed; `error` below says what actually went wrong.
      }
    }
    throw error
  }
  await record(removed)
  return removed
}

/** The user resets their own factor with a recovery code. */
export async function resetOwnFactor(
  deps: ResetDeps,
  input: { readonly userId: string; readonly recoveryCode: string },
): Promise<ResetOutcome> {
  const code = normaliseRecoveryCode(input.recoveryCode)
  if (code === '') return { ok: false, reason: 'invalid_code' }

  // Reading is not deleting. Checked first so a user with nothing to remove does
  // not burn a code.
  const factorIds = await deps.listFactorIds(input.userId)
  if (factorIds.length === 0) return { ok: false, reason: 'no_factor' }

  // AUTHORISE, THEN DELETE.
  if (!(await deps.consumeRecoveryCode(input.userId, code))) {
    return { ok: false, reason: 'invalid_code' }
  }

  const factorsRemoved = await removeAllFactors(deps, input.userId, factorIds, (removed) =>
    deps.recordSecurityEvent({
      eventType: 'factor_removed',
      subjectUserId: input.userId,
      actorUserId: input.userId,
      organizationId: null,
      detail: { actor_user_id: input.userId, method: 'recovery_code', factors_removed: removed },
    }),
  )
  return { ok: true, factorsRemoved }
}

/** An active owner resets the factor of an active member of the same agency. */
export async function resetMemberFactor(
  deps: ResetDeps,
  input: {
    readonly actorUserId: string
    readonly subjectUserId: string
    readonly organizationId: string
  },
): Promise<ResetOutcome> {
  // An owner resetting themselves would skip the recovery code entirely: the
  // own-factor path is the only way to remove your own factor.
  if (input.actorUserId === input.subjectUserId) return { ok: false, reason: 'not_permitted' }

  const [actor, subject] = await Promise.all([
    deps.findMembership(input.organizationId, input.actorUserId),
    deps.findMembership(input.organizationId, input.subjectUserId),
  ])

  // AUTHORISE, THEN DELETE.
  if (actor?.role !== 'owner' || actor.status !== 'active') {
    return { ok: false, reason: 'not_permitted' }
  }
  if (subject?.status !== 'active') return { ok: false, reason: 'not_permitted' }

  const factorIds = await deps.listFactorIds(input.subjectUserId)
  if (factorIds.length === 0) return { ok: false, reason: 'no_factor' }

  // Every agency that is about to lose this person's protection, the acting one
  // first. It is included explicitly rather than trusted to come back from the
  // listing: the owner who asked for this must see their own event whatever the
  // listing returns.
  const organizationIds = [
    ...new Set([
      input.organizationId,
      ...(await deps.listActiveOrganizationIds(input.subjectUserId)),
    ]),
  ]

  const factorsRemoved = await removeAllFactors(
    deps,
    input.subjectUserId,
    factorIds,
    async (removed) => {
      for (const organizationId of organizationIds) {
        await deps.recordSecurityEvent({
          eventType: 'factor_reset_by_owner',
          subjectUserId: input.subjectUserId,
          actorUserId: input.actorUserId,
          organizationId,
          // The same detail in every row. It names no other organization: an
          // agency sees that its member was reset, not where else they work.
          detail: { actor_user_id: input.actorUserId, factors_removed: removed },
        })
      }
    },
  )
  return { ok: true, factorsRemoved }
}

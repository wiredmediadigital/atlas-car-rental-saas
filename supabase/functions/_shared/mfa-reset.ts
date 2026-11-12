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
 * Nothing here logs, returns or records a recovery code.
 *
 * No Deno.serve, no network and no client construction: the entrypoint builds the
 * real dependencies and calls these functions.
 */

export type SecurityEventType = 'factor_removed' | 'factor_reset_by_owner'

export interface SecurityEventInput {
  readonly eventType: SecurityEventType
  readonly subjectUserId: string
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
 */
export function normaliseRecoveryCode(raw: string): string {
  return raw.replace(/[^0-9A-Za-z]/g, '').toUpperCase()
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
    // see the failure.
    if (removed > 0) await record(removed)
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

  const factorsRemoved = await removeAllFactors(deps, input.subjectUserId, factorIds, (removed) =>
    deps.recordSecurityEvent({
      eventType: 'factor_reset_by_owner',
      subjectUserId: input.subjectUserId,
      organizationId: input.organizationId,
      detail: { actor_user_id: input.actorUserId, factors_removed: removed },
    }),
  )
  return { ok: true, factorsRemoved }
}

import { getSupabaseClient } from '@/lib/supabase/client'
import { toAppError } from '@/lib/supabase/errors'

/**
 * `unreachable` is a dropped connection; `unavailable` is anything else that
 * went wrong, including a 5xx. They are kept apart because the server spends the
 * recovery code before it removes the factor, so after a 5xx the same code may
 * no longer work and the user needs telling that.
 */
export type ResetFailureReason =
  'invalid_code' | 'not_permitted' | 'no_factor' | 'unavailable' | 'unreachable'

const KNOWN_REASONS: readonly ResetFailureReason[] = ['invalid_code', 'not_permitted', 'no_factor']

/**
 * The mfa-reset function refused, or could not be reached.
 *
 * Carries only a reason. The recovery code that was submitted is deliberately
 * not kept on it: errors get logged and reported, codes must not.
 */
export class FactorResetError extends Error {
  readonly reason: ResetFailureReason

  constructor(reason: ResetFailureReason) {
    super(`Authenticator reset failed: ${reason}`)
    this.name = 'FactorResetError'
    this.reason = reason
  }
}

/**
 * Mints ten fresh recovery codes for the signed-in user, replacing any unused
 * ones. The plaintext comes back exactly once and is not stored anywhere that
 * can return it again. Needs an aal2 session, so call it only after the first
 * code has been verified.
 */
export async function generateRecoveryCodes(): Promise<readonly string[]> {
  const { data, error } = await getSupabaseClient().rpc('mfa_generate_recovery_codes')
  if (error) throw toAppError(error)
  return data
}

/**
 * Spends a recovery code to remove the caller's own authenticator. This does not
 * sign anyone in: the user has no second factor afterwards and must enrol again.
 */
export async function resetOwnFactor(recoveryCode: string): Promise<void> {
  const invocation: { error: unknown } = await getSupabaseClient().functions.invoke('mfa-reset', {
    body: { mode: 'self', recoveryCode },
  })
  const { error } = invocation
  if (!error) return

  throw new FactorResetError(await readReason(error))
}

/**
 * An owner removes a member's authenticator.
 *
 * For the member who has lost their phone AND their recovery codes — the only
 * remaining way back that does not involve the operator. Needs the owner's own
 * aal2 session, which anyone inside the application already has: without that
 * requirement, a password-only attacker holding an owner's password could strip
 * every second factor in the agency.
 *
 * The server refuses an owner who names themselves. Removing your own factor is
 * the recovery-code path and nothing else, so an owner cannot step around their
 * own second factor by being an owner.
 */
export async function resetMemberFactor(input: {
  readonly subjectUserId: string
  readonly organizationId: string
}): Promise<void> {
  const invocation: { error: unknown } = await getSupabaseClient().functions.invoke('mfa-reset', {
    body: {
      mode: 'member',
      subjectUserId: input.subjectUserId,
      organizationId: input.organizationId,
    },
  })
  const { error } = invocation
  if (!error) return

  throw new FactorResetError(await readReason(error))
}

/** supabase-js leaves a non-2xx body unread on `error.context`; the reason lives there. */
async function readReason(error: unknown): Promise<ResetFailureReason> {
  if ((error as { name?: unknown }).name === 'FunctionsFetchError') return 'unreachable'

  const context: unknown = (error as { context?: unknown }).context
  if (!(context instanceof Response)) return 'unavailable'

  try {
    const body: unknown = await context.json()
    const reason = (body as { reason?: unknown } | null)?.reason
    return KNOWN_REASONS.find((known) => known === reason) ?? 'unavailable'
  } catch {
    return 'unavailable'
  }
}

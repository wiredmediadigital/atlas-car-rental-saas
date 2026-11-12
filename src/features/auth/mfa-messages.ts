import { AppError } from '@/lib/supabase/errors'

import { FactorResetError, type ResetFailureReason } from './mfa-recovery'

const WRONG_CODE_MESSAGE =
  'That code is not correct. Codes change every 30 seconds, so wait for a new one and try again.'

/**
 * What to tell someone whose authenticator code did not pass.
 *
 * A dropped connection is not the code's fault, and blaming the code sends a
 * person to re-type something that was right. Everything else the auth server
 * can say here (wrong code, expired code, too many tries) reads as the same thing
 * to a person at the keyboard, so it gets one plain sentence rather than the
 * provider's wording.
 */
export function verificationErrorMessage(error: unknown): string {
  if (error instanceof AppError && error.kind === 'network') return error.message
  return WRONG_CODE_MESSAGE
}

const MEMBER_RESET_MESSAGES: Record<ResetFailureReason, string> = {
  // The member path sends no code at all, so this can only mean the function
  // read the request as something other than what was sent.
  invalid_code: 'That request was not understood. Reload the page and try again.',
  not_permitted:
    'That was refused. Only an owner can reset another member’s two-factor, and never their own — an owner removes their own authenticator with a recovery code.',
  no_factor: 'They have no authenticator set up, so there is nothing to remove.',
  unavailable: 'The reset could not be completed. Try again in a moment.',
  unreachable: 'We could not reach the server. Check your connection and try again.',
}

/**
 * What to tell an owner whose reset of a member's authenticator was refused.
 *
 * Separate wording from the recovery-code path on purpose: there, the thing
 * that failed is usually the code in front of the user, and every message is
 * about what to do with it. Here there is no code, the subject is somebody
 * else's account, and "that recovery code may already have been used" would be
 * nonsense.
 */
export function memberResetErrorMessage(error: unknown): string {
  if (error instanceof FactorResetError) return MEMBER_RESET_MESSAGES[error.reason]
  return MEMBER_RESET_MESSAGES.unavailable
}

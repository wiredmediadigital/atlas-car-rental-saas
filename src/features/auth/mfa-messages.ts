import { AppError } from '@/lib/supabase/errors'

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

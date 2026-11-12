import { getSupabaseClient } from '@/lib/supabase/client'
import { toAppError } from '@/lib/supabase/errors'

export interface FactorState {
  readonly status: 'none' | 'unverified' | 'verified'
  readonly factorId: string | null
}

export interface EnrolmentStart {
  readonly factorId: string
  readonly qrCodeSvg: string
  readonly secret: string
}

export type AssuranceLevel = 'aal1' | 'aal2'

/**
 * Where the user stands with their authenticator app.
 *
 * `verified` is reported only for a factor the user has proved they hold. An
 * enrolment that was started and never finished leaves an `unverified` factor
 * behind; it must not be mistaken for a working second factor.
 */
export async function listFactorState(): Promise<FactorState> {
  const { data, error } = await getSupabaseClient().auth.mfa.listFactors()
  if (error) throw toAppError(error)

  const totp = data.all.filter((factor) => factor.factor_type === 'totp')
  const verified = totp.find((factor) => factor.status === 'verified')
  if (verified) return { status: 'verified', factorId: verified.id }

  const unverified = totp.find((factor) => factor.status === 'unverified')
  if (unverified) return { status: 'unverified', factorId: unverified.id }

  return { status: 'none', factorId: null }
}

/**
 * Starts enrolling an authenticator app.
 *
 * `enroll` creates the factor immediately, so closing the tab before entering a
 * code leaves an unverified factor on the account. Those are removed first:
 * otherwise each abandoned attempt would count toward the per-user factor
 * ceiling until enrolment fails outright. An unverified factor can be removed
 * by an aal1 session, so this works before the user has passed any challenge.
 * Verified factors are never touched here.
 *
 * Only TOTP factors are cleared. Nothing else is enabled today, but the day a
 * phone factor is, opening this screen would silently destroy a half-finished
 * enrolment of a kind this screen knows nothing about.
 */
export async function beginEnrolment(): Promise<EnrolmentStart> {
  const { mfa } = getSupabaseClient().auth

  const listed = await mfa.listFactors()
  if (listed.error) throw toAppError(listed.error)

  for (const factor of listed.data.all) {
    if (factor.factor_type !== 'totp') continue
    if (factor.status !== 'unverified') continue
    const { error } = await mfa.unenroll({ factorId: factor.id })
    if (error) throw toAppError(error)
  }

  const { data, error } = await mfa.enroll({ factorType: 'totp' })
  if (error) throw toAppError(error)

  return { factorId: data.id, qrCodeSvg: data.totp.qr_code, secret: data.totp.secret }
}

/** Proves the first code from a freshly enrolled app, which also upgrades the session to aal2. */
export async function completeEnrolment(factorId: string, code: string): Promise<void> {
  await verifyCode(factorId, code)
}

/**
 * Writes the `factor_enrolled` row of the security audit trail.
 *
 * Separate from completeEnrolment because GoTrue, not this schema, owns the
 * enrolment itself: nothing in the database observes it happening, so the one
 * moment that knows has to say so. Needs the aal2 session completeEnrolment has
 * just created, so call it only after that has returned.
 *
 * Deliberately not emitted when recovery codes are regenerated from Settings:
 * that is not an enrolment.
 */
export async function recordEnrolment(): Promise<void> {
  const { error } = await getSupabaseClient().rpc('mfa_record_enrolment')
  if (error) throw toAppError(error)
}

/**
 * Removes a factor the user holds, so that a new one can take its place.
 *
 * This is the replace path in Settings, and it needs the aal2 session the user
 * already has to be there. It leaves the account with NO second factor until a
 * new one is verified, which is why the screen that offers it says so and why
 * the guard sends the user straight to enrolment afterwards: an account that is
 * required to have a factor and has none can reach nothing until it does.
 *
 * Losing an authenticator this way also abandons the recovery codes it was
 * minted with — enrolment issues a fresh set, replacing them.
 */
export async function removeFactor(factorId: string): Promise<void> {
  const { error } = await getSupabaseClient().auth.mfa.unenroll({ factorId })
  if (error) throw toAppError(error)
}

/** Passes the second-factor challenge for an already verified factor. */
export async function challenge(factorId: string, code: string): Promise<void> {
  await verifyCode(factorId, code)
}

export async function assuranceLevel(): Promise<AssuranceLevel> {
  const { data, error } = await getSupabaseClient().auth.mfa.getAuthenticatorAssuranceLevel()
  if (error) throw toAppError(error)

  return data.currentLevel === 'aal2' ? 'aal2' : 'aal1'
}

async function verifyCode(factorId: string, code: string): Promise<void> {
  const { error } = await getSupabaseClient().auth.mfa.challengeAndVerify({ factorId, code })
  if (error) throw toAppError(error)
}

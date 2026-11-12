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
 */
export async function beginEnrolment(): Promise<EnrolmentStart> {
  const { mfa } = getSupabaseClient().auth

  const listed = await mfa.listFactors()
  if (listed.error) throw toAppError(listed.error)

  for (const factor of listed.data.all) {
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

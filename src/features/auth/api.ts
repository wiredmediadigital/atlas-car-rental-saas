import { getSupabaseClient } from '@/lib/supabase/client'
import { toAppError } from '@/lib/supabase/errors'

import type { CreateOrganizationInput, SignInInput, SignUpInput } from './schemas'

/** Absolute URL Supabase should send the user back to after an email link. */
function redirectUrl(path: string): string {
  return new URL(path, window.location.origin).toString()
}

export interface SignUpResult {
  /** False when the deployment requires email confirmation before first sign-in. */
  readonly hasSession: boolean
  readonly email: string
}

/**
 * Creates an account.
 *
 * `returnTo` decides where the confirmation link lands. An invited person is
 * sent back to the acceptance route rather than to the generic callback, which
 * otherwise drops somebody who is joining an existing agency onto the screen
 * that offers to create a new one — the accidental second agency this product
 * goes out of its way to prevent. The database refuses to provision one for an
 * invited address either way; this is the half that decides what they SEE.
 *
 * Supabase ignores a `redirectTo` that is not in the project's allow-list and
 * falls back to the Site URL, so `/welcome` also carries a line pointing an
 * invited person back to their email. Neither depends on the other.
 */
export async function signUp(
  input: SignUpInput,
  returnTo = '/auth/callback',
): Promise<SignUpResult> {
  const supabase = getSupabaseClient()

  const { data, error } = await supabase.auth.signUp({
    email: input.email,
    password: input.password,
    options: {
      emailRedirectTo: redirectUrl(returnTo),
      // Read by the on_auth_user_created trigger, which creates the profile and
      // provisions the agency with this user as its owner — one transaction, no
      // window in which an account exists without a workspace.
      data: {
        full_name: input.fullName,
        organization_name: input.organizationName,
        country_code: input.countryCode,
        default_currency: input.defaultCurrency,
        time_zone: input.timeZone,
        /*
         * Whether the box was ticked, and nothing else. The trigger stamps the
         * version and the moment itself, from app.current_terms_version() and
         * now(), so a browser claiming to have accepted some other version
         * claims nothing. A missing or malformed flag leaves the columns null
         * and still creates the account.
         */
        terms_accepted: input.acceptedTerms,
      },
    },
  })

  if (error) throw toAppError(error)

  return { hasSession: data.session !== null, email: input.email }
}

/**
 * Records that the signed-in person agreed to the Terms of Service.
 *
 * For somebody who arrived by invitation. They never saw the sign-up screen, so
 * the trigger that stamps acceptance during account creation never had a flag
 * to read; this is the other half. The server decides the version and the
 * moment, and refuses to move a date that is already recorded, so calling it
 * twice is harmless.
 *
 * A failure is logged rather than thrown, for the same reason
 * recordManualLinkShown does it: by the time this runs the person is already a
 * member of the agency, and making the screen report a failure for the one
 * thing that did succeed would be a lie about what happened.
 */
export async function recordTermsAcceptance(): Promise<void> {
  const { error } = await getSupabaseClient().rpc('record_terms_acceptance')

  if (error) console.error('Could not record the terms acceptance.')
}

export async function signIn(input: SignInInput): Promise<void> {
  const { error } = await getSupabaseClient().auth.signInWithPassword({
    email: input.email,
    password: input.password,
  })

  if (error) throw toAppError(error)
}

export async function requestPasswordReset(email: string): Promise<void> {
  const { error } = await getSupabaseClient().auth.resetPasswordForEmail(email, {
    redirectTo: redirectUrl('/auth/reset-password'),
  })

  if (error) throw toAppError(error)
}

export async function updatePassword(password: string): Promise<void> {
  const { error } = await getSupabaseClient().auth.updateUser({ password })
  if (error) throw toAppError(error)
}

export async function resendConfirmationEmail(email: string): Promise<void> {
  const { error } = await getSupabaseClient().auth.resend({
    type: 'signup',
    email,
    options: { emailRedirectTo: redirectUrl('/auth/callback') },
  })

  if (error) throw toAppError(error)
}

/**
 * Creates an agency for a signed-in user who has no membership.
 *
 * Reached only from onboarding — the normal path provisions the agency during
 * sign-up. Calls the SECURITY DEFINER function so the organization, its owner
 * membership and its settings row are created together or not at all.
 */
export async function createOrganization(input: CreateOrganizationInput): Promise<string> {
  const { data, error } = await getSupabaseClient().rpc('create_organization', {
    p_name: input.organizationName,
    p_country: input.countryCode,
    p_currency: input.defaultCurrency,
    p_time_zone: input.timeZone,
  })

  if (error) throw toAppError(error)
  if (!data) throw new Error('The agency could not be created.')

  return data.id
}

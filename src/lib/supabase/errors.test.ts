import { describe, expect, it } from 'vitest'

import { toAppError } from './errors'

/** The shape supabase-js gives an Auth answer: name, HTTP status, code, message. */
function authError(status: number, code: string, message: string) {
  return Object.assign(new Error(message), { name: 'AuthApiError', status, code })
}

describe('toAppError — Auth', () => {
  it('explains an address Auth rejects instead of a generic failure', () => {
    // As returned by a live project for a reserved domain.
    const error = toAppError(
      authError(400, 'email_address_invalid', 'Email address "someone@example.com" is invalid'),
    )

    expect(error.kind).toBe('auth')
    expect(error.message).toBe(
      'That email address cannot be used. Check it for typos or use a different address.',
    )
    expect(error.message).not.toContain('someone@example.com')
  })

  it('matches on the code when the wording differs', () => {
    const error = toAppError(authError(400, 'email_address_invalid', 'Unable to validate email'))
    expect(error.message).toMatch(/cannot be used/)
  })

  it('says when the project cannot email that address yet', () => {
    const error = toAppError(
      authError(400, 'email_address_not_authorized', 'Email address cannot be used'),
    )
    expect(error.kind).toBe('auth')
    expect(error.message).toMatch(/set up email delivery/)
  })

  it('names the email rate limit, by message or by code', () => {
    expect(toAppError(authError(429, '', 'email rate limit exceeded')).message).toBe(
      'Too many emails requested. Try again in a few minutes.',
    )
    expect(
      toAppError(authError(429, 'over_email_send_rate_limit', 'Rate limit reached')).message,
    ).toBe('Too many emails requested. Try again in a few minutes.')
  })

  it('keeps the existing sign-in message', () => {
    const error = toAppError(authError(400, 'invalid_credentials', 'Invalid login credentials'))
    expect(error.message).toBe('That email and password combination is not recognised.')
  })

  it('still falls back to a generic message for anything unrecognised', () => {
    const error = toAppError(authError(400, 'something_new', 'Something internal happened'))
    expect(error.kind).toBe('unknown')
    expect(error.message).toBe('Something went wrong. Please try again.')
  })

  it('does not let an error code alone turn a database error into an Auth one', () => {
    const error = toAppError({ code: '42501', message: 'permission denied for table vehicles' })
    expect(error.kind).toBe('permission')
  })

  it('explains a billing restriction instead of saying "no permission"', () => {
    // The sentence app.billing_require_write raises, verbatim.
    const error = toAppError({
      code: '42501',
      message: 'This agency has no active subscription, so its records are read-only.',
    })

    expect(error.kind).toBe('permission')
    expect(error.message).toMatch(/read-only/i)
    // The two things somebody in this state most needs to know.
    expect(error.message).toMatch(/exported/i)
    expect(error.message).toMatch(/Billing/)
    expect(error.message).not.toBe('You do not have permission to do that.')
  })
})

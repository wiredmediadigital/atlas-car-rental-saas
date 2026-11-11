import { describe, expect, it } from 'vitest'

import { functionErrorKind, toAppError } from './errors'

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

  it('explains a closed or closing agency instead of showing SQL', () => {
    // The sentence app.require_write raises, verbatim.
    const error = toAppError({
      code: '42501',
      message: 'This agency is closed or closing, so its records are read-only.',
    })

    expect(error.kind).toBe('permission')
    expect(error.message).toMatch(/suspended for closure/i)
    expect(error.message).toMatch(/restore/i)
    expect(error.message).not.toMatch(/subscription/i)
  })

  it('reads the billing function’s own refusal categories', () => {
    /*
     * The billing Edge Function answers `{ error: { category, message } }`, and
     * the category decides what KIND of failure the interface treats it as. A
     * checkout refused because the agency is closing is a state conflict, not a
     * validation problem: the owner got nothing wrong, the agency is simply on
     * its way out and restoring it is what unblocks them.
     */
    expect(functionErrorKind('closing')).toBe('conflict')
    expect(functionErrorKind('permission_denied')).toBe('permission')
    expect(functionErrorKind('already_subscribed')).toBe('conflict')
    // Anything unrecognised still reaches a person as a sentence, not a crash.
    expect(functionErrorKind('something_new')).toBe('validation')
    expect(functionErrorKind(undefined)).toBe('validation')
  })

  it('explains each refusal the closure actions can give', () => {
    const cases: Array<[string, string, RegExp]> = [
      ['42501', 'Only an owner can close an agency.', /only an owner can close/i],
      ['55000', 'This agency is already closed or closing.', /already closing/i],
      [
        '55000',
        'The purge of this agency has started, so it can no longer be restored.',
        /purge has started/i,
      ],
      ['55000', 'This agency is not closing, so there is nothing to restore.', /not closing/i],
    ]
    for (const [code, message, expected] of cases) {
      const error = toAppError({ code, message })
      expect(error.message).toMatch(expected)
      expect(error.message).not.toBe('Something went wrong. Please try again.')
    }
  })

  // A browser can be talking to a project that has not had 20261107100100
  // applied, so both wordings have to reach the same friendly sentence. If the
  // pattern ever stops covering the older one, the raw SQL message goes in
  // front of the user instead.
  it('explains a held deposit whether or not the database has been migrated', () => {
    for (const raw of [
      'A deposit of 20000 is still held. Refund it before completing the rental.',
      'A deposit of 20000 is still held. Refund or retain it before completing the rental.',
    ]) {
      const error = toAppError({ code: '23514', message: raw })

      expect(error.kind).toBe('validation')
      expect(error.message).toBe(
        'A deposit is still being held on this contract. Refund it before completing the rental.',
      )
      // The action named has to be one that exists.
      expect(error.message).not.toMatch(/retain/i)
    }
  })
})

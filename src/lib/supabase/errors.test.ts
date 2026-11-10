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

describe('toAppError — the vehicle limit', () => {
  // Fails if the trigger sentence is left unmapped: the raw "covers 1 vehicles"
  // database wording reaches a person who opens /vehicles/new at the limit.
  it('rewrites the trigger refusal instead of quoting the database', () => {
    const error = toAppError({
      code: '55000',
      message: 'Your plan covers 1 vehicles. You have 1.',
    })

    expect(error.message).toBe(
      'Your plan covers 1 vehicle and you have 1. Retire one you no longer rent, or see Billing to move up.',
    )
    expect(error.message).not.toMatch(/1 vehicles/)
  })

  /*
   * This layer sees an error and nothing else: no agency, no tier, no reader. At
   * limit 1 "Your agency's limit is 1 vehicle" read naturally and hid that it was
   * asserting a bespoke limit. At 5, for an agency on Starter, it was simply
   * untrue -- and it sent an owner to a support mailbox for something one click
   * on Billing fixes. The sentence names no tier, claims no bespoke limit, and
   * points at Billing; the Vehicles page's own hooks replace it with the tiered
   * sentence (src/features/vehicles/limit-refusal.test.tsx pins that they agree).
   */
  it('claims no bespoke limit and names no mailbox for an ordinary Starter agency', () => {
    const error = toAppError({
      code: '55000',
      message: 'Your plan covers 5 vehicles. You have 5.',
    })

    expect(error.message).toBe(
      'Your plan covers 5 vehicles and you have 5. Retire one you no longer rent, or see Billing to move up.',
    )
    expect(error.message).not.toMatch(/agency's limit/i)
    expect(error.message).not.toMatch(/contact us/i)
  })

  // The two numbers the server compared, for the caller that knows the tier.
  it('carries the limit and the count it read', () => {
    const error = toAppError({
      code: '55000',
      message: 'Your plan covers 5 vehicles. You have 5.',
    })

    expect(error.detail).toEqual({ limit: 5, count: 5 })
  })

  // Fails if the batch sentence is left unmapped, or if the free-slot count is
  // dropped from the copy.
  it('rewrites the batch refusal and names the free slots', () => {
    const error = toAppError({
      code: '55000',
      message:
        'This import has 40 vehicles but your plan has room for 3 more (limit 5, in use 2). Nothing was imported.',
    })

    expect(error.kind).toBe('validation')
    expect(error.message).toContain('40 vehicles')
    expect(error.message).toContain('room for 3 more')
    expect(error.message).not.toMatch(/your plan has room/)
  })

  it('says there is no room at all when the fleet is full', () => {
    const error = toAppError({
      code: '55000',
      message:
        'This import has 2 vehicles but your plan has room for 0 more (limit 5, in use 5). Nothing was imported.',
    })

    expect(error.message).toContain('no room for more')
  })
})

describe('toAppError — a plate collision', () => {
  const PLATE_DETAILS =
    'Key (organization_id, upper(btrim(registration_plate::text)))=(0b8f6c1e-2a54-4d0e-9a4b-5d3f0c1d7a11, 12-A-34567) already exists.'

  // Fails if the details are not read: the user is told "no" without being told
  // which plate in the file collided.
  it('names the plate that collided', () => {
    const error = toAppError({
      code: '23505',
      message: 'duplicate key value violates unique constraint "vehicles_plate_unique_idx"',
      details: PLATE_DETAILS,
    })

    expect(error.kind).toBe('conflict')
    expect(error.message).toBe(
      'A vehicle with the registration plate 12-A-34567 is already in your fleet.',
    )
  })

  // Fails if the mapping assumes details are always present.
  it('falls back to the generic sentence when the details carry no plate', () => {
    const error = toAppError({
      code: '23505',
      message: 'duplicate key value violates unique constraint "vehicles_plate_unique_idx"',
    })

    expect(error.message).toBe('A vehicle with this registration plate is already in your fleet.')
  })
})

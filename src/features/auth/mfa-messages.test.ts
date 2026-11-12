import { describe, expect, it } from 'vitest'

import { AppError } from '@/lib/supabase/errors'

import { memberResetErrorMessage, verificationErrorMessage } from './mfa-messages'
import { FactorResetError } from './mfa-recovery'

describe('verificationErrorMessage', () => {
  it('blames the code for anything the auth server refused', () => {
    expect(verificationErrorMessage(new Error('mfa_verification_failed'))).toMatch(
      /not correct.*30 seconds/i,
    )
  })

  it('does not blame the code for a dropped connection', () => {
    const message = verificationErrorMessage(new AppError('network', 'We could not reach you.'))

    expect(message).toBe('We could not reach you.')
    expect(message).not.toMatch(/not correct/i)
  })
})

describe('memberResetErrorMessage', () => {
  it('explains a refusal in terms of who may reset whom', () => {
    expect(memberResetErrorMessage(new FactorResetError('not_permitted'))).toMatch(
      /only an owner.*never their own/i,
    )
  })

  it('says plainly when there was nothing to remove', () => {
    expect(memberResetErrorMessage(new FactorResetError('no_factor'))).toMatch(
      /no authenticator set up/i,
    )
  })

  it('separates a dropped connection from a refusal', () => {
    expect(memberResetErrorMessage(new FactorResetError('unreachable'))).toMatch(/connection/i)
  })

  it('never blames a recovery code the owner never typed', () => {
    // The self path's wording is all about the code in front of the user —
    // "that code may already have been used, try a different one". There is no
    // code on this path, and borrowing that wording would be nonsense.
    for (const reason of [
      'invalid_code',
      'not_permitted',
      'no_factor',
      'unavailable',
      'unreachable',
    ] as const) {
      const message = memberResetErrorMessage(new FactorResetError(reason))
      expect(message).not.toMatch(/already been used/i)
      expect(message).not.toMatch(/try a different/i)
    }
  })

  it('falls back to a plain failure for anything that is not a reset refusal', () => {
    expect(memberResetErrorMessage(new Error('boom'))).toMatch(/could not be completed/i)
  })
})

// @vitest-environment node
/**
 * The factor-reset boundary decisions: body validation and the aal gate.
 *
 * The aal gate is what stops a password-only attacker holding an owner's password
 * from stripping every member's second factor, so each way of getting it wrong is
 * pinned here.
 */
import { describe, expect, it } from 'vitest'

import { hasRequiredAal, parseResetRequest, readAalClaim } from '../_shared/mfa-reset-request.ts'

const UUID_A = '00000000-0000-0000-0000-0000000000a1'
const UUID_B = '00000000-0000-0000-0000-0000000000b2'

function b64url(text: string): string {
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function bearer(payload: unknown): string {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload)
  return `Bearer ${b64url('{"alg":"HS256"}')}.${b64url(body)}.signature`
}

describe('parseResetRequest', () => {
  it.each([null, undefined, 'x', 7, true, [], [{ mode: 'self' }]])(
    'refuses a body that is not an object (%j)',
    (body) => {
      expect(parseResetRequest(body).ok).toBe(false)
    },
  )

  it('refuses a missing or unknown mode', () => {
    expect(parseResetRequest({}).ok).toBe(false)
    expect(parseResetRequest({ mode: 'admin', recoveryCode: 'ABC' }).ok).toBe(false)
    expect(parseResetRequest({ mode: 7 }).ok).toBe(false)
  })

  it('accepts a self request and carries only the code', () => {
    expect(parseResetRequest({ mode: 'self', recoveryCode: 'ABCD-EFGH', aal: 'aal2' })).toEqual({
      ok: true,
      request: { mode: 'self', recoveryCode: 'ABCD-EFGH' },
    })
  })

  it.each([undefined, '', 12, null, ['ABC']])('refuses a self request with code %j', (code) => {
    expect(parseResetRequest({ mode: 'self', recoveryCode: code }).ok).toBe(false)
  })

  it('refuses a code too long to be one, before any hashing happens', () => {
    // An unbounded string would otherwise run the normalising regexes and up to
    // ten bcrypt comparisons inside a billed invocation.
    expect(parseResetRequest({ mode: 'self', recoveryCode: 'A'.repeat(65) }).ok).toBe(false)
  })

  it('still accepts a code padded with the separators a user pastes', () => {
    expect(parseResetRequest({ mode: 'self', recoveryCode: 'A'.repeat(64) }).ok).toBe(true)
  })

  it('accepts a member request', () => {
    expect(
      parseResetRequest({ mode: 'member', subjectUserId: UUID_A, organizationId: UUID_B }),
    ).toEqual({
      ok: true,
      request: { mode: 'member', subjectUserId: UUID_A, organizationId: UUID_B },
    })
  })

  it.each([
    [{ organizationId: UUID_B }],
    [{ subjectUserId: UUID_A }],
    [{ subjectUserId: 'not-a-uuid', organizationId: UUID_B }],
    [{ subjectUserId: UUID_A, organizationId: 'x' }],
    [{ subjectUserId: 5, organizationId: UUID_B }],
  ])('refuses a member request %j', (fields) => {
    expect(parseResetRequest({ mode: 'member', ...fields }).ok).toBe(false)
  })
})

describe('readAalClaim', () => {
  it('reads aal1 and aal2', () => {
    expect(readAalClaim(bearer({ aal: 'aal1' }))).toBe('aal1')
    expect(readAalClaim(bearer({ aal: 'aal2' }))).toBe('aal2')
  })

  it('returns an empty string when aal is absent or not a string', () => {
    expect(readAalClaim(bearer({ sub: 'x' }))).toBe('')
    expect(readAalClaim(bearer({ aal: 2 }))).toBe('')
    expect(readAalClaim(bearer({ aal: ['aal2'] }))).toBe('')
    expect(readAalClaim(bearer(null))).toBe('')
  })

  it.each([
    ['a missing header', ''],
    ['a token with no payload', 'Bearer abc'],
    ['a payload that is not base64', 'Bearer a.%%%.c'],
    ['a payload that is not JSON', bearer('not json')],
  ])('throws a fixed error for %s', (_label, header) => {
    expect(() => readAalClaim(header)).toThrow('unreadable_aal_claim')
  })

  it('does not echo the token in its error', () => {
    const header = bearer('secret-looking-text')
    expect(() => readAalClaim(header)).toThrow(/^unreadable_aal_claim$/)
  })
})

describe('hasRequiredAal', () => {
  it('lets self mode through at aal1, aal2 and with no claim', () => {
    expect(hasRequiredAal('self', bearer({ aal: 'aal1' }))).toBe(true)
    expect(hasRequiredAal('self', bearer({ aal: 'aal2' }))).toBe(true)
    expect(hasRequiredAal('self', bearer({}))).toBe(true)
  })

  it('lets member mode through only at exactly aal2', () => {
    expect(hasRequiredAal('member', bearer({ aal: 'aal2' }))).toBe(true)
  })

  it.each([{ aal: 'aal1' }, { aal: 'AAL2' }, { aal: 'aal3' }, { aal: 2 }, { aal: true }, {}])(
    'refuses member mode for %j',
    (claims) => {
      expect(hasRequiredAal('member', bearer(claims))).toBe(false)
    },
  )

  it('fails closed for member mode when the token cannot be read', () => {
    expect(() => hasRequiredAal('member', '')).toThrow('unreadable_aal_claim')
    expect(() => hasRequiredAal('member', bearer('not json'))).toThrow('unreadable_aal_claim')
  })
})

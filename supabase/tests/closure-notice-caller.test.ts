// @vitest-environment node
/**
 * Who may call the closure-notice function, and what each caller may drain.
 *
 * Two callers: a signed-in user (one agency, checked by row-level security) and
 * the scheduled drain, which proves itself with the runner secret and drains
 * every agency. The drain must never be reachable without the secret, and a
 * user session must never be mistaken for it.
 */
import { describe, expect, it } from 'vitest'

import { resolveNoticeCaller } from '../functions/_shared/closure-notice.ts'

const SECRET = 'r'.repeat(40)

describe('resolveNoticeCaller', () => {
  it('treats the runner secret as the scheduled drain', () => {
    expect(resolveNoticeCaller(`Bearer ${SECRET}`, SECRET)).toBe('runner')
  })

  it('treats any other bearer token as a user session to be verified', () => {
    expect(resolveNoticeCaller('Bearer eyJhbGciOi.user.jwt', SECRET)).toBe('user')
  })

  it('does not treat a near-miss of the secret as the runner', () => {
    expect(resolveNoticeCaller(`Bearer ${SECRET}x`, SECRET)).toBe('user')
    expect(resolveNoticeCaller(`Bearer ${SECRET.slice(1)}`, SECRET)).toBe('user')
  })

  it('never grants the drain when the secret is unset or too short', () => {
    expect(resolveNoticeCaller('Bearer ', '')).toBe('refused')
    expect(resolveNoticeCaller('Bearer short', 'short')).toBe('user')
    expect(resolveNoticeCaller('Bearer x', '')).toBe('user')
  })

  it('refuses a request with no bearer token at all', () => {
    expect(resolveNoticeCaller(null, SECRET)).toBe('refused')
    expect(resolveNoticeCaller('', SECRET)).toBe('refused')
    expect(resolveNoticeCaller('Basic abc', SECRET)).toBe('refused')
  })
})

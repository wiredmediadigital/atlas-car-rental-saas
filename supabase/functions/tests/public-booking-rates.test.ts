import { describe, expect, it } from 'vitest'

import {
  ADDRESS_RULE,
  EMAIL_RULE,
  MAX_MILLISECONDS_ON_FORM,
  MIN_MILLISECONDS_ON_FORM,
  checkRate,
  createRateState,
  forgetExpired,
  looksAutomated,
} from '../_shared/public-booking-rates.ts'

const NOW = Date.parse('2027-02-01T12:00:00Z')

describe('the rate limit', () => {
  it('allows attempts up to the limit and refuses the next', () => {
    const state = createRateState()
    for (let attempt = 1; attempt <= EMAIL_RULE.limit; attempt += 1) {
      expect(checkRate(state, 'email:a@b.test', NOW, EMAIL_RULE).allowed).toBe(true)
    }
    const verdict = checkRate(state, 'email:a@b.test', NOW, EMAIL_RULE)
    expect(verdict.allowed).toBe(false)
    if (!verdict.allowed) expect(verdict.retryAfterSeconds).toBeGreaterThan(0)
  })

  it('counts keys independently, so one visitor cannot block another', () => {
    const state = createRateState()
    for (let attempt = 0; attempt <= EMAIL_RULE.limit; attempt += 1) {
      checkRate(state, 'email:loud@b.test', NOW, EMAIL_RULE)
    }
    expect(checkRate(state, 'email:quiet@b.test', NOW, EMAIL_RULE).allowed).toBe(true)
  })

  it('limits by address and by email independently', () => {
    // The same person sending from one address five times is caught by the
    // email rule; five different people behind one office router are not.
    const state = createRateState()
    for (let attempt = 0; attempt <= EMAIL_RULE.limit; attempt += 1) {
      checkRate(state, 'email:one@b.test', NOW, EMAIL_RULE)
    }
    expect(checkRate(state, 'ip:203.0.113.7', NOW, ADDRESS_RULE).allowed).toBe(true)
    expect(checkRate(state, 'email:two@b.test', NOW, EMAIL_RULE).allowed).toBe(true)
  })

  it('forgives once the window has passed', () => {
    const state = createRateState()
    for (let attempt = 0; attempt <= EMAIL_RULE.limit; attempt += 1) {
      checkRate(state, 'email:a@b.test', NOW, EMAIL_RULE)
    }
    expect(checkRate(state, 'email:a@b.test', NOW, EMAIL_RULE).allowed).toBe(false)
    expect(
      checkRate(state, 'email:a@b.test', NOW + EMAIL_RULE.windowMs + 1, EMAIL_RULE).allowed,
    ).toBe(true)
  })

  it('counts a refused attempt, so hammering extends the wait', () => {
    const state = createRateState()
    for (let attempt = 0; attempt <= EMAIL_RULE.limit; attempt += 1) {
      checkRate(state, 'email:a@b.test', NOW, EMAIL_RULE)
    }
    const first = checkRate(state, 'email:a@b.test', NOW + 1_000, EMAIL_RULE)
    const later = checkRate(state, 'email:a@b.test', NOW + EMAIL_RULE.windowMs - 1_000, EMAIL_RULE)
    expect(first.allowed).toBe(false)
    expect(later.allowed).toBe(false)
  })
})

describe('forgetting', () => {
  it('drops keys whose attempts have all aged out, and keeps live ones', () => {
    const state = createRateState()
    checkRate(state, 'ip:old', NOW, ADDRESS_RULE)
    checkRate(state, 'ip:fresh', NOW + ADDRESS_RULE.windowMs, ADDRESS_RULE)
    forgetExpired(state, NOW + ADDRESS_RULE.windowMs + 1, ADDRESS_RULE)
    expect(state.attempts.has('ip:old')).toBe(false)
    expect(state.attempts.has('ip:fresh')).toBe(true)
  })
})

describe('whether a submission looks automated', () => {
  it('catches a filled honeypot', () => {
    expect(looksAutomated({ honeypot: 'Acme Ltd', startedAt: null, now: NOW })).toEqual({
      automated: true,
      reason: 'honeypot',
    })
  })

  it('ignores an empty or whitespace honeypot', () => {
    expect(looksAutomated({ honeypot: '   ', startedAt: null, now: NOW }).automated).toBe(false)
    expect(looksAutomated({ honeypot: '', startedAt: null, now: NOW }).automated).toBe(false)
  })

  it('catches a submission faster than a person can fill a form', () => {
    const startedAt = NOW - MIN_MILLISECONDS_ON_FORM + 1
    expect(looksAutomated({ honeypot: null, startedAt, now: NOW })).toEqual({
      automated: true,
      reason: 'too-fast',
    })
  })

  it('accepts one that took a human amount of time', () => {
    const startedAt = NOW - MIN_MILLISECONDS_ON_FORM - 1
    expect(looksAutomated({ honeypot: null, startedAt, now: NOW }).automated).toBe(false)
  })

  it('catches a stale tab or a forged timestamp', () => {
    const startedAt = NOW - MAX_MILLISECONDS_ON_FORM - 1
    expect(looksAutomated({ honeypot: null, startedAt, now: NOW })).toEqual({
      automated: true,
      reason: 'too-slow',
    })
  })

  it('does not hold a missing timestamp against the visitor', () => {
    // Scripting partly blocked is still a person.
    expect(looksAutomated({ honeypot: null, startedAt: null, now: NOW }).automated).toBe(false)
    expect(looksAutomated({ honeypot: null, now: NOW }).automated).toBe(false)
  })
})

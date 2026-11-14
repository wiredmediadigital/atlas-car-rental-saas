/**
 * What stops the public booking form being used as a machine.
 *
 * Three cheap defences, and no third-party CAPTCHA: a rate limit per key, a
 * honeypot field, and a minimum time on the form. They are here, alone and
 * pure, so each can be tested without a request, a database or a clock.
 *
 * WHAT THESE ARE WORTH, HONESTLY. None of them stops a determined attacker.
 * The honeypot costs one line to defeat, the minimum time costs a sleep, and
 * the rate limit below is held in memory, so it is per Edge Function instance:
 * Supabase runs several and recycles them, which means the real limit is looser
 * than the numbers here and resets without warning. What they stop is the
 * ordinary case -- a scraper, a bored visitor, a form submitted forty times by
 * a broken retry -- and they do it without putting a Google widget in front of
 * an agency's customers or a row in the database for every attempt.
 *
 * If this is ever not enough, the fix is a table with the same shape as
 * public.gps_rate_limits and `RateState` implemented over it. The interface
 * below is deliberately small enough for that to be a drop-in.
 */

/** How many attempts a key may make, and over what span. */
export interface RateRule {
  limit: number
  windowMs: number
}

/**
 * One request per visitor is the honest expectation; five in an hour covers a
 * change of mind and a second car. Twenty per address catches a household,
 * an office, or a phone on a carrier NAT without catching a scraper.
 */
export const EMAIL_RULE: RateRule = { limit: 5, windowMs: 60 * 60 * 1000 }
export const ADDRESS_RULE: RateRule = { limit: 20, windowMs: 60 * 60 * 1000 }

/** Nobody reads a car's details, fills in four fields and submits in under this. */
export const MIN_MILLISECONDS_ON_FORM = 3_000

/**
 * And nobody takes a working day over it either. A `startedAt` older than this
 * is a stale tab or a forged value; both get a fresh form rather than a lead.
 */
export const MAX_MILLISECONDS_ON_FORM = 12 * 60 * 60 * 1000

export type RateVerdict = { allowed: true } | { allowed: false; retryAfterSeconds: number }

/**
 * The attempts remembered so far, keyed by whatever the caller is limiting.
 *
 * A plain Map of timestamps. It is given to the module rather than created by
 * it so that a test can hand over a fresh one, and so that an implementation
 * backed by something durable can be substituted without changing any rule.
 */
export interface RateState {
  attempts: Map<string, number[]>
}

export function createRateState(): RateState {
  return { attempts: new Map() }
}

/**
 * Records an attempt against `key` and says whether it is allowed.
 *
 * COUNTING HAPPENS EVEN WHEN THE ANSWER IS NO. A refused attempt is still an
 * attempt, so hammering the endpoint extends the wait rather than resetting it
 * -- the behaviour a retry loop deserves.
 */
export function checkRate(
  state: RateState,
  key: string,
  now: number,
  rule: RateRule = EMAIL_RULE,
): RateVerdict {
  const cutoff = now - rule.windowMs
  const seen = (state.attempts.get(key) ?? []).filter((at) => at > cutoff)
  seen.push(now)
  state.attempts.set(key, seen)

  if (seen.length <= rule.limit) return { allowed: true }

  // The oldest attempt still in the window is what has to age out.
  const oldest = seen[0]!
  const waitMs = Math.max(oldest + rule.windowMs - now, 1_000)
  return { allowed: false, retryAfterSeconds: Math.ceil(waitMs / 1_000) }
}

/**
 * Drops keys whose attempts have all aged out.
 *
 * Without this the map grows for the life of the instance, one entry per
 * address ever seen. Called on a schedule the caller chooses; the rules do not
 * depend on it having run.
 */
export function forgetExpired(state: RateState, now: number, rule: RateRule = ADDRESS_RULE): void {
  const cutoff = now - rule.windowMs
  for (const [key, attempts] of state.attempts) {
    if (attempts.every((at) => at <= cutoff)) state.attempts.delete(key)
  }
}

export type AutomationVerdict =
  { automated: false } | { automated: true; reason: 'honeypot' | 'too-fast' | 'too-slow' }

/**
 * Whether a submission looks like a machine rather than a person.
 *
 * The honeypot is a field a person never sees and therefore never fills. The
 * timing is the gap between the form being built and being sent, which the page
 * reports and which a forger can lie about -- it is a speed bump, not a gate,
 * and is treated as one: a submission that fails it is refused with the same
 * ordinary message as any other bad request, never told which rule it hit.
 */
export function looksAutomated(submission: {
  honeypot?: string | null
  startedAt?: number | null
  now: number
}): AutomationVerdict {
  if (typeof submission.honeypot === 'string' && submission.honeypot.trim() !== '') {
    return { automated: true, reason: 'honeypot' }
  }

  const startedAt = submission.startedAt
  // No timestamp at all is not held against the visitor: a page with scripting
  // partly blocked still has a person behind it.
  if (typeof startedAt !== 'number' || !Number.isFinite(startedAt)) return { automated: false }

  const elapsed = submission.now - startedAt
  if (elapsed < MIN_MILLISECONDS_ON_FORM) return { automated: true, reason: 'too-fast' }
  if (elapsed > MAX_MILLISECONDS_ON_FORM) return { automated: true, reason: 'too-slow' }
  return { automated: false }
}

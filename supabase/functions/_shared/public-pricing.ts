/**
 * The public pricing payload, the rule for when the mirrored catalogue is too
 * old to serve, and every decision the public pricing endpoint makes.
 *
 * The public pricing function reads `billing_plans` and answers the marketing
 * page with what Stripe last said. The decisions here decide what a visitor
 * sees, so they are pure (or have their effects injected) and tested: how stale
 * the rows may be, which rows are shown, when Stripe may be asked again, and
 * which status answers which state. Nothing in this module talks to Supabase or
 * Stripe: the entrypoint (`pricing/index.ts`) is only a Deno shim, because an
 * entrypoint is outside tsconfig and no test can reach it.
 */

/**
 * The subset of `billing_plans` this module reads. `interval` is the whole of
 * `public.billing_interval`, not the two values the page can label: the table
 * holds whatever Stripe reported, and narrowing happens in `toPublicPlans`.
 */
export interface PlanRow {
  plan_key: string
  currency: string
  amount_minor: number
  interval: 'day' | 'week' | 'month' | 'year'
  interval_count: number
  is_active: boolean
  sort_order: number
  updated_at: string
}

/**
 * One sellable plan as the browser receives it. There is deliberately no display
 * name: the card heading is page copy, and Stripe's nickname would be a second
 * place a product name could disagree with the page.
 */
export interface PublicPlan {
  planKey: string
  amountMinor: number
  currency: string
  interval: 'month' | 'year'
  intervalCount: number
}

export interface PublicPricing {
  configured: boolean
  plans: PublicPlan[]
  trialDays: number
}

/** The answer when no pricing is configured. A normal state, not a fault. */
export const UNCONFIGURED: PublicPricing = { configured: false, plans: [], trialDays: 0 }

/** How long mirrored prices may be served before the catalogue is refreshed. */
export const PRICING_TTL_SECONDS = 600

const MILLISECONDS_PER_SECOND = 1000

/**
 * Whether the newest mirrored row is too old to serve.
 *
 * `null` means nothing has ever been written. An unparseable timestamp is also
 * treated as stale: the comparison is written so that NaN fails the freshness
 * test, rather than silently passing as fresh.
 *
 * The boundary is chosen, not inherited: a row exactly `ttlSeconds` old is still
 * fresh, and only an age strictly greater than the TTL is stale.
 */
export function isStale(
  newestUpdatedAt: string | null,
  now: Date,
  ttlSeconds: number = PRICING_TTL_SECONDS,
): boolean {
  if (newestUpdatedAt === null) return true
  const ageMilliseconds = now.getTime() - Date.parse(newestUpdatedAt)
  return !(ageMilliseconds <= ttlSeconds * MILLISECONDS_PER_SECOND)
}

/**
 * Shapes mirrored rows into the plans the page can show.
 *
 * Inactive rows are dropped, and so is any row whose interval is not month or
 * year: the page can only label those two, and the browser rejects a payload
 * containing anything else, which would hide every other plan with it. One odd
 * plan must not take the others down (the same policy the browser applies to an
 * unrenderable currency). The rest are ordered by `sort_order`. The interval is
 * the one Stripe reported, never one inferred from the plan key.
 *
 * `.filter()` returns a new array, so the `.sort()` after it never reorders the
 * caller's rows; a test pins that.
 */
export function toPublicPlans(rows: readonly PlanRow[]): PublicPlan[] {
  return rows
    .filter(
      (row): row is PlanRow & { interval: PublicPlan['interval'] } =>
        row.is_active && (row.interval === 'month' || row.interval === 'year'),
    )
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((row): PublicPlan => ({
      planKey: row.plan_key,
      amountMinor: row.amount_minor,
      currency: row.currency,
      interval: row.interval,
      intervalCount: row.interval_count,
    }))
}

/**
 * The payload for a deployment, given whether it is configured.
 *
 * `configured` is the caller's knowledge and is not derived from the rows: a
 * configured deployment whose every price has been archived has rows but no
 * active ones, and one never refreshed has none, and neither is "not
 * configured". Deriving it from the row count would call a live deployment
 * unconfigured and hide its pricing section for the wrong reason.
 */
export function buildPublicPricing(args: {
  rows: readonly PlanRow[]
  trialDays: number
  configured: boolean
}): PublicPricing {
  if (!args.configured) return UNCONFIGURED
  return { configured: true, plans: toPublicPlans(args.rows), trialDays: args.trialDays }
}

/** Minimum gap between Stripe refresh attempts by one instance, after a good one. */
export const REFRESH_RETRY_MS = 60_000

/**
 * The gap after a refresh that failed or changed nothing: ten minutes.
 *
 * THIS IS A MITIGATION, NOT THE GLOBAL BOUND. The cross-instance bound on Stripe
 * calls is `billing_plans.updated_at`, which advances only when a refresh both
 * succeeds and touches a row. Two states freeze it: every price archived (the
 * replace deactivates rather than deletes, so a second such refresh touches
 * nothing) and Stripe being unreachable. In those states the only bound left is
 * this per-instance window, and at 60s anonymous traffic would drive one Stripe
 * call per instance per minute indefinitely, during an incident, against the
 * account that takes customers' money. Ten minutes cuts the worst case from
 * instances/60s to instances/10min; it does not make it independent of the
 * number of instances. A true bound needs shared state (a migration), which is
 * a separate decision. `billing_platform_state` must not be used for it: it
 * records what the server knows of its Stripe configuration, and the billing
 * path reads it for access decisions.
 */
export const REFRESH_BACKOFF_MS = 600_000

/**
 * Whether to call Stripe now: the mirrored data is stale AND this instance has
 * not tried recently.
 *
 * Staleness alone is not enough. A failed refresh writes nothing, so the data
 * stays stale and every anonymous request would call Stripe again: a retry storm
 * against the payment account during exactly the incident that caused the
 * failure. The retry window bounds every refresh path, including a `null`
 * newest timestamp (no rows, or none parseable), which is always stale.
 */
export function shouldRefresh(args: {
  newestUpdatedAt: string | null
  lastAttemptMs: number | null
  nowMs: number
  ttlSeconds?: number
  retryMs?: number
}): boolean {
  const { newestUpdatedAt, lastAttemptMs, nowMs, ttlSeconds, retryMs = REFRESH_RETRY_MS } = args
  if (!isStale(newestUpdatedAt, new Date(nowMs), ttlSeconds)) return false
  return lastAttemptMs === null || nowMs - lastAttemptMs >= retryMs
}

/**
 * One instance's memory of when it last tried to refresh, and how long to wait
 * before trying again. It is deliberately mutable: it is module state in the
 * entrypoint, and it must be written BEFORE a refresh starts so that concurrent
 * requests at TTL expiry do not all refresh at once. Per instance only.
 */
export interface RefreshGate {
  lastAttemptMs: number | null
  retryMs: number
}

export function createRefreshGate(): RefreshGate {
  return { lastAttemptMs: null, retryMs: REFRESH_RETRY_MS }
}

/**
 * The newest `updated_at` among the rows, for `isStale`.
 *
 * Compared as instants, not strings: Postgres may render the same instant with
 * different offsets. A missing or unparseable timestamp is ignored rather than
 * allowed to win a comparison; if no row has a usable one the answer is `null`,
 * which `isStale` treats as stale, so bad data errs toward a refresh.
 */
export function newestUpdatedAt(rows: readonly Pick<PlanRow, 'updated_at'>[]): string | null {
  let newest: string | null = null
  let newestTime = Number.NEGATIVE_INFINITY
  for (const row of rows) {
    const time = typeof row.updated_at === 'string' ? Date.parse(row.updated_at) : Number.NaN
    if (Number.isNaN(time) || time <= newestTime) continue
    newest = row.updated_at
    newestTime = time
  }
  return newest
}

/** Whether `after` is a strictly later instant than `before` (`null` is the earliest). */
function hasAdvanced(before: string | null, after: string | null): boolean {
  if (after === null) return false
  const beforeTime = before === null ? Number.NaN : Date.parse(before)
  return Date.parse(after) > (Number.isNaN(beforeTime) ? Number.NEGATIVE_INFINITY : beforeTime)
}

/** The effects `servePricing` needs, injected so a test can stand in for each. */
export interface PricingDeps {
  /** `null` when billing configuration is missing or invalid. */
  config: { trialDays: number } | null
  hasPlatformCredentials: boolean
  /** Every mirrored row, or `null` if the read itself failed. */
  readPlans: () => Promise<PlanRow[] | null>
  /** Asks Stripe and rewrites the mirror. Throws on failure. */
  refresh: () => Promise<unknown>
  gate: RefreshGate
  nowMs: number
  logError: (message: string) => void
}

export type PricingDecision =
  { status: 200; body: PublicPricing } | { status: 503; body: { error: string } }

const UNAVAILABLE: PricingDecision = {
  status: 503,
  body: { error: 'Pricing is unavailable right now.' },
}

/** An error's name only: a message or body can echo a credential. */
function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'non-error'
}

/**
 * Refreshes the mirror if it is stale and this instance may try, and returns the
 * rows to serve. Stale but real beats nothing, so a failed refresh serves what
 * is already mirrored.
 *
 * The gate is written before the attempt (see `RefreshGate`). Afterwards the
 * window is set by the outcome: a refresh that threw, or that returned without
 * the newest `updated_at` moving, earns the long `REFRESH_BACKOFF_MS`.
 */
async function refreshIfStale(deps: PricingDeps, rows: PlanRow[]): Promise<PlanRow[]> {
  const { gate, nowMs } = deps
  const before = newestUpdatedAt(rows)
  const allowed = shouldRefresh({
    newestUpdatedAt: before,
    lastAttemptMs: gate.lastAttemptMs,
    nowMs,
    retryMs: gate.retryMs,
  })
  if (!allowed) return rows

  gate.lastAttemptMs = nowMs
  try {
    await deps.refresh()
  } catch (error) {
    gate.retryMs = REFRESH_BACKOFF_MS
    deps.logError(`pricing: catalogue refresh failed (${errorName(error)})`)
    return rows
  }

  const reread = await deps.readPlans()
  const moved = reread !== null && hasAdvanced(before, newestUpdatedAt(reread))
  gate.retryMs = moved ? REFRESH_RETRY_MS : REFRESH_BACKOFF_MS
  return reread ?? rows
}

/**
 * Everything the public pricing endpoint decides, with its effects injected.
 *
 * Missing or invalid configuration is a state, not a fault: HTTP 200 with
 * `UNCONFIGURED`, and Stripe is never contacted. Invalid is answered exactly like
 * missing so an anonymous caller cannot learn that a deployment's configuration
 * is malformed; the authenticated billing `status` action gives owners the
 * specific problem. Absent platform credentials, or an unreadable table, are
 * faults and answer 503. Otherwise configuration is present, so the payload is
 * `configured: true` however many rows remain.
 */
export async function servePricing(deps: PricingDeps): Promise<PricingDecision> {
  if (deps.config === null) return { status: 200, body: UNCONFIGURED }

  if (!deps.hasPlatformCredentials) {
    deps.logError('pricing: platform credentials missing')
    return UNAVAILABLE
  }

  const rows = await deps.readPlans()
  if (rows === null) {
    deps.logError('pricing: catalogue read failed')
    return UNAVAILABLE
  }

  const served = await refreshIfStale(deps, rows)
  return {
    status: 200,
    body: buildPublicPricing({ rows: served, trialDays: deps.config.trialDays, configured: true }),
  }
}

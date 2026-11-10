/**
 * Reports for the two configurations that misbehave silently.
 *
 * The feature fails OPEN on purpose: a plan key with no authored vehicle limit
 * means 'no limit', and a subscription that lands below the agency's fleet is
 * kept as it is, because nothing here is retroactive. Neither is an error, so
 * neither stops anything - which is exactly why somebody has to be TOLD.
 */

/** What the reports read. Every answer is the server's. */
export interface LimitReportStore {
  /** Plan keys the catalogue sells in this mode (billing_plans.is_active). */
  activePlanKeys(): Promise<readonly string[]>
  /** Plan keys that have a row in plan_vehicle_limits. */
  authoredLimitKeys(): Promise<readonly string[]>
}

/**
 * Active plan keys with no authored limit, in the order given.
 *
 * Also the condition behind the public pricing page: it names a tier from the
 * plan key and drops a key it cannot name, and every key outside the six
 * authored ones shows up here first.
 */
export async function plansWithoutLimit(store: LimitReportStore): Promise<readonly string[]> {
  const [active, authored] = await Promise.all([store.activePlanKeys(), store.authoredLimitKeys()])
  const limited = new Set(authored)
  return [...new Set(active)].filter((key) => !limited.has(key))
}

/** The longest reason billing_report_platform_state keeps. */
const REASON_MAX = 200

/** One sentence for the operator. Plan keys only: never a price id or a secret. */
export function describePlansWithoutLimit(keys: readonly string[]): string {
  const prefix = 'No vehicle limit is authored for: '
  const suffix = '. Those plans allow unlimited vehicles.'
  const room = REASON_MAX - prefix.length - suffix.length
  let list = keys.join(', ')
  if (list.length > room) list = list.slice(0, Math.max(0, room - 3)) + '...'
  return prefix + list + suffix
}

export interface FleetStore {
  /** app.vehicle_limit_of: the override, else the authored limit of the effective plan. */
  vehicleLimit(organizationId: string): Promise<number | null>
  /** app.vehicle_count_of. */
  vehicleCount(organizationId: string): Promise<number>
  /** Writes the observation to the agency's billing history. */
  note(organizationId: string, summary: string): Promise<void>
}

/**
 * Notes, and ONLY notes, an agency whose fleet exceeds the limit it now has.
 *
 * Nothing is archived, blocked or reverted: the feature is not retroactive, and
 * the usual way here is a lower tier arriving from outside the product (an
 * operator editing Stripe directly). The mismatch is made visible and left to a
 * person to resolve. Returns what it found, or null when the fleet fits.
 */
export async function checkFleetAgainstTier(
  store: FleetStore,
  organizationId: string,
): Promise<{ readonly limit: number; readonly count: number } | null> {
  const limit = await store.vehicleLimit(organizationId)
  if (limit === null) return null
  const count = await store.vehicleCount(organizationId)
  if (count <= limit) return null
  const vehicles = count === 1 ? 'vehicle' : 'vehicles'
  await store.note(
    organizationId,
    `The plan now covers ${limit} but the agency has ${count} ${vehicles}. Nothing was archived.`,
  )
  return { limit, count }
}

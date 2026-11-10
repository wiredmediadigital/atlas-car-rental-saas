/**
 * Reports for the two configurations that misbehave silently.
 *
 * The feature fails OPEN on purpose: a plan key with no authored vehicle limit
 * means 'no limit', and a subscription that lands below the agency's fleet is
 * kept as it is, because nothing here is retroactive. Neither is an error, so
 * neither stops anything - which is exactly why somebody has to be TOLD.
 *
 * WHO IS TOLD DIFFERS, and so does the voice. `describePlansWithoutLimit` goes to
 * `billing_platform_state.reported_reason`, which only an operator reads, and it
 * prints plan keys. `checkFleetAgainstTier` writes to `billing_events`, which
 * `billing_events_select` grants to every owner and the Billing page renders
 * verbatim: that one is written to the agency.
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
  /**
   * The summary of the agency's most recent billing note of the kind `note` writes,
   * or null. Used so an unchanged observation is not written again.
   */
  lastNote(organizationId: string): Promise<string | null>
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
  /*
   * Written for its actual reader. `billing_events_select` grants this row to
   * every owner and the Billing page prints the summary verbatim, so it is the
   * AGENCY's history, not an operator's log: second person, a unit on the number,
   * and the two things that can be done about it -- the same pair the Vehicles
   * page offers for the same fact.
   *
   * `count` is never 1 here (it is greater than `limit`, which is at least 1) so
   * only `limit` is pluralised; there is no dead singular arm to keep correct.
   */
  const covered = `${limit} ${limit === 1 ? 'vehicle' : 'vehicles'}`
  const summary =
    `Your plan now covers ${covered} and you have ${count}. ` +
    `Nothing was retired — retire ${count - limit}, or move up a plan.`
  /*
   * Over the limit is a condition that persists for months, and this runs on every
   * applied subscription event (each renewal, each update) in a history the agency
   * reads. Only a CHANGED observation is a new fact. The comparison is with the
   * latest note of this kind, so an unrelated note in between lets it be said again.
   */
  if ((await store.lastNote(organizationId)) === summary) return { limit, count }
  await store.note(organizationId, summary)
  return { limit, count }
}

/**
 * The tier ladder Pevvy sells: its names, its allowances and its order.
 *
 * This is a PLAN fact, not a Vehicles one. The allowance happens to be counted in
 * vehicles, but the name, the ordering and the shape of a plan key all belong to
 * what is being sold; four places read them, and the fleet list is only one.
 * It is deliberately not in `src/lib/`: commercial packaging is not infrastructure.
 *
 * The sentence the Vehicles page shows beside its heading stays in
 * `src/features/vehicles/limit.ts`, which has one consumer and is page copy.
 */

export type TierKey = 'starter' | 'pro' | 'business'

export interface Tier {
  key: TierKey
  label: string
  limit: number
}

/**
 * The self-serve tiers, smallest first. The numbers mirror plan_vehicle_limits; a
 * database test compares the two so they cannot drift apart unnoticed.
 */
export const VEHICLE_TIERS: readonly Tier[] = [
  { key: 'starter', label: 'Starter', limit: 5 },
  { key: 'pro', label: 'Pro', limit: 20 },
  { key: 'business', label: 'Business', limit: 50 },
]

/**
 * The tier key inside a plan key. Plan keys are `<tier>_<interval>`
 * (`starter_monthly`, `business_yearly`), so the tier is the segment before the
 * first underscore. This is the one place that knows the shape.
 */
export function tierKeyOfPlan(planKey: string): string {
  const index = planKey.indexOf('_')
  return index === -1 ? planKey : planKey.slice(0, index)
}

function vehicles(count: number): string {
  return `${count} ${count === 1 ? 'vehicle' : 'vehicles'}`
}

/**
 * Why a move to a smaller tier is refused: the fleet is bigger than the target
 * tier covers. Names the gap. The Billing page uses this rather than its own
 * wording, so the two sentences cannot drift.
 */
export function downgradeRefusalCopy(
  targetTier: string,
  targetLimit: number,
  count: number,
): string {
  // A tier key this file does not know is never printed: "Enterprise_plus" is a
  // catalogue key, not a name.
  const known = VEHICLE_TIERS.find((candidate) => candidate.key === targetTier)
  const subject = known ? known.label : 'That plan'
  const lead = `${subject} covers ${vehicles(targetLimit)}. You have ${count}.`
  // GUARD, NOT A LIVE PATH. The server refuses only when count exceeds the limit
  // it compared, and sends those numbers, so the difference below is positive for
  // every real caller. A future caller passing anything else must not be told to
  // retire zero or a negative number of vehicles.
  const surplus = count - targetLimit
  if (surplus <= 0) return lead
  return `${lead} Retire ${surplus} to move down.`
}

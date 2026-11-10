/**
 * What the fleet limit says to a person.
 *
 * Deliberately separate from the database's own refusal ("Your plan covers % vehicles.
 * You have %."), which is a fact stated by a trigger: it reads "covers 1 vehicles" for
 * a limit of one and offers no way out. Everything here is written for the reader.
 */

export interface VehicleLimitStatus {
  /** null means no limit; the counter is hidden and nothing is ever said. */
  limit: number | null
  count: number
  /** The lowercase key stored in plan_vehicle_limits, or null without a plan. */
  tier: string | null
}

export type TierKey = 'starter' | 'pro' | 'business'

interface Tier {
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

export interface VehicleLimitCopy {
  sentence: string
  /**
   * The one way out the screen offers beside the sentence: 'upgrade' is the
   * Billing link (owner only), 'contact' is a mail link to support for the cases
   * no tier covers, null is no action.
   */
  action: 'upgrade' | 'contact' | null
  showUpgradeButton: boolean
}

/**
 * The sentence shown when the fleet has reached its limit, or null while it has
 * not (below the limit the screen says nothing; only the counter shows).
 *
 * `showUpgradeButton` is `canManageBilling` and nothing else, and only where a
 * higher tier exists to upgrade to. The caller reads it from
 * usePermission('billing.manage'); this function never decides permissions.
 */
export function vehicleLimitCopy(
  status: VehicleLimitStatus,
  canManageBilling: boolean,
): VehicleLimitCopy | null {
  const { limit, count, tier } = status
  if (limit === null || count < limit) return null

  const index = VEHICLE_TIERS.findIndex((candidate) => candidate.key === tier)
  const current = index >= 0 ? VEHICLE_TIERS[index] : undefined

  // An agency-specific limit, or a plan this screen does not know: the tier's
  // name and number would not describe what the agency actually has.
  if (!current || current.limit !== limit) {
    return {
      sentence: `Your agency's limit is ${vehicles(limit)}. You have ${count}. Retire one you no longer rent, or contact us to raise it.`,
      action: 'contact',
      showUpgradeButton: false,
    }
  }

  const lead = `${current.label} covers ${vehicles(limit)}. You have ${count}.`
  const next = VEHICLE_TIERS[index + 1]

  if (!next) {
    return {
      sentence: `${lead} Retire one you no longer rent, or contact us about a larger fleet.`,
      action: 'contact',
      showUpgradeButton: false,
    }
  }

  return canManageBilling
    ? {
        sentence: `${lead} Upgrade to ${next.label} for ${vehicles(next.limit)}, or retire one you no longer rent.`,
        action: 'upgrade',
        showUpgradeButton: true,
      }
    : {
        sentence: `${lead} Retire one you no longer rent, or ask the owner to upgrade.`,
        action: null,
        showUpgradeButton: false,
      }
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

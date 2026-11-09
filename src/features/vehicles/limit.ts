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

interface Tier {
  key: string
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

/** The display name of a stored tier key; never the raw key. */
export function tierLabel(tier: string): string {
  const known = VEHICLE_TIERS.find((candidate) => candidate.key === tier)
  if (known) return known.label
  return tier.charAt(0).toUpperCase() + tier.slice(1)
}

function vehicles(count: number): string {
  return `${count} ${count === 1 ? 'vehicle' : 'vehicles'}`
}

export interface VehicleLimitCopy {
  sentence: string
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
      showUpgradeButton: false,
    }
  }

  const lead = `${current.label} covers ${vehicles(limit)}. You have ${count}.`
  const next = VEHICLE_TIERS[index + 1]

  if (!next) {
    return {
      sentence: `${lead} Retire one you no longer rent, or contact us about a larger fleet.`,
      showUpgradeButton: false,
    }
  }

  return canManageBilling
    ? {
        sentence: `${lead} Upgrade to ${next.label} for ${vehicles(next.limit)}, or retire one you no longer rent.`,
        showUpgradeButton: true,
      }
    : {
        sentence: `${lead} Retire one you no longer rent, or ask an owner or admin to upgrade.`,
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
  return `${tierLabel(targetTier)} covers ${vehicles(targetLimit)}. You have ${count}. Retire ${count - targetLimit} to move down.`
}

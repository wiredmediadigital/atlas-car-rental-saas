/**
 * What the fleet limit says to a person.
 *
 * Deliberately separate from the database's own refusal ("Your plan covers %
 * vehicles. You have %."), which is a fact stated by a trigger: it reads "covers
 * 1 vehicles" for a limit of one and offers no way out. Everything here is
 * written for the reader.
 *
 * The ladder itself -- the tier names, their allowances and the shape of a plan
 * key -- is a plan fact with four readers and lives in
 * `src/features/billing/tiers.ts`. This file is the sentence one page shows.
 */

import { VEHICLE_TIERS } from '@/features/billing/tiers'

export interface VehicleLimitStatus {
  /** null means no limit; the counter is hidden and nothing is ever said. */
  limit: number | null
  count: number
  /** The lowercase key stored in plan_vehicle_limits, or null without a plan. */
  tier: string | null
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

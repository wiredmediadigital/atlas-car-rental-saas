/**
 * Changing an agency's plan: the decision, separated from the transport.
 *
 * Kept out of the Deno entry point so the one rule this exists to enforce - an
 * agency may not move to a tier whose limit is below the vehicles it has - can
 * be tested against a real database instead of being asserted by inspection.
 *
 * AUTHORIZATION IS NOT HERE. The caller (the billing function) has already
 * established that the requester is an owner of this agency; nothing in this
 * module re-checks it, and nothing in this module may be reached before that.
 *
 * There is deliberately no write gate either: an agency in a restricted billing
 * state must still be able to fix its own billing, and this is how.
 */

import {
  changePlanIdempotencyKey,
  changePlanParams,
  isLiveStatus,
  type StripeSubscription,
  type SubscriptionStatus,
} from './billing-domain.ts'
import type { StripeClient } from './stripe-api.ts'

export interface TargetPlan {
  readonly stripePriceId: string
  /** The plan's authored limit; null when the plan key has none. */
  readonly vehicleLimit: number | null
  readonly tier: string | null
}

export interface EffectiveSubscription {
  readonly stripeSubscriptionId: string
  readonly status: SubscriptionStatus
}

/** What the decision needs from the database. Every answer is the server's. */
export interface PlanChangeStore {
  /** The catalogue entry for the key, or null when it is not sellable. */
  resolvePlan(planKey: string): Promise<TargetPlan | null>
  /** The agency's effective subscription, or null when it has none. */
  effectiveSubscription(organizationId: string): Promise<EffectiveSubscription | null>
  /** organizations.vehicle_limit_override. */
  vehicleLimitOverride(organizationId: string): Promise<number | null>
  /** app.vehicle_count_of. */
  vehicleCount(organizationId: string): Promise<number>
}

export type PlanChangeResult =
  | { readonly ok: true }
  | {
      readonly ok: false
      readonly category: string
      readonly message: string
      readonly status: number
    }

export interface PlanChangeInput {
  readonly organizationId: string
  readonly planKey: string
  readonly attempt: string
}

function refuse(category: string, message: string, status: number): PlanChangeResult {
  return { ok: false, category, message, status }
}

function vehicles(count: number): string {
  return `${count} ${count === 1 ? 'vehicle' : 'vehicles'}`
}

function titleCase(tier: string): string {
  return tier.charAt(0).toUpperCase() + tier.slice(1)
}

export async function changePlan(
  store: PlanChangeStore,
  stripe: Pick<StripeClient, 'request'>,
  input: PlanChangeInput,
): Promise<PlanChangeResult> {
  const { organizationId, planKey } = input

  const target = await store.resolvePlan(planKey)
  if (target === null) return refuse('plan_unavailable', 'That plan is not available.', 404)

  const subscription = await store.effectiveSubscription(organizationId)
  if (subscription === null || !isLiveStatus(subscription.status)) {
    return refuse(
      'no_subscription',
      'This agency has no active subscription to change. Choose a plan to subscribe first.',
      409,
    )
  }

  /*
   * The limit that WILL apply afterwards: the per-agency override if there is
   * one, else the target plan's authored limit - the same precedence
   * app.vehicle_limit_of uses. An agency holding an override is never refused a
   * downgrade, because the override, not the plan key, is what binds.
   */
  const override = await store.vehicleLimitOverride(organizationId)
  const limit = override ?? target.vehicleLimit
  const count = await store.vehicleCount(organizationId)
  if (limit !== null && count > limit) {
    const tier = target.tier === null ? 'chosen' : titleCase(target.tier)
    return refuse(
      'over_target_limit',
      `You have ${vehicles(count)} and the ${tier} plan covers ${limit}. ` +
        `Archive ${vehicles(count - limit)} to move to it.`,
      409,
    )
  }

  /*
   * Stripe changes a plan by updating the subscription's ITEM, and our
   * projection does not store the item id, so read it first.
   */
  const subscriptionPath = `/subscriptions/${subscription.stripeSubscriptionId}`
  const current = await stripe.request<StripeSubscription>('GET', subscriptionPath)
  const items = current.items?.data ?? []
  const item = items[0]
  if (items.length !== 1 || !item?.id) {
    return refuse('plan_change_unavailable', 'This plan cannot be changed here right now.', 409)
  }

  await stripe.request(
    'POST',
    subscriptionPath,
    changePlanParams({ itemId: item.id, priceId: target.stripePriceId, planKey }) as Record<
      string,
      never
    >,
    {
      idempotencyKey: changePlanIdempotencyKey(
        subscription.stripeSubscriptionId,
        item.price?.id ?? 'unknown',
        target.stripePriceId,
        input.attempt,
      ),
    },
  )

  return { ok: true }
}

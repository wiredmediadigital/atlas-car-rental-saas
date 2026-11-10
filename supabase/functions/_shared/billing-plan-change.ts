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
  /** Tells the operator a sold plan has no authored vehicle limit. */
  reportMissingLimit(planKey: string): Promise<void>
  /** Records who asked for the change, in the billing history. */
  noteChange(input: {
    organizationId: string
    planKey: string
    /**
     * The target plan's tier, so the note can NAME the plan. The agency reads
     * this history; a catalogue key is not a name.
     */
    tier: string | null
    subscriptionId: string
    actorUserId: string | null
  }): Promise<void>
}

export type PlanChangeResult =
  | { readonly ok: true }
  | {
      readonly ok: false
      readonly category: string
      readonly message: string
      readonly status: number
      /** Structured facts behind the refusal, for a client that words it itself. */
      readonly detail?: Readonly<Record<string, unknown>>
    }

export interface PlanChangeInput {
  readonly organizationId: string
  readonly planKey: string
  /** Who asked, for the billing history. */
  readonly actorUserId?: string
  /**
   * Optional. Absent, it defaults to the current minute, so a repeat of an earlier
   * change (A to B, back to A, to B again) is a new Stripe operation rather than
   * a replay of a cached one that would report success and change nothing.
   */
  readonly attempt?: string
}

/** The default idempotency window: long enough to absorb a double click only. */
const ATTEMPT_BUCKET_MS = 60_000

function refuse(
  category: string,
  message: string,
  status: number,
  detail?: Readonly<Record<string, unknown>>,
): PlanChangeResult {
  return detail === undefined
    ? { ok: false, category, message, status }
    : { ok: false, category, message, status, detail }
}

function vehicles(count: number): string {
  return `${count} ${count === 1 ? 'vehicle' : 'vehicles'}`
}

function titleCase(tier: string): string {
  return tier.charAt(0).toUpperCase() + tier.slice(1)
}

/**
 * The note left in the agency's billing history when a change is requested.
 *
 * `billing_events` is granted to every owner by `billing_events_select` and the
 * Billing page renders the summary verbatim, so this is copy, not a log line. A
 * plan is named by its tier; a plan with no tier is "another plan", because
 * `pro_monthly` is a catalogue key and the product never prints one at a reader.
 */
export function planChangeNote(tier: string | null): string {
  const named = tier === null ? 'another plan' : `the ${titleCase(tier)} plan`
  return `A change to ${named} was requested.`
}

export async function changePlan(
  store: PlanChangeStore,
  stripe: Pick<StripeClient, 'request'>,
  input: PlanChangeInput,
): Promise<PlanChangeResult> {
  const { organizationId, planKey } = input

  const target = await store.resolvePlan(planKey)
  if (target === null) return refuse('plan_unavailable', 'That plan is not available.', 404)

  /*
   * Sold, but with no authored limit: it will be treated as unlimited. That is the
   * specified fail-open behaviour and it is not changed here; the operator is told.
   */
  if (target.vehicleLimit === null) await store.reportMissingLimit(planKey)

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
      // The numbers actually compared: the effective limit (override first), the
      // count read, and the target tier. The client words the sentence from these.
      { limit, count, tier: target.tier },
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
  if (items.length !== 1 || !item?.id || !item.price?.id) {
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
        item.price.id,
        target.stripePriceId,
        input.attempt ?? String(Math.floor(Date.now() / ATTEMPT_BUCKET_MS)),
      ),
    },
  )

  /*
   * The change has happened at Stripe, so a failure to note it must not be
   * reported to the owner as a failed change.
   */
  try {
    await store.noteChange({
      organizationId,
      planKey,
      tier: target.tier,
      subscriptionId: subscription.stripeSubscriptionId,
      actorUserId: input.actorUserId ?? null,
    })
  } catch {
    console.error('billing: plan change could not be noted')
  }

  return { ok: true }
}

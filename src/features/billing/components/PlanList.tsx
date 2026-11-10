import { useState } from 'react'

import { Badge, Button } from '@/components/ui'
import { hasLiveSubscription, intervalPhrase } from '@/features/billing/domain'
import { useChangePlan } from '@/features/billing/queries'
import { SUPPORT_EMAIL } from '@/features/help/constants'
import { downgradeRefusalCopy, tierKeyOfPlan, VEHICLE_TIERS } from '@/features/vehicles/limit'
import { usePermission } from '@/features/workspace/workspace-context'
import { formatMoney } from '@/lib/money/money'
import { cn } from '@/lib/utils/cn'
import type { BillingOverviewRow, BillingPlanRow } from '@/types/database'

/**
 * The plan cards, and what their button does.
 *
 * The button BRANCHES. An agency with no live subscription goes to Checkout; an
 * agency with one changes tier in place through `change_plan`. Sending a
 * subscribed agency to Checkout is refused by the server, so that path would be
 * an error dressed as a button.
 *
 * Only an owner is offered a tier change (`billing.manage`). Everyone else sees
 * the plans and no control.
 */

const SUPPORT_MESSAGE = `We can't change this plan automatically right now. Email ${SUPPORT_EMAIL} and we will do it for you.`
const NO_SUBSCRIPTION_MESSAGE =
  'There is no active subscription to change. Choose a plan to subscribe first.'
const GENERIC_MESSAGE = 'The plan could not be changed. Try again.'

type Direction = 'upgrade' | 'downgrade' | 'switch'

function tierIndex(planKey: string | null): number {
  if (!planKey) return -1
  const key = tierKeyOfPlan(planKey)
  return VEHICLE_TIERS.findIndex((tier) => tier.key === key)
}

function directionOf(currentPlanKey: string | null, targetPlanKey: string): Direction {
  const from = tierIndex(currentPlanKey)
  const to = tierIndex(targetPlanKey)
  if (from < 0 || to < 0 || from === to) return 'switch'
  return to > from ? 'upgrade' : 'downgrade'
}

const DIRECTION_LABEL: Record<Direction, string> = {
  upgrade: 'Upgrade to this plan',
  downgrade: 'Move to this plan',
  switch: 'Switch to this plan',
}

/** The sentence for a refused downgrade, from the client's own copy. */
function refusalSentence(targetPlanKey: string, vehicleCount: number): string {
  const key = tierKeyOfPlan(targetPlanKey)
  const tier = VEHICLE_TIERS.find((candidate) => candidate.key === key)
  if (!tier) return 'Your fleet is larger than that plan covers. Retire some vehicles to move down.'
  return downgradeRefusalCopy(key, tier.limit, vehicleCount)
}

interface Notice {
  readonly planKey: string
  readonly text: string
}

interface PlanCardProps {
  plan: BillingPlanRow
  locale: string
  isBusy: boolean
  isDisabled: boolean
  isCurrent: boolean
  isApplying: boolean
  /** null: no control at all (this member may not change the plan). */
  actionLabel: string | null
  notice: string | null
  onChoose: (planKey: string) => void
}

function PlanCard({
  plan,
  locale,
  isBusy,
  isDisabled,
  isCurrent,
  isApplying,
  actionLabel,
  notice,
  onChoose,
}: PlanCardProps) {
  return (
    <li className="border-line flex min-w-0 flex-col rounded-lg border p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[0.875rem] font-semibold">{plan.display_name}</p>
          {plan.description ? (
            <p className="text-ink-subtle mt-1 text-[0.75rem] leading-4">{plan.description}</p>
          ) : null}
        </div>
        {isCurrent ? <Badge tone="positive">Current</Badge> : null}
        {isApplying ? <Badge tone="neutral">Applying</Badge> : null}
      </div>

      <p className="mt-3">
        {/* The exact price Stripe charges, in the currency Stripe charges it in. */}
        <span data-numeric="" className="text-[1.125rem] font-semibold tabular-nums">
          {formatMoney(plan.amount_minor, plan.currency, { locale })}
        </span>{' '}
        <span className="text-ink-subtle text-[0.75rem]">
          {intervalPhrase(plan.billing_interval, plan.interval_count)}
        </span>
      </p>

      {actionLabel !== null ? (
        <Button
          className="mt-4"
          variant={isCurrent ? 'secondary' : 'primary'}
          disabled={isCurrent || isDisabled}
          isLoading={isBusy}
          onClick={() => onChoose(plan.plan_key)}
        >
          {actionLabel}
        </Button>
      ) : null}

      {notice ? (
        <p role="status" className="text-ink-muted mt-3 text-[0.8125rem] leading-5">
          {notice}
        </p>
      ) : null}
    </li>
  )
}

interface PlanListProps {
  plans: readonly BillingPlanRow[]
  overview: BillingOverviewRow
  locale: string
  /** The plan Checkout is being started for, if any. */
  checkoutBusyKey: string | null
  /** Checkout, for an agency with no live subscription. */
  onCheckout: (planKey: string) => void
}

export function PlanList({ plans, overview, locale, checkoutBusyKey, onCheckout }: PlanListProps) {
  const canManageBilling = usePermission('billing.manage')
  const changePlan = useChangePlan()
  const isSubscribed = hasLiveSubscription(overview)

  const [changingKey, setChangingKey] = useState<string | null>(null)
  const [requestedKey, setRequestedKey] = useState<string | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)

  /*
   * The change was accepted but the projection (written by the webhook) still
   * names the old plan. Derived on every render, so it clears by itself the
   * moment the row catches up.
   */
  const isApplying = requestedKey !== null && overview.plan_key !== requestedKey

  const choose = (planKey: string) => {
    if (!isSubscribed) {
      onCheckout(planKey)
      return
    }

    setNotice(null)
    setRequestedKey(null)
    setChangingKey(planKey)
    changePlan.mutate(planKey, {
      onSuccess: () => setRequestedKey(planKey),
      onError: (error) => {
        const code = (error as { code?: string }).code
        const text =
          code === 'over_target_limit'
            ? refusalSentence(planKey, overview.active_vehicles)
            : code === 'plan_change_unavailable'
              ? SUPPORT_MESSAGE
              : code === 'no_subscription'
                ? NO_SUBSCRIPTION_MESSAGE
                : GENERIC_MESSAGE
        setNotice({ planKey, text })
      },
      onSettled: () => setChangingKey(null),
    })
  }

  return (
    <>
      {isApplying ? (
        <p role="status" className="text-ink-muted mb-3 text-[0.8125rem] leading-5">
          Your change is being applied. This page updates as soon as our payment provider confirms
          it.
        </p>
      ) : null}
      <ul
        className={cn(
          'grid grid-cols-1 gap-3',
          plans.length > 1 ? 'sm:grid-cols-2' : 'sm:max-w-md',
        )}
      >
        {plans.map((plan) => {
          const isCurrent = plan.is_current && !isApplying
          const isBusy = isSubscribed
            ? changingKey === plan.plan_key
            : checkoutBusyKey === plan.plan_key

          return (
            <PlanCard
              key={plan.plan_key}
              plan={plan}
              locale={locale}
              isBusy={isBusy}
              isDisabled={isBusy || changingKey !== null || isApplying}
              isCurrent={isCurrent}
              isApplying={isApplying && plan.plan_key === requestedKey}
              actionLabel={
                isSubscribed
                  ? canManageBilling
                    ? isCurrent
                      ? 'Current plan'
                      : DIRECTION_LABEL[directionOf(overview.plan_key, plan.plan_key)]
                    : null
                  : isCurrent
                    ? 'Current plan'
                    : 'Choose plan'
              }
              notice={notice?.planKey === plan.plan_key ? notice.text : null}
              onChoose={choose}
            />
          )
        })}
      </ul>
    </>
  )
}

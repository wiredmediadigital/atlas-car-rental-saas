import { useEffect, useRef, useState } from 'react'

import { annualSaving, type PublicPlan, type PublicPricing } from '@/features/marketing/api'

import {
  formatPlanAmount,
  hasRenderablePricing,
  renderablePlans,
} from '@/features/marketing/renderable-pricing'

import { PrimaryCta } from './PrimaryCta'

/**
 * Price, interval and trial all come from the payload and nothing else: there
 * is no fallback figure, no "from $X" and no placeholder, because the whole
 * point of this section is that the advertised price cannot differ from the
 * charged one. When there is nothing true to say it renders nothing at all.
 *
 * The page makes the single pricing request and passes the result down, so the
 * section, its nav link and its FAQ entry share one condition.
 */
export interface PricingSectionProps {
  /** `undefined` while the request is in flight. */
  pricing: PublicPricing | undefined
}

/** Derived from what Stripe reported, never from the plan key. */
function cadence(plan: PublicPlan, form: 'price' | 'toggle'): string {
  const unit = plan.interval
  if (plan.intervalCount === 1) {
    if (form === 'price') return `per ${unit}`
    return unit === 'month' ? 'Monthly' : 'Yearly'
  }
  return `Every ${plan.intervalCount} ${unit}s`
}

function isYearly(plan: PublicPlan): boolean {
  return plan.interval === 'year' && plan.intervalCount === 1
}

/**
 * A plan's identity. `plan_key` is unique in the table (`billing_plans_key_unique`),
 * so two plans can never collide, and it does not change when a refetch reorders
 * the list. A cadence is not an identity: two plans may share one.
 */
function identity(plan: PublicPlan): string {
  return plan.planKey
}

const SECTION_ID = 'pricing'

function defaultPlan(plans: readonly PublicPlan[]): PublicPlan | undefined {
  return plans.find((p) => p.interval === 'month' && p.intervalCount === 1) ?? plans[0]
}

export function PricingSection({ pricing }: PricingSectionProps) {
  const [selected, setSelected] = useState<string | null>(null)
  const sectionRef = useRef<HTMLElement>(null)
  const hasPricing = pricing !== undefined && hasRenderablePricing(pricing)

  /*
   * The section is absent until the price list arrives, so a browser that loaded
   * `/#pricing` found no anchor and stayed at the top. Once the section exists,
   * bring it into view if the URL names it.
   */
  useEffect(() => {
    if (hasPricing && window.location.hash === `#${SECTION_ID}`) {
      sectionRef.current?.scrollIntoView()
    }
  }, [hasPricing])

  if (!pricing || !hasPricing) return null
  const plans = renderablePlans(pricing)

  const plan = plans.find((p) => identity(p) === selected) ?? defaultPlan(plans)
  if (!plan) return null

  const saving = annualSaving(plans)
  const hasChoice = plans.length > 1
  const hasTrial = pricing.trialDays > 0
  const trialLength = `${pricing.trialDays} ${pricing.trialDays === 1 ? 'day' : 'days'}`

  return (
    <section
      ref={sectionRef}
      id={SECTION_ID}
      aria-labelledby="pricing-heading"
      className="border-line border-t"
    >
      <div className="mx-auto max-w-[1220px] px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-ink-subtle text-[0.75rem] font-semibold tracking-[0.08em] uppercase">
            Pricing
          </p>
          <h2
            id="pricing-heading"
            className="text-ink mt-3 text-[1.875rem] font-semibold tracking-tight sm:text-[2.25rem]"
          >
            One plan, every module included.
          </h2>
          <p className="text-ink-muted mx-auto mt-4 max-w-md text-[0.9375rem] leading-6">
            Fleet, rentals, payments and reporting in one workspace, at one price.
          </p>
        </div>

        {hasChoice && (
          <div
            role="group"
            aria-label="Billing interval"
            className="border-line mx-auto mt-10 flex w-fit gap-1 rounded-lg border p-1"
          >
            {plans.map((option) => {
              const isSelected = identity(option) === identity(plan)
              return (
                <button
                  key={identity(option)}
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => setSelected(identity(option))}
                  className={[
                    'rounded-md px-4 py-2 text-sm font-medium transition-colors',
                    'focus-visible:outline-brand-500 focus-visible:outline-2',
                    'focus-visible:outline-offset-2',
                    isSelected ? 'bg-brand-900 text-ink-inverse' : 'text-ink-muted hover:text-ink',
                  ].join(' ')}
                >
                  {cadence(option, 'toggle')}
                  {isYearly(option) && saving !== null && ' '}
                  {isYearly(option) && saving !== null && (
                    <span className="ml-1 text-[0.75rem] font-semibold">Save {saving}%</span>
                  )}
                </button>
              )
            })}
          </div>
        )}

        <div className="border-line mx-auto mt-10 max-w-md rounded-xl border p-8 text-center">
          {hasTrial ? (
            <>
              <p className="text-ink text-[1.5rem] font-semibold tracking-tight">
                Try it free for {trialLength}.
              </p>
              <div className="mt-6 flex justify-center">
                <PrimaryCta label="Start your free trial" />
              </div>
              <p className="text-ink mt-6 flex items-baseline justify-center gap-2">
                <span className="text-ink-muted text-[0.9375rem]">Then</span>
                <span className="text-[1.25rem] font-semibold">{formatPlanAmount(plan)}</span>
                <span className="text-ink-muted text-[0.9375rem]">{cadence(plan, 'price')}</span>
              </p>
            </>
          ) : (
            <>
              <p className="text-ink flex items-baseline justify-center gap-2">
                <span className="text-[2.5rem] font-semibold tracking-tight">
                  {formatPlanAmount(plan)}
                </span>
                <span className="text-ink-muted text-[0.9375rem]">{cadence(plan, 'price')}</span>
              </p>
              <div className="mt-6 flex justify-center">
                <PrimaryCta />
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  )
}

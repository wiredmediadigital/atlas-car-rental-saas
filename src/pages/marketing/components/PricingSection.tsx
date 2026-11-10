import { useEffect, useRef, useState } from 'react'

import { SUPPORT_EMAIL } from '@/features/help/constants'
import type { PublicPlan, PublicPricing } from '@/features/marketing/api'
import {
  cadenceKey,
  commonCadences,
  formatPlanAmount,
  hasRenderablePricing,
  renderablePlans,
  tierOfPlan,
  tierSaving,
} from '@/features/marketing/renderable-pricing'
import { VEHICLE_TIERS, type TierKey } from '@/features/vehicles/limit'

import { PrimaryCta } from './PrimaryCta'

/**
 * Price, interval and trial all come from the payload and nothing else: there
 * is no fallback figure, no "from $X" and no placeholder, because the whole
 * point of this section is that the advertised price cannot differ from the
 * charged one. When there is nothing true to say it renders nothing at all.
 *
 * The tier's name and its vehicle allowance are NOT in the payload: they are
 * page copy, read from `VEHICLE_TIERS` (the constant the Vehicles and Billing
 * pages use, pinned to `plan_vehicle_limits` by a database test) and chosen by
 * the tier in the plan key. They never touch price, interval or trial. The
 * talk-to-us card is static content, not a plan: it has no price and is not
 * built from the payload.
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

const SECTION_ID = 'pricing'

function defaultCadence(plans: readonly PublicPlan[]): string | undefined {
  const plan = plans.find((p) => p.interval === 'month' && p.intervalCount === 1) ?? plans[0]
  return plan && cadenceKey(plan)
}

/** Smallest tier first, whatever order the payload arrived in. */
function tierOrder(plan: PublicPlan): number {
  const tier = tierOfPlan(plan)
  return tier ? VEHICLE_TIERS.indexOf(tier) : VEHICLE_TIERS.length
}

// Chosen by name, typed against the tier keys: renaming a key is a compile error here.
const POPULAR_TIER: TierKey = 'pro'
const LARGEST_TIER = VEHICLE_TIERS[VEHICLE_TIERS.length - 1]

interface PlanCardProps {
  plan: PublicPlan
  hasTrial: boolean
}

function PlanCard({ plan, hasTrial }: PlanCardProps) {
  const tier = tierOfPlan(plan)
  if (!tier) return null
  const isPopular = tier.key === POPULAR_TIER

  return (
    <li
      className={[
        'rounded-xl border p-6 text-center',
        isPopular ? 'border-brand-700' : 'border-line',
      ].join(' ')}
    >
      <p className="text-brand-700 h-5 text-[0.75rem] font-semibold tracking-[0.08em] uppercase">
        {isPopular && 'Most popular'}
      </p>
      <h3 className="text-ink mt-1 text-[1.25rem] font-semibold tracking-tight">{tier.label}</h3>
      <p className="text-ink-muted mt-1 text-[0.9375rem]">
        Up to {tier.limit} {tier.limit === 1 ? 'vehicle' : 'vehicles'}
      </p>
      {hasTrial ? (
        <>
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
          <p className="text-ink mt-6 flex items-baseline justify-center gap-2">
            <span className="text-[2rem] font-semibold tracking-tight">
              {formatPlanAmount(plan)}
            </span>
            <span className="text-ink-muted text-[0.9375rem]">{cadence(plan, 'price')}</span>
          </p>
          <div className="mt-6 flex justify-center">
            <PrimaryCta />
          </div>
        </>
      )}
    </li>
  )
}

/** Static: not a plan, no price, and nothing downstream should treat it as one. */
function TalkToUsCard() {
  if (!LARGEST_TIER) return null
  return (
    <li className="border-line rounded-xl border p-6 text-center">
      <p className="h-5" />
      <h3 className="text-ink mt-1 text-[1.25rem] font-semibold tracking-tight">
        More than {LARGEST_TIER.limit} vehicles
      </h3>
      <p className="text-ink-muted mt-1 text-[0.9375rem]">Tell us about your fleet.</p>
      <div className="mt-6 flex justify-center">
        <a
          href={`mailto:${SUPPORT_EMAIL}`}
          className="text-brand-700 text-sm font-medium underline underline-offset-4"
        >
          Talk to us
        </a>
      </div>
    </li>
  )
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

  const options = commonCadences(plans)
  const chosen = options.some((o) => cadenceKey(o) === selected)
    ? selected
    : defaultCadence(options)
  if (chosen === undefined) return null

  const shown = plans
    .filter((p) => cadenceKey(p) === chosen)
    .sort((x, y) => tierOrder(x) - tierOrder(y))

  const saving = tierSaving(plans)
  const hasChoice = options.length > 1
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
            Every module included. Priced by fleet size.
          </h2>
          <p className="text-ink-muted mx-auto mt-4 max-w-md text-[0.9375rem] leading-6">
            Fleet, rentals, payments and reporting in one workspace. Choose the size of your fleet.
          </p>
        </div>

        {hasChoice && (
          <div
            role="group"
            aria-label="Billing interval"
            className="border-line mx-auto mt-10 flex w-fit gap-1 rounded-lg border p-1"
          >
            {options.map((option) => {
              const isSelected = cadenceKey(option) === chosen
              return (
                <button
                  key={cadenceKey(option)}
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => setSelected(cadenceKey(option))}
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

        {hasTrial && (
          <p className="text-ink mt-10 text-center text-[1.5rem] font-semibold tracking-tight">
            Try it free for {trialLength}.
          </p>
        )}

        <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {shown.map((plan) => (
            <PlanCard key={plan.planKey} plan={plan} hasTrial={hasTrial} />
          ))}
          <TalkToUsCard />
        </ul>
      </div>
    </section>
  )
}

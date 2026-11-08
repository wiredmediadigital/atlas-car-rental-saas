import { useState } from 'react'

import { annualSaving, type PublicPlan, type PublicPricing } from '@/features/marketing/api'

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

function formatAmount(plan: PublicPlan): string | null {
  try {
    const formatter = new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: plan.currency.toUpperCase(),
    })
    const { maximumFractionDigits } = formatter.resolvedOptions()
    return formatter.format(plan.amountMinor / 10 ** (maximumFractionDigits ?? 2))
  } catch {
    // An unknown currency code: better no price than a wrong one.
    return null
  }
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

function defaultIndex(plans: readonly PublicPlan[]): number {
  const monthly = plans.findIndex((p) => p.interval === 'month' && p.intervalCount === 1)
  return monthly === -1 ? 0 : monthly
}

export function PricingSection({ pricing }: PricingSectionProps) {
  const [selected, setSelected] = useState<number | null>(null)

  if (!pricing) return null
  const plans = pricing.plans.filter((plan) => formatAmount(plan) !== null)
  if (plans.length === 0) return null

  const index = selected !== null && selected < plans.length ? selected : defaultIndex(plans)
  const plan = plans[index]
  if (!plan) return null

  const saving = annualSaving(plans)
  const hasChoice = plans.length > 1

  return (
    <section id="pricing" aria-labelledby="pricing-heading" className="border-line border-t">
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
            {plans.map((option, i) => {
              const isSelected = i === index
              return (
                <button
                  key={`${option.planKey}-${i}`}
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => setSelected(i)}
                  className={[
                    'rounded-md px-4 py-2 text-sm font-medium transition-colors',
                    'focus-visible:outline-brand-500 focus-visible:outline-2',
                    'focus-visible:outline-offset-2',
                    isSelected ? 'bg-brand-900 text-ink-inverse' : 'text-ink-muted hover:text-ink',
                  ].join(' ')}
                >
                  {cadence(option, 'toggle')}
                  {isYearly(option) && saving !== null && (
                    <span className="ml-2 text-[0.75rem] font-semibold">Save {saving}%</span>
                  )}
                </button>
              )
            })}
          </div>
        )}

        <div className="border-line mx-auto mt-10 max-w-md rounded-xl border p-8 text-center">
          <p className="text-ink flex items-baseline justify-center gap-2">
            <span className="text-[2.5rem] font-semibold tracking-tight">{formatAmount(plan)}</span>
            <span className="text-ink-muted text-[0.9375rem]">{cadence(plan, 'price')}</span>
          </p>
          {pricing.trialDays > 0 && (
            <p className="text-ink-muted mt-4 text-[0.9375rem] leading-6">
              Try it free for {pricing.trialDays} days.
            </p>
          )}
          <div className="mt-6 flex justify-center">
            <PrimaryCta />
          </div>
        </div>
      </div>
    </section>
  )
}

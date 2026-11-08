import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import { AuthContext, type AuthContextValue } from '@/features/auth/auth-context'
import type { PublicPlan, PublicPricing } from '@/features/marketing/api'

import { PricingSection } from './PricingSection'

const MONTHLY: PublicPlan = {
  planKey: 'pro_monthly',
  amountMinor: 4900,
  currency: 'usd',
  interval: 'month',
  intervalCount: 1,
}
const YEARLY: PublicPlan = {
  planKey: 'pro_yearly',
  amountMinor: 49000,
  currency: 'usd',
  interval: 'year',
  intervalCount: 1,
}

function pricing(plans: PublicPlan[], overrides: Partial<PublicPricing> = {}): PublicPricing {
  return { configured: true, plans, trialDays: 14, ...overrides }
}

const auth: AuthContextValue = {
  status: 'unauthenticated',
  session: null,
  user: null,
  isRecoverySession: false,
  signOut: () => Promise.resolve(),
}

function renderSection(value: PublicPricing | undefined) {
  return render(
    <AuthContext.Provider value={auth}>
      <MemoryRouter>
        <PricingSection pricing={value} />
      </MemoryRouter>
    </AuthContext.Provider>,
  )
}

describe('PricingSection', () => {
  it('renders nothing while loading', () => {
    const { container } = renderSection(undefined)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing when the deployment is unconfigured', () => {
    const { container } = renderSection({ configured: false, plans: [], trialDays: 0 })
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing when configured but no plan resolved', () => {
    const { container } = renderSection(pricing([]))
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing when every plan is inactive', () => {
    // The function omits inactive plans, so this arrives as an empty list.
    const { container } = renderSection(pricing([], { trialDays: 14 }))
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing when the only plan has a currency Intl rejects', () => {
    const { container } = renderSection(pricing([{ ...MONTHLY, currency: 'not-a-currency' }]))
    expect(container).toBeEmptyDOMElement()
  })

  it('never shows a currency symbol when there are no plans', () => {
    const { container } = renderSection(pricing([]))
    expect(container.textContent).not.toMatch(/[$€£]|\d/)
  })

  it('shows the monthly amount by default', () => {
    renderSection(pricing([YEARLY, MONTHLY]))
    expect(screen.getByText('$49.00')).toBeInTheDocument()
    expect(screen.queryByText('$490.00')).not.toBeInTheDocument()
    expect(screen.getByText(/per month/i)).toBeInTheDocument()
  })

  it('switches to the yearly amount', async () => {
    const user = userEvent.setup()
    renderSection(pricing([MONTHLY, YEARLY]))

    const yearly = screen.getByRole('button', { name: /yearly/i })
    expect(yearly).toHaveAttribute('aria-pressed', 'false')
    await user.click(yearly)

    expect(yearly).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /monthly/i })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    expect(screen.getByText('$490.00')).toBeInTheDocument()
    expect(screen.queryByText('$49.00')).not.toBeInTheDocument()
    expect(screen.getByText(/per year/i)).toBeInTheDocument()
  })

  it('can be operated from the keyboard', async () => {
    const user = userEvent.setup()
    renderSection(pricing([MONTHLY, YEARLY]))

    await user.tab()
    expect(screen.getByRole('button', { name: /monthly/i })).toHaveFocus()
    await user.tab()
    await user.keyboard('{Enter}')
    expect(screen.getByText('$490.00')).toBeInTheDocument()
  })

  it('shows the saving when the two prices are comparable', () => {
    renderSection(pricing([MONTHLY, YEARLY]))
    // 49 * 12 = 588; 490 is 17% less.
    expect(screen.getByText(/save 17%/i)).toBeInTheDocument()
  })

  it('hides the saving across currencies', () => {
    renderSection(pricing([MONTHLY, { ...YEARLY, currency: 'eur' }]))
    expect(screen.queryByText(/save/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/%/)).not.toBeInTheDocument()
  })

  it('hides the saving when the yearly price is not cheaper', () => {
    renderSection(pricing([MONTHLY, { ...YEARLY, amountMinor: 60000 }]))
    expect(screen.queryByText(/save/i)).not.toBeInTheDocument()
  })

  it('offers no toggle with a single plan', () => {
    renderSection(pricing([MONTHLY]))
    expect(screen.queryByRole('button', { name: /monthly|yearly/i })).not.toBeInTheDocument()
    expect(screen.getByText('$49.00')).toBeInTheDocument()
  })

  it('leads the call to action with the trial', () => {
    renderSection(pricing([MONTHLY], { trialDays: 14 }))
    expect(screen.getByText(/free for 14 days/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Start your agency' })).toBeInTheDocument()
  })

  it('drops the trial copy when no trial is configured', () => {
    renderSection(pricing([MONTHLY], { trialDays: 0 }))
    expect(screen.queryByText(/free for/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/trial/i)).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Start your agency' })).toBeInTheDocument()
  })

  it('labels the interval Stripe reported, not the one the key claims', () => {
    // A human typed "pro_yearly"; Stripe says the price recurs monthly.
    renderSection(pricing([{ ...MONTHLY, planKey: 'pro_yearly' }]))
    expect(screen.getByText(/per month/i)).toBeInTheDocument()
    expect(screen.queryByText(/per year/i)).not.toBeInTheDocument()
  })

  it('describes an unusual cadence from intervalCount', () => {
    renderSection(pricing([{ ...MONTHLY, intervalCount: 3 }]))
    expect(screen.getByText(/every 3 months/i)).toBeInTheDocument()
  })

  it('formats using the plan currency and its minor-unit exponent', () => {
    renderSection(pricing([{ ...MONTHLY, currency: 'jpy', amountMinor: 5000 }]))
    expect(screen.getByText(/5,000/)).toBeInTheDocument()
    expect(screen.queryByText(/50\.00/)).not.toBeInTheDocument()
  })

  it('carries the pricing anchor and one H2, no H1', () => {
    const { container } = renderSection(pricing([MONTHLY]))
    expect(container.querySelector('section#pricing')).not.toBeNull()
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull()
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(1)
  })
})

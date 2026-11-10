import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

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

function ui(value: PublicPricing | undefined) {
  return (
    <AuthContext.Provider value={auth}>
      <MemoryRouter>
        <PricingSection pricing={value} />
      </MemoryRouter>
    </AuthContext.Provider>
  )
}

function renderSection(value: PublicPricing | undefined) {
  return render(ui(value))
}

const SECOND_MONTHLY: PublicPlan = { ...MONTHLY, planKey: 'pro_monthly_eur', amountMinor: 5900 }

function tierPlan(tier: string, interval: 'month' | 'year', amountMinor: number): PublicPlan {
  return {
    planKey: `${tier}_${interval === 'month' ? 'monthly' : 'yearly'}`,
    amountMinor,
    currency: 'usd',
    interval,
    intervalCount: 1,
  }
}

/** Starter, Pro and Business, each monthly and yearly, in a deliberately shuffled order. */
const TIERED: PublicPlan[] = [
  tierPlan('business', 'year', 199000),
  tierPlan('pro', 'month', 11900),
  tierPlan('starter', 'year', 59000),
  tierPlan('business', 'month', 19900),
  tierPlan('starter', 'month', 5900),
  tierPlan('pro', 'year', 119000),
]

function card(name: string): HTMLElement {
  return screen.getByRole('heading', { name }).closest('li')!
}

describe('three tiers', () => {
  it('renders three tiers with their vehicle allowances', () => {
    renderSection(pricing(TIERED))

    for (const [name, allowance, price] of [
      ['Starter', 'Up to 5 vehicles', '$59.00'],
      ['Pro', 'Up to 20 vehicles', '$119.00'],
      ['Business', 'Up to 50 vehicles', '$199.00'],
    ] as const) {
      expect(within(card(name)).getByText(allowance)).toBeInTheDocument()
      expect(within(card(name)).getByText(price)).toBeInTheDocument()
    }
    // Smallest first, whatever order the payload arrived in.
    const names = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)
    expect(names.slice(0, 3)).toEqual(['Starter', 'Pro', 'Business'])
  })

  it('switches every card between monthly and yearly', async () => {
    const user = userEvent.setup()
    renderSection(pricing(TIERED))
    await user.click(screen.getByRole('button', { name: /yearly/i }))

    for (const [name, price] of [
      ['Starter', '$590.00'],
      ['Pro', '$1,190.00'],
      ['Business', '$1,990.00'],
    ] as const) {
      expect(within(card(name)).getByText(price)).toBeInTheDocument()
      expect(within(card(name)).getByText(/per year/i)).toBeInTheDocument()
    }
    expect(screen.queryByText('$59.00')).not.toBeInTheDocument()
    // One toggle for the whole section, not one per plan.
    expect(screen.getAllByRole('button', { name: /monthly|yearly/i })).toHaveLength(2)
  })

  it('marks Pro as the popular tier', () => {
    renderSection(pricing(TIERED))
    expect(within(card('Pro')).getByText('Most popular')).toBeInTheDocument()
    expect(within(card('Starter')).queryByText(/popular/i)).not.toBeInTheDocument()
    expect(within(card('Business')).queryByText(/popular/i)).not.toBeInTheDocument()
    expect(screen.getAllByText(/popular/i)).toHaveLength(1)
  })

  it('renders a talk-to-us card above 50 vehicles with no price', async () => {
    const user = userEvent.setup()
    renderSection(pricing(TIERED))

    const talk = card('More than 50 vehicles')
    const link = within(talk).getByRole('link', { name: /talk to us/i })
    expect(link).toHaveAttribute('href', 'mailto:help@pevvy.io')
    expect(talk.textContent).not.toMatch(/[$€£]|\d{2,}\.\d\d/)

    // It is not a plan: three plans, three trial buttons, and the toggle leaves it alone.
    expect(screen.getAllByRole('link', { name: 'Start your free trial' })).toHaveLength(3)
    await user.click(screen.getByRole('button', { name: /yearly/i }))
    expect(within(card('More than 50 vehicles')).getByRole('link', { name: /talk to us/i })).toBe(
      link,
    )
  })

  it('says the trial once, not once per card', () => {
    renderSection(pricing(TIERED))
    expect(screen.getAllByText(/free for 14 days/i)).toHaveLength(1)
  })

  it('advertises the smallest saving across the tiers', () => {
    // Starter saves 25%, Pro and Business 16%: the claim must hold for all three.
    renderSection(
      pricing(
        TIERED.map((p) => (p.planKey === 'starter_yearly' ? { ...p, amountMinor: 44250 } : p)),
      ),
    )
    expect(screen.getByText(/save 16%/i)).toBeInTheDocument()
    expect(screen.queryByText(/save 25%/i)).not.toBeInTheDocument()
  })

  it('advertises no saving when a tier has no yearly price to compare', () => {
    renderSection(pricing(TIERED.filter((p) => p.planKey !== 'business_yearly')))
    expect(screen.queryByText(/save/i)).not.toBeInTheDocument()
  })

  it('offers no yearly toggle when a tier has no yearly plan, and keeps all three cards', () => {
    renderSection(pricing(TIERED.filter((p) => p.planKey !== 'starter_yearly')))

    // Starter would vanish on Yearly, so Yearly is not offered at all.
    expect(screen.queryByRole('button', { name: /yearly/i })).not.toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: 'Start your free trial' })).toHaveLength(3)
    expect(within(card('Starter')).getByText('$59.00')).toBeInTheDocument()
  })

  it('still switches when every tier has both cadences, with every card kept', async () => {
    const user = userEvent.setup()
    renderSection(pricing(TIERED))
    await user.click(screen.getByRole('button', { name: /yearly/i }))
    expect(screen.getAllByRole('link', { name: 'Start your free trial' })).toHaveLength(3)
    for (const [name, price] of [
      ['Starter', '$590.00'],
      ['Pro', '$1,190.00'],
      ['Business', '$1,990.00'],
    ] as const) {
      expect(within(card(name)).getByText(price)).toBeInTheDocument()
    }
    expect(screen.queryByText('$59.00')).not.toBeInTheDocument()
  })

  it('renders nothing when no cadence covers every tier, rather than a ladder with a gap', () => {
    // Starter is monthly-only, Pro is yearly-only: any one view would drop a tier.
    const { container } = renderSection(
      pricing([tierPlan('starter', 'month', 5900), tierPlan('pro', 'year', 119000)]),
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('does not render a plan whose tier it cannot name', () => {
    renderSection(pricing([...TIERED, { ...MONTHLY, planKey: 'enterprise_monthly' }]))
    expect(screen.getAllByRole('link', { name: 'Start your free trial' })).toHaveLength(3)
    expect(screen.queryByText(/enterprise/i)).not.toBeInTheDocument()
  })

  it('renders nothing when the only plan belongs to an unknown tier', () => {
    const { container } = renderSection(pricing([{ ...MONTHLY, planKey: 'enterprise_monthly' }]))
    expect(container).toBeEmptyDOMElement()
  })
})

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
    // 49 * 12 = 588; 490 is 16.67% less, advertised as 16% (floored).
    expect(screen.getByText(/save 16%/i)).toBeInTheDocument()
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
    const lead = screen.getByText(/free for 14 days/i)
    const cta = screen.getByRole('link', { name: 'Start your free trial' })
    const price = screen.getByText('$49.00')
    expect(screen.queryByRole('link', { name: 'Start your agency' })).not.toBeInTheDocument()
    // The trial leads, the call to action follows, the price is beneath.
    expect(lead.compareDocumentPosition(cta) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(cta.compareDocumentPosition(price) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
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

  it('gives the yearly button an accessible name with the words separated', () => {
    renderSection(pricing([MONTHLY, YEARLY]))
    expect(screen.getByRole('button', { name: 'Yearly Save 16%' })).toBeInTheDocument()
  })

  it('says "1 day", not "1 days"', () => {
    renderSection(pricing([MONTHLY], { trialDays: 1 }))
    expect(screen.getByText('Try it free for 1 day.')).toBeInTheDocument()
  })

  it('keeps the selected interval when a refetch reorders the plans', async () => {
    const user = userEvent.setup()
    const { rerender } = renderSection(pricing([MONTHLY, YEARLY]))
    await user.click(screen.getByRole('button', { name: /yearly/i }))
    expect(screen.getByText('$490.00')).toBeInTheDocument()

    rerender(ui(pricing([YEARLY, MONTHLY])))
    expect(screen.getByText('$490.00')).toBeInTheDocument()
    expect(screen.getByText(/per year/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /yearly/i })).toHaveAttribute('aria-pressed', 'true')
  })

  it('falls back to a shown plan when the selected one disappears', async () => {
    const user = userEvent.setup()
    const { rerender } = renderSection(pricing([MONTHLY, YEARLY]))
    await user.click(screen.getByRole('button', { name: /yearly/i }))

    rerender(ui(pricing([MONTHLY])))
    expect(screen.getByText('$49.00')).toBeInTheDocument()
  })

  it('keeps two plans that share a tier and a cadence apart', () => {
    renderSection(pricing([MONTHLY, SECOND_MONTHLY]))

    // One toggle option for the shared cadence; both plans shown, neither swallowed.
    expect(screen.queryByRole('button', { name: /monthly|yearly/i })).not.toBeInTheDocument()
    expect(screen.getByText('$49.00')).toBeInTheDocument()
    expect(screen.getByText('$59.00')).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { name: 'Pro' })).toHaveLength(2)
  })

  describe('deep link', () => {
    // jsdom does not implement scrollIntoView, so the original is usually
    // undefined; restore exactly that rather than leave a stub on the prototype.
    const original = Element.prototype.scrollIntoView
    const proto = Element.prototype as { scrollIntoView?: Element['scrollIntoView'] }

    afterEach(() => {
      window.location.hash = ''
      if (original === undefined) delete proto.scrollIntoView
      else proto.scrollIntoView = original
    })

    it('scrolls to the section when the URL names it and prices arrive later', () => {
      const scroll = vi.fn()
      Element.prototype.scrollIntoView = scroll
      window.location.hash = '#pricing'

      const { rerender } = renderSection(undefined)
      expect(scroll).not.toHaveBeenCalled()
      rerender(ui(pricing([MONTHLY])))
      expect(scroll).toHaveBeenCalledTimes(1)
    })

    it('does not scroll when the URL names nothing', () => {
      const scroll = vi.fn()
      Element.prototype.scrollIntoView = scroll
      renderSection(pricing([MONTHLY]))
      expect(scroll).not.toHaveBeenCalled()
    })
  })
})

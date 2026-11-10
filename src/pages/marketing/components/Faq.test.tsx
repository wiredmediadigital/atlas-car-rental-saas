import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import type { PublicPricing } from '@/features/marketing/api'

import { Faq } from './Faq'

describe('the homepage FAQ', () => {
  it('shows every question without anything being clicked', () => {
    /*
     * The questions are the content. A visitor skimming for "can another
     * agency see my data" has to find it without opening six panels, and a
     * crawler has to find it without running any script at all.
     */
    render(<Faq />)
    expect(screen.getByText('Can another agency see my data?')).toBeInTheDocument()
    expect(screen.getByText('What stops the same car being booked twice?')).toBeInTheDocument()
    expect(screen.getByText('Can my staff have limited access?')).toBeInTheDocument()
  })

  it('keeps the answers in the page while they are collapsed', () => {
    // <details> leaves its content in the DOM, which is what makes the answers
    // indexable. A JavaScript accordion that unmounts them would not be.
    render(<Faq />)
    expect(screen.getByText(/enforced by the database on every single query/)).toBeInTheDocument()
  })

  it('opens an answer when its question is activated', async () => {
    const user = userEvent.setup()
    const { container } = render(<Faq />)

    const first = container.querySelector('details')
    expect(first?.open).toBe(false)

    await user.click(screen.getByText('Can another agency see my data?'))
    expect(first?.open).toBe(true)
  })

  it('does not add a second H1 to the page', () => {
    // The hero owns the only H1; this section is a sibling of the others.
    render(<Faq />)
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull()
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(
      'The questions worth asking first.',
    )
  })

  it('states no price when none is available', () => {
    // Nothing on this site states a price, and an FAQ is not the place to
    // invent one. With no pricing to point at, the FAQ stays exactly as it was.
    for (const pricing of [
      undefined,
      { configured: false, plans: [], trialDays: 0 },
      { configured: true, plans: [], trialDays: 14 },
    ] as (PublicPricing | undefined)[]) {
      const { container, unmount } = render(<Faq pricing={pricing} />)
      expect(container.textContent).not.toMatch(/\$|€|per month|free trial/i)
      expect(screen.queryByText(/what does it cost/i)).not.toBeInTheDocument()
      unmount()
    }
  })

  it('answers what it costs when prices are available, without stating any figure', () => {
    const pricing: PublicPricing = {
      configured: true,
      trialDays: 14,
      plans: [
        {
          planKey: 'starter_monthly',
          amountMinor: 4900,
          currency: 'usd',
          interval: 'month',
          intervalCount: 1,
        },
      ],
    }
    const { container } = render(<Faq pricing={pricing} />)

    expect(screen.getByText('What does it cost?')).toBeInTheDocument()
    expect(screen.getByText(/pricing section/i)).toBeInTheDocument()
    // The section carries the figures; the FAQ must not be a second source.
    expect(container.textContent).not.toMatch(/\$|€|per month|free trial|\d+[- ]day|14|49/i)
  })
})

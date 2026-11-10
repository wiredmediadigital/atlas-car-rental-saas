import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { paths } from '@/app/routes/paths'
import { AuthContext, type AuthContextValue, type AuthStatus } from '@/features/auth/auth-context'

import type { PublicPricing } from '@/features/marketing/api'
import { usePublicPricing } from '@/features/marketing/queries'

import { MarketingHomePage } from './MarketingHomePage'

// The page makes the one pricing request; the tests decide what it returns.
vi.mock('@/features/marketing/queries', () => ({ usePublicPricing: vi.fn() }))

const REAL_PRICING: PublicPricing = {
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

function givenPricing(data: PublicPricing | undefined) {
  vi.mocked(usePublicPricing).mockReturnValue({ data } as ReturnType<typeof usePublicPricing>)
}

beforeEach(() => givenPricing(undefined))

function authValue(status: AuthStatus): AuthContextValue {
  return {
    status,
    session: null,
    user: status === 'authenticated' ? ({ id: 'user-1' } as AuthContextValue['user']) : null,
    isRecoverySession: false,
    signOut: () => Promise.resolve(),
  }
}

function renderMarketingHome(status: AuthStatus = 'unauthenticated') {
  return render(
    <AuthContext.Provider value={authValue(status)}>
      <MemoryRouter initialEntries={['/']}>
        <MarketingHomePage />
      </MemoryRouter>
    </AuthContext.Provider>,
  )
}

describe('MarketingHomePage', () => {
  it('renders exactly one H1 with the hero headline', () => {
    renderMarketingHome()

    const headings = screen.getAllByRole('heading', { level: 1 })
    expect(headings).toHaveLength(1)
    expect(headings[0]).toHaveTextContent('Run your entire rental business from one place.')
  })

  it('links "Start your agency" to the real sign-up route for a signed-out visitor', () => {
    renderMarketingHome('unauthenticated')

    const ctas = screen.getAllByRole('link', { name: 'Start your agency' })
    expect(ctas.length).toBeGreaterThan(0)
    for (const cta of ctas) {
      expect(cta).toHaveAttribute('href', paths.signUp)
    }
  })

  it('links "Sign in" to the sign-in route', () => {
    renderMarketingHome()

    const signInLinks = screen.getAllByRole('link', { name: 'Sign in' })
    expect(signInLinks.length).toBeGreaterThan(0)
    for (const link of signInLinks) {
      expect(link).toHaveAttribute('href', paths.signIn)
    }
  })

  it('offers "Open dashboard" instead of running sign-up again if reached while authenticated', () => {
    // Routing does not allow this today (RequireAuth only renders this page
    // for a signed-out visitor), but the CTA stays safe if that ever changes:
    // it must never re-run sign-up and risk provisioning a second agency.
    renderMarketingHome('authenticated')

    expect(screen.queryByRole('link', { name: 'Start your agency' })).not.toBeInTheDocument()
    const dashboardLinks = screen.getAllByRole('link', { name: 'Open dashboard' })
    expect(dashboardLinks.length).toBeGreaterThan(0)
    for (const link of dashboardLinks) {
      expect(link).toHaveAttribute('href', paths.overview)
    }
  })

  it('keeps creator attribution confined to the footer', () => {
    renderMarketingHome()

    const footer = screen.getByRole('contentinfo')
    expect(within(footer).getByText(/by Adera Labs Inc/i)).toBeInTheDocument()

    const main = screen.getByRole('main')
    expect(within(main).queryByText(/Adera Labs Inc/i)).not.toBeInTheDocument()
  })

  it('gives the footer a real "Create agency account" link alongside sign in', () => {
    renderMarketingHome()

    const footer = screen.getByRole('contentinfo')
    expect(within(footer).getByRole('link', { name: 'Create agency account' })).toHaveAttribute(
      'href',
      paths.signUp,
    )
  })

  describe('pricing', () => {
    const faqQuestion = /what does it cost/i

    it('offers no Pricing link, section or FAQ entry when there is no price to show', () => {
      for (const data of [
        undefined,
        { configured: false, plans: [], trialDays: 0 },
        { configured: true, plans: [], trialDays: 14 },
        {
          configured: true,
          trialDays: 0,
          plans: [
            {
              planKey: 'starter_monthly',
              amountMinor: 100,
              currency: 'zzz1',
              interval: 'month',
              intervalCount: 1,
            },
          ],
        },
      ] as (PublicPricing | undefined)[]) {
        givenPricing(data)
        const { container, unmount } = renderMarketingHome()
        expect(screen.queryByRole('link', { name: 'Pricing' })).not.toBeInTheDocument()
        expect(container.querySelector('#pricing')).toBeNull()
        expect(screen.queryByText(faqQuestion)).not.toBeInTheDocument()
        unmount()
      }
    })

    it('offers a Pricing link to the section, and an FAQ entry, when prices load', () => {
      givenPricing(REAL_PRICING)
      const { container } = renderMarketingHome()

      expect(container.querySelector('#pricing')).not.toBeNull()
      const links = screen.getAllByRole('link', { name: 'Pricing' })
      expect(links.length).toBeGreaterThan(0)
      for (const link of links) expect(link).toHaveAttribute('href', '#pricing')
      expect(screen.getByText(faqQuestion)).toBeInTheDocument()
    })

    it('makes a single pricing request for the whole page', () => {
      givenPricing(REAL_PRICING)
      vi.mocked(usePublicPricing).mockClear()
      renderMarketingHome()
      expect(usePublicPricing).toHaveBeenCalledTimes(1)
    })
  })
})

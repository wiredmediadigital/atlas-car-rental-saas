import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import { AuthContext, type AuthContextValue } from '@/features/auth/auth-context'

import type * as LegalConfig from './legal-config'
import { PrivacyPolicyPage } from './PrivacyPolicyPage'
import { TermsPage } from './TermsPage'

// Keeps the real implementation but makes the module spy-able, so the
// jurisdiction tests below can replace LEGAL() without the pages knowing.
vi.mock('./legal-config', async (importOriginal) => {
  const actual = await importOriginal<typeof LegalConfig>()
  return { ...actual }
})

const SIGNED_OUT: AuthContextValue = {
  status: 'unauthenticated',
  session: null,
  user: null,
  isRecoverySession: false,
  signOut: () => Promise.resolve(),
}

function renderPage(page: React.ReactElement) {
  return render(
    <AuthContext.Provider value={SIGNED_OUT}>
      <MemoryRouter>{page}</MemoryRouter>
    </AuthContext.Provider>,
  )
}

describe('Privacy policy', () => {
  it('is readable by someone who is not signed in', () => {
    renderPage(<PrivacyPolicyPage />)
    expect(screen.getByRole('heading', { level: 1, name: /privacy/i })).toBeInTheDocument()
  })

  /*
   * The distinction a template gets wrong. Pevvy is the controller of an
   * agency's own account, and the PROCESSOR of the renter data that agency
   * puts in — including licence and passport numbers. A policy that blurs the
   * two tells an agency's own customers that Pevvy decided to collect their
   * identity documents, which is not true and is not the agency's position
   * either.
   */
  it('separates what Pevvy decides from what an agency decides', () => {
    const { container } = renderPage(<PrivacyPolicyPage />)
    const text = container.textContent ?? ''
    expect(text).toMatch(/controller/i)
    expect(text).toMatch(/processor/i)
    // The apostrophe class is deliberate: the page uses a typographic ’, and a
    // test that only accepts ' would fail on correct typography.
    expect(text).toMatch(/on (the agency['’]s|their) instructions/i)
  })

  it('names every service the data actually reaches', () => {
    const { container } = renderPage(<PrivacyPolicyPage />)
    const text = container.textContent ?? ''
    for (const processor of ['Supabase', 'Stripe', 'Resend', 'Wialon']) {
      expect(text, `${processor} missing from the subprocessor list`).toContain(processor)
    }
  })

  it('says identity documents are held, because they are', () => {
    const { container } = renderPage(<PrivacyPolicyPage />)
    expect(container.textContent ?? '').toMatch(/driving licence|passport|identity document/i)
  })

  it('says card details are never stored here', () => {
    const { container } = renderPage(<PrivacyPolicyPage />)
    expect(container.textContent ?? '').toMatch(/card (details|numbers?)[^.]*never|never[^.]*card/i)
  })
})

/*
 * The contracting party is a company; the prose is about software. Collapsing
 * the two produces "Adera Labs Inc, trading as Pevvy is used by car rental
 * agencies", and worse, leaves a reader unable to tell who they are actually
 * agreeing with.
 */
describe('Who the agreement is with', () => {
  it('names the operating company on the privacy policy', async () => {
    const { entityName } = (await import('./legal-config')).LEGAL()
    const { container } = renderPage(<PrivacyPolicyPage />)
    expect(container.textContent ?? '').toContain(entityName)
  })

  it('names the contracting company on the terms', async () => {
    const { entityName } = (await import('./legal-config')).LEGAL()
    const { container } = renderPage(<TermsPage />)
    expect(container.textContent ?? '').toContain(entityName)
  })
})

describe('Finding them', () => {
  /*
   * A policy nobody can reach is the same as no policy. The footer is the
   * conventional place to look, and a payment provider's review looks there.
   */
  it('links to both documents from the footer', () => {
    renderPage(<PrivacyPolicyPage />)
    const footer = screen.getByRole('contentinfo')
    expect(within(footer).getByRole('link', { name: /privacy/i })).toHaveAttribute(
      'href',
      '/privacy',
    )
    expect(within(footer).getByRole('link', { name: /terms/i })).toHaveAttribute('href', '/terms')
  })
})

describe('Terms', () => {
  it('is readable by someone who is not signed in', () => {
    renderPage(<TermsPage />)
    expect(screen.getByRole('heading', { level: 1, name: /terms/i })).toBeInTheDocument()
  })

  it('says an agency keeps and can export its own data', () => {
    const { container } = renderPage(<TermsPage />)
    const text = container.textContent ?? ''
    expect(text).toMatch(/export/i)
    expect(text).toMatch(/your data|the agency's data|belongs to/i)
  })

  it('covers cancelling a subscription', () => {
    const { container } = renderPage(<TermsPage />)
    expect(container.textContent ?? '').toMatch(/cancel/i)
  })

  it('does not promise that restoring brings writes back unconditionally', () => {
    /*
     * The Terms said restoring brought the account back "and everything is as
     * it was". The operator email says to cancel the Stripe subscription now,
     * so if the operator did as instructed, restoring returns the agency to
     * billing-restricted read-only: the write gate needs billing unrestricted
     * AND closure open. The spec asks for exactly the opposite of the old
     * sentence -- "the interface must say so rather than imply restoring brings
     * writes back".
     */
    const text = renderPage(<TermsPage />).container.textContent ?? ''
    expect(text).not.toMatch(/everything is as it was/i)
    expect(text).toMatch(/if (its|the) subscription is still active/i)
    expect(text).toMatch(/start(ed)? again|restart/i)
  })

  it('does not promise deletion exactly at the end of the grace period', () => {
    /*
     * Three things hold a purge past day 30 by design: an uncancelled
     * subscription (organization_claim_purge refuses), an unset
     * CLOSURE_OPERATOR_EMAIL (nothing prompts the cancellation), and GitHub
     * disabling the schedule after 60 days without repository activity.
     */
    const text = renderPage(<TermsPage />).container.textContent ?? ''
    expect(text).toMatch(/after the end of the 30-day grace period/i)
  })
})

/*
 * The governing-law jurisdiction is a fact only the operator has. Printing a
 * bracketed placeholder on a live page is worse than saying nothing: it reads
 * as unfinished to a customer and as unenforceable to a lawyer. So the clause
 * is absent until a jurisdiction is configured, and these tests pin both
 * halves of that.
 */
describe('The jurisdiction gap', () => {
  it('omits the governing-law clause while no jurisdiction is set', async () => {
    const config = await import('./legal-config')
    vi.spyOn(config, 'LEGAL').mockReturnValue({ ...config.LEGAL(), governingLaw: null })

    const { container } = renderPage(<TermsPage />)
    expect(container.textContent ?? '').not.toMatch(/governing law/i)
  })

  it('states the governing law once a jurisdiction is set', async () => {
    const config = await import('./legal-config')
    vi.spyOn(config, 'LEGAL').mockReturnValue({
      ...config.LEGAL(),
      governingLaw: 'England and Wales',
    })

    const { container } = renderPage(<TermsPage />)
    const text = container.textContent ?? ''
    expect(text).toMatch(/governing law/i)
    expect(text).toContain('England and Wales')
  })

  it('never renders a bracketed placeholder on either page', () => {
    for (const page of [<PrivacyPolicyPage key="p" />, <TermsPage key="t" />]) {
      const { container, unmount } = renderPage(page)
      expect(container.textContent ?? '').not.toMatch(/\[[A-Z_ ]{3,}\]/)
      unmount()
    }
  })
})

import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import { AuthContext, type AuthContextValue } from '@/features/auth/auth-context'

import type * as LegalConfig from './legal-config'
import { PrivacyPolicyPage } from './PrivacyPolicyPage'
import { DataProcessingPage } from './DataProcessingPage'
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
  it('links to all three documents from the footer', () => {
    renderPage(<PrivacyPolicyPage />)
    const footer = screen.getByRole('contentinfo')
    expect(within(footer).getByRole('link', { name: /privacy/i })).toHaveAttribute(
      'href',
      '/privacy',
    )
    expect(within(footer).getByRole('link', { name: /terms/i })).toHaveAttribute('href', '/terms')
    expect(within(footer).getByRole('link', { name: /data processing/i })).toHaveAttribute(
      'href',
      '/data-processing',
    )
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
     * it was". An agency that has cancelled its subscription
     * (as the Terms ask it to) and then restores gets back the agency to
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

  it('says the agency cancels its own subscription, not that we do', () => {
    const text = renderPage(<TermsPage />).container.textContent ?? ''
    expect(text).toMatch(/you cancel it yourself from Manage billing/i)
    expect(text).toMatch(/after the subscription has ended and the grace period is over/i)
    expect(text).toMatch(/does not refund the remainder of a period/i)
    expect(text).not.toMatch(/we cancel it/i)
    expect(text).not.toMatch(/we have (already )?cancelled/i)
    expect(text).not.toMatch(/when we process your request/i)
  })

  it('does not promise deletion exactly at the end of the grace period', () => {
    /*
     * Three things hold a purge past day 30 by design: an uncancelled
     * subscription (organization_claim_purge refuses), an unset
     * CLOSURE_OPERATOR_EMAIL (the operator is never told which agency to look at), and GitHub
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

/*
 * The clauses below are commitments, not prose. Each one either caps what a
 * reader can claim from us, or tells them something they would otherwise
 * assume we had handled. A later edit that softens one by accident should
 * fail here rather than ship quietly.
 */
describe('Commitments the terms make', () => {
  function termsText(): string {
    const { container } = renderPage(<TermsPage />)
    return container.textContent ?? ''
  }

  it('caps our total liability at what the agency actually paid', () => {
    const text = termsText()
    expect(text).toMatch(/total liability/i)
    expect(text).toMatch(/twelve months/i)
  })

  it('keeps the liabilities that cannot lawfully be capped outside the cap', () => {
    expect(termsText()).toMatch(/personal injury[\s\S]*fraud|fraud[\s\S]*personal injury/i)
  })

  /*
   * Tracking a vehicle is tracking whoever is driving it. An agency that
   * switches GPS on could reasonably assume we had dealt with the legal side
   * of that; these say plainly that we have not, and that the data is not
   * dependable enough to accuse somebody with.
   */
  it('puts telling drivers about GPS on the agency, not on us', () => {
    const text = termsText()
    expect(text).toMatch(/location data about the person driving/i)
    expect(text).toMatch(/lawful basis/i)
  })

  it('warns that location data is sometimes wrong or missing', () => {
    expect(termsText()).toMatch(/satellite signal|mobile coverage/i)
  })

  it('carves our own failures out of the indemnity', () => {
    expect(termsText()).toMatch(/does not apply where the claim is about our own failure/i)
  })

  it('requires a second factor of everyone, and says why', () => {
    const text = termsText()
    expect(text).toMatch(/two-factor authentication/i)
    expect(text).toMatch(/required, not optional/i)
  })

  it('promises records survive non-payment', () => {
    expect(termsText()).toMatch(/not deleted for non-payment/i)
  })
})

describe('Commitments the privacy policy makes', () => {
  it('promises to tell agencies about a breach without undue delay', () => {
    const { container } = renderPage(<PrivacyPolicyPage />)
    expect(container.textContent ?? '').toMatch(/without undue\s+delay/i)
  })

  it('says the second-factor requirement is enforced by the database', () => {
    const { container } = renderPage(<PrivacyPolicyPage />)
    expect(container.textContent ?? '').toMatch(/enforced by the database/i)
  })
})

/*
 * The processor terms. An agency's own lawyer reads this one against a
 * checklist, so the tests are that checklist: each assertion stands for an
 * obligation that has to be in a processor contract for it to be worth
 * signing. A clause lost in an edit should fail here, not in a procurement
 * review.
 */
describe('Data processing terms', () => {
  function dpaText(): string {
    const { container } = renderPage(<DataProcessingPage />)
    return container.textContent ?? ''
  }

  it('is readable by someone who is not signed in', () => {
    renderPage(<DataProcessingPage />)
    expect(screen.getByRole('heading', { level: 1, name: /data processing/i })).toBeInTheDocument()
  })

  it('names which side is the controller and which the processor', () => {
    const text = dpaText()
    expect(text).toMatch(/your agency the\s+controller|agency the controller/i)
    expect(text).toMatch(/makes us your\s+processor|us your processor/i)
  })

  it('binds us to act only on the agency’s instructions', () => {
    expect(dpaText()).toMatch(/only on your instructions|only as needed to provide the product/i)
  })

  it('rules out reading, selling or training on the records', () => {
    expect(dpaText()).toMatch(/do not read your records[^.]*use them to train/i)
  })

  it('commits to telling the agency about a breach without undue delay', () => {
    expect(dpaText()).toMatch(/without undue delay after becoming aware/i)
  })

  it('promises export and deletion, and names the grace period', () => {
    const text = dpaText()
    expect(text).toMatch(/export your records at any time/i)
    expect(text).toMatch(/30-day grace period/i)
  })

  it('gives the agency a say over new sub-processors', () => {
    expect(dpaText()).toMatch(/before it starts processing your records, and you may object/i)
  })

  it('offers an audit right', () => {
    expect(dpaText()).toMatch(/you may audit us/i)
  })

  it('sends a renter’s own request back to the agency, not to us', () => {
    expect(dpaText()).toMatch(/we will not answer it ourselves/i)
  })

  /*
   * The ordering that makes the document work: a DPA that loses to the terms
   * of service on a data question is decoration.
   */
  it('says these terms win over the terms of service on personal data', () => {
    expect(dpaText()).toMatch(/conflict about personal data, these win/i)
  })
})

/*
 * A legal document is read by someone looking for one clause, and cited by
 * its number. Both need the structure to be real markup rather than visual
 * weight: a contents list that links somewhere, headings in the right order,
 * and an id on every section so a lawyer can send a colleague the clause
 * rather than the document.
 */
describe('Document structure', () => {
  for (const [name, page] of [
    ['Terms', <TermsPage key="t" />],
    ['Privacy policy', <PrivacyPolicyPage key="p" />],
    ['Data processing terms', <DataProcessingPage key="d" />],
  ] as const) {
    it(`${name}: has exactly one h1, and every section is an h2 beneath it`, () => {
      renderPage(page)
      expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
      expect(screen.getAllByRole('heading', { level: 2 }).length).toBeGreaterThan(3)
    })

    it(`${name}: every contents entry points at a section that exists`, () => {
      const { container } = renderPage(page)
      const entries = Array.from(
        container.querySelectorAll<HTMLAnchorElement>(
          'nav[aria-labelledby="contents-heading"] a[href^="#"]',
        ),
      )
      expect(entries.length).toBeGreaterThan(3)
      for (const entry of entries) {
        const id = entry.getAttribute('href')?.slice(1) ?? ''
        expect(
          container.querySelector(`section[id="${id}"]`),
          `#${id} has no section`,
        ).not.toBeNull()
      }
    })
  }

  it('does not skip from h2 to h4 where a section has parts', () => {
    renderPage(<DataProcessingPage />)
    expect(screen.getAllByRole('heading', { level: 3 }).length).toBeGreaterThan(0)
    expect(screen.queryAllByRole('heading', { level: 4 })).toHaveLength(0)
  })
})

/*
 * The refund statements appear twice: once under cancelling, once under
 * closure. They disagreed — the closure bullet read as absolute while the
 * cancelling clause carried two exceptions — and an absolute version is the
 * one a reader relies on and a court reads against the drafter.
 */
describe('The two refund statements agree', () => {
  it('states the exceptions once, and defers to them from the closure bullet', () => {
    const { container } = renderPage(<TermsPage />)
    const text = container.textContent ?? ''
    expect(text).toMatch(/unless the law requires it, or unless we have failed to provide/i)
    expect(text).toMatch(/exceptions under\s+“?Cancelling”?\s+above still apply/i)
  })

  it('never states a bare no-refund rule with no exceptions attached', () => {
    const { container } = renderPage(<TermsPage />)
    const text = (container.textContent ?? '').replace(/\s+/g, ' ')
    // The closure bullet must not end at "not refunded." without pointing somewhere.
    expect(text).not.toMatch(/not refunded\. Cancelling stops the next renewal\.\s*(What|$)/i)
  })
})

/*
 * Changing plan mid-period. The product re-prices the subscription
 * immediately and lets Stripe's default proration settle the money on the
 * next invoice — which on an annual plan is up to a year away. An agency
 * downgrading eight months into a year reasonably expects money back and
 * gets a credit instead, so the terms have to say so before they try it.
 */
describe('Changing plan mid-period', () => {
  function termsText(): string {
    return renderPage(<TermsPage />).container.textContent ?? ''
  }

  it('says the new allowance applies immediately', () => {
    expect(termsText()).toMatch(/new vehicle allowance applies straight away/i)
  })

  it('says the money is settled on the next invoice, not refunded', () => {
    const text = termsText()
    expect(text).toMatch(/settled on your next invoice/i)
    expect(text).toMatch(/credit rather than money back/i)
  })

  it('warns that on an annual plan the next invoice is months away', () => {
    expect(termsText()).toMatch(/annual plan that can be months away/i)
  })

  it('says a downgrade is refused while the fleet is too large', () => {
    const text = termsText()
    expect(text).toMatch(/downgrade is refused while your fleet is larger/i)
    expect(text).toMatch(/how many vehicles you have/i)
  })
})

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { PRODUCT_BRAND } from '@/lib/config/brand'

import { AboutSection } from './components/AboutSection'

/**
 * What the About screen is allowed to claim.
 *
 * This screen names the publisher, so it is the screen where a rebrand can
 * silently turn a true statement into a false one. It once told every agency
 * that the publisher "has no access" to their records and that the software was
 * "free to use, with every module unlocked". Both were true when the recipient
 * ran their own Supabase project and paid nothing. Neither is true of a hosted
 * service with a subscription, and the rename carried both across without
 * anybody re-reading them.
 *
 * These are assertions about claims, not about phrasing. The copy can be
 * rewritten freely; what it must not do is start promising things about access
 * to customer data or about the price again.
 */
describe('the About screen', () => {
  it('names the product, the build and the publisher', () => {
    render(<AboutSection />)

    expect(screen.getByText(/^About /)).toBeInTheDocument()
    expect(screen.getByText(__APP_VERSION__)).toBeInTheDocument()
    /*
     * getAllByText, not getByText: the publisher may legitimately be named more
     * than once on this screen, and a test that breaks when a second mention is
     * added is testing the layout rather than the claim.
     */
    expect(screen.getAllByText(new RegExp(PRODUCT_BRAND.creator)).length).toBeGreaterThan(0)
  })

  it('makes no claim about who can read the agency’s data', () => {
    render(<AboutSection />)
    const text = document.body.textContent ?? ''

    /*
     * The publisher operates the database these records live in and holds its
     * service role key. Any sentence here saying otherwise is false, and it is
     * false to the paying customer, in the product, where it reads as a
     * commitment. Data handling belongs in a privacy policy, not in chrome.
     */
    expect(text).not.toMatch(/no access/i)
    expect(text).not.toMatch(/cannot (?:see|read|access)/i)
    expect(text).not.toMatch(/we (?:never|do not) (?:see|read|access|store)/i)
  })

  it('does not call the product free', () => {
    render(<AboutSection />)
    const text = document.body.textContent ?? ''

    // There is a trial and there are paid plans. "Free to use" stopped being
    // true the day billing shipped.
    expect(text).not.toMatch(/free to use/i)
    expect(text).not.toMatch(/every module unlocked/i)
  })
})

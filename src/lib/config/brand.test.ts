import { describe, expect, it } from 'vitest'

import { PRODUCT_BRAND } from './brand'

/**
 * The three identities, and the line between them.
 *
 * This file exists because the rule is easy to state and easy to erode: the
 * product is Pevvy, the publisher is Adera Labs Inc, and the agency is whoever
 * signed in. Only the third ever reaches a renter. A future change that renames
 * the product to the publisher, or quietly drops the attribution, should fail
 * here rather than in somebody's contract.
 */
describe('the product brand', () => {
  it('keeps Pevvy as the product and Adera Labs Inc as the publisher', () => {
    expect(PRODUCT_BRAND.name).toBe('Pevvy')
    expect(PRODUCT_BRAND.creator).toBe('Adera Labs Inc')
    expect(PRODUCT_BRAND.fullName).toBe('Pevvy — Car Rental Management SaaS')
    expect(PRODUCT_BRAND.fullNameWithCreator).toBe(
      'Pevvy — Car Rental Management SaaS by Adera Labs Inc',
    )
  })

  it('never folds the publisher into the product name', () => {
    // The names the product must not drift into.
    for (const wrong of [
      'Adera Labs Inc Rental Manager',
      'Adera Labs Inc SaaS',
      'Adera Labs Inc Fleet Manager',
    ]) {
      expect(PRODUCT_BRAND.name).not.toBe(wrong)
      expect(PRODUCT_BRAND.fullName).not.toBe(wrong)
    }
    // The product name stands alone: the credit is a separate field.
    expect(PRODUCT_BRAND.name).not.toContain(PRODUCT_BRAND.creator)
    expect(PRODUCT_BRAND.fullName).not.toContain(PRODUCT_BRAND.creator)
  })

  it('states the credit as an attribution rather than an owner', () => {
    expect(PRODUCT_BRAND.attribution).toBe('by Adera Labs Inc')
    expect(PRODUCT_BRAND.fullNameWithCreator).toContain(PRODUCT_BRAND.fullName)
    expect(PRODUCT_BRAND.fullNameWithCreator).toContain(PRODUCT_BRAND.attribution)
  })

  /*
   * The publisher has no website yet, and the credit has to survive that.
   *
   * This asserts the RULE rather than a hostname: either there is nowhere to
   * send anybody, which is `null` and renders as plain text, or there is a real
   * https address. What it refuses is the state in between — an empty string or
   * a bare hostname, which `CreatorCredit` would turn into a link that quietly
   * reloads the current page.
   */
  it('either has no publisher home, or a real https one', () => {
    if (PRODUCT_BRAND.creatorUrl === null) {
      expect(PRODUCT_BRAND.creatorUrl).toBeNull()
      return
    }

    expect(PRODUCT_BRAND.creatorUrl).not.toBe('')
    const url = new URL(PRODUCT_BRAND.creatorUrl)
    expect(url.protocol).toBe('https:')
    expect(url.hostname).not.toBe('')
  })
})

import { describe, expect, it } from 'vitest'

import { PRODUCT_BRAND } from '../config/brand'

import { clientInfoHeader } from './client'

describe('how the app identifies itself to Supabase', () => {
  it('names the product that is actually shipping', () => {
    expect(clientInfoHeader()).toBe('pevvy-web')
  })

  it('follows a rename instead of outliving one', () => {
    // The literal this replaced said "atlas-web" long after the product
    // stopped being called that, which is how the report filenames went
    // stale too.
    expect(clientInfoHeader()).toContain(PRODUCT_BRAND.name.toLowerCase())
    expect(clientInfoHeader()).not.toContain('atlas')
  })

  it('is a valid header value whatever the product is called', () => {
    // A header value must be an HTTP token: no spaces, no punctuation a
    // proxy could choke on. Product names are free text.
    expect(clientInfoHeader()).toMatch(/^[a-z0-9-]+$/)
  })
})

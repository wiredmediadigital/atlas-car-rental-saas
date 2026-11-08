// @vitest-environment node
/**
 * The skip rules of the catalogue refresh, which no test could reach while the
 * function lived in an Edge Function entrypoint.
 *
 * Every rule here protects a sale: a price that is archived, from the other
 * Stripe mode, not recurring, or without an amount must never reach
 * billing_plans, because the Billing page and the public pricing section sell
 * whatever that table holds.
 */
import { describe, expect, it } from 'vitest'

import {
  priceToPlanRow,
  refreshCatalogue,
  type CatalogueStore,
  type StripePriceShape,
} from '../functions/_shared/billing-catalogue.ts'

/** A sellable test-mode monthly price; each test overrides only what it is about. */
function price(overrides: Partial<StripePriceShape> = {}): StripePriceShape {
  return {
    id: 'price_1',
    active: true,
    currency: 'usd',
    unit_amount: 4900,
    livemode: false,
    lookup_key: 'pro_monthly',
    product: 'prod_1',
    nickname: 'Pro',
    recurring: { interval: 'month', interval_count: 1 },
    ...overrides,
  }
}

describe('priceToPlanRow', () => {
  it('maps a sellable price to a plan row', () => {
    expect(priceToPlanRow(price(), 'pro_monthly', 3, 'test')).toEqual({
      plan_key: 'pro_monthly',
      display_name: 'Pro',
      stripe_price_id: 'price_1',
      stripe_product_id: 'prod_1',
      lookup_key: 'pro_monthly',
      currency: 'USD',
      amount_minor: 4900,
      interval: 'month',
      interval_count: 1,
      mode: 'test',
      sort_order: 3,
    })
  })

  it('skips an archived price', () => {
    expect(priceToPlanRow(price({ active: false }), 'pro_monthly', 0, 'test')).toBeNull()
  })

  it('skips a price from the other Stripe mode', () => {
    expect(priceToPlanRow(price({ livemode: true }), 'pro_monthly', 0, 'test')).toBeNull()
    expect(priceToPlanRow(price({ livemode: false }), 'pro_monthly', 0, 'live')).toBeNull()
  })

  it('skips a one-off price with no recurring interval', () => {
    expect(priceToPlanRow(price({ recurring: null }), 'pro_monthly', 0, 'test')).toBeNull()
  })

  it('skips a price with no unit amount', () => {
    expect(priceToPlanRow(price({ unit_amount: null }), 'pro_monthly', 0, 'test')).toBeNull()
  })

  it('falls back to the plan key when the nickname is empty', () => {
    expect(priceToPlanRow(price({ nickname: '  ' }), 'pro_monthly', 0, 'test')?.display_name).toBe(
      'pro_monthly',
    )
  })

  it('falls back to the plan key when the nickname exceeds 80 characters', () => {
    const row = priceToPlanRow(price({ nickname: 'x'.repeat(81) }), 'pro_monthly', 0, 'test')
    expect(row?.display_name).toBe('pro_monthly')
  })

  it('upper-cases the currency', () => {
    expect(priceToPlanRow(price({ currency: 'usd' }), 'pro_monthly', 0, 'test')?.currency).toBe(
      'USD',
    )
  })

  it('defaults interval_count to 1 when Stripe omits it', () => {
    const row = priceToPlanRow(price({ recurring: { interval: 'year' } }), 'pro_yearly', 0, 'test')
    expect(row?.interval_count).toBe(1)
  })
})

describe('priceToPlanRow: cadences the table cannot hold', () => {
  it('writes a weekly price, which billing_interval allows', () => {
    const row = priceToPlanRow(
      price({ recurring: { interval: 'week', interval_count: 1 } }),
      'weekly',
      0,
      'test',
    )
    expect(row?.interval).toBe('week')
  })

  it('drops an interval the enum does not contain', () => {
    expect(
      priceToPlanRow(price({ recurring: { interval: 'fortnight' } }), 'x', 0, 'test'),
    ).toBeNull()
  })

  it('accepts interval_count at both ends of 1..12', () => {
    for (const count of [1, 12]) {
      const row = priceToPlanRow(
        price({ recurring: { interval: 'month', interval_count: count } }),
        'x',
        0,
        'test',
      )
      expect(row?.interval_count).toBe(count)
    }
  })

  it('drops interval_count outside 1..12, which would fail the whole insert', () => {
    for (const count of [0, 13, 26, -1, 1.5]) {
      expect(
        priceToPlanRow(
          price({ recurring: { interval: 'week', interval_count: count } }),
          'x',
          0,
          'test',
        ),
      ).toBeNull()
    }
  })
})

describe('refreshCatalogue', () => {
  function store(result: { data: unknown; error: unknown }): CatalogueStore {
    return { schema: () => ({ rpc: () => Promise.resolve(result) }) }
  }
  const stripe = {
    request: () => Promise.resolve(price()),
  } as unknown as Parameters<typeof refreshCatalogue>[1]
  const config = {
    mode: 'test',
    catalogue: [{ planKey: 'pro_monthly', priceId: 'price_1' }],
  } as unknown as Parameters<typeof refreshCatalogue>[2]

  it('returns the count the database reports', async () => {
    expect(await refreshCatalogue(store({ data: 1, error: null }), stripe, config)).toBe(1)
  })

  it('throws when the replace fails, instead of reporting success', async () => {
    await expect(
      refreshCatalogue(store({ data: null, error: { message: 'boom' } }), stripe, config),
    ).rejects.toThrow('billing_replace_catalogue failed')
  })
})

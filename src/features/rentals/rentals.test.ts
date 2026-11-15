import { describe, expect, it } from 'vitest'

import { RENTAL_DESK_VIEWS, deskViewFilter, isRentalDeskView } from './api'
import { actionState, canTransition, isTerminal, primaryAction } from './lifecycle'
import type { RentalSnapshot } from './lifecycle'
import {
  baseChargeMismatch,
  baseRentalLine,
  billableDays,
  describeDayRounding,
  formatTaxRate,
  parseKeptAmount,
  parseTaxRatePercent,
  quoteFromLines,
} from './pricing'
import type { QuoteLine } from './pricing'
import { buildRentalSchema, handoverSchema } from './schemas'

/**
 * The rental rules that live in the interface.
 *
 * Each of these has a twin in the database. The point of testing both is that
 * the two agree — a quote that disagrees with what the contract will say is
 * worse than no quote at all.
 */

const at = (iso: string) => new Date(iso)

describe('billable days', () => {
  it('charges a full day for a few hours', () => {
    expect(billableDays(at('2028-06-01T09:00:00Z'), at('2028-06-01T13:00:00Z'))).toBe(1)
  })

  it('charges one day for exactly twenty-four hours', () => {
    expect(billableDays(at('2028-06-01T09:00:00Z'), at('2028-06-02T09:00:00Z'))).toBe(1)
  })

  it('charges the started day', () => {
    expect(billableDays(at('2028-06-01T09:00:00Z'), at('2028-06-02T09:01:00Z'))).toBe(2)
  })

  it('counts a week as seven', () => {
    expect(billableDays(at('2028-06-01T09:00:00Z'), at('2028-06-08T09:00:00Z'))).toBe(7)
  })

  it('is unmoved by a daylight-saving change inside the hire', () => {
    // Europe/Paris springs forward at 02:00 on 2028-03-26. These two instants
    // are 47 hours apart however the local clock behaved in between.
    const before = at('2028-03-25T09:00:00Z')
    const after = at('2028-03-27T08:00:00Z')
    expect(billableDays(before, after)).toBe(2)
  })

  it('never returns zero for a mistyped period', () => {
    expect(billableDays(at('2028-06-02T09:00:00Z'), at('2028-06-01T09:00:00Z'))).toBe(1)
  })

  it('explains how it reached the number', () => {
    const text = describeDayRounding(at('2028-06-01T18:00:00Z'), at('2028-06-03T10:00:00Z'))
    expect(text).toContain('2 days')
    expect(text).toContain('started day')
  })
})

describe('quotes', () => {
  const line = (over: Partial<QuoteLine> = {}): QuoteLine => ({
    kind: 'other',
    description: 'Line',
    quantity: 1,
    unitAmountMinor: 0,
    amountMinor: 0,
    isTaxable: true,
    ...over,
  })

  it('separates the hire from the extras', () => {
    const quote = quoteFromLines(
      [
        baseRentalLine(3, 5000),
        line({ kind: 'child_seat', amountMinor: 3000 }),
        line({ kind: 'delivery', amountMinor: 2000 }),
      ],
      'EUR',
      0,
    )

    expect(quote.subtotalMinor).toBe(15000)
    expect(quote.extrasMinor).toBe(5000)
    expect(quote.totalMinor).toBe(20000)
  })

  it('treats a discount as a negative line and reports it positively', () => {
    const quote = quoteFromLines(
      [baseRentalLine(2, 5000), line({ kind: 'discount', amountMinor: -1500 })],
      'EUR',
      0,
    )

    expect(quote.discountMinor).toBe(1500)
    expect(quote.totalMinor).toBe(8500)
  })

  it('taxes the charges net of a taxable discount', () => {
    const quote = quoteFromLines(
      [
        baseRentalLine(3, 5000),
        line({ kind: 'child_seat', amountMinor: 3000 }),
        line({ kind: 'discount', amountMinor: -1800 }),
      ],
      'EUR',
      2000,
    )

    // 20% of (15000 + 3000 - 1800)
    expect(quote.taxMinor).toBe(3240)
    expect(quote.totalMinor).toBe(15000 + 3000 - 1800 + 3240)
  })

  it('leaves an exempt line out of the tax base', () => {
    const quote = quoteFromLines(
      [baseRentalLine(2, 5000), line({ kind: 'other', amountMinor: 5000, isTaxable: false })],
      'EUR',
      2000,
    )

    expect(quote.taxableMinor).toBe(10000)
    expect(quote.taxMinor).toBe(2000)
    expect(quote.totalMinor).toBe(17000)
  })

  it('rounds tax half-up on the minor unit', () => {
    // 7% of 7.15 is 0.5005 — half a cent up, matching Postgres round().
    const quote = quoteFromLines([baseRentalLine(1, 715)], 'EUR', 700)
    expect(quote.taxMinor).toBe(50)
  })

  it('names the days in the line it writes', () => {
    expect(baseRentalLine(1, 5000).description).toBe('1 day of hire')
    expect(baseRentalLine(4, 5000).description).toBe('4 days of hire')
    expect(baseRentalLine(4, 5000).amountMinor).toBe(20000)
  })

  it('has nothing to charge for an empty contract', () => {
    const quote = quoteFromLines([], 'EUR', 2000)
    expect(quote.totalMinor).toBe(0)
    expect(quote.taxMinor).toBe(0)
  })
})

describe('tax rates', () => {
  it('reads a rate a person typed', () => {
    expect(parseTaxRatePercent('20')).toBe(2000)
    expect(parseTaxRatePercent('20%')).toBe(2000)
    expect(parseTaxRatePercent('7,5')).toBe(750)
    expect(parseTaxRatePercent('')).toBe(0)
  })

  it('refuses a rate that cannot be one', () => {
    expect(parseTaxRatePercent('abc')).toBeNull()
    expect(parseTaxRatePercent('-5')).toBeNull()
  })

  it('writes a rate back the way it was typed', () => {
    expect(formatTaxRate(2000)).toBe('20%')
    expect(formatTaxRate(750)).toBe('7.50%')
    expect(formatTaxRate(0)).toBe('0%')
  })
})

describe('the lifecycle', () => {
  const rental = (over: Partial<RentalSnapshot> = {}): RentalSnapshot => ({
    status: 'draft',
    hasPrimaryDriver: true,
    returnedAt: null,
    depositHeldMinor: 0,
    balanceDueMinor: 0,
    ...over,
  })

  it('matches the transitions the database allows', () => {
    expect(canTransition('draft', 'reserved')).toBe(true)
    expect(canTransition('draft', 'cancelled')).toBe(true)
    expect(canTransition('reserved', 'active')).toBe(true)
    expect(canTransition('reserved', 'cancelled')).toBe(true)
    expect(canTransition('active', 'completed')).toBe(true)
  })

  it('refuses the transitions the database refuses', () => {
    expect(canTransition('draft', 'active')).toBe(false)
    expect(canTransition('draft', 'completed')).toBe(false)
    expect(canTransition('reserved', 'completed')).toBe(false)
    expect(canTransition('active', 'cancelled')).toBe(false)
    expect(canTransition('active', 'reserved')).toBe(false)
    expect(canTransition('completed', 'active')).toBe(false)
    expect(canTransition('cancelled', 'reserved')).toBe(false)
  })

  it('knows which states are the end of the line', () => {
    expect(isTerminal('completed')).toBe(true)
    expect(isTerminal('cancelled')).toBe(true)
    expect(isTerminal('active')).toBe(false)
  })

  it('will not offer to confirm a draft with no driver named', () => {
    const state = actionState('confirm', rental({ hasPrimaryDriver: false }))
    expect(state.available).toBe(false)
    expect(state.reason).toMatch(/primary driver/i)
  })

  it('will not offer to cancel a rental that is out with a customer', () => {
    const state = actionState('cancel', rental({ status: 'active' }))
    expect(state.available).toBe(false)
    expect(state.reason).toMatch(/record the return/i)
  })

  it('will not offer to complete before the return is recorded', () => {
    expect(actionState('complete', rental({ status: 'active' })).available).toBe(false)
    expect(
      actionState('complete', rental({ status: 'active', returnedAt: '2028-06-02T10:00:00Z' }))
        .available,
    ).toBe(true)
  })

  it('will not offer to complete while a deposit is held', () => {
    const state = actionState(
      'complete',
      rental({ status: 'active', returnedAt: '2028-06-02T10:00:00Z', depositHeldMinor: 20000 }),
    )
    expect(state.available).toBe(false)
    expect(state.reason).toMatch(/deposit/i)
  })

  it('will not offer to change the vehicle once it has been collected', () => {
    expect(actionState('substitute-vehicle', rental({ status: 'reserved' })).available).toBe(true)
    expect(actionState('substitute-vehicle', rental({ status: 'active' })).available).toBe(false)
  })

  it('only offers a deposit refund when one is held', () => {
    expect(actionState('refund-deposit', rental()).available).toBe(false)
    expect(actionState('refund-deposit', rental({ depositHeldMinor: 1 })).available).toBe(true)
  })

  it('suggests the next thing the desk would do', () => {
    expect(primaryAction(rental())).toBe('confirm')
    expect(primaryAction(rental({ status: 'reserved' }))).toBe('check-out')
    expect(primaryAction(rental({ status: 'active' }))).toBe('check-in')
    expect(primaryAction(rental({ status: 'active', returnedAt: '2028-06-02T10:00:00Z' }))).toBe(
      'complete',
    )
    expect(primaryAction(rental({ status: 'completed' }))).toBeNull()
  })
})

describe('the rental form', () => {
  const schema = buildRentalSchema('EUR')

  const values = {
    vehicleId: 'v1',
    customerId: 'c1',
    primaryDriverId: 'c1',
    additionalDriverIds: [] as string[],
    startsAt: '2028-06-01T09:00',
    endsAt: '2028-06-04T09:00',
    pickupLocation: 'Airport',
    returnLocation: '',
    dailyRate: '50',
    deposit: '300',
    taxRateBps: 2000,
    taxLabel: 'VAT',
    notes: '',
  }

  it('accepts a complete booking and converts the money', () => {
    const result = schema.safeParse(values)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.dailyRate).toBe(5000)
      expect(result.data.deposit).toBe(30000)
      expect(result.data.returnLocation).toBeNull()
    }
  })

  it('refuses a return before the collection', () => {
    const result = schema.safeParse({ ...values, endsAt: '2028-05-30T09:00' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.message).toMatch(/after the collection/i)
    }
  })

  it('refuses the same person as primary and additional driver', () => {
    const result = schema.safeParse({ ...values, additionalDriverIds: ['c1'] })
    expect(result.success).toBe(false)
  })

  it('refuses a driver listed twice', () => {
    const result = schema.safeParse({ ...values, additionalDriverIds: ['c2', 'c2'] })
    expect(result.success).toBe(false)
  })
})

describe('the handover form', () => {
  it('reads an odometer written with separators', () => {
    const result = handoverSchema.safeParse({
      odometer: '41 250',
      fuelPercent: '80',
      notes: '',
      at: '2028-06-01T09:00',
    })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.odometer).toBe(41250)
  })

  it('refuses fuel outside a percentage', () => {
    const result = handoverSchema.safeParse({
      odometer: '100',
      fuelPercent: '140',
      notes: '',
      at: '2028-06-01T09:00',
    })
    expect(result.success).toBe(false)
  })

  it('accepts a blank fuel reading', () => {
    const result = handoverSchema.safeParse({
      odometer: '100',
      fuelPercent: '',
      notes: '',
      at: '2028-06-01T09:00',
    })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.fuelPercent).toBeNull()
  })
})

/**
 * The desk views.
 *
 * Each one is a count on a tile and a list behind that tile, and the two were
 * once written separately: the count bounded the pick-up or return instant
 * inside the agency's day while the list asked for any contract overlapping it,
 * so "Due back today: 1" opened a page of every contract currently out. These
 * assertions pin the predicate itself, because that is the thing both consumers
 * now read.
 */
describe('desk views', () => {
  const day = { start: '2028-06-01T00:00:00.000Z', end: '2028-06-02T00:00:00.000Z' }

  it('counts a collection by when it starts, not by what it overlaps', () => {
    expect(deskViewFilter('collecting', day)).toEqual({
      statuses: ['reserved'],
      startsFrom: day.start,
      startsBefore: day.end,
    })
  })

  it('counts a return by when it ends, not by what it overlaps', () => {
    // The bug this replaces: a contract that started last week and ends next
    // week overlaps today and was listed under "due back today".
    expect(deskViewFilter('returning', day)).toEqual({
      statuses: ['active'],
      endsFrom: day.start,
      endsBefore: day.end,
    })
  })

  it('leaves overdue to the database, adding no status of its own', () => {
    expect(deskViewFilter('overdue', day)).toEqual({ overdueOnly: true })
  })

  it('owes money only where the money is owed on a real commitment', () => {
    // Drafts and cancellations can carry a balance and were being listed under
    // a count that had excluded them.
    expect(deskViewFilter('outstanding', day)).toEqual({
      statuses: ['reserved', 'active', 'completed'],
      outstandingOnly: true,
    })
    expect(deskViewFilter('outstanding', day).statuses).not.toContain('draft')
    expect(deskViewFilter('outstanding', day).statuses).not.toContain('cancelled')
  })

  it('names every view it claims to have', () => {
    expect(RENTAL_DESK_VIEWS.every(isRentalDeskView)).toBe(true)
    expect(isRentalDeskView('everything')).toBe(false)
    // A view with no definition would return undefined and filter nothing,
    // which is the one failure that would silently show the whole board.
    for (const view of RENTAL_DESK_VIEWS) {
      expect(Object.keys(deskViewFilter(view, day)).length).toBeGreaterThan(0)
    }
  })
})

describe('the base charge mismatch the interface has to show', () => {
  const line = (
    overrides: Partial<{
      kind: string
      amount_minor: number
      quantity: number
      sort_order: number
      created_at: string
    }> = {},
  ) =>
    ({
      kind: 'base_rental',
      amount_minor: 27000,
      quantity: 3,
      sort_order: 0,
      created_at: '2027-07-01T09:00:00Z',
      ...overrides,
    }) as Parameters<typeof baseChargeMismatch>[1][number]

  const booking = (
    overrides: Partial<{
      daily_rate_minor: number
      billable_days: number | null
      status: string
    }> = {},
  ) => ({
    daily_rate_minor: 9000,
    billable_days: 3,
    status: 'reserved',
    ...overrides,
  })

  it('says nothing when the charge matches the rate and the days', () => {
    expect(baseChargeMismatch(booking(), [line()])).toBeNull()
  })

  it('catches a booking shortened without repricing', () => {
    // Three days charged, two days booked.
    const found = baseChargeMismatch(booking({ billable_days: 2 }), [line()])
    expect(found).toEqual({
      expectedMinor: 18000,
      chargedMinor: 27000,
      dailyRateMinor: 9000,
      days: 2,
    })
  })

  it('catches a car swapped for a cheaper one', () => {
    const found = baseChargeMismatch(booking({ daily_rate_minor: 4000 }), [line()])
    expect(found?.expectedMinor).toBe(12000)
    expect(found?.chargedMinor).toBe(27000)
  })

  it('leaves the extension days to the extension', () => {
    /*
     * The bug this exists for, in the numbers it appeared in. Five days at
     * $102 is a base line of $510; extending by one day adds the day to
     * billable_days AND writes its own $102 line. Six days are charged, as
     * $510 + $102, and nothing is wrong.
     *
     * Measuring all six days against the $510 line reported a mismatch that
     * was not there -- and repricing on that reading wrote $612 into the base
     * line while the extension went on charging for the sixth day: $714 for a
     * six day hire.
     *
     * The version of this test that let that through set billable_days to 3
     * while holding an extension, which rental_extend cannot produce:
     * extending always raises the count.
     */
    const base = line({ amount_minor: 51000, quantity: 5 })
    const extension = line({
      amount_minor: 10200,
      quantity: 1,
      sort_order: 1,
      created_at: '2027-07-02T09:00:00Z',
    })
    const extended = booking({ daily_rate_minor: 10200, billable_days: 6 })
    expect(baseChargeMismatch(extended, [base, extension])).toBeNull()
  })

  it('still catches a cheaper car on a booking that has been extended', () => {
    // Only the base period is repriced: five days at the new rate, with the
    // extension's own charge left exactly as agreed.
    const base = line({ amount_minor: 51000, quantity: 5 })
    const extension = line({
      amount_minor: 10200,
      quantity: 1,
      sort_order: 1,
      created_at: '2027-07-02T09:00:00Z',
    })
    const found = baseChargeMismatch(booking({ daily_rate_minor: 8000, billable_days: 6 }), [
      base,
      extension,
    ])
    expect(found).toEqual({
      expectedMinor: 40000,
      chargedMinor: 51000,
      dailyRateMinor: 8000,
      days: 5,
    })
  })

  it('says nothing when extensions cover the whole hire', () => {
    // A drift no arithmetic here settles; rental_reprice refuses it outright.
    const base = line({ amount_minor: 51000, quantity: 5 })
    const extension = line({
      amount_minor: 10200,
      quantity: 6,
      sort_order: 1,
      created_at: '2027-07-02T09:00:00Z',
    })
    expect(baseChargeMismatch(booking({ billable_days: 6 }), [base, extension])).toBeNull()
  })

  it('ignores extras and discounts entirely', () => {
    const extras = [
      line(),
      line({ kind: 'child_seat', amount_minor: 1500, sort_order: 2 }),
      line({ kind: 'discount', amount_minor: -500, sort_order: 3 }),
    ]
    expect(baseChargeMismatch(booking(), extras)).toBeNull()
  })

  it('offers nothing once the customer has the car', () => {
    // What they were charged is a fact by then, not a plan.
    for (const status of ['active', 'completed', 'cancelled']) {
      expect(baseChargeMismatch(booking({ status, billable_days: 2 }), [line()])).toBeNull()
    }
  })

  it('says nothing about a booking with no days and no base charge', () => {
    expect(baseChargeMismatch(booking({ billable_days: null }), [])).toBeNull()
    expect(baseChargeMismatch(booking({ daily_rate_minor: 0 }), [])).toBeNull()
  })

  it('catches a booking that lost its base charge', () => {
    const found = baseChargeMismatch(booking(), [line({ kind: 'child_seat', amount_minor: 1500 })])
    expect(found).toEqual({ expectedMinor: 27000, chargedMinor: 0, dailyRateMinor: 9000, days: 3 })
  })
})

describe('what an agency keeps when a booking is called off', () => {
  it('reads nothing as keeping nothing', () => {
    // Most cancellations keep nothing, so the box is usually left alone.
    expect(parseKeptAmount('', 'EUR')).toBe(0)
    expect(parseKeptAmount('   ', 'EUR')).toBe(0)
  })

  it('reads an amount into minor units', () => {
    expect(parseKeptAmount('50', 'EUR')).toBe(5000)
    expect(parseKeptAmount('50.00', 'EUR')).toBe(5000)
  })

  it('refuses something that is not an amount rather than keeping nothing', () => {
    // The failure that matters: text in a field about money must not quietly
    // become a free cancellation.
    expect(parseKeptAmount('fifty', 'EUR')).toBeNull()
    expect(parseKeptAmount('--', 'EUR')).toBeNull()
  })

  it('tolerates a half-typed separator the way every other amount field does', () => {
    // parseMoneyToMinor reads a trailing separator as the end of the whole
    // part. Keeping that consistent matters more than being strict here.
    expect(parseKeptAmount('50,', 'EUR')).toBe(5000)
  })

  it('refuses a negative amount', () => {
    expect(parseKeptAmount('-50', 'EUR')).toBeNull()
  })
})

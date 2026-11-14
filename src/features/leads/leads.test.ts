import { describe, expect, it } from 'vitest'

import { overlappingLeadIds, type Lead } from './api'

let counter = 0

function lead(overrides: Partial<Lead> = {}): Lead {
  counter += 1
  return {
    id: `lead-${counter}`,
    reference: `REQ-0000000${counter}`,
    status: 'new',
    vehicleId: 'veh-1',
    vehicleLabel: 'Renault Clio',
    startsAt: '2027-05-01T09:00:00Z',
    endsAt: '2027-05-05T09:00:00Z',
    fullName: 'Someone Asking',
    email: 'asking@example.test',
    phone: null,
    note: null,
    currency: 'EUR',
    dailyRateMinor: 4500,
    billableDays: 4,
    quotedTotalMinor: 18000,
    convertedRentalId: null,
    createdAt: '2027-04-01T09:00:00Z',
    ...overrides,
  }
}

describe('flagging two people asking for the same car', () => {
  it('flags two live leads on the same vehicle with overlapping dates', () => {
    // Neither holds the car. Both look equally answerable in the queue until
    // somebody converts one and the other becomes an apology.
    const first = lead()
    const second = lead({ startsAt: '2027-05-03T09:00:00Z', endsAt: '2027-05-08T09:00:00Z' })
    expect(overlappingLeadIds([first, second])).toEqual(new Set([first.id, second.id]))
  })

  it('flags a lead wholly inside another', () => {
    const outer = lead()
    const inner = lead({ startsAt: '2027-05-02T09:00:00Z', endsAt: '2027-05-03T09:00:00Z' })
    expect(overlappingLeadIds([outer, inner])).toEqual(new Set([outer.id, inner.id]))
  })

  it('does not flag leads on the same vehicle with separate dates', () => {
    const first = lead()
    const second = lead({ startsAt: '2027-06-01T09:00:00Z', endsAt: '2027-06-04T09:00:00Z' })
    expect(overlappingLeadIds([first, second]).size).toBe(0)
  })

  it('does not flag a hire that starts exactly as another ends', () => {
    // The back-to-back booking the exclusion constraint already allows.
    const first = lead()
    const second = lead({ startsAt: '2027-05-05T09:00:00Z', endsAt: '2027-05-08T09:00:00Z' })
    expect(overlappingLeadIds([first, second]).size).toBe(0)
  })

  it('does not flag overlapping dates on different vehicles', () => {
    const first = lead()
    const second = lead({ vehicleId: 'veh-2' })
    expect(overlappingLeadIds([first, second]).size).toBe(0)
  })

  it('does not flag a converted lead against a new one', () => {
    // The converted one no longer claims the car -- a rental does, and the
    // conversion dialog re-checks that. Counting it would flag every new
    // request against its own vehicle's history.
    const converted = lead({ status: 'converted', convertedRentalId: 'rental-1' })
    const fresh = lead()
    expect(overlappingLeadIds([converted, fresh]).size).toBe(0)
  })

  it('does not flag a declined or lapsed lead', () => {
    for (const status of ['declined', 'lapsed'] as const) {
      const dead = lead({ status })
      const fresh = lead()
      expect(overlappingLeadIds([dead, fresh]).size).toBe(0)
    }
  })

  it('flags all three when three people want the same car', () => {
    const first = lead()
    const second = lead({ startsAt: '2027-05-02T09:00:00Z', endsAt: '2027-05-06T09:00:00Z' })
    const third = lead({ startsAt: '2027-05-04T09:00:00Z', endsAt: '2027-05-09T09:00:00Z' })
    expect(overlappingLeadIds([first, second, third])).toEqual(
      new Set([first.id, second.id, third.id]),
    )
  })

  it('finds nothing in an empty queue or a queue of one', () => {
    expect(overlappingLeadIds([]).size).toBe(0)
    expect(overlappingLeadIds([lead()]).size).toBe(0)
  })
})

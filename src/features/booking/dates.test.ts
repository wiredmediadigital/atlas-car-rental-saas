import { describe, expect, it } from 'vitest'

import {
  billableDays,
  defaultWindow,
  formatWindow,
  fromLocalInputValue,
  toLocalInputValue,
} from './dates'

const NOW = new Date('2027-02-01T12:00:00Z')

/** The hour a zone reads at an instant, as a visitor there would see it. */
function hourIn(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hour12: false }).format(at)
}

function dayIn(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone, day: '2-digit', month: '2-digit' }).format(at)
}

describe('the default window', () => {
  it('starts tomorrow at ten in the agency time zone', () => {
    const paris = defaultWindow('Europe/Paris', NOW)
    expect(hourIn(paris.from, 'Europe/Paris')).toBe('10')
    expect(dayIn(paris.from, 'Europe/Paris')).toBe('02/02')
  })

  it('means a different instant for agencies in different zones', () => {
    // Tomorrow is a local idea: ten in Paris and ten in Auckland are not the
    // same moment, and an agency's counter keeps its own hours.
    const paris = defaultWindow('Europe/Paris', NOW)
    const auckland = defaultWindow('Pacific/Auckland', NOW)
    expect(paris.from.toISOString()).not.toBe(auckland.from.toISOString())
    expect(hourIn(auckland.from, 'Pacific/Auckland')).toBe('10')
  })

  it('runs for three days', () => {
    const period = defaultWindow('Europe/Paris', NOW)
    expect(billableDays(period.from, period.to)).toBe(3)
  })

  it('still offers something for an agency with a nonsense time zone', () => {
    const period = defaultWindow('Not/A_Zone', NOW)
    expect(period.from.getTime()).toBeGreaterThan(NOW.getTime())
    expect(period.to.getTime()).toBeGreaterThan(period.from.getTime())
  })

  it('crosses a daylight-saving change without losing or gaining a day', () => {
    // Paris springs forward on 28 March 2027. The window either side of it is
    // still three charged days, because the count is elapsed hours, not dates.
    const beforeTheChange = new Date('2027-03-26T12:00:00Z')
    const period = defaultWindow('Europe/Paris', beforeTheChange)
    expect(hourIn(period.from, 'Europe/Paris')).toBe('10')
    expect(billableDays(period.from, period.to)).toBe(3)
  })
})

describe('billable days', () => {
  /*
   * The twin of public.rental_billable_days and of billableDays in
   * src/features/rentals/pricing.ts. Counted from elapsed time, never from
   * local dates: a hire from Friday 18:00 to Sunday 10:00 is two days in every
   * country, and subtracting local dates would make it two in one zone and
   * three in another.
   */
  it('charges a started day in full', () => {
    expect(billableDays(new Date('2027-06-01T09:00:00Z'), new Date('2027-06-01T13:00:00Z'))).toBe(1)
    expect(billableDays(new Date('2027-06-01T09:00:00Z'), new Date('2027-06-02T09:00:00Z'))).toBe(1)
    expect(billableDays(new Date('2027-06-01T09:00:00Z'), new Date('2027-06-02T09:01:00Z'))).toBe(2)
  })

  it('never charges less than one day', () => {
    expect(billableDays(new Date('2027-06-02T09:00:00Z'), new Date('2027-06-01T09:00:00Z'))).toBe(1)
  })

  it('counts a week as seven', () => {
    expect(billableDays(new Date('2027-06-01T09:00:00Z'), new Date('2027-06-08T09:00:00Z'))).toBe(7)
  })
})

describe('showing a window to a visitor', () => {
  it('reads in the agency time zone, not the visitor one', () => {
    // A visitor in another country reading their own local dates would book a
    // day either side of what they meant.
    const period = {
      from: new Date('2027-02-02T09:00:00Z'),
      to: new Date('2027-02-05T09:00:00Z'),
    }
    const paris = formatWindow(period, 'Europe/Paris')
    const auckland = formatWindow(period, 'Pacific/Auckland')
    expect(paris).not.toBe(auckland)
    expect(paris).toMatch(/2 Feb/)
    expect(auckland).toMatch(/22:00/)
  })
})

describe('the date input', () => {
  it('round-trips an instant through the agency zone', () => {
    const at = new Date('2027-02-02T09:00:00Z')
    const value = toLocalInputValue(at, 'Europe/Paris')
    expect(value).toBe('2027-02-02T10:00')
    expect(fromLocalInputValue(value, 'Europe/Paris')?.toISOString()).toBe(at.toISOString())
  })

  it('round-trips across the date line too', () => {
    const at = new Date('2027-02-02T09:00:00Z')
    const value = toLocalInputValue(at, 'Pacific/Auckland')
    expect(fromLocalInputValue(value, 'Pacific/Auckland')?.toISOString()).toBe(at.toISOString())
  })

  it('refuses a value it cannot read', () => {
    expect(fromLocalInputValue('tomorrow', 'Europe/Paris')).toBeNull()
    expect(fromLocalInputValue('', 'Europe/Paris')).toBeNull()
  })
})

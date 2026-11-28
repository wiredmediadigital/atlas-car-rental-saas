import { describe, expect, it } from 'vitest'

import { chosenOr, isUnchosen, settledDefault } from './selection-defaults'

/*
 * These cover the defaulting rule behind the three react-hooks corrections in
 * RentalNewPage and IncidentNewPage. The pages themselves have no automated
 * coverage; this is the part of them that actually changed, lifted out so the
 * behaviour can be asserted rather than carried on trust into acceptance.
 *
 * The case worth the attention is the cleared field. "The desk chose nothing"
 * and "the desk has not chosen" are different states, and conflating them is
 * what makes a cleared selection silently refill itself on the next render.
 */
describe('chosenOr', () => {
  it('offers the default while nothing has been chosen', () => {
    expect(chosenOr(undefined, () => 'the current hire')).toBe('the current hire')
  })

  it('returns a choice that was made', () => {
    expect(chosenOr('another hire', () => 'the current hire')).toBe('another hire')
  })

  it('treats an empty string as a real choice, not as absence', () => {
    // The desk cleared the box. The default must not come back.
    expect(chosenOr('', () => 'the current hire')).toBe('')
  })

  it('treats null as a real choice, not as absence', () => {
    // RentalNewPage clears the primary driver to null.
    expect(chosenOr<string | null>(null, () => 'the renter')).toBeNull()
  })

  it('does not evaluate the default when a choice was made', () => {
    let evaluated = 0
    chosenOr('picked', () => {
      evaluated += 1
      return 'default'
    })
    expect(evaluated).toBe(0)
  })

  it('evaluates the default exactly once when it applies', () => {
    let evaluated = 0
    chosenOr(undefined, () => {
      evaluated += 1
      return 'default'
    })
    expect(evaluated).toBe(1)
  })
})

describe('isUnchosen', () => {
  it('is true only for undefined', () => {
    expect(isUnchosen(undefined)).toBe(true)
    expect(isUnchosen('')).toBe(false)
    expect(isUnchosen(null)).toBe(false)
    expect(isUnchosen(0)).toBe(false)
    expect(isUnchosen(false)).toBe(false)
  })
})

describe('settledDefault', () => {
  it('offers the default once the data has arrived', () => {
    expect(settledDefault({ isPending: false, isError: false }, '', () => 'rental-1')).toBe(
      'rental-1',
    )
  })

  it('stays empty while the data is still loading', () => {
    // A blank box must not claim there is no current hire when nobody knows yet.
    expect(settledDefault({ isPending: true, isError: false }, '', () => 'rental-1')).toBe('')
  })

  it('stays empty when the query failed', () => {
    expect(settledDefault({ isPending: false, isError: true }, '', () => 'rental-1')).toBe('')
  })

  it('does not read the value while unsettled', () => {
    let read = 0
    settledDefault({ isPending: true, isError: false }, '', () => {
      read += 1
      return 'rental-1'
    })
    expect(read).toBe(0)
  })
})

describe('the two rules together, as the incident page composes them', () => {
  const resolve = (
    choice: string | undefined,
    vehicleId: string,
    rentals: { isPending: boolean; isError: boolean; current: string | null },
  ) =>
    chosenOr(choice, () =>
      vehicleId ? settledDefault(rentals, '', () => rentals.current ?? '') : '',
    )

  const loaded = (current: string | null) => ({ isPending: false, isError: false, current })

  it('offers the hire the vehicle is out on', () => {
    expect(resolve(undefined, 'vehicle-1', loaded('rental-9'))).toBe('rental-9')
  })

  it('offers nothing when the vehicle is not out', () => {
    expect(resolve(undefined, 'vehicle-1', loaded(null))).toBe('')
  })

  it('offers nothing before a vehicle is picked', () => {
    expect(resolve(undefined, '', loaded('rental-9'))).toBe('')
  })

  it('keeps a cleared hire cleared even though a default exists', () => {
    expect(resolve('', 'vehicle-1', loaded('rental-9'))).toBe('')
  })

  it('keeps an explicitly chosen hire', () => {
    expect(resolve('rental-2', 'vehicle-1', loaded('rental-9'))).toBe('rental-2')
  })

  it('waits rather than guessing while the hires are loading', () => {
    expect(resolve(undefined, 'vehicle-1', { isPending: true, isError: false, current: 'r' })).toBe(
      '',
    )
  })
})

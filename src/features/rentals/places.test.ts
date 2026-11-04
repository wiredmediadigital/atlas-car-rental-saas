import { describe, expect, it } from 'vitest'

import { agencyDesk, collectionPlace, returnPlace } from './places'

const AGENCY = { name: 'Atlas Cars', city: 'Casablanca' }

const rental = (
  over: Partial<{ pickup_location: string | null; return_location: string | null }>,
) => ({ pickup_location: null, return_location: null, ...over }) as const

describe('where a car is handed over', () => {
  it('names the agency when the rental leaves collection blank', () => {
    /*
     * The form says "Leave blank for your usual desk", and this is the only
     * thing that makes that true. It used to read as an em dash on every
     * screen, so the ordinary case looked like a missing record.
     */
    expect(collectionPlace(rental({}), AGENCY)).toBe('Atlas Cars — Casablanca')
  })

  it('prefers what the desk actually typed', () => {
    expect(collectionPlace(rental({ pickup_location: 'Terminal 1 arrivals' }), AGENCY)).toBe(
      'Terminal 1 arrivals',
    )
  })

  it('treats a box of spaces as blank', () => {
    // A field somebody tabbed through is empty, whatever it contains.
    expect(collectionPlace(rental({ pickup_location: '   ' }), AGENCY)).toBe(
      'Atlas Cars — Casablanca',
    )
  })

  it('sends the car back where it came from when return is blank', () => {
    // A one-way box left empty means "same place", not "we do not know".
    expect(returnPlace(rental({ pickup_location: 'Hotel Rif' }), AGENCY)).toBe('Hotel Rif')
  })

  it('falls all the way back to the desk when neither is recorded', () => {
    expect(returnPlace(rental({}), AGENCY)).toBe('Atlas Cars — Casablanca')
  })

  it('keeps a genuine one-way drop-off', () => {
    expect(
      returnPlace(
        rental({ pickup_location: 'Terminal 1 arrivals', return_location: 'Marrakesh office' }),
        AGENCY,
      ),
    ).toBe('Marrakesh office')
  })

  it('manages without a city, which is an optional column', () => {
    expect(agencyDesk({ name: 'Atlas Cars', city: null })).toBe('Atlas Cars')
    expect(agencyDesk({ name: 'Atlas Cars', city: '  ' })).toBe('Atlas Cars')
  })

  it('never returns an empty string for a renter to puzzle over', () => {
    // Every branch has to name somewhere. An agency always has a name.
    for (const pickup of [null, '', '  ', 'Desk']) {
      for (const ret of [null, '', '  ', 'Desk']) {
        const value = returnPlace(rental({ pickup_location: pickup, return_location: ret }), AGENCY)
        expect(value.trim().length).toBeGreaterThan(0)
      }
    }
  })
})

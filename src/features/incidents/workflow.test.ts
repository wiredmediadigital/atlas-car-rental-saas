import { describe, expect, it } from 'vitest'

import { currentCheckedOutRental } from './workflow'

const now = Date.parse('2026-11-25T12:00:00.000Z')
const rental = (overrides: Partial<{ id: string; status: string; starts_at: string; ends_at: string }> = {}) => ({
  id: 'rental-1',
  status: 'active',
  starts_at: '2026-11-25T10:00:00.000Z',
  ends_at: '2026-11-26T10:00:00.000Z',
  ...overrides,
})

describe('currentCheckedOutRental', () => {
  it('selects the one active rental currently in progress', () => {
    expect(currentCheckedOutRental([rental()], now)?.id).toBe('rental-1')
  })

  it('does not select a future reserved rental', () => {
    expect(currentCheckedOutRental([rental({ status: 'reserved', starts_at: '2026-11-26T10:00:00.000Z' })], now)).toBeNull()
  })

  it('does not guess when inconsistent data has multiple active rentals', () => {
    expect(currentCheckedOutRental([rental(), rental({ id: 'rental-2' })], now)).toBeNull()
  })
})

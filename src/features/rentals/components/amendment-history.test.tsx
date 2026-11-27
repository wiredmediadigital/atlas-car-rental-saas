import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { RentalPricingAmendment } from '@/types/database'

import { AmendmentHistory } from './AmendmentHistory'

const useRentalPricingAmendments = vi.hoisted(() => vi.fn())
vi.mock('../queries', () => ({ useRentalPricingAmendments }))

let nextId = 0
function amendment(over: Partial<RentalPricingAmendment> = {}): RentalPricingAmendment {
  nextId += 1
  const previous = over.previous_amount_minor ?? 100
  const revised = over.revised_amount_minor ?? 1_500_000
  return {
    id: `amendment-${nextId}`,
    organization_id: 'org-1',
    rental_id: 'rental-1',
    line_item_id: 'line-1',
    kind: 'reprice',
    previous_amount_minor: previous,
    revised_amount_minor: revised,
    difference_minor: revised - previous,
    currency: 'EUR',
    changes: {},
    contract_version: null,
    reason: null,
    amended_by: 'user-1',
    amended_at: '2026-11-27T10:00:00Z',
    ...over,
  }
}

function renderHistory(
  state: { data?: RentalPricingAmendment[]; isPending?: boolean; isError?: boolean } = {},
) {
  useRentalPricingAmendments.mockReturnValue({
    data: state.data ?? [],
    isPending: state.isPending ?? false,
    isError: state.isError ?? false,
  })
  return render(
    <AmendmentHistory rentalId="rental-1" currency="EUR" locale="en" timeZone="Europe/Lisbon" />,
  )
}

describe('AmendmentHistory', () => {
  it('says plainly when the hire has never been amended', () => {
    renderHistory({ data: [] })

    expect(screen.getByText(/has not been repriced or extended/i)).toBeTruthy()
  })

  it('keeps the previous amount visible beside the revised one', () => {
    /*
     * The defect this whole correction closes was that the previous amount
     * disappeared. A panel that showed only the current figure would be the
     * same bug with a nicer frame around it.
     */
    renderHistory({
      data: [amendment({ previous_amount_minor: 100, revised_amount_minor: 1_500_000 })],
    })

    expect(screen.getByText('€1.00')).toBeTruthy()
    expect(screen.getByText('€15,000.00')).toBeTruthy()
  })

  it('shows the financial difference, signed', () => {
    renderHistory({
      data: [amendment({ previous_amount_minor: 1_500_000, revised_amount_minor: 2_500_000 })],
    })

    expect(screen.getByText('+€10,000.00')).toBeTruthy()
  })

  it('shows a reduction without a plus sign', () => {
    renderHistory({
      data: [amendment({ previous_amount_minor: 2_500_000, revised_amount_minor: 1_500_000 })],
    })

    expect(screen.getByText('-€10,000.00')).toBeTruthy()
  })

  it('distinguishes an extension from a reprice', () => {
    renderHistory({
      data: [
        amendment({ kind: 'extension', reason: 'Flight delayed' }),
        amendment({ kind: 'reprice' }),
      ],
    })

    expect(screen.getByText('Extended')).toBeTruthy()
    expect(screen.getByText('Repriced')).toBeTruthy()
    expect(screen.getByText('Flight delayed')).toBeTruthy()
  })

  it('names the contract version in force, when there was one', () => {
    renderHistory({ data: [amendment({ contract_version: 2 })] })

    expect(screen.getByText(/contract version 2 was in force/i)).toBeTruthy()
  })

  it('says nothing about contracts when none had been issued', () => {
    renderHistory({ data: [amendment({ contract_version: null })] })

    expect(screen.queryByText(/contract version/i)).toBeNull()
  })

  it('lists every amendment, not only the latest', () => {
    renderHistory({
      data: [
        amendment({ reason: 'third' }),
        amendment({ reason: 'second' }),
        amendment({ reason: 'first' }),
      ],
    })

    expect(screen.getAllByRole('listitem')).toHaveLength(3)
  })

  it('reports a failed read instead of claiming there is no history', () => {
    // Zero is a claim. A rental whose history could not be read has not been
    // shown to have none.
    renderHistory({ isError: true, data: undefined })

    expect(screen.getByText(/could not be read/i)).toBeTruthy()
    expect(screen.queryByText(/has not been repriced or extended/i)).toBeNull()
  })

  it('shows a skeleton rather than an empty state while loading', () => {
    renderHistory({ isPending: true, data: undefined })

    expect(screen.queryByText(/has not been repriced or extended/i)).toBeNull()
  })

  it('stacks each record so nothing needs a sideways scroll on a phone', () => {
    const { container } = renderHistory({ data: [amendment()] })

    const row = container.querySelector('li > div')
    expect(row?.className).toContain('flex-col')
    expect(row?.className).toContain('sm:flex-row')
  })

  it('keeps the was, now and difference together in one record', () => {
    renderHistory({ data: [amendment()] })

    const item = screen.getByRole('listitem')
    expect(within(item).getByText(/^Was$/)).toBeTruthy()
    expect(within(item).getByText(/^Now$/)).toBeTruthy()
    expect(within(item).getByText(/^Difference$/)).toBeTruthy()
  })
})

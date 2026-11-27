import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { RentalLineItem } from '@/types/database'

import { ChargesPanel, type ChargesPanelProps } from './ChargesPanel'

/**
 * The screen that replaced a destructive delete.
 *
 * What is being protected here is not a button but a reading: after a charge
 * is corrected, the contract has to still say what was charged in the first
 * place. A test that only checked the new total would pass just as happily
 * against the old behaviour, which erased the line.
 */

let nextId = 0
function charge(over: Partial<RentalLineItem> = {}): RentalLineItem {
  nextId += 1
  return {
    id: `line-${nextId}`,
    organization_id: 'org-1',
    rental_id: 'rental-1',
    kind: 'cleaning',
    description: 'Valet',
    quantity: 1,
    unit_amount_minor: 10_000,
    amount_minor: 10_000,
    currency: 'EUR',
    is_taxable: true,
    sort_order: 0,
    reverses_line_item_id: null,
    reversal_reason: null,
    created_by: null,
    created_at: '2026-11-20T10:00:00Z',
    updated_at: '2026-11-20T10:00:00Z',
    ...over,
  }
}

function renderPanel(over: Partial<ChargesPanelProps> = {}) {
  const onReverse = vi.fn().mockResolvedValue(undefined)
  const onRemove = vi.fn()
  const result = render(
    <ChargesPanel
      lines={[charge()]}
      currency="EUR"
      locale="en"
      timeZone="Europe/Lisbon"
      isFinalized
      canRemove
      canReverse
      isRemoving={false}
      isReversing={false}
      onRemove={onRemove}
      onReverse={onReverse}
      {...over}
    />,
  )
  return { ...result, onReverse, onRemove }
}

describe('ChargesPanel', () => {
  it('offers no delete once the rental is committed', () => {
    renderPanel({ isFinalized: true })

    expect(screen.queryByRole('button', { name: /remove valet/i })).toBeNull()
    expect(screen.getByRole('button', { name: /reverse valet/i })).toBeTruthy()
  })

  it('still deletes outright while the rental is a draft', async () => {
    const user = userEvent.setup()
    const { onRemove } = renderPanel({ isFinalized: false })

    expect(screen.queryByRole('button', { name: /reverse valet/i })).toBeNull()
    await user.click(screen.getByRole('button', { name: /remove valet/i }))

    expect(onRemove).toHaveBeenCalledTimes(1)
  })

  it('does not offer to reverse the hire, which repricing changes', () => {
    renderPanel({
      lines: [charge({ kind: 'base_rental', description: '3 day hire' })],
    })

    expect(screen.queryByRole('button', { name: /reverse 3 day hire/i })).toBeNull()
  })

  it('withholds the reversal from staff who may not post one', () => {
    renderPanel({ canReverse: false })

    expect(screen.queryByRole('button', { name: /reverse valet/i })).toBeNull()
    expect(screen.getByText(/corrected by posting a reversal, which a manager does/i)).toBeTruthy()
  })

  it('keeps the original charge on the contract after it is reversed', () => {
    const original = charge()
    const reversal = charge({
      amount_minor: -10_000,
      unit_amount_minor: -10_000,
      description: 'Reversal of Valet',
      reverses_line_item_id: original.id,
      reversal_reason: 'The valet was not carried out.',
    })

    renderPanel({ lines: [original, reversal] })

    // Both figures, because both happened.
    expect(screen.getByText('€100.00')).toBeTruthy()
    expect(screen.getByText('-€100.00')).toBeTruthy()
    expect(screen.getByText('The valet was not carried out.')).toBeTruthy()
    expect(screen.getByText(/net effect on this contract: €0\.00/i)).toBeTruthy()
  })

  it('will not reverse a charge twice', () => {
    const original = charge()
    const reversal = charge({
      amount_minor: -10_000,
      reverses_line_item_id: original.id,
      reversal_reason: 'Charged in error.',
    })

    renderPanel({ lines: [original, reversal] })

    expect(screen.queryByRole('button', { name: /reverse valet/i })).toBeNull()
  })

  it('refuses to post a reversal with no reason', async () => {
    const user = userEvent.setup()
    const { onReverse } = renderPanel()

    await user.click(screen.getByRole('button', { name: /reverse valet/i }))
    await user.click(screen.getByRole('button', { name: /post the reversal/i }))

    expect(screen.getByText(/say why this charge is being reversed/i)).toBeTruthy()
    expect(onReverse).not.toHaveBeenCalled()
  })

  it('shows what the correction does to the money before it is posted', async () => {
    const user = userEvent.setup()
    renderPanel()

    await user.click(screen.getByRole('button', { name: /reverse valet/i }))
    const dialog = screen.getByRole('dialog')

    expect(within(dialog).getByText('€100.00')).toBeTruthy()
    expect(within(dialog).getByText('-€100.00')).toBeTruthy()
    expect(within(dialog).getByText('€0.00')).toBeTruthy()
  })

  it('posts the reversal with the reason the manager typed', async () => {
    const user = userEvent.setup()
    const { onReverse } = renderPanel()

    await user.click(screen.getByRole('button', { name: /reverse valet/i }))
    await user.type(screen.getByRole('textbox'), '  Charged in error.  ')
    await user.click(screen.getByRole('button', { name: /post the reversal/i }))

    expect(onReverse).toHaveBeenCalledWith(expect.any(String), 'Charged in error.')
  })

  it('says so when the database refuses the reversal', async () => {
    const user = userEvent.setup()
    const onReverse = vi.fn().mockRejectedValue(new Error('Only a manager may correct a charge.'))
    renderPanel({ onReverse })

    await user.click(screen.getByRole('button', { name: /reverse valet/i }))
    await user.type(screen.getByRole('textbox'), 'Charged in error.')
    await user.click(screen.getByRole('button', { name: /post the reversal/i }))

    expect(await screen.findByText(/only a manager may correct a charge/i)).toBeTruthy()
  })

  it('reports a refused delete rather than appearing to have worked', () => {
    renderPanel({ isFinalized: false, error: 'This charge is part of a committed rental.' })

    expect(screen.getByText(/this charge is part of a committed rental/i)).toBeTruthy()
  })
})

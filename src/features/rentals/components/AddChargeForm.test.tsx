import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { ADDABLE_CHARGE_KINDS, CHARGE_KIND_LABELS, CHARGE_KIND_PLACEHOLDERS } from '../pricing'

import { AddChargeForm } from './AddChargeForm'

describe('adding a charge to a contract', () => {
  it('shows an example that belongs to the kind that is selected', async () => {
    /*
     * Every kind but discount used to hint "Child seat". Having chosen
     * Cleaning, that reads as a field filled in with the wrong thing rather
     * than as an example, and the description is required — so the hint is the
     * only guidance the desk gets about what to write.
     */
    const user = userEvent.setup()
    render(<AddChargeForm currency="USD" onAdd={vi.fn()} />)

    const type = screen.getByLabelText('Type')
    const description = screen.getByLabelText('Description')

    for (const kind of ADDABLE_CHARGE_KINDS) {
      await user.selectOptions(type, kind)
      expect(description).toHaveAttribute('placeholder', CHARGE_KIND_PLACEHOLDERS[kind])
    }

    await user.selectOptions(type, 'discount')
    expect(description).toHaveAttribute('placeholder', CHARGE_KIND_PLACEHOLDERS.discount)
  })

  it('never offers an example that just repeats the name of the kind', () => {
    // An example that says "Cleaning" under a box labelled Cleaning teaches
    // nobody what the field is for.
    for (const kind of ADDABLE_CHARGE_KINDS) {
      expect(CHARGE_KIND_PLACEHOLDERS[kind].toLowerCase()).not.toBe(
        CHARGE_KIND_LABELS[kind].toLowerCase(),
      )
    }
  })

  it('keeps the example out of the charge it adds', async () => {
    // A placeholder is a hint, not a default. Submitting an empty description
    // has to be refused rather than quietly recorded as "Child seat".
    const user = userEvent.setup()
    const onAdd = vi.fn()
    render(<AddChargeForm currency="USD" onAdd={onAdd} />)

    await user.type(screen.getByLabelText('Amount'), '40.00')
    await user.click(screen.getByRole('button', { name: /Add charge/ }))

    expect(onAdd).not.toHaveBeenCalled()
    expect(screen.getByText('Say what this charge is for.')).toBeInTheDocument()
  })

  it('adds the charge the desk actually typed', async () => {
    const user = userEvent.setup()
    const onAdd = vi.fn()
    render(<AddChargeForm currency="USD" onAdd={onAdd} />)

    await user.selectOptions(screen.getByLabelText('Type'), 'cleaning')
    await user.type(screen.getByLabelText('Description'), 'Interior valet')
    await user.type(screen.getByLabelText('Amount'), '40.00')
    await user.click(screen.getByRole('button', { name: /Add charge/ }))

    expect(onAdd).toHaveBeenCalledTimes(1)
    expect(onAdd.mock.calls[0]?.[0]).toMatchObject({
      kind: 'cleaning',
      description: 'Interior valet',
      amountMinor: 4000,
    })
  })

  it('stores a discount negative while the desk types a positive amount', async () => {
    // The signed column is an implementation detail nobody at a desk should
    // have to know about.
    const user = userEvent.setup()
    const onAdd = vi.fn()
    render(<AddChargeForm currency="USD" onAdd={onAdd} />)

    await user.selectOptions(screen.getByLabelText('Type'), 'discount')
    await user.type(screen.getByLabelText('Description'), 'Returning customer')
    await user.type(screen.getByLabelText('Amount'), '25.00')
    await user.click(screen.getByRole('button', { name: /Add charge/ }))

    expect(onAdd.mock.calls[0]?.[0]).toMatchObject({ amountMinor: -2500 })
  })
})

import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { PaymentsPanel, type PaymentsPanelProps } from './PaymentsPanel'

const useRentalPayments = vi.hoisted(() => vi.fn())
const useVoidPayment = vi.hoisted(() => vi.fn())

vi.mock('../queries', () => ({ useRentalPayments, useVoidPayment }))
vi.mock('@/components/ui', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return { ...actual, useToast: () => ({ success: vi.fn(), error: vi.fn() }) }
})

function renderPanel(overrides: Partial<PaymentsPanelProps> = {}) {
  useRentalPayments.mockReturnValue({ data: [], isPending: false })
  useVoidPayment.mockReturnValue({ mutateAsync: vi.fn(), isPending: false })

  return render(
    <PaymentsPanel
      rentalId="rental-1"
      currency="EUR"
      locale="en"
      timeZone="Europe/Lisbon"
      canRecord
      canVoid
      isCancelled={false}
      onRecordCharge={vi.fn()}
      onTakeDeposit={vi.fn()}
      onRefundDeposit={vi.fn()}
      onRefund={vi.fn()}
      depositHeldMinor={0}
      depositAgreedMinor={0}
      balanceDueMinor={0}
      {...overrides}
    />,
  )
}

const button = (name: RegExp | string) => screen.queryByRole('button', { name })

beforeEach(() => {
  useRentalPayments.mockReset()
  useVoidPayment.mockReset()
})

describe('money on a booking that was called off', () => {
  it('offers to take the cancellation fee the customer owes', () => {
    /*
     * The gap this closes. Every payment control was hidden on a cancelled
     * booking, so the fee introduced in 20261115100200 was a receivable with
     * no way to settle it.
     */
    renderPanel({ isCancelled: true, balanceDueMinor: 5_000 })
    expect(button('Record payment')).toBeInTheDocument()
  })

  it('offers nothing to pay when the booking charges nothing', () => {
    renderPanel({ isCancelled: true, balanceDueMinor: 0 })
    expect(button('Record payment')).not.toBeInTheDocument()
  })

  it('never offers to take a deposit on a car that is not going anywhere', () => {
    renderPanel({ isCancelled: true, depositAgreedMinor: 30_000, depositHeldMinor: 0 })
    expect(button(/take deposit/i)).not.toBeInTheDocument()
  })

  it('still returns a deposit that is being held', () => {
    renderPanel({ isCancelled: true, depositHeldMinor: 30_000 })
    expect(button(/return deposit/i)).toBeInTheDocument()
  })

  it('offers the refund, and says how much', () => {
    // 120 taken, 50 kept as the fee, so the balance is -70.
    renderPanel({ isCancelled: true, balanceDueMinor: -7_000 })
    expect(button(/refund/i)).toHaveTextContent('€70.00')
  })

  it('offers no refund when nothing is owed back', () => {
    renderPanel({ isCancelled: true, balanceDueMinor: 5_000 })
    expect(button(/^refund/i)).not.toBeInTheDocument()
  })
})

describe('money on a booking that stands', () => {
  it('takes payment and a deposit as it always did', () => {
    renderPanel({ balanceDueMinor: 40_000, depositAgreedMinor: 30_000 })
    expect(button('Record payment')).toBeInTheDocument()
    expect(button(/take deposit/i)).toBeInTheDocument()
  })

  it('offers to refund an overpaid contract too', () => {
    // Not only cancellations: anything taken beyond what is charged.
    renderPanel({ balanceDueMinor: -2_500 })
    expect(button(/refund/i)).toHaveTextContent('€25.00')
  })

  it('shows nothing at all to somebody who may not record money', () => {
    renderPanel({ canRecord: false, balanceDueMinor: 40_000 })
    expect(button('Record payment')).not.toBeInTheDocument()
  })
})

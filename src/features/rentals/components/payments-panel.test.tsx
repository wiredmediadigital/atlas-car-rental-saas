import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Payment } from '@/types/database'

import { PaymentsPanel, type PaymentsPanelProps } from './PaymentsPanel'

const useRentalPayments = vi.hoisted(() => vi.fn())
const useVoidPayment = vi.hoisted(() => vi.fn())

vi.mock('../queries', () => ({ useRentalPayments, useVoidPayment }))
vi.mock('@/components/ui', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return { ...actual, useToast: () => ({ success: vi.fn(), error: vi.fn() }) }
})

/** One received payment, enough for the row that carries the Void control. */
function paid(amountMinor: number): Payment {
  return {
    id: 'payment-1',
    organization_id: 'org-1',
    rental_id: 'rental-1',
    customer_id: 'customer-1',
    direction: 'inbound',
    purpose: 'rental_charge',
    method: 'card',
    amount_minor: amountMinor,
    currency: 'EUR',
    paid_at: '2026-11-16T10:00:00Z',
    reference: null,
    notes: null,
    recorded_by: null,
    voided_at: null,
    voided_by: null,
    void_reason: null,
    idempotency_key: null,
    created_at: '2026-11-16T10:00:00Z',
    updated_at: '2026-11-16T10:00:00Z',
  }
}

function renderPanel(overrides: Partial<PaymentsPanelProps> & { payments?: Payment[] } = {}) {
  const { payments = [], ...props } = overrides
  useRentalPayments.mockReturnValue({ data: payments, isPending: false })
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
      onKeepOnAccount={vi.fn()}
      depositHeldMinor={0}
      depositAgreedMinor={0}
      balanceDueMinor={0}
      {...props}
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

  it('offers to keep the money on the account instead of refunding it', () => {
    // The same money going the other way: against their next hire rather than
    // out of the till. Before this, doing that meant two unrelated actions and
    // the booking went on reporting money it no longer held.
    renderPanel({ isCancelled: true, balanceDueMinor: -7_000 })
    expect(button(/keep on account/i)).toBeInTheDocument()
  })

  it('offers no refund when nothing is owed back', () => {
    renderPanel({ isCancelled: true, balanceDueMinor: 5_000 })
    expect(button(/^refund/i)).not.toBeInTheDocument()
    expect(button(/keep on account/i)).not.toBeInTheDocument()
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

describe('what voiding means', () => {
  const openVoid = async () => {
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /void/i }))
  }

  it('says voiding means the payment never happened', async () => {
    /*
     * The confusion this closes, reported from live use: somebody owed a
     * customer money, reached for Void because it sits on the payment itself,
     * and ended up telling the system it had never taken the money at all.
     */
    renderPanel({ balanceDueMinor: 0, payments: [paid(33_000)] })
    await openVoid()

    expect(screen.getByText(/Did you receive this money\?/i)).toBeInTheDocument()
    expect(screen.getByText(/customer will owe it again/i)).toBeInTheDocument()
  })

  it('names the refund, and its amount, when there is one to make', async () => {
    renderPanel({ balanceDueMinor: -8_250, payments: [paid(33_000)] })
    await openVoid()

    expect(screen.getByText(/use Refund €82\.50 instead/i)).toBeInTheDocument()
  })

  it('points at reducing the charge when nothing is refundable yet', async () => {
    renderPanel({ balanceDueMinor: 5_000, payments: [paid(33_000)] })
    await openVoid()

    expect(screen.getByText(/reduce what the booking charges/i)).toBeInTheDocument()
  })
})

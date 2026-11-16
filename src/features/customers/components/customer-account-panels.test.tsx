import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ComplianceOptions } from '@/lib/compliance/expiry'
import { formatMoney } from '@/lib/money/money'
import type {
  CustomerDirectoryEntry,
  CustomerFinancialSummaryRow,
  CustomerPaymentEntry,
  RentalBoardEntry,
} from '@/types/database'

import { CustomerActivityPanel } from './CustomerActivityPanel'
import { CustomerMoneyPanel } from './CustomerMoneyPanel'
import { CustomerRentalsPanel } from './CustomerRentalsPanel'

const useCustomerFinancialSummary = vi.hoisted(() => vi.fn())
const useCustomerRentalSummary = vi.hoisted(() => vi.fn())
const useCustomerRentals = vi.hoisted(() => vi.fn())
const useCustomerPayments = vi.hoisted(() => vi.fn())
const useCustomerAccountBalance = vi.hoisted(() => vi.fn())
const useRecordCustomerCredit = vi.hoisted(() => vi.fn())
const useApplyCustomerCredit = vi.hoisted(() => vi.fn())

vi.mock('../queries', () => ({
  useCustomerFinancialSummary,
  useCustomerRentalSummary,
  useCustomerRentals,
  useCustomerPayments,
  useCustomerAccountBalance,
  useRecordCustomerCredit,
  useApplyCustomerCredit,
}))
vi.mock('@/components/ui', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return { ...actual, useToast: () => ({ success: vi.fn(), error: vi.fn() }) }
})

const COMPLIANCE: ComplianceOptions = {
  timeZone: 'Europe/Lisbon',
  leadDays: 30,
  now: new Date('2026-06-15T12:00:00Z'),
}

/** Only the fields these two panels read; the rest of the directory row is noise here. */
const CUSTOMER = {
  customer_id: 'customer-1',
  rental_count: 3,
  first_rental_at: '2025-01-01T00:00:00Z',
  last_rental_ends_at: '2026-05-01T00:00:00Z',
  active_rental_id: null,
  active_rental_reference: null,
  active_rental_ends_at: null,
  upcoming_rental_id: null,
  upcoming_rental_reference: null,
  upcoming_rental_starts_at: null,
} as CustomerDirectoryEntry

function money(overrides: Partial<CustomerFinancialSummaryRow> = {}): CustomerFinancialSummaryRow {
  return {
    currency: 'EUR',
    rental_count: 3,
    charged_minor: 60_000,
    paid_minor: 60_000,
    outstanding_minor: 0,
    deposits_held_minor: 0,
    cancelled_count: 0,
    to_refund_minor: 0,
    ...overrides,
  }
}

function renderActivity(cancelledCount = 0): ReturnType<typeof render> {
  useCustomerRentalSummary.mockReturnValue({ data: { cancelled_count: cancelledCount } })

  return render(
    <MemoryRouter>
      <CustomerActivityPanel customer={CUSTOMER} compliance={COMPLIANCE} locale="en" />
    </MemoryRouter>,
  )
}

function renderMoney(
  finance: CustomerFinancialSummaryRow[],
  payments: CustomerPaymentEntry[] = [],
  options: { held?: { currency: string; on_account_minor: number }[]; canRecord?: boolean } = {},
): ReturnType<typeof render> {
  useCustomerFinancialSummary.mockReturnValue({ data: finance, isPending: false })
  useCustomerPayments.mockReturnValue({ data: payments, isPending: false })
  useCustomerAccountBalance.mockReturnValue({ data: options.held ?? [] })
  useCustomerRentals.mockReturnValue({ data: [], isPending: false })
  useRecordCustomerCredit.mockReturnValue({ mutateAsync: vi.fn(), isPending: false })
  useApplyCustomerCredit.mockReturnValue({ mutateAsync: vi.fn(), isPending: false })

  return render(
    <MemoryRouter>
      <CustomerMoneyPanel
        customerId="customer-1"
        compliance={COMPLIANCE}
        locale="en"
        defaultCurrency="EUR"
        canRecord={options.canRecord ?? true}
      />
    </MemoryRouter>,
  )
}

function payment(overrides: Partial<CustomerPaymentEntry> = {}): CustomerPaymentEntry {
  return {
    id: 'payment-1',
    organization_id: 'org-1',
    customer_id: 'customer-1',
    rental_id: 'rental-1',
    direction: 'inbound',
    purpose: 'rental_charge',
    method: 'card',
    amount_minor: 12_000,
    currency: 'EUR',
    paid_at: '2026-05-02T10:00:00Z',
    reference: null,
    notes: null,
    voided_at: null,
    void_reason: null,
    rental_reference: 'RNT-0001',
    rental_status: 'completed',
    ...overrides,
  }
}

beforeEach(() => {
  useCustomerFinancialSummary.mockReset()
  useCustomerRentalSummary.mockReset()
  useCustomerRentals.mockReset()
  useCustomerPayments.mockReset()
  useCustomerAccountBalance.mockReset()
  useRecordCustomerCredit.mockReset()
  useApplyCustomerCredit.mockReset()
})

describe('a cancelled booking on the account', () => {
  it('says how many bookings were cancelled', () => {
    // The figure was computed by the database from the start and rendered
    // nowhere, so a cancelled reservation left no mark on the account at all.
    renderActivity(1)
    expect(screen.getByText('1 cancelled')).toBeInTheDocument()
  })

  it('says nothing about cancellations when there have been none', () => {
    renderActivity(0)
    expect(screen.queryByText(/cancelled/i)).not.toBeInTheDocument()
  })

  it('reports money taken against a cancelled booking as refundable', () => {
    renderMoney([money({ to_refund_minor: 10_000, cancelled_count: 1 })])

    const row = screen.getByRole('row', { name: /EUR/ })
    expect(within(row).getByText(formatMoney(10_000, 'EUR', { locale: 'en' }))).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'To refund' })).toBeInTheDocument()
  })

  it('does not carry a permanently empty refund column', () => {
    // An agency that has never cancelled anything should not be reading a
    // column of zeroes to find the one that matters.
    renderMoney([money()])
    expect(screen.queryByRole('columnheader', { name: 'To refund' })).not.toBeInTheDocument()
  })
})

function rental(overrides: Partial<RentalBoardEntry> = {}): RentalBoardEntry {
  return {
    id: 'rental-1',
    reference: 'RNT-0001',
    status: 'completed',
    starts_at: '2026-05-01T09:00:00Z',
    ends_at: '2026-05-05T09:00:00Z',
    currency: 'EUR',
    total_minor: 60_000,
    vehicle_make: 'Dacia',
    vehicle_model: 'Duster',
    ...overrides,
  } as RentalBoardEntry
}

function renderRentals(rentals: RentalBoardEntry[], isPending = false): ReturnType<typeof render> {
  useCustomerRentals.mockReturnValue({ data: rentals, isPending })

  return render(
    <MemoryRouter>
      <CustomerRentalsPanel customerId="customer-1" compliance={COMPLIANCE} locale="en" />
    </MemoryRouter>,
  )
}

describe('the contracts on a customer’s account', () => {
  it('lists a cancelled booking rather than filtering it out', () => {
    // There was previously no way to reach a cancelled reservation from the
    // customer it belonged to: the account showed what was out and what was
    // next, and a booking that was called off was neither.
    renderRentals([
      rental(),
      rental({ id: 'rental-2', reference: 'RNT-0002', status: 'cancelled', total_minor: 71_400 }),
    ])

    const cancelled = screen.getByRole('link', { name: 'RNT-0002' })
    expect(cancelled).toHaveAttribute('href', '/rentals/rental-2')
    expect(screen.getByText('Cancelled')).toBeInTheDocument()
  })

  it('links each contract to the contract', () => {
    renderRentals([rental()])
    expect(screen.getByRole('link', { name: 'RNT-0001' })).toHaveAttribute(
      'href',
      '/rentals/rental-1',
    )
  })

  it('shows what each booking came to', () => {
    renderRentals([rental()])
    expect(screen.getByText(formatMoney(60_000, 'EUR', { locale: 'en' }))).toBeInTheDocument()
  })

  it('says so plainly when there are no contracts', () => {
    renderRentals([])
    expect(screen.getByText('No contracts yet')).toBeInTheDocument()
  })

  it('names the vehicle each booking was for', () => {
    renderRentals([rental()])
    expect(screen.getByText('Dacia Duster')).toBeInTheDocument()
  })
})

describe('the money on a customer’s record', () => {
  it('lists what was taken, against the booking it was taken for', () => {
    // Money used to be visible one contract at a time: answering "what has
    // this person actually paid us" meant opening their bookings one by one.
    renderMoney([money()], [payment()])

    expect(screen.getByText('€120.00')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'RNT-0001' })).toHaveAttribute(
      'href',
      '/rentals/rental-1',
    )
  })

  it('shows a refund as money going out', () => {
    renderMoney([money()], [payment({ direction: 'outbound', amount_minor: 7_000 })])
    expect(screen.getByText('−€70.00')).toBeInTheDocument()
    expect(screen.getByText('Refund')).toBeInTheDocument()
  })

  it('keeps a voided entry visible rather than dropping it', () => {
    // It is part of what happened. The rolled up figures already exclude it.
    renderMoney([money()], [payment({ voided_at: '2026-05-03T10:00:00Z' })])
    expect(screen.getByText('Voided')).toBeInTheDocument()
  })

  it('marks money held against the customer rather than a booking', () => {
    // Nothing writes this yet, and the schema has always allowed it.
    renderMoney([money()], [payment({ rental_id: null, rental_reference: null })])
    expect(screen.getByText('On account')).toBeInTheDocument()
  })

  it('says what each entry was for, which is how a transfer is followed', () => {
    // The note was being recorded from the first credit and rendered nowhere,
    // so money moving between a booking and the account left no trail anybody
    // could read.
    renderMoney([money()], [payment({ notes: 'Moved from RNT-0003' })])
    expect(screen.getByText('Moved from RNT-0003')).toBeInTheDocument()
  })

  it('says so plainly when no money has moved', () => {
    renderMoney([money()], [])
    expect(screen.getByText('Nothing recorded yet')).toBeInTheDocument()
  })
})

describe('money held on a customer’s account', () => {
  const held = [{ currency: 'EUR', on_account_minor: 7_000 }]

  it('says what is held and offers to spend it', () => {
    // payments.rental_id was nullable from the first migration and nothing
    // ever wrote a row there, so an overpayment could only leave the till.
    renderMoney([money()], [], { held })

    expect(screen.getByText('Money on account')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /use €70\.00/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /pay back/i })).toBeInTheDocument()
  })

  it('offers to take money even when nothing is held', () => {
    renderMoney([money()], [], { held: [] })

    expect(screen.getByText('Nothing held')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /take on account/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /pay back/i })).not.toBeInTheDocument()
  })

  it('shows nothing at all to somebody who may not record money', () => {
    renderMoney([money()], [], { held, canRecord: false })

    expect(screen.queryByText('Money on account')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /take on account/i })).not.toBeInTheDocument()
  })

  it('keeps two currencies apart rather than adding them', () => {
    renderMoney([money()], [], {
      held: [
        { currency: 'EUR', on_account_minor: 7_000 },
        { currency: 'USD', on_account_minor: 2_500 },
      ],
    })

    expect(screen.getByRole('button', { name: /use €70\.00/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /use \$25\.00/i })).toBeInTheDocument()
  })
})

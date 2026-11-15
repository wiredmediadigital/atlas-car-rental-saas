import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ComplianceOptions } from '@/lib/compliance/expiry'
import { formatMoney } from '@/lib/money/money'
import type {
  CustomerDirectoryEntry,
  CustomerFinancialSummaryRow,
  RentalBoardEntry,
} from '@/types/database'

import { CustomerActivityPanel } from './CustomerActivityPanel'
import { CustomerRentalsPanel } from './CustomerRentalsPanel'

const useCustomerFinancialSummary = vi.hoisted(() => vi.fn())
const useCustomerRentalSummary = vi.hoisted(() => vi.fn())
const useCustomerRentals = vi.hoisted(() => vi.fn())

vi.mock('../queries', () => ({
  useCustomerFinancialSummary,
  useCustomerRentalSummary,
  useCustomerRentals,
}))

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

function renderActivity(
  finance: CustomerFinancialSummaryRow[],
  cancelledCount = 0,
): ReturnType<typeof render> {
  useCustomerFinancialSummary.mockReturnValue({ data: finance, isPending: false })
  useCustomerRentalSummary.mockReturnValue({ data: { cancelled_count: cancelledCount } })

  return render(
    <MemoryRouter>
      <CustomerActivityPanel customer={CUSTOMER} compliance={COMPLIANCE} locale="en" />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  useCustomerFinancialSummary.mockReset()
  useCustomerRentalSummary.mockReset()
  useCustomerRentals.mockReset()
})

describe('a cancelled booking on the account', () => {
  it('says how many bookings were cancelled', () => {
    // The figure was computed by the database from the start and rendered
    // nowhere, so a cancelled reservation left no mark on the account at all.
    renderActivity([money()], 1)
    expect(screen.getByText('1 cancelled')).toBeInTheDocument()
  })

  it('says nothing about cancellations when there have been none', () => {
    renderActivity([money()], 0)
    expect(screen.queryByText(/cancelled/i)).not.toBeInTheDocument()
  })

  it('reports money taken against a cancelled booking as refundable', () => {
    renderActivity([money({ to_refund_minor: 10_000, cancelled_count: 1 })], 1)

    const row = screen.getByRole('row', { name: /EUR/ })
    expect(within(row).getByText(formatMoney(10_000, 'EUR', { locale: 'en' }))).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'To refund' })).toBeInTheDocument()
  })

  it('does not carry a permanently empty refund column', () => {
    // An agency that has never cancelled anything should not be reading a
    // column of zeroes to find the one that matters.
    renderActivity([money()], 0)
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

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi, beforeEach } from 'vitest'

import { fetchCustomers } from '@/features/customers/api'
import type * as CustomerApi from '@/features/customers/api'
import type { ComplianceOptions } from '@/lib/compliance/expiry'
import type { CustomerDirectoryEntry } from '@/types/database'

import { CustomerPicker } from './CustomerPicker'

vi.mock('@/features/workspace/workspace-context', () => ({
  useOrganization: () => ({ id: 'org-1', default_currency: 'USD' }),
}))

// The API, not the query hook. Mocking useCustomerList would make "asks the
// server for nobody" a statement about the mock rather than about the picker.
vi.mock('@/features/customers/api', async (importOriginal) => ({
  ...(await importOriginal<typeof CustomerApi>()),
  fetchCustomers: vi.fn(),
}))

const COMPLIANCE: ComplianceOptions = {
  timeZone: 'Europe/Lisbon',
  leadDays: 30,
  now: new Date('2026-06-15T12:00:00Z'),
}

function makeCustomer(overrides: Partial<CustomerDirectoryEntry> = {}): CustomerDirectoryEntry {
  return {
    customer_id: 'customer-1',
    organization_id: 'org-1',
    customer_type: 'individual',
    display_name: 'John Smith',
    first_name: 'John',
    last_name: 'Smith',
    company_name: null,
    email: 'john@example.com',
    phone: '+1 213 555 0101',
    secondary_phone: null,
    date_of_birth: null,
    nationality_country_code: 'US',
    country_code: 'US',
    city: 'Los Angeles',
    region: null,
    postal_code: null,
    address_line1: null,
    address_line2: null,
    preferred_locale: null,
    notes: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    archived_at: null,
    identity_document_count: 1,
    document_count: 2,
    identity_expires_on: '2030-01-01',
    driver_license_id: 'licence-1',
    driver_license_country: 'US',
    driver_license_issued_on: '2015-01-01',
    driver_license_expires_on: '2030-09-30',
    driver_license_classes: ['B'],
    has_driver_license: true,
    rental_count: 0,
    first_rental_at: null,
    last_rental_ends_at: null,
    active_rental_id: null,
    active_rental_reference: null,
    active_rental_ends_at: null,
    upcoming_rental_id: null,
    upcoming_rental_reference: null,
    upcoming_rental_starts_at: null,
    outstanding_currency_count: 0,
    outstanding_minor: null,
    outstanding_currency: null,
    ...overrides,
  }
}

function page(rows: CustomerDirectoryEntry[], total = rows.length) {
  return { rows, total, page: 1, pageSize: 8, pageCount: Math.ceil(total / 8) }
}

function renderPicker() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <CustomerPicker selectedIds={[]} onSelect={() => undefined} compliance={COMPLIANCE} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.mocked(fetchCustomers).mockReset()
  vi.mocked(fetchCustomers).mockResolvedValue(page([makeCustomer()]))
})

describe('CustomerPicker', () => {
  /*
   * The desk serves people walking in off the street, so the renter is almost
   * never somebody already in the list. A list standing open before anybody has
   * typed is the first eight names alphabetically: not an answer, but shaped
   * like one, and one click away from putting the wrong person on a contract.
   */
  it('offers nobody to click until a name has been typed', () => {
    renderPicker()

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.getByText('Start typing a name, phone or email.')).toBeInTheDocument()
  })

  it('asks the server for nobody until the term is worth searching', async () => {
    const user = userEvent.setup()
    renderPicker()

    await user.type(screen.getByLabelText('Search customers'), 'J')
    await new Promise((resolve) => setTimeout(resolve, 400))
    expect(fetchCustomers).not.toHaveBeenCalled()

    await user.type(screen.getByLabelText('Search customers'), 'o')
    await waitFor(() => expect(fetchCustomers).toHaveBeenCalled())
  })

  it('tells two people apart by phone, which a city cannot do', async () => {
    const user = userEvent.setup()
    vi.mocked(fetchCustomers).mockResolvedValue(
      page([
        makeCustomer({ customer_id: 'a', phone: '+1 213 555 0101' }),
        makeCustomer({ customer_id: 'b', phone: '+1 213 555 0199' }),
      ]),
    )
    renderPicker()

    await user.type(screen.getByLabelText('Search customers'), 'John')

    expect(await screen.findByText('+1 213 555 0101')).toBeInTheDocument()
    expect(screen.getByText('+1 213 555 0199')).toBeInTheDocument()
    expect(screen.queryByText('Los Angeles, US')).not.toBeInTheDocument()
  })

  it('falls back to the email when there is no phone', async () => {
    const user = userEvent.setup()
    vi.mocked(fetchCustomers).mockResolvedValue(
      page([makeCustomer({ phone: null, email: 'john@example.com' })]),
    )
    renderPicker()

    await user.type(screen.getByLabelText('Search customers'), 'John')

    expect(await screen.findByText('john@example.com')).toBeInTheDocument()
  })

  /*
   * The one that matters. The query returns eight rows whatever the total, so
   * without this the desk sees eight Johns, cannot tell there are fifteen more,
   * and picks the closest of the eight believing it is the only candidate.
   */
  it('says how many matches it is not showing, so a missing person is visible', async () => {
    const user = userEvent.setup()
    const rows = Array.from({ length: 8 }, (_, index) =>
      makeCustomer({ customer_id: `c-${index}`, display_name: `John Smith ${index}` }),
    )
    vi.mocked(fetchCustomers).mockResolvedValue(page(rows, 23))
    renderPicker()

    await user.type(screen.getByLabelText('Search customers'), 'John')

    expect(await screen.findByText(/Showing 8 of 23/)).toBeInTheDocument()
  })

  it('stays quiet about the count when every match is on screen', async () => {
    const user = userEvent.setup()
    vi.mocked(fetchCustomers).mockResolvedValue(page([makeCustomer()], 1))
    renderPicker()

    await user.type(screen.getByLabelText('Search customers'), 'John')

    await screen.findByText('John Smith')
    expect(screen.queryByText(/Showing/)).not.toBeInTheDocument()
  })

  it('keeps "no match" for a search that genuinely found nobody', async () => {
    const user = userEvent.setup()
    vi.mocked(fetchCustomers).mockResolvedValue(page([], 0))
    renderPicker()

    await user.type(screen.getByLabelText('Search customers'), 'Zzz')

    expect(await screen.findByText('No customer matches that name.')).toBeInTheDocument()
  })
})

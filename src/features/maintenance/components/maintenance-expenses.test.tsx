import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ToastProvider } from '@/components/ui'
import { createExpense, fetchCategories } from '@/features/expenses/api'
import {
  fetchLinkableExpenses,
  fetchMaintenanceActualCost,
  fetchMaintenanceExpenses,
  linkMaintenanceExpense,
} from '@/features/maintenance/api'
import type { ExpenseCategoryRecord } from '@/types/database'

import { MaintenanceExpenses } from './MaintenanceExpenses'

/**
 * The Costs section of a maintenance record.
 *
 * These render for real rather than asserting on props, because every claim
 * here is a claim about what an operator sees and can do: that the workflow is
 * explained rather than hidden when there is nothing to link, that a cost can
 * be recorded without leaving the record, and — the one that matters most —
 * that a cost which was saved is never reported as unsaved.
 */

// Mocked wholesale rather than through importOriginal: this module builds its
// Supabase client at import time, and there is no configured project in a
// unit test. Every name `queries.ts` imports has to be present or the import
// fails before a single assertion runs.
vi.mock('@/features/maintenance/api', () => ({
  changeMaintenance: vi.fn(),
  createMaintenance: vi.fn(),
  deleteMaintenanceDocument: vi.fn(),
  fetchLinkableExpenses: vi.fn(),
  fetchMaintenance: vi.fn(),
  fetchMaintenanceActualCost: vi.fn(),
  fetchMaintenanceDocuments: vi.fn(),
  fetchMaintenanceExpenses: vi.fn(),
  fetchMaintenanceForIncident: vi.fn(),
  fetchVehicleDowntime: vi.fn(),
  linkMaintenanceExpense: vi.fn(),
  unlinkMaintenanceExpense: vi.fn(),
  uploadMaintenanceDocument: vi.fn(),
  MAINTENANCE_DOCUMENT_BUCKET: 'maintenance-documents',
}))

vi.mock('@/features/expenses/api', () => ({
  createExpense: vi.fn(),
  fetchCategories: vi.fn(),
  fetchVendors: vi.fn(),
  fetchDuplicateExpenses: vi.fn(),
  fetchDuplicateVendors: vi.fn(),
  fetchVehicleOptions: vi.fn(),
  fetchRentalOptions: vi.fn(),
  createVendor: vi.fn(),
}))

vi.mock('@/features/workspace/workspace-context', () => ({
  useOrganization: () => ({
    id: 'org-1',
    locale: 'en-GB',
    default_currency: 'MAD',
    time_zone: 'Africa/Casablanca',
  }),
  usePermission: () => true,
}))

// The ledger, the reports and the fleet all get invalidated on a write. None
// of that is this card's claim, and the real one pulls in the whole vehicles
// module.
vi.mock('@/features/vehicles/queries', () => ({
  invalidateVehicleRestrictions: vi.fn(() => Promise.resolve()),
}))

vi.mock('@/features/expenses/queries', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return { ...actual, invalidateExpenses: vi.fn(() => Promise.resolve()) }
})

const CATEGORY: ExpenseCategoryRecord = {
  id: 'cat-repair',
  organization_id: 'org-1',
  name: 'Repairs',
  description: null,
  system_key: 'repair',
  is_system: true,
  default_allocation: 'vehicle',
  sort_order: 30,
  archived_at: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

function renderCard() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <MemoryRouter>
        <QueryClientProvider client={client}>
          <ToastProvider>{children}</ToastProvider>
        </QueryClientProvider>
      </MemoryRouter>
    )
  }

  return render(
    <MaintenanceExpenses
      maintenanceId="maintenance-1"
      vehicleId="vehicle-1"
      reference="MNT-2026-00014"
      title="Front brake pads"
      category="brake_service"
      currency="MAD"
      estimatedCostMinor={150000}
      canManage
      locale="en-GB"
      timeZone="Africa/Casablanca"
    />,
    { wrapper: Wrapper },
  )
}

beforeEach(() => {
  // `restoreMocks` restores spies, not module-factory fakes: without this the
  // call counts carry over and "called once" is a claim about the whole file.
  vi.clearAllMocks()
  vi.mocked(fetchMaintenanceExpenses).mockResolvedValue([])
  vi.mocked(fetchMaintenanceActualCost).mockResolvedValue(0)
  vi.mocked(fetchLinkableExpenses).mockResolvedValue([])
  vi.mocked(linkMaintenanceExpense).mockResolvedValue(undefined)
  vi.mocked(fetchCategories).mockResolvedValue([CATEGORY])
})

describe('the Costs section', () => {
  it('explains the link workflow instead of hiding it when nothing is eligible', async () => {
    renderCard()

    expect(
      await screen.findByText(/No unlinked vehicle costs for this vehicle/i),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Record a cost/i })).toBeInTheDocument()
  })

  it('asks for this vehicle’s unattached costs, not every cost it has ever had', async () => {
    vi.mocked(fetchLinkableExpenses).mockResolvedValue([
      {
        id: 'expense-7',
        reference: 'INV-184',
        description: 'Brake pads',
        amount_minor: 184000,
        currency: 'MAD',
        incurred_on: '2026-07-14',
      },
    ])

    renderCard()

    expect(await screen.findByLabelText(/Link an existing vehicle expense/i)).toBeInTheDocument()
    expect(fetchLinkableExpenses).toHaveBeenCalledWith('org-1', 'vehicle-1')
    expect(screen.getByRole('option', { name: /INV-184/ })).toBeInTheDocument()
  })

  it('records a cost from the record and attaches it, with the context filled in', async () => {
    const user = userEvent.setup()
    vi.mocked(createExpense).mockResolvedValue({ id: 'expense-new' } as never)

    renderCard()
    await user.click(await screen.findByRole('button', { name: /Record a cost/i }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByLabelText(/What was it for/i)).toHaveValue(
      'MNT-2026-00014 — Front brake pads',
    )
    expect(within(dialog).getByLabelText(/Category/i)).toHaveValue('cat-repair')

    await user.type(within(dialog).getByLabelText(/Amount paid/i), '1840')
    await user.click(within(dialog).getByRole('button', { name: /Record cost/i }))

    await waitFor(() => expect(createExpense).toHaveBeenCalled())
    const [organizationId, values] = vi.mocked(createExpense).mock.calls[0]!
    expect(organizationId).toBe('org-1')
    expect(values.allocation).toBe('vehicle')
    expect(values.vehicleId).toBe('vehicle-1')
    expect(values.amount).toBe(184000)

    await waitFor(() =>
      expect(linkMaintenanceExpense).toHaveBeenCalledWith('maintenance-1', 'expense-new'),
    )
  })

  it('never reports a saved cost as unsaved when attaching it fails', async () => {
    const user = userEvent.setup()
    vi.mocked(createExpense).mockResolvedValue({ id: 'expense-new' } as never)
    vi.mocked(linkMaintenanceExpense).mockRejectedValue(new Error('Maintenance record not found.'))

    renderCard()
    await user.click(await screen.findByRole('button', { name: /Record a cost/i }))

    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText(/Amount paid/i), '1840')
    await user.click(within(dialog).getByRole('button', { name: /Record cost/i }))

    expect(await within(dialog).findByText(/recorded but not attached/i)).toBeInTheDocument()
    expect(within(dialog).queryByText(/The cost was not saved/i)).not.toBeInTheDocument()

    // And the cost cannot be recorded a second time over the same failure.
    expect(within(dialog).getByRole('button', { name: /Record cost/i })).toBeDisabled()
    await user.click(within(dialog).getByRole('button', { name: /Record cost/i }))
    expect(createExpense).toHaveBeenCalledTimes(1)
  })
})

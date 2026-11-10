import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { VehiclesPage } from './VehiclesPage'

interface TestState {
  limit: { limit: number | null; count: number; tier: string | null }
  canManageBilling: boolean
}

const state = vi.hoisted<TestState>(() => ({
  limit: { limit: 5, count: 5, tier: 'starter' },
  canManageBilling: false,
}))

vi.mock('@/features/vehicles/queries', () => ({
  useVehicleLimit: () => ({ data: state.limit }),
  useFleetCounts: () => ({
    data: {
      total: 5,
      available: 5,
      rented: 0,
      reserved: 0,
      maintenance: 0,
      unavailable: 0,
      archived: 0,
    },
    isPending: false,
    isError: false,
  }),
  useVehicleList: () => ({
    data: { rows: [{ vehicle_id: 'v1' }], total: 1, pageCount: 1 },
    isPending: false,
    isError: false,
  }),
  useVehicleMakes: () => ({ data: [] }),
  useVehicleThumbnails: () => ({}),
}))

vi.mock('@/features/workspace/workspace-context', () => ({
  useOrganization: () => ({ id: 'org-1', name: 'Agency', locale: 'en' }),
  usePermission: (permission: string) =>
    permission === 'billing.manage' ? state.canManageBilling : true,
}))

vi.mock('@/features/workspace/useOrganizationSettings', () => ({
  useComplianceOptions: () => [],
  useDistanceUnit: () => 'km',
}))

vi.mock('@/features/exports/useCsvExport', () => ({
  useCsvExport: () => ({ exportNow: () => Promise.resolve(), isExporting: false }),
}))

vi.mock('@/features/vehicles/components/VehicleTable', () => ({ VehicleTable: () => null }))
vi.mock('@/features/vehicles/components/VehicleCardList', () => ({ VehicleCardList: () => null }))

vi.mock('@/features/vehicles/components/VehicleImportDialog', () => ({
  VehicleImportDialog: () => null,
}))

function renderPage() {
  return render(
    <MemoryRouter>
      <VehiclesPage />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  state.limit = { limit: 5, count: 5, tier: 'starter' }
  state.canManageBilling = false
})

describe('the Vehicles page and the fleet limit', () => {
  it('shows "5 of 5" in the heading and the notice beneath it', () => {
    renderPage()

    const heading = screen.getByRole('heading', { name: 'Vehicles' })
    expect(within(heading.parentElement!).getByText('5 of 5')).toBeTruthy()
    expect(screen.getByRole('status').textContent).toContain(
      'Starter covers 5 vehicles. You have 5.',
    )
  })

  it('does not offer to add or import a vehicle at the limit, but still offers Export', () => {
    renderPage()

    expect(screen.queryByRole('link', { name: 'Add vehicle' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Import' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Export' })).toBeTruthy()
  })

  it('offers adding below the limit, with the counter and no notice', () => {
    state.limit = { limit: 5, count: 4, tier: 'starter' }
    renderPage()

    expect(screen.getByText('4 of 5')).toBeTruthy()
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.getByRole('link', { name: 'Add vehicle' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Import' })).toBeTruthy()
  })

  it('shows no counter and keeps adding open when there is no limit', () => {
    state.limit = { limit: null, count: 80, tier: null }
    renderPage()

    expect(screen.queryByText(/ of /)).toBeNull()
    expect(screen.getByRole('link', { name: 'Add vehicle' })).toBeTruthy()
  })
})

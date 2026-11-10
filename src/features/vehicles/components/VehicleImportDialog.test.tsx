import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { ToastProvider } from '@/components/ui'

import { toAppError } from '@/lib/supabase/errors'

import { importVehicles } from '../api'
import type * as VehicleQueries from '../queries'
import { vehicleKeys } from '../queries'

import { VehicleImportDialog } from './VehicleImportDialog'

vi.mock('@/features/workspace/workspace-context', () => ({
  useOrganization: () => ({ id: 'org-1', default_currency: 'USD' }),
}))

vi.mock('../api', () => ({
  importVehicles: vi.fn((_org: string, rows: readonly unknown[]) =>
    Promise.resolve(rows.map(() => ({}))),
  ),
}))

vi.mock('../queries', async (importOriginal) => ({
  ...(await importOriginal<typeof VehicleQueries>()),
  useVehicleList: () => ({ data: { rows: [] } }),
}))

const CSV = [
  'make,model,registration_plate,daily_rate,odometer',
  'Toyota,Yaris,IMP-001,35,12000',
  'Dacia,Logan,IMP-002,28,45000',
].join('\n')

function renderDialog() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  const user = userEvent.setup()
  render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <VehicleImportDialog open onOpenChange={() => undefined} />
      </ToastProvider>
    </QueryClientProvider>,
  )
  return { user, invalidate }
}

async function upload(user: ReturnType<typeof userEvent.setup>, csv: string) {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]')
  await user.upload(input!, new File([csv], 'fleet.csv', { type: 'text/csv' }))
}

describe('VehicleImportDialog', () => {
  // Regression: an import used to leave the fleet list showing its stale,
  // pre-import result until the page was reloaded.
  it('refreshes the fleet once the import has written vehicles', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    const user = userEvent.setup()

    render(
      <QueryClientProvider client={client}>
        <ToastProvider>
          <VehicleImportDialog open onOpenChange={() => undefined} />
        </ToastProvider>
      </QueryClientProvider>,
    )

    const input = document.querySelector<HTMLInputElement>('input[type="file"]')
    expect(input).not.toBeNull()
    await user.upload(input!, new File([CSV], 'fleet.csv', { type: 'text/csv' }))

    await user.click(await screen.findByRole('button', { name: 'Import 2 vehicles' }))

    await waitFor(() => expect(importVehicles).toHaveBeenCalledTimes(1))
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({ queryKey: vehicleKeys.all('org-1') }),
    )
  })

  // Fails if the dialog goes back to one call per row: there would be two calls
  // of one row each, not one call holding both plates.
  it('sends every valid row in one call', async () => {
    vi.mocked(importVehicles).mockClear()
    const { user } = renderDialog()
    await upload(user, CSV)
    await user.click(await screen.findByRole('button', { name: 'Import 2 vehicles' }))

    await waitFor(() => expect(importVehicles).toHaveBeenCalledTimes(1))
    const [organizationId, rows] = vi.mocked(importVehicles).mock.calls[0]!
    expect(organizationId).toBe('org-1')
    expect(rows.map((row) => row.registrationPlate)).toEqual(['IMP-001', 'IMP-002'])
    // The dialog's result and the toast both say so.
    expect((await screen.findAllByText('2 vehicles imported')).length).toBeGreaterThan(0)
  })

  // Fails if the dialog swallows the refusal, shows the database sentence, or
  // reports any import as done: the design's anti-goal is a half-applied import.
  it('shows the refusal and imports nothing when the batch exceeds the limit', async () => {
    vi.mocked(importVehicles).mockReset()
    vi.mocked(importVehicles).mockRejectedValueOnce(
      toAppError({
        code: '55000',
        message:
          'This import has 2 vehicles but your plan has room for 1 more (limit 5, in use 4). Nothing was imported.',
      }),
    )
    const { user, invalidate } = renderDialog()
    await upload(user, CSV)
    await user.click(await screen.findByRole('button', { name: 'Import 2 vehicles' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('room for 1 more')
    expect(alert).toHaveTextContent('Nothing was imported')
    expect(alert).not.toHaveTextContent(/your plan has room/)
    // Still on the mapping step, ready to retry; no success shown.
    expect(screen.queryByText(/vehicles imported/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Import 2 vehicles' })).toBeInTheDocument()
    expect(invalidate).not.toHaveBeenCalled()
  })

  // Fails if the offending plate is not surfaced from the database error.
  it('names the colliding plate when the database refuses a duplicate', async () => {
    vi.mocked(importVehicles).mockReset()
    vi.mocked(importVehicles).mockRejectedValueOnce(
      toAppError({
        code: '23505',
        message: 'duplicate key value violates unique constraint "vehicles_plate_unique_idx"',
        details:
          'Key (organization_id, upper(btrim(registration_plate::text)))=(0b8f6c1e-2a54-4d0e-9a4b-5d3f0c1d7a11, IMP-002) already exists.',
      }),
    )
    const { user } = renderDialog()
    await upload(user, CSV)
    await user.click(await screen.findByRole('button', { name: 'Import 2 vehicles' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('IMP-002')
    expect(alert).toHaveTextContent('Nothing was imported')
  })

  // Fails if within-file duplicates are sent to the database: the batch would
  // fail whole on the repeat instead of naming the row beforehand.
  it('flags a plate repeated in the file and does not send the repeat', async () => {
    vi.mocked(importVehicles).mockReset()
    vi.mocked(importVehicles).mockImplementation((_org, rows) =>
      Promise.resolve(rows.map(() => ({}) as never)),
    )
    const csv = [CSV, 'Dacia,Sandero,imp 001,30,100'].join('\n')
    const { user } = renderDialog()
    await upload(user, csv)

    expect(await screen.findByText('Same plate as row 2')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Import 2 vehicles' }))

    await waitFor(() => expect(importVehicles).toHaveBeenCalledTimes(1))
    expect(vi.mocked(importVehicles).mock.calls[0]![1]).toHaveLength(2)
  })

  // Pins the disabled Import button: if `disabled={importable.length === 0}` goes,
  // the toBeDisabled assertion fails. The mutation's own early return for an empty
  // set is defence in depth and is NOT independently pinned here, because the
  // disabled button means the UI cannot reach it; with only that return removed
  // this test still passes.
  it('does not call the importer at all when no rows are valid', async () => {
    vi.mocked(importVehicles).mockClear()
    const { user } = renderDialog()
    await upload(user, 'make,model,registration_plate\n,,\n')

    const button = await screen.findByRole('button', { name: 'Import 0 vehicles' })
    expect(button).toBeDisabled()
    await user.click(button)
    expect(importVehicles).not.toHaveBeenCalled()
  })
})

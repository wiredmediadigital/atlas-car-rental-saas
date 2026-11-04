import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ToastProvider } from '@/components/ui'
import { activateAgreement, createAgreement } from '@/features/financing/api'
import type { FinancingAgreement, Lender } from '@/types/database'

import { FinancingNewPage } from './FinancingNewPage'

vi.mock('@/features/workspace/workspace-context', () => ({
  useOrganization: () => ({
    id: 'org-1',
    default_currency: 'USD',
    time_zone: 'UTC',
    locale: 'en',
  }),
  usePermission: () => false,
}))

vi.mock('@/features/expenses/queries', () => ({
  useVehicleOptions: () => ({
    data: [
      {
        id: 'vehicle-1',
        registration_plate: 'FICT-001',
        make: 'Toyota',
        model: 'Yaris',
        archived_at: null,
      },
    ],
    isPending: false,
    isError: false,
  }),
}))

vi.mock('@/features/financing/api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fetchLenders: vi.fn(() =>
    Promise.resolve([
      { id: 'lender-1', name: 'Fictional Bank', archived_at: null } as unknown as Lender,
    ]),
  ),
  createAgreement: vi.fn(() =>
    Promise.resolve({ id: 'agreement-new' } as unknown as FinancingAgreement),
  ),
  activateAgreement: vi.fn(() =>
    Promise.resolve({ id: 'agreement-new' } as unknown as FinancingAgreement),
  ),
}))

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter initialEntries={['/financing/new']}>
          <Routes>
            <Route path="/financing/new" element={<FinancingNewPage />} />
            <Route path="/financing/:financingId" element={<p>Agreement detail</p>} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  )
}

/*
 * Derived from today, never written down.
 *
 * The form defaults `startsOn` to today, and the schema rejects a first payment
 * that falls before the agreement starts. A literal date here passes until the
 * calendar reaches it and then fails forever — which is exactly what happened
 * to the `2026-11-01` that used to sit below.
 */
function futureIsoDate(daysAhead: number): string {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() + daysAhead)
  return date.toISOString().slice(0, 10)
}

async function fillToReview() {
  const user = userEvent.setup()
  await user.selectOptions(screen.getByLabelText(/^Vehicle/), 'vehicle-1')
  await user.click(screen.getByRole('button', { name: 'Continue' }))

  await user.selectOptions(await screen.findByLabelText(/^Lender/), 'lender-1')
  await user.click(screen.getByRole('button', { name: 'Continue' }))

  fireEvent.change(await screen.findByLabelText(/^First payment due/), {
    target: { value: futureIsoDate(30) },
  })
  await user.type(screen.getByLabelText(/^Each payment/), '500')
  await user.type(screen.getByLabelText(/^Number of payments/), '12')
  await user.click(screen.getByRole('button', { name: 'Continue' }))

  return user
}

describe('FinancingNewPage', () => {
  beforeEach(() => {
    vi.mocked(createAgreement).mockClear()
    vi.mocked(activateAgreement).mockClear()
  })

  // Regression: the activation used to run with an empty id, because the id
  // was put into state and read back in the same handler, before a render.
  it('activates the agreement it has just created', async () => {
    renderPage()
    const user = await fillToReview()

    await user.click(await screen.findByRole('button', { name: 'Save and activate' }))

    expect(await screen.findByText('Agreement detail')).toBeInTheDocument()
    expect(createAgreement).toHaveBeenCalledTimes(1)
    expect(activateAgreement).toHaveBeenCalledTimes(1)
    expect(activateAgreement).toHaveBeenCalledWith('agreement-new')
  })

  it('saves a draft without activating it', async () => {
    renderPage()
    const user = await fillToReview()

    await user.click(await screen.findByRole('button', { name: 'Save as draft' }))

    await waitFor(() => expect(screen.getByText('Agreement detail')).toBeInTheDocument())
    expect(createAgreement).toHaveBeenCalledTimes(1)
    expect(activateAgreement).not.toHaveBeenCalled()
  })
})

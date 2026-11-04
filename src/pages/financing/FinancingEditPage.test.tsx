import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ToastProvider } from '@/components/ui'
import { fetchAgreement, updateAgreement } from '@/features/financing/api'
import type { FinancingAgreementOverview, Lender } from '@/types/database'

import { FinancingEditPage } from './FinancingEditPage'

/*
 * The bug this page was written for: `updateAgreement` existed, no screen ever
 * called it, and a draft saved with the wrong figure could only be activated
 * anyway or deleted and retyped — while the page said in writing that its terms
 * could still be corrected.
 */

/*
 * Saving an edit stamps `updated_by`, so this page reads the signed-in user
 * where the create page does not. Mocked rather than wrapped in a provider:
 * who is signed in is not what any of these tests are about.
 */
vi.mock('@/features/auth/auth-context', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useAuth: () => ({ user: { id: 'user-1' } }),
}))

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

function draft(over: Partial<FinancingAgreementOverview> = {}): FinancingAgreementOverview {
  return {
    id: 'agreement-1',
    organization_id: 'org-1',
    vehicle_id: 'vehicle-1',
    lender_id: 'lender-1',
    agreement_type: 'loan',
    agreement_status: 'draft',
    mode: 'simple',
    reference: 'REF-1',
    currency: 'USD',
    financed_amount_minor: null,
    down_payment_amount_minor: null,
    rate_bps: null,
    installment_amount_minor: 50_000,
    installments_count: 12,
    payment_frequency: 'monthly',
    schedule_anchor_day: 1,
    balloon_minor: null,
    starts_on: '2032-01-01',
    ends_on: null,
    first_payment_on: '2032-02-01',
    payoff_on: null,
    closure_reason: null,
    schedule_revision: 0,
    notes: null,
    activated_at: null,
    closed_at: null,
    closed_by: null,
    created_by: null,
    created_at: '2032-01-01T00:00:00Z',
    updated_by: null,
    payment_count: 0,
    ...over,
  } as unknown as FinancingAgreementOverview
}

vi.mock('@/features/financing/api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fetchLenders: vi.fn(() =>
    Promise.resolve([
      { id: 'lender-1', name: 'Fictional Bank', archived_at: null } as unknown as Lender,
    ]),
  ),
  fetchAgreement: vi.fn(),
  updateAgreement: vi.fn(() => Promise.resolve({ id: 'agreement-1' })),
  activateAgreement: vi.fn(() => Promise.resolve({ id: 'agreement-1' })),
}))

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter initialEntries={['/financing/agreement-1/edit']}>
          <Routes>
            <Route path="/financing/:financingId/edit" element={<FinancingEditPage />} />
            <Route path="/financing/:financingId" element={<p>Agreement detail</p>} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  )
}

describe('FinancingEditPage', () => {
  beforeEach(() => {
    vi.mocked(updateAgreement).mockClear()
    vi.mocked(fetchAgreement).mockResolvedValue(draft())
  })

  it('opens on the draft it is editing rather than on an empty form', async () => {
    // The whole point: a correction starts from what is already recorded. An
    // edit screen that opened blank would be a retype with extra steps.
    const user = userEvent.setup()
    renderPage()

    expect(await screen.findByText('Edit draft financing')).toBeInTheDocument()

    await user.click(await screen.findByRole('button', { name: /Lender$/ }))
    expect(await screen.findByDisplayValue('REF-1')).toBeInTheDocument()
  })

  it('lets a correction go straight to the wrong figure', async () => {
    /*
     * A new agreement walks its four steps in order because each depends on the
     * one before. A draft being corrected is already complete, so the steps are
     * just four places a figure might be wrong — and making somebody click
     * through all of them to fix one is how a bad draft gets activated instead.
     */
    const user = userEvent.setup()
    renderPage()

    await screen.findByText('Edit draft financing')
    await user.click(await screen.findByRole('button', { name: /Review$/ }))

    expect(await screen.findByRole('button', { name: 'Save draft' })).toBeInTheDocument()
  })

  it('saves the correction through update, never creating a second agreement', async () => {
    const user = userEvent.setup()
    renderPage()

    await screen.findByText('Edit draft financing')
    await user.click(await screen.findByRole('button', { name: /Lender$/ }))

    const reference = await screen.findByDisplayValue('REF-1')
    await user.clear(reference)
    await user.type(reference, 'REF-2')

    await user.click(screen.getByRole('button', { name: /Review$/ }))
    await user.click(await screen.findByRole('button', { name: 'Save draft' }))

    await waitFor(() => expect(updateAgreement).toHaveBeenCalledTimes(1))
    expect(vi.mocked(updateAgreement).mock.calls[0]?.[0]).toBe('agreement-1')
    expect(vi.mocked(updateAgreement).mock.calls[0]?.[1]).toMatchObject({ reference: 'REF-2' })
  })

  it('returns to the agreement once the correction is saved', async () => {
    const user = userEvent.setup()
    renderPage()

    await screen.findByText('Edit draft financing')
    await user.click(await screen.findByRole('button', { name: /Review$/ }))
    await user.click(await screen.findByRole('button', { name: 'Save draft' }))

    expect(await screen.findByText('Agreement detail')).toBeInTheDocument()
  })

  it('refuses an agreement that is no longer a draft', async () => {
    /*
     * Reachable by typing the URL, so the refusal lives on the page and not
     * only on the button that leads here. An activated agreement has a
     * schedule, and terms edited underneath one would leave the two
     * disagreeing.
     */
    vi.mocked(fetchAgreement).mockResolvedValue(
      draft({ agreement_status: 'active', activated_at: '2032-01-02T00:00:00Z' }),
    )
    renderPage()

    expect(await screen.findByText('These terms are no longer a draft')).toBeInTheDocument()
    expect(screen.queryByText('Edit draft financing')).not.toBeInTheDocument()
  })

  it('keeps an unknown figure unknown rather than saving it as zero', async () => {
    /*
     * A blank money field is NULL, never 0 — "we do not know the rate" and
     * "the rate is zero" are different facts about a loan. Opening the form to
     * change something else must not quietly decide the unknown ones.
     */
    const user = userEvent.setup()
    renderPage()

    await screen.findByText('Edit draft financing')
    await user.click(await screen.findByRole('button', { name: /Review$/ }))
    await user.click(await screen.findByRole('button', { name: 'Save draft' }))

    await waitFor(() => expect(updateAgreement).toHaveBeenCalledTimes(1))
    expect(vi.mocked(updateAgreement).mock.calls[0]?.[1]).toMatchObject({
      financedAmount: null,
      downPayment: null,
      balloon: null,
      rateBps: null,
    })
  })
})

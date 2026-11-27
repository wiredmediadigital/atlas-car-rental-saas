import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { FinancialOverview, type FinancialOverviewProps } from './FinancialOverview'
import { RentalTabs, isRentalTab } from './RentalTabs'

const useRentalExpenseSummary = vi.hoisted(() => vi.fn())
vi.mock('@/features/expenses/queries', () => ({ useRentalExpenseSummary }))

/**
 * The strip exists to agree with the books, so the test that matters is that
 * it reports the database's figures and derives nothing of its own.
 */
function renderOverview(
  over: Partial<FinancialOverviewProps> = {},
  costs: { data?: unknown[]; isError?: boolean } = { data: [] },
) {
  useRentalExpenseSummary.mockReturnValue({ isPending: false, isError: false, ...costs })
  return render(
    <FinancialOverview
      rentalId="rental-1"
      currency="EUR"
      locale="en"
      totalMinor={36_000}
      amountPaidMinor={20_000}
      balanceDueMinor={16_000}
      depositHeldMinor={30_000}
      canViewCosts={false}
      {...over}
    />,
  )
}

describe('FinancialOverview', () => {
  it('reports the rental total and what has been paid against it', () => {
    renderOverview()

    expect(screen.getByText('€360.00')).toBeTruthy()
    expect(screen.getByText('€200.00')).toBeTruthy()
  })

  it('shows an unpaid balance as outstanding and no credit', () => {
    renderOverview({ balanceDueMinor: 16_000 })

    const outstanding = screen.getByText('Outstanding').parentElement
    const credit = screen.getByText('Customer credit').parentElement
    expect(outstanding?.textContent).toContain('€160.00')
    expect(credit?.textContent).toContain('€0.00')
  })

  it('shows an overpayment as credit and nothing outstanding', () => {
    /*
     * balance_due_minor is one signed column. A negative balance is money the
     * customer is owed, and reporting it as a debt of minus one hundred euros
     * is the sort of thing a renter reads as being chased for a refund.
     */
    renderOverview({ balanceDueMinor: -10_000 })

    const outstanding = screen.getByText('Outstanding').parentElement
    const credit = screen.getByText('Customer credit').parentElement
    expect(outstanding?.textContent).toContain('€0.00')
    expect(credit?.textContent).toContain('€100.00')
    expect(credit?.textContent).toMatch(/overpaid/i)
  })

  it('keeps the deposit out of the total', () => {
    renderOverview({ depositHeldMinor: 30_000 })

    const deposit = screen.getByText('Deposit held').parentElement
    expect(deposit?.textContent).toContain('€300.00')
    expect(deposit?.textContent).toMatch(/not part of the total/i)
  })

  it('hides agency costs from staff who may not see them', () => {
    renderOverview({ canViewCosts: false })

    expect(screen.queryByText('Agency costs')).toBeNull()
  })

  it('shows agency costs separately from what the customer pays', () => {
    renderOverview(
      { canViewCosts: true },
      { data: [{ currency: 'EUR', total_minor: 4_500, expense_count: 2 }] },
    )

    const costs = screen.getByText('Agency costs').parentElement
    expect(costs?.textContent).toContain('€45.00')
    expect(costs?.textContent).toContain('2 recorded')
  })

  it('says when the costs could not be read instead of reporting zero', () => {
    renderOverview({ canViewCosts: true }, { data: undefined, isError: true })

    const costs = screen.getByText('Agency costs').parentElement
    expect(costs?.textContent).toMatch(/could not be read/i)
  })
})

describe('RentalTabs', () => {
  it('marks only the open tab as selected', () => {
    render(<RentalTabs tab="financials" onChange={vi.fn()} />)

    expect(screen.getByRole('tab', { name: /financials/i }).getAttribute('aria-selected')).toBe(
      'true',
    )
    expect(screen.getByRole('tab', { name: /overview/i }).getAttribute('aria-selected')).toBe(
      'false',
    )
  })

  it('offers exactly the four approved sections, and no Activity tab', () => {
    render(<RentalTabs tab="overview" onChange={vi.fn()} />)

    const names = screen.getAllByRole('tab').map((tab) => tab.textContent)
    expect(names).toEqual(['Overview', 'Financials', 'Inspections', 'Documents'])
  })

  it('reports the tab the desk chose', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<RentalTabs tab="overview" onChange={onChange} />)

    await user.click(screen.getByRole('tab', { name: /documents/i }))

    expect(onChange).toHaveBeenCalledWith('documents')
  })

  it('treats an unknown tab in the address bar as Overview', () => {
    expect(isRentalTab('activity')).toBe(false)
    expect(isRentalTab(null)).toBe(false)
    expect(isRentalTab('financials')).toBe(true)
  })
})

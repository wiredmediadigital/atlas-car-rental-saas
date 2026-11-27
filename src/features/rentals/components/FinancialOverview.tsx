import { useRentalExpenseSummary } from '@/features/expenses/queries'
import { formatMoney } from '@/lib/money/money'
import { cn } from '@/lib/utils/cn'

export interface FinancialOverviewProps {
  rentalId: string
  currency: string
  locale: string
  /** Everything below is read straight from the rental row. */
  totalMinor: number
  amountPaidMinor: number
  balanceDueMinor: number
  depositHeldMinor: number
  /** Agency costs are shown only to staff allowed to see what the hire cost. */
  canViewCosts: boolean
}

interface Figure {
  label: string
  value: string
  hint?: string
  tone?: 'critical' | 'positive'
  isLoading?: boolean
}

/**
 * What this rental is worth, in one line, above everything that explains it.
 *
 * Every figure here is read from the rental row or from the expense summary
 * view — the same values the Charges and Money sections below are built from.
 * NOTHING on this strip is recomputed in the browser. That is the whole point
 * of it: a second, independently derived total is how a screen ends up telling
 * a renter one number and the books another.
 *
 * The two derived figures are the two halves of one database column.
 * `balance_due_minor` is signed; positive means the customer still owes, and
 * negative means they have paid more than they were charged. Splitting it is
 * presentation, not arithmetic — the sign IS the distinction, and showing a
 * negative "outstanding" would read as a debt that does not exist.
 *
 * The deposit stands apart and is never folded into the total. It is the
 * customer's money held against damage, not the agency's income.
 */
export function FinancialOverview({
  rentalId,
  currency,
  locale,
  totalMinor,
  amountPaidMinor,
  balanceDueMinor,
  depositHeldMinor,
  canViewCosts,
}: FinancialOverviewProps) {
  const costs = useRentalExpenseSummary(canViewCosts ? rentalId : undefined)
  const cash = (minor: number) => formatMoney(minor, currency, { locale })

  const outstandingMinor = Math.max(balanceDueMinor, 0)
  const creditMinor = Math.max(-balanceDueMinor, 0)

  const costRow = costs.data?.find((row) => row.currency === currency) ?? costs.data?.[0]

  const figures: Figure[] = [
    { label: 'Rental total', value: cash(totalMinor), hint: 'Charges, less discounts, plus tax' },
    { label: 'Payments received', value: cash(amountPaidMinor), hint: 'Deposits excluded' },
    {
      label: 'Outstanding',
      value: cash(outstandingMinor),
      hint: outstandingMinor > 0 ? 'Still to collect' : 'Nothing to collect',
      ...(outstandingMinor > 0 ? { tone: 'critical' as const } : {}),
    },
    {
      label: 'Customer credit',
      value: cash(creditMinor),
      hint: creditMinor > 0 ? 'Overpaid — refund or keep on account' : 'None',
      ...(creditMinor > 0 ? { tone: 'positive' as const } : {}),
    },
    { label: 'Deposit held', value: cash(depositHeldMinor), hint: 'Not part of the total' },
  ]

  if (canViewCosts) {
    figures.push({
      label: 'Agency costs',
      value: costRow ? cash(costRow.total_minor) : cash(0),
      hint: costs.isError
        ? 'Could not be read'
        : costRow
          ? `${costRow.expense_count} recorded`
          : 'None recorded',
      isLoading: costs.isPending,
    })
  }

  return (
    <dl
      className={cn(
        'border-line bg-surface grid grid-cols-2 gap-x-4 gap-y-4 rounded-lg border p-4',
        'sm:grid-cols-3 xl:grid-cols-6',
      )}
    >
      {figures.map((figure) => (
        <div key={figure.label} className="min-w-0">
          <dt className="text-ink-subtle text-[0.6875rem] tracking-wide uppercase">
            {figure.label}
          </dt>
          <dd
            data-numeric=""
            className={cn(
              'mt-1 truncate text-[1.0625rem] font-semibold',
              figure.tone === 'critical' && 'text-critical-700',
              figure.tone === 'positive' && 'text-positive-700',
              !figure.tone && 'text-ink',
            )}
          >
            {figure.isLoading ? '—' : figure.value}
          </dd>
          {figure.hint ? (
            <p className="text-ink-subtle mt-0.5 truncate text-[0.6875rem]">{figure.hint}</p>
          ) : null}
        </div>
      ))}
    </dl>
  )
}

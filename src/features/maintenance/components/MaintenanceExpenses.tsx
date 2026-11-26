import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Link2, Unlink } from 'lucide-react'

import { paths } from '@/app/routes/paths'
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  Field,
  Select,
  useToast,
} from '@/components/ui'
import {
  useLinkMaintenanceExpense,
  useMaintenanceActualCost,
  useMaintenanceExpenses,
  useUnlinkMaintenanceExpense,
} from '@/features/maintenance/queries'
import { formatDate } from '@/lib/datetime/format'
import { formatMoney } from '@/lib/money/money'
import { toErrorMessage } from '@/lib/supabase/errors'

/**
 * What this repair actually cost, read from the expense ledger.
 *
 * There is no second ledger here and no money is created: an expense already
 * recorded against the vehicle is pointed at this record, and the actual cost
 * is the sum of those. Estimated cost stays separate because it is a guess
 * somebody made beforehand, and conflating the two is how a vehicle ends up
 * counted twice in a report.
 */
export interface MaintenanceExpensesProps {
  maintenanceId: string
  currency: string
  estimatedCostMinor: number | null
  linkableExpenses: Array<{ id: string; label: string }>
  canManage: boolean
  locale: string
  timeZone: string
}

export function MaintenanceExpenses({
  maintenanceId,
  currency,
  estimatedCostMinor,
  linkableExpenses,
  canManage,
  locale,
  timeZone,
}: MaintenanceExpensesProps) {
  const toast = useToast()
  const [selected, setSelected] = useState('')
  const [error, setError] = useState<string | null>(null)

  const expenses = useMaintenanceExpenses(maintenanceId)
  const cost = useMaintenanceActualCost(maintenanceId)
  const link = useLinkMaintenanceExpense(maintenanceId)
  const unlink = useUnlinkMaintenanceExpense(maintenanceId)

  async function attach() {
    if (!selected) return
    setError(null)
    try {
      await link.mutateAsync(selected)
      setSelected('')
      toast.success('Expense linked')
    } catch (cause) {
      setError(toErrorMessage(cause))
    }
  }

  async function detach(expenseId: string) {
    setError(null)
    try {
      await unlink.mutateAsync(expenseId)
      toast.success('Expense unlinked')
    } catch (cause) {
      setError(toErrorMessage(cause))
    }
  }

  const rows = expenses.data ?? []

  return (
    <Card>
      <CardHeader
        title="Costs"
        description="Linked from the expense ledger. Nothing here charges a customer."
      />
      <CardBody className="space-y-4">
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-ink-subtle text-sm">Estimated cost</dt>
            <dd className="font-medium">
              {estimatedCostMinor === null
                ? '—'
                : formatMoney(estimatedCostMinor, currency, { locale })}
            </dd>
          </div>
          <div>
            <dt className="text-ink-subtle text-sm">Actual cost</dt>
            <dd className="font-medium">
              {cost.isLoading ? '…' : formatMoney(cost.data ?? 0, currency, { locale })}
            </dd>
          </div>
        </dl>

        {error ? (
          <p role="alert" className="text-danger text-sm">
            {error}
          </p>
        ) : null}

        {rows.length === 0 ? (
          <EmptyState
            size="sm"
            title="No expenses linked"
            description="Record the invoice as a vehicle expense, then link it here."
          />
        ) : (
          <ul className="divide-line divide-y">
            {rows.map((expense) => (
              <li
                key={expense.id}
                className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
              >
                <div className="min-w-0">
                  <Link
                    className="text-brand-700 font-medium hover:underline"
                    to={`${paths.expenses}/${expense.id}`}
                  >
                    {expense.reference ?? expense.description ?? 'Expense'}
                  </Link>
                  <p className="text-ink-subtle text-[0.8125rem]">
                    {expense.incurred_on
                      ? formatDate(new Date(expense.incurred_on), { locale, timeZone })
                      : '—'}
                    {expense.status === 'voided' ? ' · Voided' : ''}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-medium">
                    {formatMoney(expense.amount_minor, expense.currency, { locale })}
                  </span>
                  {canManage ? (
                    <Button
                      variant="ghost"
                      leadingIcon={<Unlink />}
                      isLoading={unlink.isPending}
                      onClick={() => void detach(expense.id)}
                    >
                      Unlink
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}

        {canManage && linkableExpenses.length > 0 ? (
          <div className="border-line flex flex-wrap items-end gap-3 border-t pt-4">
            <Field label="Link an existing vehicle expense" id="link-expense" className="min-w-64">
              <Select
                id="link-expense"
                value={selected}
                placeholder="Choose an expense"
                options={linkableExpenses.map((expense) => ({
                  value: expense.id,
                  label: expense.label,
                }))}
                onChange={(event) => setSelected(event.target.value)}
              />
            </Field>
            <Button
              variant="secondary"
              leadingIcon={<Link2 />}
              disabled={!selected}
              isLoading={link.isPending}
              onClick={() => void attach()}
            >
              Link expense
            </Button>
          </div>
        ) : null}
      </CardBody>
    </Card>
  )
}

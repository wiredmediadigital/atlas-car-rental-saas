import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Link2, Plus, Unlink } from 'lucide-react'

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
import { RecordMaintenanceCost } from '@/features/maintenance/components/RecordMaintenanceCost'
import {
  useLinkableMaintenanceExpenses,
  useLinkMaintenanceExpense,
  useMaintenanceActualCost,
  useMaintenanceExpenses,
  useUnlinkMaintenanceExpense,
} from '@/features/maintenance/queries'
import { usePermission } from '@/features/workspace/workspace-context'
import { formatDate } from '@/lib/datetime/format'
import { formatMoney } from '@/lib/money/money'
import { toErrorMessage } from '@/lib/supabase/errors'

import type { LinkableExpense, MaintenanceCategory } from '../api'

/**
 * What this repair actually cost, read from the expense ledger.
 *
 * There is no second ledger here and no money is created. A cost is either
 * recorded from this card — through the same form, the same validation and the
 * same `expenses` table as Finance → Record a cost — or an existing vehicle
 * cost is pointed at this record; the actual cost is the sum of those.
 * Estimated cost stays separate because it is a guess somebody made
 * beforehand, and conflating the two is how a vehicle ends up counted twice in
 * a report.
 *
 * Nothing on this card is gated on the record's status. A garage invoice
 * routinely arrives after the work is signed off, and a record that will not
 * accept it is a record whose actual cost is permanently wrong.
 */
export interface MaintenanceExpensesProps {
  maintenanceId: string
  vehicleId: string
  reference: string
  title: string
  category: MaintenanceCategory
  currency: string
  estimatedCostMinor: number | null
  canManage: boolean
  locale: string
  timeZone: string
}

export function MaintenanceExpenses({
  maintenanceId,
  vehicleId,
  reference,
  title,
  category,
  currency,
  estimatedCostMinor,
  canManage,
  locale,
  timeZone,
}: MaintenanceExpensesProps) {
  const toast = useToast()
  // Linking is a maintenance action; recording a cost is an expense action,
  // and the database gates them separately. Offering the second on the
  // strength of the first would put up a button the insert then refuses.
  const canRecordCost = usePermission('expenses.create')
  const [selected, setSelected] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isRecording, setIsRecording] = useState(false)

  const expenses = useMaintenanceExpenses(maintenanceId)
  const cost = useMaintenanceActualCost(maintenanceId)
  const linkable = useLinkableMaintenanceExpenses(vehicleId, canManage)
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
  const options = linkable.data ?? []

  return (
    <Card>
      <CardHeader
        title="Costs"
        description="Recorded in the expense ledger. Nothing here charges a customer."
        actions={
          canManage && canRecordCost ? (
            <Button variant="secondary" leadingIcon={<Plus />} onClick={() => setIsRecording(true)}>
              Record a cost
            </Button>
          ) : null
        }
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
            title="No costs recorded"
            description="Record the invoice here, or link a vehicle cost already in the ledger."
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

        {canManage ? (
          <div className="border-line border-t pt-4">
            {options.length > 0 ? (
              <div className="flex flex-wrap items-end gap-3">
                <Field label="Link an existing vehicle expense" className="min-w-64">
                  <Select
                    value={selected}
                    placeholder="Choose an expense"
                    options={options.map((expense) => ({
                      value: expense.id,
                      label: linkableLabel(expense),
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
            ) : (
              // Said, not hidden. A card that simply drops the picker reads as
              // "this agency cannot link costs", and the operator goes looking
              // for a setting that does not exist.
              <p className="text-ink-subtle text-[0.8125rem]">
                {linkable.isPending
                  ? 'Looking for vehicle costs that could be linked…'
                  : canRecordCost
                    ? 'No unlinked vehicle costs for this vehicle. Record one with “Record a cost”, or record it in Finance against this vehicle and it will appear here.'
                    : 'No unlinked vehicle costs for this vehicle. Record it in Finance against this vehicle and it will appear here.'}
              </p>
            )}
          </div>
        ) : null}
      </CardBody>

      <RecordMaintenanceCost
        open={isRecording}
        onOpenChange={setIsRecording}
        maintenanceId={maintenanceId}
        vehicleId={vehicleId}
        reference={reference}
        title={title}
        category={category}
        currency={currency}
        locale={locale}
        timeZone={timeZone}
      />
    </Card>
  )
}

/** Enough to tell two invoices from the same garage apart. */
function linkableLabel(expense: LinkableExpense): string {
  const name = expense.reference ?? expense.description ?? 'Expense'
  return expense.incurred_on ? `${name} · ${expense.incurred_on}` : name
}

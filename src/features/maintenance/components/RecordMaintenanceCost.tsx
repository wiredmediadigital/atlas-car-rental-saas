import { Check } from 'lucide-react'
import { useState } from 'react'

import { Alert, Button, Dialog, DialogContent, Skeleton, useToast } from '@/components/ui'
import { ExpenseForm } from '@/features/expenses/components/ExpenseForm'
import { useExpenseCategories } from '@/features/expenses/queries'
import { buildExpenseSchema, type ExpenseFormInput } from '@/features/expenses/schemas'
import { buildMaintenanceExpenseForm } from '@/features/maintenance/expense-prefill'
import { useCreateMaintenanceExpense } from '@/features/maintenance/queries'
import { useOrganization, usePermission } from '@/features/workspace/workspace-context'
import { toIsoDateInTimeZone } from '@/lib/datetime/timezone'
import { toErrorMessage } from '@/lib/supabase/errors'
import type { ExpenseCategoryRecord } from '@/types/database'

import type { MaintenanceCategory } from '../api'

const DIALOG_TITLE = 'Record a cost'
const DIALOG_DESCRIPTION = 'Recorded in the expense ledger and attached to this maintenance record.'

export interface RecordMaintenanceCostProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  maintenanceId: string
  vehicleId: string
  reference: string
  title: string
  category: MaintenanceCategory
  currency: string
  locale: string
  timeZone: string
}

/**
 * Recording a cost without leaving the maintenance record.
 *
 * The same form, the same validation and the same ledger as Finance → Record
 * a cost; what this adds is the context an operator would otherwise retype —
 * the vehicle, the reference, the description and the category — and the
 * attachment afterwards, so a cost raised against a repair counts towards that
 * repair's actual cost without a second trip through the expense list.
 *
 * Deliberately a dialog rather than a route. Navigating away and back loses
 * the page they were reading, and the thing they came to see is the actual
 * cost changing.
 */
export function RecordMaintenanceCost(props: RecordMaintenanceCostProps) {
  // Mounted only while open, so the form starts from the prefill every time
  // and nobody reading the page pays for the category lookup.
  if (!props.open) return null
  return <RecordMaintenanceCostCategories {...props} />
}

/**
 * The categories have to be in hand before the form opens.
 *
 * The prefilled category is an id, resolved from the agency's own category
 * list by `system_key`. Starting the form before that list arrives would open
 * it with no category chosen and silently drop the one piece of context this
 * dialog exists to supply.
 */
function RecordMaintenanceCostCategories(props: RecordMaintenanceCostProps) {
  const categories = useExpenseCategories()

  if (categories.isPending || categories.isError) {
    return (
      <Dialog open onOpenChange={props.onOpenChange}>
        <DialogContent title={DIALOG_TITLE} description={DIALOG_DESCRIPTION} size="lg">
          {categories.isError ? (
            <Alert tone="critical" title="The expense categories could not be loaded">
              {toErrorMessage(categories.error)}
            </Alert>
          ) : (
            <Skeleton className="h-64 w-full" />
          )}
        </DialogContent>
      </Dialog>
    )
  }

  return <RecordMaintenanceCostForm {...props} categories={categories.data ?? []} />
}

function RecordMaintenanceCostForm({
  open,
  onOpenChange,
  maintenanceId,
  vehicleId,
  reference,
  title,
  category,
  currency,
  locale,
  timeZone,
  categories,
}: RecordMaintenanceCostProps & { categories: readonly ExpenseCategoryRecord[] }) {
  const organization = useOrganization()
  const toast = useToast()
  const canManageVendors = usePermission('expenseVendors.manage')
  const create = useCreateMaintenanceExpense(maintenanceId)

  const [values, setValues] = useState<ExpenseFormInput>(() =>
    buildMaintenanceExpenseForm({
      reference,
      title,
      category,
      vehicleId,
      currency,
      categories,
      todayIso: toIsoDateInTimeZone(new Date(), timeZone),
    }),
  )
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [orphaned, setOrphaned] = useState<string | null>(null)

  async function submit() {
    // The guard is the point, not belt and braces: without it a second click
    // while the first insert is in flight records the cost twice. The same
    // goes for a click after one that recorded a cost it could not attach.
    if (create.isPending || orphaned) return

    const schema = buildExpenseSchema(
      values.currency || organization.default_currency,
      toIsoDateInTimeZone(new Date(), timeZone),
    )
    const parsed = schema.safeParse(values)

    if (!parsed.success) {
      const next: Record<string, string> = {}
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? 'form')
        next[key] ??= issue.message
      }
      setErrors(next)
      return
    }

    setErrors({})

    try {
      const result = await create.mutateAsync(parsed.data)
      if (result.isLinked) {
        toast.success('Cost recorded', parsed.data.description)
        onOpenChange(false)
        return
      }
      // The cost exists. Saying so plainly is the only thing that stops the
      // operator recording it again, and the picker behind this dialog now
      // offers it for linking. Deliberately not routed through the form's own
      // error, which is titled "The cost was not saved" and would be the
      // opposite of what happened.
      setOrphaned(toErrorMessage(result.linkFailure))
    } catch (failure) {
      setErrors({ form: toErrorMessage(failure) })
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={DIALOG_TITLE}
        description={DIALOG_DESCRIPTION}
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              {orphaned ? 'Close' : 'Cancel'}
            </Button>
            <Button
              variant="primary"
              leadingIcon={<Check />}
              disabled={Boolean(orphaned)}
              isLoading={create.isPending}
              onClick={() => void submit()}
            >
              Record cost
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {orphaned ? (
            <Alert tone="critical" title="The cost was recorded but not attached">
              {orphaned} Close this and link it under “Link an existing vehicle expense”.
            </Alert>
          ) : null}

          <ExpenseForm
            values={values}
            onChange={(patch) => setValues((current) => ({ ...current, ...patch }))}
            errors={errors}
            categories={categories}
            canManageVendors={canManageVendors}
            locale={locale}
            lockedRelation="vehicle"
          />
        </div>
      </DialogContent>
    </Dialog>
  )
}

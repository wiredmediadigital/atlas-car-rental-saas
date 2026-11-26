import { useState } from 'react'
import { CalendarClock } from 'lucide-react'

import { Alert, Badge, Button, Card, CardBody, CardHeader, Field, Input } from '@/components/ui'
import type { MaintenanceRow } from '@/features/maintenance/api'
import { useMaintenanceAction } from '@/features/maintenance/queries'
import {
  parseServicePlanForm,
  servicePlanToForm,
  type ServicePlanErrors,
} from '@/features/maintenance/service-plan-form'
import {
  describeServiceDate,
  describeServiceDistance,
  evaluateServicePlan,
  SERVICE_STATE_LABELS,
  SERVICE_STATE_TONES,
  type ServiceOptions,
} from '@/lib/compliance/service'
import { formatDate, parseIsoDate } from '@/lib/datetime/format'
import { toErrorMessage } from '@/lib/supabase/errors'

/**
 * Preventive servicing for one record: when the vehicle is next due, by date
 * or by distance, and the interval that produces it.
 *
 * A reminder is a reminder. Nothing here takes a vehicle out of service on its
 * own -- that only happens when somebody records maintenance -- and nothing
 * here sends anything. A due service shows up as a due service.
 *
 * The saved plan is shown to EVERYONE, including the people allowed to change
 * it. It used to be rendered only in the read-only branch, so the manager who
 * saved was the one person who never saw what had been stored: the card looked
 * identical before and after, and a five-second toast was the only evidence
 * that anything had happened. The summary below is now the confirmation.
 */
export interface MaintenanceServicePlanProps {
  record: MaintenanceRow
  vehicleOdometer: number | null
  distanceUnit: string
  canManage: boolean
  locale: string
  timeZone: string
  serviceOptions: ServiceOptions
}

export function MaintenanceServicePlan({
  record,
  vehicleOdometer,
  distanceUnit,
  canManage,
  locale,
  timeZone,
  serviceOptions,
}: MaintenanceServicePlanProps) {
  const setPlan = useMaintenanceAction('maintenance_set_service_plan')

  /**
   * The stored plan, as text.
   *
   * Seeded from the record and re-seeded from the row the RPC returns, so the
   * boxes always show what the database actually holds. These used to be read
   * once at mount with nothing able to re-sync them, so a value the database
   * had rewritten went on sitting in the box looking saved until the page was
   * reloaded.
   */
  const [values, setValues] = useState(() => servicePlanToForm(record))
  const [errors, setErrors] = useState<ServicePlanErrors>({})
  const [isSaved, setIsSaved] = useState(false)

  /*
   * Follow the stored plan when it changes underneath the form.
   *
   * Completing this maintenance advances the plan in the database. Without
   * this the boxes would still hold the superseded figures, and pressing Save
   * would write them straight back over the advancement -- undoing, from the
   * operator's point of view, the one thing completing the work was supposed
   * to do. Adjusted during render, which is React's documented way to derive
   * state from a changed prop, and the pattern the expense toolbar already
   * uses in this codebase.
   */
  const stored = servicePlanToForm(record)
  const [lastStored, setLastStored] = useState(stored)
  if (
    stored.nextOn !== lastStored.nextOn ||
    stored.nextOdometer !== lastStored.nextOdometer ||
    stored.intervalDays !== lastStored.intervalDays ||
    stored.intervalOdometer !== lastStored.intervalOdometer
  ) {
    setLastStored(stored)
    setValues(stored)
    setErrors({})
  }

  const status = evaluateServicePlan(record, vehicleOdometer, serviceOptions)

  function patch(next: Partial<typeof values>) {
    setValues((current) => ({ ...current, ...next }))
    setIsSaved(false)
  }

  async function save() {
    // Without this, a second click while the first call is in flight sends the
    // plan twice and races the re-sync below.
    if (setPlan.isPending) return

    const { payload, errors: parseErrors } = parseServicePlanForm(values)
    if (!payload) {
      setErrors(parseErrors)
      setIsSaved(false)
      return
    }

    setErrors({})
    try {
      const saved = await setPlan.mutateAsync({ p_maintenance_id: record.id, ...payload })
      // The authoritative row, not the typed text. If the database normalised
      // anything, this is where it becomes visible.
      if (saved) {
        const next = servicePlanToForm(saved)
        setValues(next)
        setLastStored(next)
      }
      setIsSaved(true)
    } catch (cause) {
      setIsSaved(false)
      setErrors({ form: toErrorMessage(cause) })
    }
  }

  // A `date` column has no instant; parseIsoDate keeps it on the agency's
  // calendar day instead of rendering midnight UTC somewhere else.
  const storedDate = record.next_service_on ? parseIsoDate(record.next_service_on, timeZone) : null

  const dateLine = describeServiceDate(status.byDate)
  const distanceLine = describeServiceDistance(status.byOdometer, distanceUnit)

  return (
    <Card>
      <CardHeader
        title="Preventive servicing"
        description="When this vehicle is next due, by date or by distance."
        actions={
          <Badge tone={SERVICE_STATE_TONES[status.state]} withDot>
            {SERVICE_STATE_LABELS[status.state]}
          </Badge>
        }
      />
      <CardBody className="space-y-4">
        {status.state === 'overdue' || status.state === 'due' ? (
          <Alert tone="caution" title="Service is due">
            <p>{[dateLine, distanceLine].filter(Boolean).join(' · ')}</p>
            <p className="mt-1">
              This is a reminder. The vehicle stays available until maintenance is recorded against
              it.
            </p>
          </Alert>
        ) : null}

        {/*
          The saved plan, read back from the stored record, for everybody. This
          is what makes a successful save visible and a partial one obvious.
        */}
        <dl className="bg-surface-muted grid grid-cols-1 gap-4 rounded-md px-4 py-3 sm:grid-cols-2">
          <div>
            <dt className="text-ink-subtle text-sm">Next service on</dt>
            <dd className="font-medium">
              {storedDate ? formatDate(storedDate, { locale, timeZone }) : '—'}
            </dd>
            {dateLine ? <dd className="text-ink-subtle text-[0.75rem]">{dateLine}</dd> : null}
          </div>
          <div>
            <dt className="text-ink-subtle text-sm">Next service at</dt>
            <dd className="font-medium">
              {record.next_service_odometer === null
                ? '—'
                : `${record.next_service_odometer.toLocaleString(locale)} ${distanceUnit}`}
            </dd>
            {distanceLine ? (
              <dd className="text-ink-subtle text-[0.75rem]">{distanceLine}</dd>
            ) : record.next_service_odometer !== null && !status.odometerKnown ? (
              <dd className="text-ink-subtle text-[0.75rem]">
                No current reading for this vehicle.
              </dd>
            ) : null}
          </div>
          <div>
            <dt className="text-ink-subtle text-sm">Repeats every (days)</dt>
            <dd className="font-medium">
              {record.service_interval_days === null ? '—' : `${record.service_interval_days} days`}
            </dd>
          </div>
          <div>
            <dt className="text-ink-subtle text-sm">Repeats every ({distanceUnit})</dt>
            <dd className="font-medium">
              {record.service_interval_odometer === null
                ? '—'
                : `${record.service_interval_odometer.toLocaleString(locale)} ${distanceUnit}`}
            </dd>
          </div>
        </dl>

        {canManage ? (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Next service on" error={errors.nextOn}>
                <Input
                  type="date"
                  value={values.nextOn}
                  onChange={(event) => patch({ nextOn: event.target.value })}
                />
              </Field>
              <Field label={`Next service at (${distanceUnit})`} error={errors.nextOdometer}>
                <Input
                  inputMode="numeric"
                  value={values.nextOdometer}
                  onChange={(event) => patch({ nextOdometer: event.target.value })}
                />
              </Field>
              <Field
                label="Repeat every (days)"
                hint="Recalculated from the completion date when this service is completed."
                error={errors.intervalDays}
              >
                <Input
                  inputMode="numeric"
                  value={values.intervalDays}
                  onChange={(event) => patch({ intervalDays: event.target.value })}
                />
              </Field>
              <Field
                label={`Repeat every (${distanceUnit})`}
                hint="Recalculated from the reading taken at the service."
                error={errors.intervalOdometer}
              >
                <Input
                  inputMode="numeric"
                  value={values.intervalOdometer}
                  onChange={(event) => patch({ intervalOdometer: event.target.value })}
                />
              </Field>
            </div>

            {errors.form ? (
              <Alert tone="critical" title="The service plan was not saved">
                {errors.form}
              </Alert>
            ) : null}

            {isSaved && !errors.form ? (
              <Alert tone="positive" title="Service plan saved">
                The figures above are what the database now holds for this record.
              </Alert>
            ) : null}

            <div className="flex justify-end">
              <Button
                variant="secondary"
                leadingIcon={<CalendarClock />}
                isLoading={setPlan.isPending}
                onClick={() => void save()}
              >
                Save service plan
              </Button>
            </div>
          </>
        ) : null}
      </CardBody>
    </Card>
  )
}

import { useState } from 'react'
import { CalendarClock } from 'lucide-react'

import { Alert, Button, Card, CardBody, CardHeader, Field, Input, useToast } from '@/components/ui'
import type { MaintenanceRow } from '@/features/maintenance/api'
import { useMaintenanceAction } from '@/features/maintenance/queries'
import { formatDate } from '@/lib/datetime/format'
import { toErrorMessage } from '@/lib/supabase/errors'

/**
 * Preventive servicing for one record: when the next one is due, by date or by
 * distance, and the interval that produces it.
 *
 * A reminder is a reminder. Nothing here takes a vehicle out of service on its
 * own -- that only happens when somebody records maintenance -- and nothing
 * here sends anything. A due service shows up as a due service.
 */
export interface MaintenanceServicePlanProps {
  record: MaintenanceRow
  vehicleOdometer: number | null
  distanceUnit: string
  canManage: boolean
  locale: string
  timeZone: string
}

function toNumberOrNull(value: string): number | null {
  const trimmed = value.trim()
  if (trimmed === '') return null
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

export function MaintenanceServicePlan({
  record,
  vehicleOdometer,
  distanceUnit,
  canManage,
  locale,
  timeZone,
}: MaintenanceServicePlanProps) {
  const toast = useToast()
  const setPlan = useMaintenanceAction('maintenance_set_service_plan')

  const [intervalDays, setIntervalDays] = useState(
    record.service_interval_days === null ? '' : String(record.service_interval_days),
  )
  const [intervalOdometer, setIntervalOdometer] = useState(
    record.service_interval_odometer === null ? '' : String(record.service_interval_odometer),
  )
  const [nextOn, setNextOn] = useState(record.next_service_on ?? '')
  const [nextOdometer, setNextOdometer] = useState(
    record.next_service_odometer === null ? '' : String(record.next_service_odometer),
  )
  const [error, setError] = useState<string | null>(null)

  /*
   * Read once when the panel opens rather than on every render: a due date is
   * not a live clock, and re-reading it during render is both impure and
   * pointless at this resolution.
   */
  const [asOf] = useState(() => Date.now())

  const dueByDate =
    record.next_service_on !== null && new Date(record.next_service_on).getTime() <= asOf
  const dueByOdometer =
    record.next_service_odometer !== null &&
    vehicleOdometer !== null &&
    vehicleOdometer >= record.next_service_odometer

  async function save() {
    setError(null)
    const payload = {
      p_maintenance_id: record.id,
      p_interval_days: toNumberOrNull(intervalDays),
      p_interval_odometer: toNumberOrNull(intervalOdometer),
      p_next_service_on: nextOn.trim() === '' ? null : nextOn,
      p_next_service_odometer: toNumberOrNull(nextOdometer),
    }
    if (
      payload.p_interval_days === null &&
      payload.p_interval_odometer === null &&
      payload.p_next_service_on === null &&
      payload.p_next_service_odometer === null
    ) {
      setError('Set at least one reminder: a date, a distance, or an interval.')
      return
    }
    try {
      await setPlan.mutateAsync(payload)
      toast.success('Service plan saved')
    } catch (cause) {
      setError(toErrorMessage(cause))
    }
  }

  return (
    <Card>
      <CardHeader
        title="Preventive servicing"
        description="When this vehicle is next due, by date or by distance."
      />
      <CardBody className="space-y-4">
        {dueByDate || dueByOdometer ? (
          <Alert tone="caution" title="Service is due">
            <p>
              {dueByDate && record.next_service_on
                ? `Due since ${formatDate(new Date(record.next_service_on), { locale, timeZone })}.`
                : null}{' '}
              {dueByOdometer && record.next_service_odometer !== null
                ? `Past ${record.next_service_odometer.toLocaleString(locale)} ${distanceUnit}.`
                : null}
            </p>
            <p className="mt-1">
              This is a reminder. The vehicle stays available until maintenance is recorded against
              it.
            </p>
          </Alert>
        ) : null}

        {canManage ? (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Next service on" id="next-service-on">
                <Input
                  id="next-service-on"
                  type="date"
                  value={nextOn}
                  onChange={(event) => setNextOn(event.target.value)}
                />
              </Field>
              <Field label={`Next service at (${distanceUnit})`} id="next-service-odometer">
                <Input
                  id="next-service-odometer"
                  inputMode="numeric"
                  value={nextOdometer}
                  onChange={(event) => setNextOdometer(event.target.value)}
                />
              </Field>
              <Field label="Repeat every (days)" id="interval-days">
                <Input
                  id="interval-days"
                  inputMode="numeric"
                  value={intervalDays}
                  onChange={(event) => setIntervalDays(event.target.value)}
                />
              </Field>
              <Field label={`Repeat every (${distanceUnit})`} id="interval-odometer">
                <Input
                  id="interval-odometer"
                  inputMode="numeric"
                  value={intervalOdometer}
                  onChange={(event) => setIntervalOdometer(event.target.value)}
                />
              </Field>
            </div>

            {error ? (
              <p role="alert" className="text-danger text-sm">
                {error}
              </p>
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
        ) : (
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-ink-subtle text-sm">Next service on</dt>
              <dd>
                {record.next_service_on
                  ? formatDate(new Date(record.next_service_on), { locale, timeZone })
                  : '—'}
              </dd>
            </div>
            <div>
              <dt className="text-ink-subtle text-sm">Next service at</dt>
              <dd>
                {record.next_service_odometer === null
                  ? '—'
                  : `${record.next_service_odometer.toLocaleString(locale)} ${distanceUnit}`}
              </dd>
            </div>
          </dl>
        )}
      </CardBody>
    </Card>
  )
}

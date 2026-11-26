import { Wrench } from 'lucide-react'
import { Link } from 'react-router-dom'

import { maintenanceDetailPath, paths } from '@/app/routes/paths'
import {
  Badge,
  ButtonLink,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  Skeleton,
} from '@/components/ui'
import { useMaintenanceForVehicle } from '@/features/maintenance/queries'
import {
  describeServiceDate,
  describeServiceDistance,
  evaluateVehicleServicing,
  SERVICE_STATE_LABELS,
  SERVICE_STATE_TONES,
  type ServiceOptions,
} from '@/lib/compliance/service'
import { formatDate, parseIsoDate } from '@/lib/datetime/format'

/**
 * What this vehicle's servicing requires, read from the authoritative plan.
 *
 * The plan lives on the vehicle's maintenance records, because that is where
 * `maintenance_set_service_plan` puts it, and this card reads the same rows
 * the Maintenance screens read through the same calculation. There is
 * deliberately no editor here: a second place to set a next-service date is
 * how the product ended up with two of them that never agreed. "Manage
 * service plan" goes to the record that owns it.
 *
 * Nothing on this card restricts the vehicle. A due or overdue service is a
 * reminder; availability is decided by recorded maintenance and by explicit
 * off-road restrictions.
 */
export interface VehicleServicePanelProps {
  vehicleId: string
  odometer: number | null
  /** The pre-Maintenance date from `vehicles.next_service_on`, if any. */
  legacyNextServiceOn: string | null
  distanceUnit: string
  locale: string
  canSchedule: boolean
  serviceOptions: ServiceOptions
}

export function VehicleServicePanel({
  vehicleId,
  odometer,
  legacyNextServiceOn,
  distanceUnit,
  locale,
  canSchedule,
  serviceOptions,
}: VehicleServicePanelProps) {
  const records = useMaintenanceForVehicle(vehicleId)
  const { record: plan, status } = evaluateVehicleServicing(
    records.data ?? [],
    odometer,
    serviceOptions,
  )

  // A `date` column has no instant: new Date('2026-12-01') is midnight UTC and
  // prints as 30 November anywhere behind Greenwich, a day out of step with the
  // "Due in N days" line beside it. parseIsoDate exists for this.
  const serviceDate = status.nextServiceOn
    ? parseIsoDate(status.nextServiceOn, serviceOptions.timeZone)
    : null
  const legacyDate = legacyNextServiceOn
    ? parseIsoDate(legacyNextServiceOn, serviceOptions.timeZone)
    : null
  const formatLegacyDate = () =>
    legacyDate
      ? formatDate(legacyDate, { locale, timeZone: serviceOptions.timeZone })
      : legacyNextServiceOn

  const dateLine = describeServiceDate(status.byDate)
  const distanceLine = describeServiceDistance(status.byOdometer, distanceUnit)

  return (
    <Card>
      <CardHeader
        title="Service and maintenance"
        description="Set on the maintenance record that services this vehicle."
        actions={
          plan ? (
            <Badge tone={SERVICE_STATE_TONES[status.state]} withDot>
              {SERVICE_STATE_LABELS[status.state]}
            </Badge>
          ) : null
        }
      />
      <CardBody className="space-y-4">
        {records.isPending ? (
          <Skeleton className="h-24 w-full" />
        ) : records.isError ? (
          <p role="alert" className="text-critical-600 text-sm">
            Unable to load this vehicle’s servicing.
          </p>
        ) : (
          <>
            <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <dt className="text-ink-subtle text-sm">Current odometer</dt>
                <dd className="font-medium">
                  {odometer === null ? '—' : `${odometer.toLocaleString(locale)} ${distanceUnit}`}
                </dd>
              </div>
              <div>
                <dt className="text-ink-subtle text-sm">Service status</dt>
                <dd className="font-medium">{SERVICE_STATE_LABELS[status.state]}</dd>
              </div>
              <div>
                <dt className="text-ink-subtle text-sm">Next service date</dt>
                <dd className="font-medium">
                  {serviceDate
                    ? formatDate(serviceDate, { locale, timeZone: serviceOptions.timeZone })
                    : '—'}
                </dd>
                {dateLine ? <dd className="text-ink-subtle text-[0.75rem]">{dateLine}</dd> : null}
              </div>
              <div>
                <dt className="text-ink-subtle text-sm">Next service mileage</dt>
                <dd className="font-medium">
                  {status.nextServiceOdometer === null
                    ? '—'
                    : `${status.nextServiceOdometer.toLocaleString(locale)} ${distanceUnit}`}
                </dd>
                {distanceLine ? (
                  <dd className="text-ink-subtle text-[0.75rem]">{distanceLine}</dd>
                ) : status.nextServiceOdometer !== null && !status.odometerKnown ? (
                  <dd className="text-ink-subtle text-[0.75rem]">No current reading recorded.</dd>
                ) : null}
              </div>
              <div>
                <dt className="text-ink-subtle text-sm">Repeats every (days)</dt>
                <dd className="font-medium">
                  {plan?.service_interval_days == null ? '—' : `${plan.service_interval_days} days`}
                </dd>
              </div>
              <div>
                <dt className="text-ink-subtle text-sm">Repeats every ({distanceUnit})</dt>
                <dd className="font-medium">
                  {plan?.service_interval_odometer == null
                    ? '—'
                    : `${plan.service_interval_odometer.toLocaleString(locale)} ${distanceUnit}`}
                </dd>
              </div>
            </dl>

            {plan ? (
              <div className="border-line flex flex-wrap items-center justify-between gap-3 border-t pt-4">
                <p className="text-ink-subtle text-[0.8125rem]">
                  From{' '}
                  <Link
                    className="text-brand-700 font-medium hover:underline"
                    to={maintenanceDetailPath(plan.id)}
                  >
                    {plan.reference}
                  </Link>
                  . A due service is a reminder — it does not take the vehicle off the road.
                </p>
                <ButtonLink
                  variant="secondary"
                  leadingIcon={<Wrench />}
                  to={maintenanceDetailPath(plan.id)}
                >
                  Manage service plan
                </ButtonLink>
              </div>
            ) : (
              <EmptyState
                size="sm"
                title="No service plan configured"
                description={
                  legacyNextServiceOn
                    ? `This vehicle still carries an older service date of ${formatLegacyDate()}, recorded before servicing moved to Maintenance. It is kept for reference and is not used for reminders. Schedule maintenance for this vehicle and set its service plan there.`
                    : 'Schedule maintenance for this vehicle, then set when it is next due — by date, by distance, or both.'
                }
                action={
                  canSchedule ? (
                    <ButtonLink
                      variant="secondary"
                      leadingIcon={<Wrench />}
                      to={`${paths.maintenanceNew}?vehicle=${vehicleId}`}
                    >
                      Schedule maintenance
                    </ButtonLink>
                  ) : undefined
                }
              />
            )}
          </>
        )}
      </CardBody>
    </Card>
  )
}

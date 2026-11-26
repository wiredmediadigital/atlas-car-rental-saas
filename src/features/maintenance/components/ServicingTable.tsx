import { Wrench } from 'lucide-react'
import { Link } from 'react-router-dom'

import { maintenanceDetailPath, paths, vehicleDetailPath } from '@/app/routes/paths'
import { Badge, ButtonLink, Skeleton } from '@/components/ui'
import {
  describeServiceDate,
  describeServiceDistance,
  SERVICE_STATE_LABELS,
  SERVICE_STATE_TONES,
} from '@/lib/compliance/service'
import { formatDate } from '@/lib/datetime/format'

import type { VehicleServicing } from '../dashboard'

export interface ServicingTableProps {
  rows: readonly VehicleServicing[]
  locale: string
  timeZone: string
  distanceUnit: string
  canSchedule: boolean
  isLoading?: boolean
}

/**
 * Preventive servicing across the whole fleet.
 *
 * Shows vehicles with no plan as well as vehicles with one: a car nobody has
 * planned a service for is the most actionable row on the page, and a list
 * that quietly omitted it would look reassuring and be wrong.
 *
 * Every status here comes from the same `evaluateServicePlan` that Vehicle
 * Details and the maintenance record's own card use, so the three cannot
 * disagree about the same car on the same day. Nothing on this screen
 * restricts a vehicle; a due service is a reminder until somebody records
 * maintenance against it.
 */
export function ServicingTable({
  rows,
  locale,
  timeZone,
  distanceUnit,
  canSchedule,
  isLoading = false,
}: ServicingTableProps) {
  if (isLoading) {
    return (
      <div className="space-y-3 px-5 py-4">
        {Array.from({ length: 5 }, (_, index) => (
          <Skeleton key={index} className="h-10 w-full" />
        ))}
      </div>
    )
  }

  return (
    <>
      <div className="hidden lg:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-line text-ink-subtle border-b">
              <th scope="col" className="px-5 py-2.5 text-start font-medium">
                Vehicle
              </th>
              <th scope="col" className="px-5 py-2.5 text-end font-medium">
                Odometer
              </th>
              <th scope="col" className="px-5 py-2.5 text-start font-medium">
                Next service date
              </th>
              <th scope="col" className="px-5 py-2.5 text-end font-medium">
                Next service mileage
              </th>
              <th scope="col" className="px-5 py-2.5 text-start font-medium">
                Remaining
              </th>
              <th scope="col" className="px-5 py-2.5 text-start font-medium">
                Status
              </th>
              <th scope="col" className="px-5 py-2.5 text-end font-medium">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-line divide-y">
            {rows.map(({ vehicle, record, status }) => (
              <tr key={vehicle.id} className="hover:bg-surface-muted">
                <td className="px-5 py-3">
                  <Link
                    className="text-brand-700 font-medium hover:underline"
                    to={vehicleDetailPath(vehicle.id)}
                  >
                    {vehicle.make} {vehicle.model}
                  </Link>
                  <p className="text-ink-subtle text-[0.8125rem]">{vehicle.registration_plate}</p>
                </td>
                <td data-numeric="" className="px-5 py-3 text-end">
                  {vehicle.odometer === null
                    ? '—'
                    : `${vehicle.odometer.toLocaleString(locale)} ${distanceUnit}`}
                </td>
                <td className="px-5 py-3">
                  {status.nextServiceOn
                    ? formatDate(new Date(status.nextServiceOn), { locale, timeZone })
                    : '—'}
                </td>
                <td data-numeric="" className="px-5 py-3 text-end">
                  {status.nextServiceOdometer === null
                    ? '—'
                    : `${status.nextServiceOdometer.toLocaleString(locale)} ${distanceUnit}`}
                </td>
                <td className="px-5 py-3">
                  <p>{describeServiceDate(status.byDate) ?? '—'}</p>
                  {describeServiceDistance(status.byOdometer, distanceUnit) ? (
                    <p className="text-ink-subtle text-[0.8125rem]">
                      {describeServiceDistance(status.byOdometer, distanceUnit)}
                    </p>
                  ) : null}
                </td>
                <td className="px-5 py-3">
                  <Badge tone={SERVICE_STATE_TONES[status.state]} withDot>
                    {SERVICE_STATE_LABELS[status.state]}
                  </Badge>
                </td>
                <td className="px-5 py-3 text-end">
                  {record ? (
                    <ButtonLink variant="ghost" size="sm" to={maintenanceDetailPath(record.id)}>
                      Edit service plan
                    </ButtonLink>
                  ) : canSchedule ? (
                    <ButtonLink
                      variant="ghost"
                      size="sm"
                      leadingIcon={<Wrench />}
                      to={`${paths.maintenanceNew}?vehicle=${vehicle.id}`}
                    >
                      Configure
                    </ButtonLink>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="divide-line divide-y lg:hidden">
        {rows.map(({ vehicle, record, status }) => (
          <li key={vehicle.id} className="space-y-1.5 px-5 py-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Link
                className="text-brand-700 font-medium hover:underline"
                to={vehicleDetailPath(vehicle.id)}
              >
                {vehicle.make} {vehicle.model}
              </Link>
              <Badge tone={SERVICE_STATE_TONES[status.state]} withDot>
                {SERVICE_STATE_LABELS[status.state]}
              </Badge>
            </div>
            <p className="text-ink-subtle text-[0.8125rem]">
              {vehicle.registration_plate}
              {vehicle.odometer === null
                ? ''
                : ` · ${vehicle.odometer.toLocaleString(locale)} ${distanceUnit}`}
            </p>
            <p className="text-[0.8125rem]">
              {status.nextServiceOn
                ? formatDate(new Date(status.nextServiceOn), { locale, timeZone })
                : 'No service date'}
              {status.nextServiceOdometer === null
                ? ''
                : ` · ${status.nextServiceOdometer.toLocaleString(locale)} ${distanceUnit}`}
            </p>
            <p className="text-ink-subtle text-[0.8125rem]">
              {[
                describeServiceDate(status.byDate),
                describeServiceDistance(status.byOdometer, distanceUnit),
              ]
                .filter(Boolean)
                .join(' · ') || 'No plan configured'}
            </p>
            {record ? (
              <ButtonLink variant="ghost" size="sm" to={maintenanceDetailPath(record.id)}>
                Edit service plan
              </ButtonLink>
            ) : canSchedule ? (
              <ButtonLink
                variant="ghost"
                size="sm"
                leadingIcon={<Wrench />}
                to={`${paths.maintenanceNew}?vehicle=${vehicle.id}`}
              >
                Configure service plan
              </ButtonLink>
            ) : null}
          </li>
        ))}
      </ul>
    </>
  )
}

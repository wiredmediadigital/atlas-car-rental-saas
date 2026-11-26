import { Link } from 'react-router-dom'

import { maintenanceDetailPath } from '@/app/routes/paths'
import { Badge, Skeleton } from '@/components/ui'
import { formatDate } from '@/lib/datetime/format'
import { formatMoney } from '@/lib/money/money'

import type { MaintenanceRow } from '../api'
import {
  isOverdue,
  maintenanceCategoryLabels,
  maintenancePriorityLabels,
  maintenanceStatusLabels,
  maintenanceStatusTones,
} from '../presentation'

export interface MaintenanceTableProps {
  rows: readonly MaintenanceRow[]
  /** Actual cost per record, keyed by maintenance id. Absent while loading. */
  costs: ReadonlyMap<string, number>
  locale: string
  timeZone: string
  isLoading?: boolean
}

function vehicleLabel(row: MaintenanceRow): string {
  if (!row.vehicle) return '—'
  return `${row.vehicle.make} ${row.vehicle.model}`
}

function scheduled(row: MaintenanceRow, locale: string, timeZone: string): string {
  if (!row.scheduled_start) return 'Unscheduled'
  return formatDate(new Date(row.scheduled_start), { locale, timeZone })
}

function expected(row: MaintenanceRow, locale: string, timeZone: string): string {
  const value = row.actual_completion ?? row.expected_completion
  if (!value) return '—'
  return formatDate(new Date(value), { locale, timeZone })
}

/**
 * The maintenance records list, for a desk.
 *
 * Hidden below `lg`, where MaintenanceCardList renders the same rows. Purely
 * presentational: no fetching and no filter state, so the page owns the one
 * copy of both.
 */
export function MaintenanceTable({
  rows,
  costs,
  locale,
  timeZone,
  isLoading = false,
}: MaintenanceTableProps) {
  return (
    <div className="hidden lg:block">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-line text-ink-subtle border-b text-start">
            <th scope="col" className="px-5 py-2.5 text-start font-medium">
              Reference / Vehicle
            </th>
            <th scope="col" className="px-5 py-2.5 text-start font-medium">
              Description
            </th>
            <th scope="col" className="px-5 py-2.5 text-start font-medium">
              Category
            </th>
            <th scope="col" className="px-5 py-2.5 text-start font-medium">
              Priority
            </th>
            <th scope="col" className="px-5 py-2.5 text-start font-medium">
              Scheduled
            </th>
            <th scope="col" className="px-5 py-2.5 text-start font-medium">
              Completion
            </th>
            <th scope="col" className="px-5 py-2.5 text-end font-medium">
              Actual cost
            </th>
            <th scope="col" className="px-5 py-2.5 text-start font-medium">
              Status
            </th>
          </tr>
        </thead>
        <tbody className="divide-line divide-y">
          {isLoading
            ? Array.from({ length: 5 }, (_, index) => (
                <tr key={index}>
                  <td colSpan={8} className="px-5 py-3">
                    <Skeleton className="h-5 w-full" />
                  </td>
                </tr>
              ))
            : rows.map((row) => {
                const cost = costs.get(row.id)
                return (
                  <tr key={row.id} className="hover:bg-surface-muted">
                    <td className="px-5 py-3">
                      <Link
                        className="text-brand-700 font-medium hover:underline"
                        to={maintenanceDetailPath(row.id)}
                      >
                        {row.reference}
                      </Link>
                      <p className="text-ink-subtle text-[0.8125rem]">
                        {vehicleLabel(row)}
                        {row.vehicle ? ` · ${row.vehicle.registration_plate}` : ''}
                      </p>
                    </td>
                    <td className="px-5 py-3">{row.title}</td>
                    <td className="px-5 py-3">{maintenanceCategoryLabels[row.category]}</td>
                    <td className="px-5 py-3">{maintenancePriorityLabels[row.priority]}</td>
                    <td className="px-5 py-3">
                      {scheduled(row, locale, timeZone)}
                      {isOverdue(row) ? (
                        <Badge tone="critical" className="ms-2">
                          Overdue
                        </Badge>
                      ) : null}
                    </td>
                    <td className="px-5 py-3">{expected(row, locale, timeZone)}</td>
                    <td data-numeric="" className="px-5 py-3 text-end">
                      {cost === undefined ? '—' : formatMoney(cost, row.currency, { locale })}
                    </td>
                    <td className="px-5 py-3">
                      <Badge tone={maintenanceStatusTones[row.status]} withDot>
                        {maintenanceStatusLabels[row.status]}
                      </Badge>
                    </td>
                  </tr>
                )
              })}
        </tbody>
      </table>
    </div>
  )
}

/** The same rows on a phone, where a seven-column table cannot be read. */
export function MaintenanceCardList({
  rows,
  costs,
  locale,
  timeZone,
}: Omit<MaintenanceTableProps, 'isLoading'>) {
  return (
    <ul className="divide-line divide-y lg:hidden">
      {rows.map((row) => {
        const cost = costs.get(row.id)
        return (
          <li key={row.id} className="space-y-1.5 px-5 py-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Link
                className="text-brand-700 font-medium hover:underline"
                to={maintenanceDetailPath(row.id)}
              >
                {row.reference}
              </Link>
              <Badge tone={maintenanceStatusTones[row.status]} withDot>
                {maintenanceStatusLabels[row.status]}
              </Badge>
            </div>
            <p className="text-[0.875rem]">{row.title}</p>
            <p className="text-ink-subtle text-[0.8125rem]">
              {vehicleLabel(row)}
              {row.vehicle ? ` · ${row.vehicle.registration_plate}` : ''}
            </p>
            <p className="text-ink-subtle text-[0.8125rem]">
              {maintenanceCategoryLabels[row.category]} · {maintenancePriorityLabels[row.priority]}{' '}
              · {scheduled(row, locale, timeZone)}
            </p>
            {cost === undefined ? null : (
              <p className="text-[0.8125rem] font-medium">
                {formatMoney(cost, row.currency, { locale })}
              </p>
            )}
          </li>
        )
      })}
    </ul>
  )
}

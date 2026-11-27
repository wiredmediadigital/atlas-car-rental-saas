import { Link } from 'react-router-dom'

import { incidentDetailPath } from '@/app/routes/paths'
import { Badge, Skeleton } from '@/components/ui'
import { formatDate } from '@/lib/datetime/format'

import type { IncidentDashboardRow, IncidentMaintenanceLink } from '../api'
import {
  incidentResponsibilityLabels,
  incidentStatusLabels,
  incidentTypeLabels,
  statusTone,
} from '../presentation'

export interface IncidentTableProps {
  rows: readonly IncidentDashboardRow[]
  links: Readonly<Record<string, IncidentMaintenanceLink>>
  /**
   * False while the maintenance link is still loading, or if the read failed.
   *
   * Without it every row renders "None", which is indistinguishable from an
   * incident nobody has raised any work for -- an operator would read a whole
   * screen of untouched incidents and believe it.
   */
  linksKnown: boolean
  /**
   * True when the maintenance read FAILED rather than being in flight.
   *
   * Without the distinction every row shows an ellipsis for ever, which reads
   * as "still loading" and never resolves -- so the operator waits for
   * something that is never coming instead of retrying.
   */
  linksFailed?: boolean
  locale: string
  timeZone: string
  isLoading?: boolean
}

/** The business identifier an operator reads, never the UUID. */
function vehicleName(row: IncidentDashboardRow): string {
  return row.vehicle ? `${row.vehicle.make} ${row.vehicle.model}` : 'Vehicle unavailable'
}

function occurred(row: IncidentDashboardRow, locale: string, timeZone: string): string {
  // `occurred_at` is a timestamptz -- a real instant -- so `new Date` is right
  // here, unlike the date columns elsewhere in this product. The agency's own
  // zone and locale are passed so the day shown is the day it happened there.
  return formatDate(new Date(row.occurred_at), { locale, timeZone })
}

interface MaintenanceCellProps {
  link: IncidentMaintenanceLink | undefined
  known: boolean
  failed: boolean
}

/**
 * What the incident has led to, in one cell.
 *
 * Outstanding work is called out because it is the actionable part. The total
 * is shown beside it so a resolved incident with a completed repair still reads
 * as "1 record" rather than as nothing having been done -- the incident and the
 * maintenance have independent lifecycles, and this cell must not imply
 * otherwise.
 */
function MaintenanceCell({ link, known, failed }: MaintenanceCellProps) {
  if (failed) return <span className="text-ink-subtle">Unavailable</span>
  if (!known) return <span className="text-ink-subtle">…</span>
  if (!link || link.total === 0) return <span className="text-ink-subtle">None</span>

  const records = `${link.total} record${link.total === 1 ? '' : 's'}`
  if (link.outstanding === 0) return <span>{records}</span>

  return (
    <span className="flex flex-wrap items-center gap-2">
      <Badge tone="caution">{link.outstanding} outstanding</Badge>
      <span className="text-ink-subtle text-[0.8125rem]">{records}</span>
    </span>
  )
}

/**
 * The incident records list, for a desk.
 *
 * Hidden below `lg`, where IncidentCardList renders the same rows. Purely
 * presentational: no fetching and no filter state, so the page owns the one
 * copy of both. Every row links to Incident Details, the accepted screen that
 * already shows the related maintenance, its documents and its insurance — this
 * table deliberately does not duplicate any of that.
 */
export function IncidentTable({
  rows,
  links,
  linksKnown,
  linksFailed = false,
  locale,
  timeZone,
  isLoading = false,
}: IncidentTableProps) {
  return (
    <div className="hidden lg:block">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-line text-ink-subtle border-b text-start">
            <th scope="col" className="px-5 py-2.5 text-start font-medium">
              Reference / Vehicle
            </th>
            <th scope="col" className="px-5 py-2.5 text-start font-medium">
              Type
            </th>
            <th scope="col" className="px-5 py-2.5 text-start font-medium">
              Rental
            </th>
            <th scope="col" className="px-5 py-2.5 text-start font-medium">
              Customer
            </th>
            <th scope="col" className="px-5 py-2.5 text-start font-medium">
              Responsibility
            </th>
            <th scope="col" className="px-5 py-2.5 text-start font-medium">
              Occurred
            </th>
            <th scope="col" className="px-5 py-2.5 text-start font-medium">
              Maintenance
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
            : rows.map((row) => (
                <tr key={row.id} className="hover:bg-surface-muted">
                  <td className="px-5 py-3">
                    <Link
                      className="text-brand-700 font-medium hover:underline"
                      to={incidentDetailPath(row.id)}
                    >
                      {row.reference}
                    </Link>
                    <p className="text-ink-subtle text-[0.8125rem]">
                      {vehicleName(row)}
                      {row.vehicle ? ` · ${row.vehicle.registration_plate}` : ''}
                    </p>
                  </td>
                  <td className="px-5 py-3">{incidentTypeLabels[row.incident_type]}</td>
                  <td className="px-5 py-3">
                    {row.rental ? (
                      row.rental.reference
                    ) : (
                      <span className="text-ink-subtle">Not rental-related</span>
                    )}
                  </td>
                  <td className="px-5 py-3">
                    {row.customer ? (
                      row.customer.display_name
                    ) : (
                      <span className="text-ink-subtle">—</span>
                    )}
                  </td>
                  <td className="px-5 py-3">{incidentResponsibilityLabels[row.responsibility]}</td>
                  <td className="px-5 py-3">{occurred(row, locale, timeZone)}</td>
                  <td className="px-5 py-3">
                    <MaintenanceCell link={links[row.id]} known={linksKnown} failed={linksFailed} />
                  </td>
                  <td className="px-5 py-3">
                    <Badge tone={statusTone(row.status)} withDot>
                      {incidentStatusLabels[row.status]}
                    </Badge>
                  </td>
                </tr>
              ))}
        </tbody>
      </table>
    </div>
  )
}

/** The same rows on a phone, where an eight-column table cannot be read. */
export function IncidentCardList({
  rows,
  links,
  linksKnown,
  linksFailed = false,
  locale,
  timeZone,
}: Omit<IncidentTableProps, 'isLoading'>) {
  return (
    <ul className="divide-line divide-y lg:hidden">
      {rows.map((row) => (
        <li key={row.id} className="space-y-1.5 px-5 py-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Link
              className="text-brand-700 font-medium hover:underline"
              to={incidentDetailPath(row.id)}
            >
              {row.reference}
            </Link>
            <Badge tone={statusTone(row.status)} withDot>
              {incidentStatusLabels[row.status]}
            </Badge>
          </div>

          <p className="text-ink-subtle text-[0.8125rem]">
            {vehicleName(row)}
            {row.vehicle ? ` · ${row.vehicle.registration_plate}` : ''}
          </p>

          <p className="text-[0.8125rem]">
            {incidentTypeLabels[row.incident_type]} · {occurred(row, locale, timeZone)} ·{' '}
            {incidentResponsibilityLabels[row.responsibility]}
          </p>

          <p className="text-ink-subtle text-[0.8125rem]">
            {row.rental ? row.rental.reference : 'Not rental-related'}
            {row.customer ? ` · ${row.customer.display_name}` : ''}
          </p>

          <MaintenanceCell link={links[row.id]} known={linksKnown} failed={linksFailed} />
        </li>
      ))}
    </ul>
  )
}

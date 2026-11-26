import { Link } from 'react-router-dom'
import { Wrench } from 'lucide-react'

import { paths } from '@/app/routes/paths'
import { Badge, ButtonLink, Card, CardBody, CardHeader, EmptyState } from '@/components/ui'
import {
  isOverdue,
  maintenanceCategoryLabels,
  maintenancePriorityLabels,
  maintenanceStatusLabels,
  maintenanceStatusTones,
} from '@/features/maintenance/presentation'
import { useMaintenanceForIncident } from '@/features/maintenance/queries'
import { formatDateTime } from '@/lib/datetime/format'
import { formatMoney } from '@/lib/money/money'

/**
 * The maintenance raised from one incident.
 *
 * Maintenance Details already named its incident; this is the other direction,
 * which was missing, so an operator looking at an incident could not tell
 * whether anything had been done about it without searching the maintenance
 * list. It stays visible after the incident is resolved, because the repair
 * history is part of what the incident left behind.
 */
export interface RelatedMaintenanceProps {
  incidentId: string
  vehicleId: string
  canCreate: boolean
  locale: string
  timeZone: string
}

export function RelatedMaintenance({
  incidentId,
  vehicleId,
  canCreate,
  locale,
  timeZone,
}: RelatedMaintenanceProps) {
  const query = useMaintenanceForIncident(incidentId)
  const rows = query.data ?? []

  return (
    <Card>
      <CardHeader
        title="Related maintenance"
        description="Work raised from this incident. Resolving the incident does not complete it."
        actions={
          canCreate ? (
            <ButtonLink
              variant="secondary"
              leadingIcon={<Wrench />}
              to={`${paths.maintenanceNew}?vehicle=${vehicleId}&incident=${incidentId}`}
            >
              Create maintenance
            </ButtonLink>
          ) : null
        }
      />
      <CardBody>
        {query.isLoading ? (
          <p className="text-ink-subtle text-sm">Loading maintenance…</p>
        ) : query.isError ? (
          <p role="alert" className="text-critical-600 text-sm">
            Unable to load related maintenance.
          </p>
        ) : rows.length === 0 ? (
          <EmptyState
            size="sm"
            title="No maintenance raised"
            description="If this incident needs a repair, raise it here so the vehicle is restricted while the work happens."
          />
        ) : (
          <ul className="divide-line divide-y">
            {rows.map((row) => (
              <li key={row.id} className="py-3 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <Link
                    className="text-brand-700 font-medium hover:underline"
                    to={`${paths.maintenance}/${row.id}`}
                  >
                    {row.reference} · {row.title}
                  </Link>
                  <div className="flex items-center gap-2">
                    {isOverdue(row) ? <Badge tone="critical">Overdue</Badge> : null}
                    <Badge tone={maintenanceStatusTones[row.status]} withDot>
                      {maintenanceStatusLabels[row.status]}
                    </Badge>
                  </div>
                </div>
                <p className="text-ink-subtle mt-1 text-[0.8125rem]">
                  {maintenanceCategoryLabels[row.category]} ·{' '}
                  {maintenancePriorityLabels[row.priority]}
                  {row.scheduled_start
                    ? ` · Scheduled ${formatDateTime(new Date(row.scheduled_start), { locale, timeZone })}`
                    : ''}
                  {row.expected_completion
                    ? ` → ${formatDateTime(new Date(row.expected_completion), { locale, timeZone })}`
                    : ''}
                </p>
                <p className="text-ink-subtle mt-0.5 text-[0.8125rem]">
                  {row.actual_completion
                    ? `Completed ${formatDateTime(new Date(row.actual_completion), { locale, timeZone })}`
                    : row.actual_start
                      ? `Started ${formatDateTime(new Date(row.actual_start), { locale, timeZone })}`
                      : 'Not started'}
                  {row.estimated_cost_minor !== null
                    ? ` · Estimated ${formatMoney(row.estimated_cost_minor, row.currency, { locale })}`
                    : ''}
                </p>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  )
}

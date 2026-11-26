import { Link } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { paths } from '@/app/routes/paths'
import { Badge, ButtonLink, Card, CardBody, PageHeader } from '@/components/ui'
import { useMaintenance } from '@/features/maintenance/queries'
import type { MaintenanceRow } from '@/features/maintenance/api'
const statusLabel: Record<MaintenanceRow['status'], string> = {
  scheduled: 'Scheduled',
  in_progress: 'In progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
}
const tone: Record<MaintenanceRow['status'], 'info' | 'caution' | 'positive' | 'neutral'> = {
  scheduled: 'info',
  in_progress: 'caution',
  completed: 'positive',
  cancelled: 'neutral',
}
export function MaintenancePage() {
  const query = useMaintenance()
  const rows = query.data ?? []
  return (
    <div className="space-y-6">
      <PageHeader
        title="Maintenance"
        eyebrow="Fleet"
        description="Schedule and track vehicle servicing without changing rental or financial history."
        actions={
          <ButtonLink to={paths.maintenanceNew} leadingIcon={<Plus />}>
            Schedule maintenance
          </ButtonLink>
        }
      />
      <Card>
        <CardBody>
          {query.isLoading ? (
            <p>Loading maintenance…</p>
          ) : query.isError ? (
            <p role="alert">Unable to load maintenance records.</p>
          ) : rows.length === 0 ? (
            <p className="text-ink-subtle">No maintenance records yet.</p>
          ) : (
            <div className="divide-y divide-border">
              {rows.map((row) => (
                <Link
                  key={row.id}
                  to={`${paths.maintenance}/${row.id}`}
                  className="block py-4 first:pt-0 last:pb-0 hover:bg-surface-subtle"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="font-medium">
                        {row.reference} · {row.title}
                      </p>
                      <p className="text-sm text-ink-subtle">
                        {row.vehicle
                          ? `${row.vehicle.make} ${row.vehicle.model} · ${row.vehicle.registration_plate}`
                          : row.vehicle_id}
                      </p>
                    </div>
                    <Badge tone={tone[row.status]} withDot>
                      {statusLabel[row.status]}
                    </Badge>
                  </div>
                  <p className="mt-2 text-sm text-ink-subtle">
                    {row.category.replaceAll('_', ' ')} · {row.priority} ·{' '}
                    {row.scheduled_start
                      ? new Date(row.scheduled_start).toLocaleString()
                      : 'Immediate / unscheduled'}
                  </p>
                </Link>
              ))}
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  )
}

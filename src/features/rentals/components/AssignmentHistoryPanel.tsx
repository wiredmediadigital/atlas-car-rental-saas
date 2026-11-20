import { Card, CardBody, CardHeader } from '@/components/ui'
import type { RentalAssignmentHistoryRow } from '@/types/database'

export function AssignmentHistoryPanel({
  rows,
  formatDate,
}: {
  rows: RentalAssignmentHistoryRow[]
  formatDate: (value: string) => string
}) {
  if (rows.length === 0) return null
  return (
    <Card>
      <CardHeader
        title="Vehicle assignment history"
        description="The current vehicle and every recorded replacement."
      />
      <CardBody>
        <div className="divide-ink-faint divide-y">
          {rows.map((row) => (
            <div
              key={row.assignment_id}
              className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
            >
              <div>
                <p className="text-ink text-sm font-medium">{row.registration_plate}</p>
                <p className="text-ink-subtle text-xs">
                  {row.reason.replaceAll('_', ' ')} · {row.inspection_count} inspection
                  {row.inspection_count === 1 ? '' : 's'}
                </p>
              </div>
              <div className="text-right text-xs">
                <p className="text-ink capitalize">{row.state.replaceAll('_', ' ')}</p>
                <p className="text-ink-subtle">
                  {formatDate(row.started_at ?? row.scheduled_starts_at)}
                </p>
              </div>
            </div>
          ))}
        </div>
      </CardBody>
    </Card>
  )
}

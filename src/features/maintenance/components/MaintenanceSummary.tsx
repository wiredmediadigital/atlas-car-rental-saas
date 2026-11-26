import { MetricTile } from '@/features/overview/components/MetricTile'
import { formatMoney } from '@/lib/money/money'

import type { MaintenanceSpendRow } from '../api'
import type { MaintenanceCounts } from '../dashboard'
import type { ServicingCounts } from '../dashboard'
import { formatDuration } from '../presentation'

/**
 * What the fleet's maintenance looks like right now, and what it cost.
 *
 * The first six figures are states, not period totals: "2 scheduled" means two
 * are scheduled, today, whatever month is selected. Only the last two are
 * period figures, and their captions say so — a tile that silently mixes the
 * two is the kind of number somebody puts in a board pack and cannot explain.
 */
export interface MaintenanceSummaryProps {
  counts: MaintenanceCounts
  servicing: ServicingCounts
  spend: readonly MaintenanceSpendRow[]
  downtimeMinutes: number | null
  periodLabel: string
  locale: string
  isLoading: boolean
  isSpendLoading: boolean
  isDowntimeLoading: boolean
  /** True while the corrective migration has not been applied yet. */
  isDowntimeUnavailable?: boolean
}

export function MaintenanceSummary({
  counts,
  servicing,
  spend,
  downtimeMinutes,
  periodLabel,
  locale,
  isLoading,
  isSpendLoading,
  isDowntimeLoading,
  isDowntimeUnavailable = false,
}: MaintenanceSummaryProps) {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <MetricTile label="Scheduled" value={counts.scheduled} isLoading={isLoading} />
        <MetricTile label="In progress" value={counts.inProgress} isLoading={isLoading} />
        <MetricTile label="Completed" value={counts.completed} isLoading={isLoading} />
        <MetricTile
          label="Service due soon"
          value={servicing.dueSoon}
          caption="Approaching a date or a distance threshold."
          isLoading={isLoading}
        />
        <MetricTile
          label="Service overdue"
          value={servicing.overdue}
          caption="Past the threshold, or due today. A reminder only."
          isLoading={isLoading}
        />
        <MetricTile
          label="Vehicles in maintenance"
          value={counts.vehiclesInMaintenance}
          caption="Distinct vehicles with work under way."
          isLoading={isLoading}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <MetricTile
          label={`Maintenance costs · ${periodLabel}`}
          emphasis="strong"
          isLoading={isSpendLoading}
          value={
            spend.length === 0 ? (
              '—'
            ) : (
              <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                {spend.map((row) => (
                  <span key={row.currency}>
                    {formatMoney(row.total_minor, row.currency, { locale })}
                  </span>
                ))}
              </span>
            )
          }
          caption={
            spend.length > 1
              ? 'Shown per currency. Two currencies are never added together.'
              : 'Costs in the expense ledger attached to a maintenance record.'
          }
        />
        <MetricTile
          label={`Actual downtime · ${periodLabel}`}
          emphasis="strong"
          isLoading={isDowntimeLoading}
          value={isDowntimeUnavailable ? 'Unavailable' : formatDuration(downtimeMinutes)}
          caption={
            isDowntimeUnavailable
              ? 'Needs the maintenance service plan migration to be applied to this project.'
              : 'Time vehicles were actually out of service. Work scheduled but never started is not counted, and two jobs on one vehicle count once.'
          }
        />
      </div>
    </div>
  )
}

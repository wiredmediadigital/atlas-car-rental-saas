import { MetricTile } from '@/features/overview/components/MetricTile'
import { cn } from '@/lib/utils/cn'

import type { IncidentSummaryFigures } from '../dashboard'

/**
 * What the agency's incidents look like, and what happened in the period.
 *
 * TWO KINDS OF FIGURE, SAID OUT LOUD. The first row is the selected period:
 * what was reported, how much of it is closed, how much involved a rental. The
 * second row is now, regardless of when the incident happened — an incident
 * opened in March and never closed is the most important row on this page, and
 * a tile that hid it behind a month selector would be worse than no tile. Every
 * caption says which kind it is, because a figure somebody puts in a board pack
 * and cannot explain is a liability.
 *
 * The tiles are filter controls. Each one narrows the list beneath it to the
 * rows it counted, which is the only honest way to let somebody check a number
 * they do not believe.
 */
export interface IncidentSummaryProps {
  figures: IncidentSummaryFigures
  periodLabel: string
  isLoading: boolean
  /** True when the incident read failed: the tiles must not show a confident 0. */
  isUnavailable?: boolean
  /**
   * True when the MAINTENANCE read failed.
   *
   * Tracked separately because the two queries fail independently. With one
   * flag, a failed maintenance read left `links` as an empty map and the
   * Outstanding maintenance tile reported a confident `0` -- while the table
   * in the same card honestly showed "…" on every row, so the page
   * contradicted itself on one screen.
   */
  isMaintenanceUnavailable?: boolean
  onSelect: (selection: IncidentSummarySelection) => void
}

export type IncidentSummarySelection =
  | 'period-all'
  | 'period-resolved'
  | 'period-rental'
  | 'open'
  | 'vehicles-affected'
  | 'outstanding-maintenance'

interface TileProps {
  label: string
  value: number
  caption: string
  isLoading: boolean
  isUnavailable: boolean
  /** Shown instead of the caption when the figure cannot be produced. */
  unavailableNote: string
  onClick: () => void
}

/**
 * A tile that is also a button.
 *
 * Wrapped rather than teaching `MetricTile` to be clickable: that component is
 * shared with the Overview and the accepted Maintenance dashboard, and an
 * optional prop there would be a change to both for the benefit of one.
 *
 * NO `aria-label`. An `aria-label` REPLACES the accessible name computed from
 * the content, so "Open incidents: filter the list" would announce the tile
 * and silently withhold the only thing on it that matters -- the number. The
 * name is left to the content, and the visually hidden line below adds what a
 * sighted user infers from the cursor: that this thing can be clicked.
 *
 * The hover affordance is a ring rather than a border colour. The button
 * itself has no border -- the border belongs to the MetricTile inside it -- so
 * a `hover:border-*` class here would generate a rule that changes a colour
 * nothing is drawing, which is to say nothing at all.
 */
function ClickableTile({
  label,
  value,
  caption,
  isLoading,
  isUnavailable,
  unavailableNote,
  onClick,
}: TileProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isUnavailable}
      className={cn(
        'rounded-lg text-start transition-shadow',
        'focus-visible:outline-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2',
        isUnavailable
          ? 'cursor-default opacity-80'
          : 'hover:ring-line-strong cursor-pointer hover:ring-2',
      )}
    >
      <MetricTile
        label={label}
        // Never a confident zero over a failed read: "—" is honest, "0" is a
        // claim the page cannot support, and nobody re-checks a plausible
        // number.
        value={isUnavailable ? '—' : value}
        caption={isUnavailable ? unavailableNote : caption}
        isLoading={isLoading}
        className="h-full"
      />
      {isUnavailable ? null : <span className="sr-only">Filter the list by {label}</span>}
    </button>
  )
}

export function IncidentSummary({
  figures,
  periodLabel,
  isLoading,
  isUnavailable = false,
  isMaintenanceUnavailable = false,
  onSelect,
}: IncidentSummaryProps) {
  const common = {
    isLoading,
    isUnavailable,
    unavailableNote: 'Unavailable — the incident list could not be loaded.',
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <ClickableTile
          {...common}
          label={`Total incidents · ${periodLabel}`}
          value={figures.total}
          caption="Reported in the selected period."
          onClick={() => onSelect('period-all')}
        />
        <ClickableTile
          {...common}
          label={`Resolved · ${periodLabel}`}
          value={figures.resolved}
          caption="Reported in the period and since resolved."
          onClick={() => onSelect('period-resolved')}
        />
        <ClickableTile
          {...common}
          label={`Rental-related · ${periodLabel}`}
          value={figures.rentalRelated}
          caption="Reported in the period against a rental."
          onClick={() => onSelect('period-rental')}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <ClickableTile
          {...common}
          label="Open incidents"
          value={figures.open}
          caption="Not resolved, whenever they happened. Not limited to the period."
          onClick={() => onSelect('open')}
        />
        <ClickableTile
          {...common}
          label="Vehicles affected"
          value={figures.vehiclesAffected}
          caption="Distinct vehicles with an unresolved incident. Counted once each."
          onClick={() => onSelect('vehicles-affected')}
        />
        <ClickableTile
          {...common}
          // This figure needs the maintenance read as well as the incident
          // one, so either failure makes it unavailable rather than zero.
          isUnavailable={isUnavailable || isMaintenanceUnavailable}
          unavailableNote={
            isUnavailable
              ? 'Unavailable — the incident list could not be loaded.'
              : 'Unavailable — the related maintenance could not be loaded.'
          }
          label="Outstanding maintenance"
          value={figures.withOutstandingMaintenance}
          caption="Incidents with work scheduled or in progress. Counted once per incident."
          onClick={() => onSelect('outstanding-maintenance')}
        />
      </div>
    </div>
  )
}

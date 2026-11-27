import { ChevronLeft, ChevronRight, Search, SlidersHorizontal } from 'lucide-react'
import { useEffect, useState } from 'react'

import { Badge, Button, Field, Input, Select } from '@/components/ui'
import type { IncidentType } from '@/types/database'

import { countActiveFilters, type IncidentListFilters } from '../dashboard'
import {
  incidentResponsibilityLabels,
  incidentStatusLabels,
  incidentTypeLabels,
} from '../presentation'

export interface IncidentToolbarProps {
  filters: IncidentListFilters
  onChange: (patch: Partial<IncidentListFilters>) => void
  onClearAll: () => void
  vehicles: readonly { id: string; label: string }[]
  periodLabel: string
  onStepPeriod: (direction: -1 | 1) => void
  onThisMonth: () => void
  isCurrentMonth: boolean
  /** True when the period is switched off and every incident is listed. */
  /** False while the maintenance link cannot be read: its filters would lie. */
  isMaintenanceUsable?: boolean
  isAllTime: boolean
  onToggleAllTime: () => void
}

/**
 * Period, search and filters for the incident records list.
 *
 * Deliberately the same shape as the maintenance and expense toolbars: the
 * period on the left, a debounced search, and the rest folded away behind one
 * button carrying a count. An operator who has learnt one list screen in this
 * product has learnt them all, and a second convention would cost more than it
 * is worth.
 *
 * ALL TIME IS NOT A FILTER, IT IS THE PERIOD SWITCHED OFF. An unresolved
 * incident from eight months ago is precisely what somebody opens this page to
 * find, and a month selector with no way out would bury it. It sits with the
 * stepper rather than in the filter drawer so it is visible without opening
 * anything, and the month controls are disabled while it is on, because
 * stepping a month that is not in use reads as a broken control.
 */
export function IncidentToolbar({
  filters,
  onChange,
  onClearAll,
  vehicles,
  periodLabel,
  onStepPeriod,
  onThisMonth,
  isCurrentMonth,
  isMaintenanceUsable = true,
  isAllTime,
  onToggleAllTime,
}: IncidentToolbarProps) {
  const [draft, setDraft] = useState(filters.search)
  const [lastApplied, setLastApplied] = useState(filters.search)
  const [showFilters, setShowFilters] = useState(false)

  // Follows the parent when it changes the term itself — "Clear all", a summary
  // tile, or a back navigation restoring an earlier URL.
  if (filters.search !== lastApplied) {
    setLastApplied(filters.search)
    setDraft(filters.search)
  }

  useEffect(() => {
    if (draft === filters.search) return
    const timer = setTimeout(() => onChange({ search: draft }), 250)
    return () => clearTimeout(timer)
  }, [draft, filters.search, onChange])

  const activeFilterCount = countActiveFilters(filters)

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="border-line-strong bg-surface shadow-raised flex items-center rounded-md border">
          <Button
            variant="ghost"
            size="sm"
            aria-label="Previous month"
            className="rounded-e-none"
            disabled={isAllTime}
            onClick={() => onStepPeriod(-1)}
          >
            <ChevronLeft className="size-4" aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="border-line-strong rounded-none border-x px-3"
            onClick={onThisMonth}
            disabled={isAllTime || isCurrentMonth}
          >
            This month
          </Button>
          <Button
            variant="ghost"
            size="sm"
            aria-label="Next month"
            className="rounded-s-none"
            disabled={isAllTime}
            onClick={() => onStepPeriod(1)}
          >
            <ChevronRight className="size-4" aria-hidden="true" />
          </Button>
        </div>

        <Button
          variant={isAllTime ? 'secondary' : 'ghost'}
          size="sm"
          aria-pressed={isAllTime}
          onClick={onToggleAllTime}
        >
          All time
        </Button>

        <p className="text-ink text-[0.9375rem] font-semibold">{periodLabel}</p>

        <div className="ms-auto flex flex-wrap items-center gap-2">
          <div className="relative w-full min-w-0 flex-1 sm:max-w-sm">
            <Search
              className="text-ink-subtle pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2"
              aria-hidden="true"
            />
            <Input
              type="search"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Search reference, vehicle, rental or customer"
              aria-label="Search incidents"
              className="ps-9"
            />
          </div>

          <Button
            variant={showFilters || activeFilterCount > 0 ? 'secondary' : 'ghost'}
            leadingIcon={<SlidersHorizontal />}
            onClick={() => setShowFilters((open) => !open)}
            aria-expanded={showFilters}
            aria-controls="incident-filters"
          >
            Filters
            {activeFilterCount > 0 ? (
              <Badge tone="brand" className="ms-1">
                {activeFilterCount}
              </Badge>
            ) : null}
          </Button>
        </div>
      </div>

      {showFilters ? (
        <div
          id="incident-filters"
          className="border-line bg-surface grid gap-4 rounded-lg border p-4 sm:grid-cols-2 lg:grid-cols-3"
        >
          <Field label="Status">
            <Select
              value={filters.status}
              onChange={(event) =>
                onChange({ status: event.target.value as IncidentListFilters['status'] })
              }
              options={[
                { value: 'any', label: 'Any status' },
                // Not a database status: open OR in progress. It is what the
                // "Open incidents" tile counts, so it has to be reachable here
                // too or the figure could not be checked.
                { value: 'unresolved', label: 'Unresolved (open or in progress)' },
                ...Object.entries(incidentStatusLabels).map(([value, label]) => ({ value, label })),
              ]}
            />
          </Field>

          <Field label="Type">
            <Select
              value={filters.type}
              onChange={(event) => onChange({ type: event.target.value as IncidentType | 'any' })}
              options={[
                { value: 'any', label: 'Any type' },
                ...Object.entries(incidentTypeLabels).map(([value, label]) => ({ value, label })),
              ]}
            />
          </Field>

          <Field label="Responsibility">
            <Select
              value={filters.responsibility}
              onChange={(event) =>
                onChange({
                  responsibility: event.target.value as IncidentListFilters['responsibility'],
                })
              }
              options={[
                { value: 'any', label: 'Any responsibility' },
                ...Object.entries(incidentResponsibilityLabels).map(([value, label]) => ({
                  value,
                  label,
                })),
              ]}
            />
          </Field>

          <Field label="Vehicle">
            <Select
              value={filters.vehicleId}
              onChange={(event) => onChange({ vehicleId: event.target.value })}
              options={[
                { value: '', label: 'Any vehicle' },
                ...vehicles.map((vehicle) => ({ value: vehicle.id, label: vehicle.label })),
              ]}
            />
          </Field>

          <Field
            label="Maintenance"
            hint={
              isMaintenanceUsable
                ? 'Work raised from the incident, whatever its own status.'
                : 'Unavailable — the related maintenance could not be loaded.'
            }
          >
            <Select
              // Disabled rather than left working on an empty link map, where
              // "No maintenance raised" would match every incident in the
              // agency and look like a confident answer.
              disabled={!isMaintenanceUsable}
              value={isMaintenanceUsable ? filters.maintenance : 'any'}
              onChange={(event) =>
                onChange({ maintenance: event.target.value as IncidentListFilters['maintenance'] })
              }
              options={[
                { value: 'any', label: 'Any' },
                { value: 'outstanding', label: 'Has outstanding maintenance' },
                { value: 'none', label: 'No maintenance raised' },
              ]}
            />
          </Field>

          <Field label="Rental">
            <Select
              value={filters.rental}
              onChange={(event) =>
                onChange({ rental: event.target.value as IncidentListFilters['rental'] })
              }
              options={[
                { value: 'any', label: 'Any' },
                { value: 'rental', label: 'Rental-related' },
                { value: 'standalone', label: 'Not rental-related' },
              ]}
            />
          </Field>

          <Field label="Occurred from" hint="Filters on the date of the incident.">
            <Input
              type="date"
              value={filters.from}
              onChange={(event) => onChange({ from: event.target.value })}
            />
          </Field>

          <Field label="Occurred to">
            <Input
              type="date"
              value={filters.to}
              onChange={(event) => onChange({ to: event.target.value })}
            />
          </Field>

          <div className="flex items-end lg:col-span-3">
            <Button variant="ghost" onClick={onClearAll} disabled={activeFilterCount === 0}>
              Clear all filters
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

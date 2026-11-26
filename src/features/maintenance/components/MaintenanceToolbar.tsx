import { ChevronLeft, ChevronRight, Search, SlidersHorizontal } from 'lucide-react'
import { useEffect, useState } from 'react'

import { Badge, Button, Field, Input, Select } from '@/components/ui'

import type { MaintenanceCategory, MaintenancePriority, MaintenanceRow } from '../api'
import {
  maintenanceCategoryLabels,
  maintenancePriorityLabels,
  maintenanceStatusLabels,
} from '../presentation'

export interface MaintenanceFilters {
  readonly search: string
  readonly status: MaintenanceRow['status'] | 'any'
  readonly vehicleId: string
  readonly category: MaintenanceCategory | 'any'
  readonly priority: MaintenancePriority | 'any'
  readonly from: string
  readonly to: string
}

export const EMPTY_MAINTENANCE_FILTERS: MaintenanceFilters = {
  search: '',
  status: 'any',
  vehicleId: '',
  category: 'any',
  priority: 'any',
  from: '',
  to: '',
}

export interface MaintenanceToolbarProps {
  filters: MaintenanceFilters
  onChange: (patch: Partial<MaintenanceFilters>) => void
  onClearAll: () => void
  vehicles: readonly { id: string; label: string }[]
  periodLabel: string
  onStepPeriod: (direction: -1 | 1) => void
  onThisMonth: () => void
  isCurrentMonth: boolean
}

/**
 * Period, search and filters for the maintenance records list.
 *
 * Deliberately the same shape as the expense toolbar: the period on the left,
 * a debounced search, and the rest folded away behind one button with a count.
 * An operator who has learnt one list screen in this product has learnt them
 * all, and a second convention would cost more than it is worth.
 *
 * The period governs the two figures that are period figures — spend and
 * downtime — and the scheduled-date filter. It does not hide records: a list
 * that silently dropped next month's scheduled work would be worse than
 * useless to the person planning it.
 */
export function MaintenanceToolbar({
  filters,
  onChange,
  onClearAll,
  vehicles,
  periodLabel,
  onStepPeriod,
  onThisMonth,
  isCurrentMonth,
}: MaintenanceToolbarProps) {
  const [draft, setDraft] = useState(filters.search)
  const [lastApplied, setLastApplied] = useState(filters.search)
  const [showFilters, setShowFilters] = useState(false)

  // Follows the parent when it changes the term itself — "Clear all", or a
  // back navigation restoring an earlier URL.
  if (filters.search !== lastApplied) {
    setLastApplied(filters.search)
    setDraft(filters.search)
  }

  useEffect(() => {
    if (draft === filters.search) return
    const timer = setTimeout(() => onChange({ search: draft }), 250)
    return () => clearTimeout(timer)
  }, [draft, filters.search, onChange])

  const activeFilterCount =
    (filters.status !== 'any' ? 1 : 0) +
    (filters.vehicleId !== '' ? 1 : 0) +
    (filters.category !== 'any' ? 1 : 0) +
    (filters.priority !== 'any' ? 1 : 0) +
    (filters.from !== '' ? 1 : 0) +
    (filters.to !== '' ? 1 : 0)

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="border-line-strong bg-surface shadow-raised flex items-center rounded-md border">
          <Button
            variant="ghost"
            size="sm"
            aria-label="Previous month"
            className="rounded-e-none"
            onClick={() => onStepPeriod(-1)}
          >
            <ChevronLeft className="size-4" aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="border-line-strong rounded-none border-x px-3"
            onClick={onThisMonth}
            disabled={isCurrentMonth}
          >
            This month
          </Button>
          <Button
            variant="ghost"
            size="sm"
            aria-label="Next month"
            className="rounded-s-none"
            onClick={() => onStepPeriod(1)}
          >
            <ChevronRight className="size-4" aria-hidden="true" />
          </Button>
        </div>

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
              placeholder="Search reference, title, vehicle or plate"
              aria-label="Search maintenance"
              className="ps-9"
            />
          </div>

          <Button
            variant={showFilters || activeFilterCount > 0 ? 'secondary' : 'ghost'}
            leadingIcon={<SlidersHorizontal />}
            onClick={() => setShowFilters((open) => !open)}
            aria-expanded={showFilters}
            aria-controls="maintenance-filters"
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
          id="maintenance-filters"
          className="border-line bg-surface grid gap-4 rounded-lg border p-4 sm:grid-cols-2 lg:grid-cols-3"
        >
          <Field label="Status">
            <Select
              value={filters.status}
              onChange={(event) =>
                onChange({ status: event.target.value as MaintenanceFilters['status'] })
              }
              options={[
                { value: 'any', label: 'Any status' },
                ...Object.entries(maintenanceStatusLabels).map(([value, label]) => ({
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

          <Field label="Category">
            <Select
              value={filters.category}
              onChange={(event) =>
                onChange({ category: event.target.value as MaintenanceFilters['category'] })
              }
              options={[
                { value: 'any', label: 'Any category' },
                ...Object.entries(maintenanceCategoryLabels).map(([value, label]) => ({
                  value,
                  label,
                })),
              ]}
            />
          </Field>

          <Field label="Priority">
            <Select
              value={filters.priority}
              onChange={(event) =>
                onChange({ priority: event.target.value as MaintenanceFilters['priority'] })
              }
              options={[
                { value: 'any', label: 'Any priority' },
                ...Object.entries(maintenancePriorityLabels).map(([value, label]) => ({
                  value,
                  label,
                })),
              ]}
            />
          </Field>

          <Field label="Scheduled from" hint="Filters on the scheduled start date.">
            <Input
              type="date"
              value={filters.from}
              onChange={(event) => onChange({ from: event.target.value })}
            />
          </Field>

          <Field label="Scheduled to">
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

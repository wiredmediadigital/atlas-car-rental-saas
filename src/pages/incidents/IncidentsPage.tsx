import { Plus, SearchX, TriangleAlert } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { paths } from '@/app/routes/paths'
import { ButtonLink, Card, CardBody, EmptyState, ListPagination, PageHeader } from '@/components/ui'
import {
  IncidentSummary,
  type IncidentSummarySelection,
} from '@/features/incidents/components/IncidentSummary'
import { IncidentCardList, IncidentTable } from '@/features/incidents/components/IncidentTable'
import { IncidentToolbar } from '@/features/incidents/components/IncidentToolbar'
import {
  filterIncidentRows,
  incidentVehicleOptions,
  summariseIncidents,
  type IncidentListFilters,
  type IncidentPeriod,
} from '@/features/incidents/dashboard'
import { useIncidentDashboard, useIncidentMaintenanceLinks } from '@/features/incidents/queries'
import { useOrganization } from '@/features/workspace/workspace-context'
import {
  addMonthsInTimeZone,
  startOfMonthInTimeZone,
  toIsoDateInTimeZone,
} from '@/lib/datetime/timezone'

const PAGE_SIZE = 25

const FILTER_KEYS = [
  'q',
  'status',
  'type',
  'responsibility',
  'vehicle',
  'from',
  'to',
  'maintenance',
  'rental',
] as const

/**
 * Incident Management.
 *
 * Built on the accepted Maintenance dashboard rather than beside it: the same
 * page skeleton, the same period stepper, the same debounced search and folded
 * filter drawer, the same clamped pagination, the same responsive table and
 * card-list split. An operator who has learnt Maintenance has learnt this, and
 * a second set of conventions would cost more than it is worth.
 *
 * THE SUMMARY MIXES TWO KINDS OF FIGURE AND SAYS WHICH IS WHICH. Three tiles
 * describe the selected period; three describe now, regardless of when the
 * incident happened. The second group is the point of the page — an incident
 * opened in March and never closed must not be hidden behind a month selector —
 * and the "All time" control exists so the LIST can reach those rows too.
 *
 * Nothing here changes an incident, a maintenance record or a vehicle's
 * availability. It is a reading surface: every action routes to the accepted
 * screens that already own those lifecycles.
 */
export function IncidentsPage() {
  const organization = useOrganization()

  const [searchParams, setSearchParams] = useSearchParams()
  const [now] = useState(() => new Date())

  const timeZone = organization.time_zone
  const locale = organization.locale

  const isAllTime = searchParams.get('period') === 'all'

  // The period is resolved in the agency's own zone, so "this month" means the
  // month the agency is in rather than the month the server is in.
  const period = useMemo(() => {
    const anchorIso = searchParams.get('month')
    const anchor =
      anchorIso && /^\d{4}-\d{2}$/.test(anchorIso)
        ? new Date(`${anchorIso}-01T12:00:00Z`)
        : startOfMonthInTimeZone(now, timeZone)

    const start = startOfMonthInTimeZone(anchor, timeZone)
    const end = addMonthsInTimeZone(start, timeZone, 1)

    return {
      // Instants, because `occurred_at` is a timestamptz. A bare YYYY-MM-DD
      // would be read at the server's midnight rather than the agency's, so the
      // window would not cover the month its own label names.
      fromInstant: start.toISOString(),
      toInstant: end.toISOString(),
      label: new Intl.DateTimeFormat(locale, {
        month: 'long',
        year: 'numeric',
        timeZone,
      }).format(start),
      monthParam: toIsoDateInTimeZone(start, timeZone).slice(0, 7),
    }
  }, [searchParams, now, timeZone, locale])

  // Memoised, not computed inline: a fresh object every render would change
  // the identity the summary and filter memos below depend on, so both would
  // recompute over the whole incident list on every keystroke.
  const activePeriod: IncidentPeriod | null = useMemo(
    () => (isAllTime ? null : { fromInstant: period.fromInstant, toInstant: period.toInstant }),
    [isAllTime, period.fromInstant, period.toInstant],
  )

  const periodLabel = isAllTime ? 'All time' : period.label

  const isCurrentMonth =
    period.monthParam ===
    toIsoDateInTimeZone(startOfMonthInTimeZone(now, timeZone), timeZone).slice(0, 7)

  const filters: IncidentListFilters = useMemo(
    () => ({
      search: searchParams.get('q') ?? '',
      status: (searchParams.get('status') ?? 'any') as IncidentListFilters['status'],
      type: (searchParams.get('type') ?? 'any') as IncidentListFilters['type'],
      responsibility: (searchParams.get('responsibility') ??
        'any') as IncidentListFilters['responsibility'],
      vehicleId: searchParams.get('vehicle') ?? '',
      from: searchParams.get('from') ?? '',
      to: searchParams.get('to') ?? '',
      maintenance: (searchParams.get('maintenance') ?? 'any') as IncidentListFilters['maintenance'],
      rental: (searchParams.get('rental') ?? 'any') as IncidentListFilters['rental'],
    }),
    [searchParams],
  )

  const requestedPage = Math.max(1, Number(searchParams.get('page') ?? '1') || 1)

  const updateParams = useCallback(
    (mutate: (params: URLSearchParams) => void, { resetPage = true } = {}) => {
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current)
          mutate(next)
          if (resetPage) next.delete('page')
          return next
        },
        { replace: true },
      )
    },
    [setSearchParams],
  )

  const changeFilters = useCallback(
    (patch: Partial<IncidentListFilters>) => {
      updateParams((params) => {
        const set = (key: string, value: string, fallback: string) => {
          if (value === fallback) params.delete(key)
          else params.set(key, value)
        }
        if (patch.search !== undefined) set('q', patch.search, '')
        if (patch.status !== undefined) set('status', patch.status, 'any')
        if (patch.type !== undefined) set('type', patch.type, 'any')
        if (patch.responsibility !== undefined) set('responsibility', patch.responsibility, 'any')
        if (patch.vehicleId !== undefined) set('vehicle', patch.vehicleId, '')
        if (patch.from !== undefined) set('from', patch.from, '')
        if (patch.to !== undefined) set('to', patch.to, '')
        if (patch.maintenance !== undefined) set('maintenance', patch.maintenance, 'any')
        if (patch.rental !== undefined) set('rental', patch.rental, 'any')
      })
    },
    [updateParams],
  )

  const clearFilters = useCallback(() => {
    updateParams((params) => {
      for (const key of FILTER_KEYS) params.delete(key)
    })
  }, [updateParams])

  const stepPeriod = (direction: -1 | 1) =>
    updateParams((params) => {
      const start = startOfMonthInTimeZone(new Date(`${period.monthParam}-01T12:00:00Z`), timeZone)
      const moved = addMonthsInTimeZone(start, timeZone, direction)
      params.set('month', toIsoDateInTimeZone(moved, timeZone).slice(0, 7))
    })

  /**
   * A summary tile narrows the list to the rows it counted.
   *
   * The three current-state tiles also switch the list to All time, because
   * they counted across all time. A tile that filtered to "open" while leaving
   * the list bounded to November would show four of the nine it had just
   * counted, and the operator would be right to distrust the number.
   */
  const applySelection = useCallback(
    (selection: IncidentSummarySelection) => {
      updateParams((params) => {
        for (const key of FILTER_KEYS) params.delete(key)

        /*
         * The three period tiles leave the period EXACTLY as it is. They
         * counted whatever window is selected -- including "All time" -- so
         * resetting it here would drop the list back to the current month
         * under a figure that had just counted eight years, which is the
         * contradiction this whole drill-down exists to prevent.
         */
        if (selection === 'period-resolved') params.set('status', 'resolved')
        if (selection === 'period-rental') params.set('rental', 'rental')

        if (selection === 'open' || selection === 'vehicles-affected') {
          params.set('period', 'all')
          params.set('status', 'unresolved')
        }
        if (selection === 'outstanding-maintenance') {
          params.set('period', 'all')
          params.set('maintenance', 'outstanding')
        }
      })
    },
    [updateParams],
  )

  const incidents = useIncidentDashboard()
  const links = useIncidentMaintenanceLinks()

  const rows = useMemo(() => incidents.data ?? [], [incidents.data])
  const linkMap = useMemo(() => links.data ?? {}, [links.data])

  /*
   * The two reads fail independently, and the maintenance filters are only
   * meaningful once the link map has arrived.
   *
   * Without this, a failed maintenance read made `linkMap` an empty object and
   * the filter inverted silently: "No maintenance raised" matched EVERY
   * incident in the agency, asserting that nothing anywhere had any work
   * against it. The control is disabled and says why instead.
   */
  const linksUsable = links.isSuccess
  const effectiveFilters = useMemo(
    () => (linksUsable ? filters : { ...filters, maintenance: 'any' as const }),
    [filters, linksUsable],
  )

  const figures = useMemo(
    () => summariseIncidents(rows, linkMap, activePeriod),
    [rows, linkMap, activePeriod],
  )

  const filtered = useMemo(
    () => filterIncidentRows(rows, linkMap, effectiveFilters, activePeriod, timeZone),
    [rows, linkMap, effectiveFilters, activePeriod, timeZone],
  )

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  // Clamped, so a stale or hand-edited ?page= shows the last page of results
  // rather than a blank card with no control to escape it.
  const page = Math.min(requestedPage, pageCount)
  const visible = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const vehicleOptions = useMemo(() => incidentVehicleOptions(rows), [rows])

  const isListLoading = incidents.isPending

  return (
    <div className="space-y-6">
      <PageHeader
        title="Incidents"
        eyebrow="Operations"
        description="Track operational events without changing rental or vehicle history."
        actions={
          <ButtonLink to={paths.incidentNew} leadingIcon={<Plus />}>
            Report incident
          </ButtonLink>
        }
      />

      <IncidentSummary
        figures={figures}
        periodLabel={periodLabel}
        isLoading={isListLoading || links.isPending}
        isUnavailable={incidents.isError}
        isMaintenanceUnavailable={links.isError}
        onSelect={applySelection}
      />

      <div className="space-y-4">
        <IncidentToolbar
          filters={filters}
          onChange={changeFilters}
          onClearAll={clearFilters}
          vehicles={vehicleOptions}
          periodLabel={periodLabel}
          onStepPeriod={stepPeriod}
          onThisMonth={() => updateParams((params) => params.delete('month'))}
          isCurrentMonth={isCurrentMonth}
          isMaintenanceUsable={linksUsable}
          isAllTime={isAllTime}
          onToggleAllTime={() =>
            updateParams((params) => {
              if (isAllTime) params.delete('period')
              else params.set('period', 'all')
            })
          }
        />

        <Card>
          {incidents.isError ? (
            <CardBody>
              <p role="alert" className="text-critical-600">
                Unable to load incidents.
              </p>
            </CardBody>
          ) : !isListLoading && filtered.length === 0 ? (
            <CardBody>
              <EmptyState
                icon={rows.length === 0 ? TriangleAlert : SearchX}
                title={rows.length === 0 ? 'No incidents yet' : 'Nothing matches those filters'}
                description={
                  rows.length === 0
                    ? 'Report a breakdown, an accident or damage and it will appear here with any maintenance it leads to.'
                    : 'Try a different status, vehicle or period — or switch to All time to find older unresolved incidents.'
                }
                action={
                  rows.length === 0 ? (
                    <ButtonLink to={paths.incidentNew} leadingIcon={<Plus />}>
                      Report incident
                    </ButtonLink>
                  ) : undefined
                }
              />
            </CardBody>
          ) : (
            <>
              <IncidentTable
                rows={visible}
                links={linkMap}
                linksKnown={links.isSuccess}
                linksFailed={links.isError}
                locale={locale}
                timeZone={timeZone}
                isLoading={isListLoading}
              />
              {isListLoading ? null : (
                <IncidentCardList
                  rows={visible}
                  links={linkMap}
                  linksKnown={links.isSuccess}
                  linksFailed={links.isError}
                  locale={locale}
                  timeZone={timeZone}
                />
              )}
              <ListPagination
                page={page}
                pageCount={pageCount}
                total={filtered.length}
                noun="incident"
                onPageChange={(next) =>
                  updateParams((params) => params.set('page', String(next)), {
                    resetPage: false,
                  })
                }
              />
            </>
          )}
        </Card>
      </div>
    </div>
  )
}

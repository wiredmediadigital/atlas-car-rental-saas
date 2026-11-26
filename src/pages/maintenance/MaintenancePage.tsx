import { Plus, SearchX, Wrench } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { paths } from '@/app/routes/paths'
import { ButtonLink, Card, CardBody, EmptyState, ListPagination, PageHeader } from '@/components/ui'
import type {
  MaintenanceCategory,
  MaintenancePriority,
  MaintenanceRow,
} from '@/features/maintenance/api'
import { MaintenanceSummary } from '@/features/maintenance/components/MaintenanceSummary'
import {
  MaintenanceCardList,
  MaintenanceTable,
} from '@/features/maintenance/components/MaintenanceTable'
import {
  MaintenanceToolbar,
  type MaintenanceFilters,
} from '@/features/maintenance/components/MaintenanceToolbar'
import { ServicingTable } from '@/features/maintenance/components/ServicingTable'
import {
  buildServicingRows,
  countServicing,
  filterMaintenanceRows,
  sortServicingRows,
} from '@/features/maintenance/dashboard'
import {
  useFleetDowntime,
  useMaintenance,
  useMaintenanceCostsByRecord,
  useMaintenanceStatusCounts,
  useMaintenanceSpend,
  useServicingFleet,
  useServicePlans,
} from '@/features/maintenance/queries'
import { useComplianceOptions, useDistanceUnit } from '@/features/workspace/useOrganizationSettings'
import { useOrganization, usePermission } from '@/features/workspace/workspace-context'
import {
  addMonthsInTimeZone,
  startOfMonthInTimeZone,
  toIsoDateInTimeZone,
} from '@/lib/datetime/timezone'
import { cn } from '@/lib/utils/cn'

const PAGE_SIZE = 25

type Tab = 'records' | 'servicing'

const TABS: readonly (readonly [Tab, string])[] = [
  ['records', 'Maintenance records'],
  ['servicing', 'Preventive servicing'],
]

const FILTER_KEYS = ['q', 'status', 'vehicle', 'category', 'priority', 'from', 'to'] as const

/**
 * Maintenance Management.
 *
 * Two tabs over one set of rows: what is being worked on, and what is going to
 * need working on. They share a data source and a status calculation on
 * purpose -- the fleet-wide servicing list, a vehicle's own page and a
 * maintenance record's card all read `evaluateServicePlan`, so none of them can
 * tell an operator a different story about the same car on the same day.
 *
 * The summary mixes two kinds of figure and says which is which. The six
 * counts are states now; the two money-and-time tiles are totals for the
 * selected period. Nothing on this page changes a vehicle's availability: a
 * service falling due is a reminder, and only recorded maintenance takes a car
 * off the road.
 */
export function MaintenancePage() {
  const organization = useOrganization()
  const compliance = useComplianceOptions()
  const distanceUnit = useDistanceUnit()
  const canCreate = usePermission('maintenance.create')

  const [searchParams, setSearchParams] = useSearchParams()
  const [now] = useState(() => new Date())

  const timeZone = organization.time_zone
  const locale = organization.locale

  const tab: Tab = searchParams.get('tab') === 'servicing' ? 'servicing' : 'records'

  // The period is a pair of business dates resolved in the agency's own zone,
  // so "this month" means the month the agency is in.
  const period = useMemo(() => {
    const anchorIso = searchParams.get('month')
    const anchor =
      anchorIso && /^\d{4}-\d{2}$/.test(anchorIso)
        ? new Date(`${anchorIso}-01T12:00:00Z`)
        : startOfMonthInTimeZone(now, timeZone)

    const start = startOfMonthInTimeZone(anchor, timeZone)
    const end = addMonthsInTimeZone(start, timeZone, 1)

    return {
      from: toIsoDateInTimeZone(start, timeZone),
      to: toIsoDateInTimeZone(end, timeZone),
      label: new Intl.DateTimeFormat(locale, {
        month: 'long',
        year: 'numeric',
        timeZone,
      }).format(start),
      monthParam: toIsoDateInTimeZone(start, timeZone).slice(0, 7),
    }
  }, [searchParams, now, timeZone, locale])

  const isCurrentMonth =
    period.monthParam ===
    toIsoDateInTimeZone(startOfMonthInTimeZone(now, timeZone), timeZone).slice(0, 7)

  const filters: MaintenanceFilters = useMemo(
    () => ({
      search: searchParams.get('q') ?? '',
      status: (searchParams.get('status') ?? 'any') as MaintenanceFilters['status'],
      vehicleId: searchParams.get('vehicle') ?? '',
      category: (searchParams.get('category') ?? 'any') as MaintenanceCategory | 'any',
      priority: (searchParams.get('priority') ?? 'any') as MaintenancePriority | 'any',
      from: searchParams.get('from') ?? '',
      to: searchParams.get('to') ?? '',
    }),
    [searchParams],
  )

  const page = Math.max(1, Number(searchParams.get('page') ?? '1') || 1)

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
    (patch: Partial<MaintenanceFilters>) => {
      updateParams((params) => {
        const set = (key: string, value: string, fallback: string) => {
          if (value === fallback) params.delete(key)
          else params.set(key, value)
        }
        if (patch.search !== undefined) set('q', patch.search, '')
        if (patch.status !== undefined) set('status', patch.status, 'any')
        if (patch.vehicleId !== undefined) set('vehicle', patch.vehicleId, '')
        if (patch.category !== undefined) set('category', patch.category, 'any')
        if (patch.priority !== undefined) set('priority', patch.priority, 'any')
        if (patch.from !== undefined) set('from', patch.from, '')
        if (patch.to !== undefined) set('to', patch.to, '')
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

  const records = useMaintenance()
  const statusCounts = useMaintenanceStatusCounts()
  const fleet = useServicingFleet()
  const servicePlans = useServicePlans()
  const costs = useMaintenanceCostsByRecord()
  const spend = useMaintenanceSpend(period.from, period.to)
  const downtime = useFleetDowntime(period.from, period.to)

  const rows: readonly MaintenanceRow[] = useMemo(() => records.data ?? [], [records.data])

  // Counted by the database, not derived from `rows`: that read is capped at
  // max_rows, and a count taken from a truncated list is wrong while looking
  const counts = statusCounts.data ?? {
    scheduled: 0,
    inProgress: 0,
    completed: 0,
    vehiclesInMaintenance: 0,
  }

  const servicingRows = useMemo(
    () =>
      sortServicingRows(buildServicingRows(fleet.data ?? [], servicePlans.data ?? [], compliance)),
    [fleet.data, servicePlans.data, compliance],
  )
  const servicingCounts = useMemo(() => countServicing(servicingRows), [servicingRows])

  const filtered = useMemo(() => filterMaintenanceRows(rows, filters), [rows, filters])
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const visible = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const costMap = useMemo(() => new Map(Object.entries(costs.data ?? {})), [costs.data])

  const vehicleOptions = useMemo(
    () =>
      (fleet.data ?? []).map((vehicle) => ({
        id: vehicle.id,
        label: `${vehicle.make} ${vehicle.model} · ${vehicle.registration_plate}`,
      })),
    [fleet.data],
  )

  const isListLoading = records.isPending || fleet.isPending

  return (
    <div className="space-y-6">
      <PageHeader
        title="Maintenance"
        eyebrow="Fleet"
        description="Manage vehicle servicing, repairs and preventive maintenance."
        actions={
          canCreate ? (
            <ButtonLink to={paths.maintenanceNew} leadingIcon={<Plus />}>
              Schedule maintenance
            </ButtonLink>
          ) : null
        }
      />

      <MaintenanceSummary
        counts={counts}
        servicing={servicingCounts}
        spend={spend.data ?? []}
        downtimeMinutes={downtime.data ?? null}
        periodLabel={period.label}
        locale={locale}
        isLoading={statusCounts.isPending || isListLoading}
        isSpendLoading={spend.isPending}
        isDowntimeLoading={downtime.isPending}
        isDowntimeUnavailable={downtime.isError}
      />

      <div className="border-line flex items-center gap-1 border-b" role="tablist">
        {TABS.map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            className={cn(
              '-mb-px border-b-2 px-4 py-2.5 text-sm font-medium transition-colors',
              tab === value
                ? 'border-brand-700 text-ink'
                : 'text-ink-subtle hover:text-ink border-transparent',
            )}
            onClick={() => updateParams((params) => params.set('tab', value))}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'records' ? (
        <div className="space-y-4">
          <MaintenanceToolbar
            filters={filters}
            onChange={changeFilters}
            onClearAll={clearFilters}
            vehicles={vehicleOptions}
            periodLabel={period.label}
            onStepPeriod={stepPeriod}
            onThisMonth={() => updateParams((params) => params.delete('month'))}
            isCurrentMonth={isCurrentMonth}
          />

          <Card>
            {records.isError ? (
              <CardBody>
                <p role="alert" className="text-critical-600">
                  Unable to load maintenance records.
                </p>
              </CardBody>
            ) : !isListLoading && filtered.length === 0 ? (
              <CardBody>
                <EmptyState
                  icon={rows.length === 0 ? Wrench : SearchX}
                  title={rows.length === 0 ? 'No maintenance yet' : 'Nothing matches those filters'}
                  description={
                    rows.length === 0
                      ? 'Schedule servicing or a repair and it will appear here with its cost and downtime.'
                      : 'Try a different status, vehicle or date range.'
                  }
                  action={
                    rows.length === 0 && canCreate ? (
                      <ButtonLink to={paths.maintenanceNew} leadingIcon={<Plus />}>
                        Schedule maintenance
                      </ButtonLink>
                    ) : undefined
                  }
                />
              </CardBody>
            ) : (
              <>
                <MaintenanceTable
                  rows={visible}
                  costs={costMap}
                  locale={locale}
                  timeZone={timeZone}
                  isLoading={isListLoading}
                />
                <MaintenanceCardList
                  rows={visible}
                  costs={costMap}
                  locale={locale}
                  timeZone={timeZone}
                />
                <ListPagination
                  page={page}
                  pageCount={pageCount}
                  total={filtered.length}
                  noun="record"
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
      ) : (
        <Card>
          {fleet.isError ? (
            <CardBody>
              <p role="alert" className="text-critical-600">
                Unable to load the fleet.
              </p>
            </CardBody>
          ) : !isListLoading && servicingRows.length === 0 ? (
            <CardBody>
              <EmptyState
                icon={Wrench}
                title="No vehicles yet"
                description="Add a vehicle to the fleet and its servicing will be tracked here."
              />
            </CardBody>
          ) : (
            <ServicingTable
              rows={servicingRows}
              locale={locale}
              timeZone={timeZone}
              distanceUnit={distanceUnit}
              canSchedule={canCreate}
              isLoading={isListLoading}
            />
          )}
        </Card>
      )}
    </div>
  )
}

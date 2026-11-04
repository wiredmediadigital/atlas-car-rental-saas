import { Download, FileSignature, Plus, SearchX } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { paths } from '@/app/routes/paths'
import { ErrorState } from '@/components/feedback/ErrorState'
import { Button, ButtonLink, Card, EmptyState, ListPagination, PageHeader } from '@/components/ui'
import {
  RENTAL_SORTS,
  type RentalDeskView,
  type RentalPaymentFilter,
  type RentalSort,
  deskViewFilter,
  fetchRentalsForExport,
  isRentalDeskView,
} from '@/features/rentals/api'
import { useCsvExport } from '@/features/exports/useCsvExport'
import { exportRentals } from '@/features/rentals/export'
import { RentalCardList } from '@/features/rentals/components/RentalCardList'
import { RentalSummary } from '@/features/rentals/components/RentalSummary'
import { RentalTable } from '@/features/rentals/components/RentalTable'
import { RentalToolbar, type RentalFilters } from '@/features/rentals/components/RentalToolbar'
import { useRentalList, useRentalSummary } from '@/features/rentals/queries'
import { useOrganization, usePermission } from '@/features/workspace/workspace-context'
import { addDaysInTimeZone, startOfDayInTimeZone } from '@/lib/datetime/timezone'

const STATUS_VALUES: readonly string[] = [
  'draft',
  'reserved',
  'active',
  'completed',
  'cancelled',
  'live',
  'all',
]

/** The words the file uses for what it is showing. */
const STATUS_LABELS: Readonly<Record<string, string>> = {
  live: 'Live rentals (draft, reserved, active)',
  all: 'All rentals',
  draft: 'Drafts',
  reserved: 'Reservations',
  active: 'Active rentals',
  completed: 'Completed rentals',
  cancelled: 'Cancelled rentals',
}

const DESK_VIEW_LABELS: Readonly<Record<RentalDeskView, string>> = {
  collecting: 'Collecting today',
  returning: 'Returning today',
  overdue: 'Overdue',
  outstanding: 'Outstanding balance',
}

function isRentalSort(value: string): value is RentalSort {
  return value in RENTAL_SORTS
}

/**
 * The rentals board.
 *
 * Filters live in the URL rather than in component state, so a filtered view can
 * be bookmarked, reloaded and sent to a colleague — which is what people do with
 * "everything due back today".
 */
export function RentalsPage() {
  const organization = useOrganization()
  const canCreate = usePermission('rentals.create')
  const [searchParams, setSearchParams] = useSearchParams()
  const [now] = useState(() => new Date())

  // The agency's day, not the browser's.
  const day = useMemo(() => {
    const start = startOfDayInTimeZone(now, organization.time_zone)
    return {
      start: start.toISOString(),
      end: addDaysInTimeZone(start, organization.time_zone, 1).toISOString(),
    }
  }, [now, organization.time_zone])

  const tile = searchParams.get('view') ?? ''
  const activeTile: RentalDeskView | null = isRentalDeskView(tile) ? tile : null

  const filters: RentalFilters = useMemo(() => {
    const sort = searchParams.get('sort') ?? 'starting'
    const status = searchParams.get('status') ?? 'live'
    const payment = searchParams.get('payment') ?? 'any'

    return {
      search: searchParams.get('q') ?? '',
      sort: isRentalSort(sort) ? sort : 'starting',
      status: STATUS_VALUES.includes(status) ? (status as RentalFilters['status']) : 'live',
      payment: ['any', 'outstanding', 'settled'].includes(payment)
        ? (payment as RentalPaymentFilter)
        : 'any',
      overdueOnly: searchParams.get('overdue') === '1',
    }
  }, [searchParams])

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

  const handleFilterChange = useCallback(
    (patch: Partial<RentalFilters>) => {
      updateParams((params) => {
        // A hand-set filter replaces whichever summary tile was selected;
        // leaving both on would show a result neither of them describes.
        params.delete('view')

        if (patch.search !== undefined) {
          if (patch.search === '') params.delete('q')
          else params.set('q', patch.search)
        }
        if (patch.sort !== undefined) {
          if (patch.sort === 'starting') params.delete('sort')
          else params.set('sort', patch.sort)
        }
        if (patch.status !== undefined) {
          if (patch.status === 'live') params.delete('status')
          else params.set('status', patch.status)
        }
        if (patch.payment !== undefined) {
          if (patch.payment === 'any') params.delete('payment')
          else params.set('payment', patch.payment)
        }
        if (patch.overdueOnly !== undefined) {
          if (patch.overdueOnly) params.set('overdue', '1')
          else params.delete('overdue')
        }
      })
    },
    [updateParams],
  )

  const selectTile = useCallback(
    (next: RentalDeskView) => {
      updateParams((params) => {
        params.set('view', next)
        params.delete('status')
        params.delete('payment')
        params.delete('overdue')
      })
    },
    [updateParams],
  )

  const clearTile = useCallback(() => {
    updateParams((params) => params.delete('view'))
  }, [updateParams])

  const clearAll = useCallback(() => {
    setSearchParams(new URLSearchParams(), { replace: true })
  }, [setSearchParams])

  // A summary tile is a saved query, and the definition of each one lives with
  // the counts it has to agree with rather than being restated here.
  const tileQuery = useMemo(
    () => (activeTile === null ? null : deskViewFilter(activeTile, day)),
    [activeTile, day],
  )

  /*
   * One definition of "what is on screen", used by the list and by the export.
   *
   * Written out here rather than inline in useRentalList so the export cannot
   * drift from the page it was started from — a spreadsheet that quietly
   * contains a different set of rows than the screen is the failure that makes
   * somebody stop trusting every export they are given afterwards.
   */
  const currentFilter = useMemo(
    () => ({
      search: filters.search,
      sort: filters.sort,
      ...(tileQuery ?? {
        status: filters.status,
        payment: filters.payment,
        overdueOnly: filters.overdueOnly,
      }),
    }),
    [filters.search, filters.sort, filters.status, filters.payment, filters.overdueOnly, tileQuery],
  )

  const listQuery = useRentalList({ ...currentFilter, page })

  const summaryQuery = useRentalSummary(day.start, day.end)

  const rentals = listQuery.data?.rows ?? []
  const total = listQuery.data?.total ?? 0
  const pageCount = listQuery.data?.pageCount ?? 1

  const activeFilterCount =
    (filters.status !== 'live' ? 1 : 0) +
    (filters.payment !== 'any' ? 1 : 0) +
    (filters.overdueOnly ? 1 : 0)

  const isFiltered = activeFilterCount > 0 || filters.search.length > 0 || activeTile !== null

  /** What the file will say it is showing. The same words the toolbar uses. */
  const filterLabel = useMemo(() => {
    const parts: string[] = []
    if (activeTile) parts.push(DESK_VIEW_LABELS[activeTile])
    else parts.push(STATUS_LABELS[filters.status] ?? filters.status)
    if (filters.payment !== 'any') parts.push(`payment: ${filters.payment}`)
    if (filters.overdueOnly) parts.push('overdue only')
    if (filters.search) parts.push(`search: ${filters.search}`)
    return parts.join(' · ')
  }, [activeTile, filters.status, filters.payment, filters.overdueOnly, filters.search])

  /**
   * Taking the rental book out of the product.
   *
   * Offered to anyone who may READ rentals, and deliberately not gated on the
   * subscription: an agency whose records have gone read-only is exactly the
   * agency most likely to need this, and a read-only state with no way to take
   * the data out would be a worse promise than the one the wind-down makes.
   */
  const { exportNow, isExporting } = useCsvExport({
    fetchRows: useCallback(
      () => fetchRentalsForExport({ ...currentFilter, organizationId: organization.id }),
      [currentFilter, organization.id],
    ),
    build: exportRentals,
    filterLabel,
    noun: 'rentals',
  })

  const hasAnyRentals =
    total > 0 ||
    (summaryQuery.data
      ? summaryQuery.data.collectingToday +
          summaryQuery.data.returningToday +
          summaryQuery.data.overdue +
          summaryQuery.data.outstanding >
        0
      : false)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Rentals"
        eyebrow="Operations"
        description={`Every contract ${organization.name} is running, and what each one needs next.`}
        actions={
          <>
            <Button
              variant="secondary"
              leadingIcon={<Download />}
              onClick={() => void exportNow()}
              isLoading={isExporting}
              disabled={isExporting || !hasAnyRentals}
            >
              Export
            </Button>
            {canCreate ? (
              <ButtonLink variant="primary" leadingIcon={<Plus />} to={paths.rentalNew}>
                New rental
              </ButtonLink>
            ) : null}
          </>
        }
      />

      {/* Four zeros are not a summary. Both the day's tiles and the filters
          appear once there is a contract for them to describe. */}
      {hasAnyRentals || isFiltered ? (
        <RentalSummary
          summary={summaryQuery.data}
          isLoading={summaryQuery.isPending}
          active={activeTile}
          onSelect={selectTile}
          onClear={clearTile}
        />
      ) : null}

      {hasAnyRentals || isFiltered ? (
        <RentalToolbar
          filters={filters}
          onChange={handleFilterChange}
          activeFilterCount={activeFilterCount}
          onClearAll={clearAll}
        />
      ) : null}

      <Card className="overflow-hidden">
        {listQuery.isError ? (
          <ErrorState error={listQuery.error} onRetry={() => void listQuery.refetch()} />
        ) : listQuery.isPending ? (
          <>
            <RentalTable
              rentals={[]}
              locale={organization.locale}
              timeZone={organization.time_zone}
              isLoading
            />
            <RentalCardList
              rentals={[]}
              locale={organization.locale}
              timeZone={organization.time_zone}
              isLoading
            />
          </>
        ) : rentals.length === 0 ? (
          isFiltered ? (
            <EmptyState
              icon={SearchX}
              title="No contracts match this view"
              description="Try a different search term, or clear the filters to see every open contract."
              action={
                <Button variant="secondary" size="sm" onClick={clearAll}>
                  Clear filters
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={FileSignature}
              title="Write your first rental contract"
              description="Pick the dates, choose a vehicle that is free, name the renter and their driver, and the contract, its pricing and its paperwork follow from there."
              action={
                canCreate ? (
                  <ButtonLink variant="primary" to={paths.rentalNew}>
                    New rental
                  </ButtonLink>
                ) : (
                  <p className="text-ink-subtle text-[0.8125rem]">
                    Ask a manager or administrator to open a contract.
                  </p>
                )
              }
            />
          )
        ) : (
          <>
            <RentalTable
              rentals={rentals}
              locale={organization.locale}
              timeZone={organization.time_zone}
            />
            <RentalCardList
              rentals={rentals}
              locale={organization.locale}
              timeZone={organization.time_zone}
            />
          </>
        )}

        <ListPagination
          page={page}
          pageCount={pageCount}
          total={total}
          noun="contract"
          onPageChange={(next) =>
            updateParams((params) => params.set('page', String(next)), { resetPage: false })
          }
        />
      </Card>
    </div>
  )
}

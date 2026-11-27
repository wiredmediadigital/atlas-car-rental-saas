import { cn } from '@/lib/utils/cn'

export type RentalTab = 'overview' | 'financials' | 'inspections' | 'documents'

export const RENTAL_TABS: readonly (readonly [RentalTab, string])[] = [
  ['overview', 'Overview'],
  ['financials', 'Financials'],
  ['inspections', 'Inspections'],
  ['documents', 'Documents'],
] as const

export function isRentalTab(value: string | null): value is RentalTab {
  return RENTAL_TABS.some(([tab]) => tab === value)
}

export interface RentalTabsProps {
  tab: RentalTab
  onChange: (tab: RentalTab) => void
  /** A count beside a tab, where one helps. Zero and undefined both show nothing. */
  counts?: Partial<Record<RentalTab, number>>
}

/**
 * The four parts of one rental.
 *
 * Follows the tab strip the Maintenance dashboard already uses, down to the
 * underline and the roles, so the two screens do not disagree about what a tab
 * looks like. It scrolls horizontally rather than wrapping: on a phone four
 * tabs do not fit, and a second row of tabs reads as a second kind of thing.
 */
export function RentalTabs({ tab, onChange, counts }: RentalTabsProps) {
  return (
    <div
      className="border-line -mx-4 flex items-center gap-1 overflow-x-auto border-b px-4 sm:mx-0 sm:px-0"
      role="tablist"
      aria-label="Rental sections"
    >
      {RENTAL_TABS.map(([value, label]) => {
        const count = counts?.[value]
        return (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            className={cn(
              '-mb-px shrink-0 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors sm:px-4',
              tab === value
                ? 'border-brand-700 text-ink'
                : 'text-ink-subtle hover:text-ink border-transparent',
            )}
            onClick={() => onChange(value)}
          >
            {label}
            {count ? (
              <span className="text-ink-subtle ml-1.5 text-[0.75rem] tabular-nums">{count}</span>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}

import { History } from 'lucide-react'

import { Card, CardBody, CardHeader, Skeleton } from '@/components/ui'
import { formatDateTime } from '@/lib/datetime/format'
import { formatMoney } from '@/lib/money/money'
import { cn } from '@/lib/utils/cn'
import type { RentalAmendmentKind, RentalPricingAmendment } from '@/types/database'

import { useRentalPricingAmendments } from '../queries'

export interface AmendmentHistoryProps {
  rentalId: string
  currency: string
  locale: string
  timeZone: string
}

const KIND_LABELS: Record<RentalAmendmentKind, string> = {
  reprice: 'Repriced',
  extension: 'Extended',
}

/**
 * What authorized pricing has done to this hire, and what it used to be.
 *
 * Read-only, and deliberately so: there is no browser privilege to write a row
 * here at all. The record is produced by the pricing operation itself, inside
 * the same transaction, which is why it can be trusted as a history rather
 * than as a convention somebody remembered to follow.
 *
 * It does not duplicate Charges or Money. Those two say what the contract is
 * now; this says what it used to be and when that stopped being true. A rental
 * nobody has repriced or extended shows nothing, which is the honest answer
 * rather than an empty table pretending to be a ledger.
 */
export function AmendmentHistory({ rentalId, currency, locale, timeZone }: AmendmentHistoryProps) {
  const query = useRentalPricingAmendments(rentalId)
  const cash = (minor: number) => formatMoney(minor, currency, { locale })
  const records = query.data ?? []

  return (
    <Card className="border-dashed">
      <CardHeader
        title="Hire amendments"
        description="Every authorized change to the hire charge, and what it was before."
      />

      <CardBody>
        {query.isPending ? (
          <div className="space-y-2">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        ) : query.isError ? (
          <p className="text-ink-subtle text-[0.8125rem]">
            The amendment history could not be read. Refresh the page or try again later.
          </p>
        ) : records.length === 0 ? (
          <p className="text-ink-subtle flex items-center gap-2 text-[0.8125rem]">
            <History className="size-3.5 shrink-0" aria-hidden="true" />
            The hire on this rental has not been repriced or extended.
          </p>
        ) : (
          <ul className="divide-line divide-y">
            {records.map((record) => (
              <AmendmentRow
                key={record.id}
                record={record}
                cash={cash}
                locale={locale}
                timeZone={timeZone}
              />
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  )
}

interface AmendmentRowProps {
  record: RentalPricingAmendment
  cash: (minor: number) => string
  locale: string
  timeZone: string
}

function AmendmentRow({ record, cash, locale, timeZone }: AmendmentRowProps) {
  const difference = record.difference_minor
  const label = KIND_LABELS[record.kind] ?? 'Amended'

  return (
    <li className="py-3 first:pt-0 last:pb-0">
      {/*
        Stacked on a phone, two columns from the small breakpoint up. A table
        would need a sideways scroll at 390px, and a money column somebody has
        to scroll to reach is a money column they will not check.
      */}
      <div className="flex flex-col gap-1.5 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="min-w-0">
          <p className="text-ink text-[0.8125rem] font-medium">{label}</p>
          <p className="text-ink-subtle mt-0.5 text-[0.6875rem]">
            {formatDateTime(new Date(record.amended_at), { locale, timeZone })}
          </p>
          {record.reason ? (
            <p className="text-ink-subtle mt-0.5 text-[0.75rem]">{record.reason}</p>
          ) : null}
          {record.contract_version !== null ? (
            <p className="text-ink-subtle mt-0.5 text-[0.6875rem]">
              Contract version {record.contract_version} was in force
            </p>
          ) : null}
        </div>

        <dl className="shrink-0 sm:text-right">
          <div className="flex items-baseline gap-2 sm:justify-end">
            <dt className="text-ink-subtle text-[0.6875rem]">Was</dt>
            <dd data-numeric="" className="text-ink-subtle text-[0.8125rem] line-through">
              {cash(record.previous_amount_minor)}
            </dd>
          </div>
          <div className="flex items-baseline gap-2 sm:justify-end">
            <dt className="text-ink-subtle text-[0.6875rem]">Now</dt>
            <dd data-numeric="" className="text-ink text-[0.9375rem] font-semibold">
              {cash(record.revised_amount_minor)}
            </dd>
          </div>
          <div className="flex items-baseline gap-2 sm:justify-end">
            <dt className="text-ink-subtle text-[0.6875rem]">Difference</dt>
            <dd
              data-numeric=""
              className={cn(
                'text-[0.75rem]',
                difference > 0 && 'text-critical-700',
                difference < 0 && 'text-positive-700',
                difference === 0 && 'text-ink-subtle',
              )}
            >
              {difference > 0 ? '+' : ''}
              {cash(difference)}
            </dd>
          </div>
        </dl>
      </div>
    </li>
  )
}

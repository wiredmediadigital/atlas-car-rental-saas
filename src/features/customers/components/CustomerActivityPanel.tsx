import { CalendarClock } from 'lucide-react'
import { Link } from 'react-router-dom'

import { rentalDetailPath } from '@/app/routes/paths'
import { CardBody, CardHeader, EmptyState } from '@/components/ui'
import type { ComplianceOptions } from '@/lib/compliance/expiry'
import { formatDate } from '@/lib/datetime/format'
import type { CustomerDirectoryEntry } from '@/types/database'

import { useCustomerRentalSummary } from '../queries'

export interface CustomerActivityPanelProps {
  customer: CustomerDirectoryEntry
  compliance: ComplianceOptions
  locale: string
}

/**
 * Rental history and money, read from the contracts that exist.
 *
 * Nothing here is invented: a customer with no rentals gets an empty state
 * rather than a row of zeroes dressed up as history. References are shown as
 * text rather than links because the Rentals module has no detail route yet, and
 * a link to a page that does not exist is worse than no link.
 */
export function CustomerActivityPanel({
  customer,
  compliance,
  locale,
}: CustomerActivityPanelProps) {
  // The cancelled count is already computed by customer_rental_summary and was
  // never rendered anywhere, so a cancelled reservation left no trace on the
  // account at all.
  const rentalSummary = useCustomerRentalSummary(customer.customer_id).data
  const cancelledCount = Number(rentalSummary?.cancelled_count ?? 0)

  const hasHistory = customer.rental_count > 0

  return (
    <>
      <CardHeader title="Rental activity" description="Where this customer stands right now." />

      <CardBody className="p-0">
        {!hasHistory ? (
          <EmptyState
            size="sm"
            icon={CalendarClock}
            title="No rentals yet"
            description="Contracts involving this customer will appear here once the first one is created."
          />
        ) : (
          <>
            <dl className="divide-line grid grid-cols-2 divide-x divide-y">
              <Figure
                label="Rentals"
                value={String(customer.rental_count)}
                note={cancelledCount > 0 ? `${cancelledCount} cancelled` : undefined}
              />
              <Figure
                label="First rental"
                value={
                  customer.first_rental_at
                    ? formatDate(new Date(customer.first_rental_at), {
                        locale,
                        timeZone: compliance.timeZone,
                      })
                    : '—'
                }
              />
              <Figure
                label="Last returned"
                value={
                  customer.last_rental_ends_at
                    ? formatDate(new Date(customer.last_rental_ends_at), {
                        locale,
                        timeZone: compliance.timeZone,
                      })
                    : '—'
                }
              />
              <Figure
                label="Currently"
                value={
                  customer.active_rental_reference
                    ? 'Renting'
                    : customer.upcoming_rental_reference
                      ? 'Booked'
                      : 'Idle'
                }
              />
            </dl>

            {customer.active_rental_reference || customer.upcoming_rental_reference ? (
              <div className="border-line space-y-2 border-t px-5 py-4">
                {customer.active_rental_reference && customer.active_rental_ends_at ? (
                  <p className="text-[0.8125rem]">
                    <span className="text-ink-subtle">Out on </span>
                    {customer.active_rental_id ? (
                      <Link
                        to={rentalDetailPath(customer.active_rental_id)}
                        className="identifier hover:underline"
                      >
                        {customer.active_rental_reference}
                      </Link>
                    ) : (
                      <span className="identifier">{customer.active_rental_reference}</span>
                    )}
                    <span className="text-ink-muted">
                      {' '}
                      · due back{' '}
                      {formatDate(new Date(customer.active_rental_ends_at), {
                        locale,
                        timeZone: compliance.timeZone,
                      })}
                    </span>
                  </p>
                ) : null}

                {customer.upcoming_rental_reference && customer.upcoming_rental_starts_at ? (
                  <p className="text-[0.8125rem]">
                    <span className="text-ink-subtle">Next booking </span>
                    {customer.upcoming_rental_id ? (
                      <Link
                        to={rentalDetailPath(customer.upcoming_rental_id)}
                        className="identifier hover:underline"
                      >
                        {customer.upcoming_rental_reference}
                      </Link>
                    ) : (
                      <span className="identifier">{customer.upcoming_rental_reference}</span>
                    )}
                    <span className="text-ink-muted">
                      {' '}
                      · from{' '}
                      {formatDate(new Date(customer.upcoming_rental_starts_at), {
                        locale,
                        timeZone: compliance.timeZone,
                      })}
                    </span>
                  </p>
                ) : null}
              </div>
            ) : null}
          </>
        )}
      </CardBody>
    </>
  )
}

function Figure({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="px-5 py-3">
      <dt className="eyebrow">{label}</dt>
      <dd data-numeric="" className="text-ink mt-1 text-[0.8125rem] font-medium">
        {value}
        {note ? <span className="text-ink-subtle block font-normal">{note}</span> : null}
      </dd>
    </div>
  )
}

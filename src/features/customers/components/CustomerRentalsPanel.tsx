import { CalendarClock } from 'lucide-react'
import { Link } from 'react-router-dom'

import { rentalDetailPath } from '@/app/routes/paths'
import { CardBody, CardHeader, EmptyState, Skeleton } from '@/components/ui'
import { RentalStatusBadge } from '@/features/rentals/components/RentalBadges'
import type { ComplianceOptions } from '@/lib/compliance/expiry'
import { formatDate } from '@/lib/datetime/format'
import { formatMoney } from '@/lib/money/money'

import { CUSTOMER_RENTAL_LIMIT } from '../api'
import { useCustomerRentals } from '../queries'

export interface CustomerRentalsPanelProps {
  customerId: string
  compliance: ComplianceOptions
  locale: string
}

/**
 * Every contract this customer is the renter on.
 *
 * The account used to carry figures and no contracts: a count of rentals, a
 * balance, and two shortcuts to whichever booking happened to be out or next.
 * A cancelled reservation fell through all three, so a customer asking about
 * one left staff with nowhere to look it up but the Rentals list and a guess
 * at the dates.
 *
 * Cancelled bookings are shown with everything else and say so in their badge,
 * rather than being filtered out as though they had not been made.
 */
export function CustomerRentalsPanel({
  customerId,
  compliance,
  locale,
}: CustomerRentalsPanelProps) {
  const rentalsQuery = useCustomerRentals(customerId)
  const rentals = rentalsQuery.data ?? []
  const isCapped = rentals.length === CUSTOMER_RENTAL_LIMIT

  const day = (value: string) =>
    formatDate(new Date(value), { locale, timeZone: compliance.timeZone })

  return (
    <>
      <CardHeader
        title="Contracts"
        description={
          isCapped
            ? `The ${CUSTOMER_RENTAL_LIMIT} most recent. Older ones are in Rentals.`
            : 'Every booking in this customer’s name, cancelled ones included.'
        }
      />

      <CardBody className="p-0">
        {rentalsQuery.isPending ? (
          <div className="space-y-2 p-5">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : rentals.length === 0 ? (
          <EmptyState
            size="sm"
            icon={CalendarClock}
            title="No contracts yet"
            description="Bookings made in this customer’s name will be listed here."
          />
        ) : (
          <ul className="divide-line divide-y">
            {rentals.map((rental) => (
              <li
                key={rental.id}
                className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-5 py-3"
              >
                <Link
                  to={rentalDetailPath(rental.id)}
                  className="identifier text-[0.8125rem] hover:underline"
                >
                  {rental.reference}
                </Link>

                <RentalStatusBadge status={rental.status} />

                <span className="text-ink-muted text-[0.8125rem]">
                  {day(rental.starts_at)} – {day(rental.ends_at)}
                </span>

                <span className="text-ink-subtle w-full text-[0.8125rem] sm:w-auto">
                  {rental.vehicle_make} {rental.vehicle_model}
                </span>

                <span
                  data-numeric=""
                  className="text-ink ms-auto text-[0.8125rem] font-medium whitespace-nowrap"
                >
                  {formatMoney(rental.total_minor, rental.currency, { locale })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </>
  )
}

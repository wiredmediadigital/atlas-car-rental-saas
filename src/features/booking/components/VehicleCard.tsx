import { Button, Card } from '@/components/ui'
import { formatMoney } from '@/lib/money/money'

import type { PublicVehicle } from '../api'

/**
 * The exact words an unavailable car carries.
 *
 * One sentence for every reason — booked by someone else, in the workshop,
 * withdrawn from service. A renter has no business knowing which, and an agency
 * has no interest in telling them: "in maintenance" invites a question about
 * the condition of the rest of the fleet.
 */
export const UNAVAILABLE_LABEL = 'not free for these dates'

export interface VehicleCardProps {
  vehicle: PublicVehicle
  /** Absent when the agency is not taking requests; the card is then a listing. */
  onRequest?: (vehicle: PublicVehicle) => void
}

function specLine(vehicle: PublicVehicle): string {
  const parts = [
    vehicle.year === null ? null : String(vehicle.year),
    vehicle.category,
    vehicle.transmission === 'automatic'
      ? 'Automatic'
      : vehicle.transmission === 'manual'
        ? 'Manual'
        : null,
    vehicle.seats === null ? null : `${vehicle.seats} seats`,
    vehicle.doors === null ? null : `${vehicle.doors} doors`,
  ]
  return parts.filter((part): part is string => part !== null && part !== '').join(' · ')
}

export function VehicleCard({ vehicle, onRequest }: VehicleCardProps) {
  const name = `${vehicle.make} ${vehicle.model}`
  const perDay = formatMoney(vehicle.dailyRateMinor, vehicle.currency)
  const total = formatMoney(vehicle.quotedTotalMinor, vehicle.currency)
  const nights = vehicle.billableDays === 1 ? '1 day' : `${vehicle.billableDays} days`

  return (
    <Card
      className={
        // Dimmed rather than hidden: an agency's page showing three of its
        // eight cars on a busy weekend reads as an agency with three cars.
        vehicle.isAvailable ? 'overflow-hidden' : 'overflow-hidden opacity-60'
      }
      data-testid="vehicle-card"
    >
      {vehicle.imageUrl === null ? (
        <div className="bg-surface-muted aspect-[16/10] w-full" aria-hidden="true" />
      ) : (
        <img
          src={vehicle.imageUrl}
          alt={name}
          className="aspect-[16/10] w-full object-cover"
          loading="lazy"
        />
      )}

      <div className="space-y-3 p-5">
        <div className="space-y-1">
          <h3 className="text-base font-semibold">{name}</h3>
          <p className="text-ink-muted text-[0.8125rem]">{specLine(vehicle)}</p>
        </div>

        <div className="space-y-0.5">
          <p className="text-base font-semibold">{total}</p>
          <p className="text-ink-muted text-[0.8125rem]">
            {perDay} per day · {nights}
          </p>
        </div>

        {vehicle.isAvailable ? (
          onRequest === undefined ? null : (
            <Button type="button" variant="primary" fullWidth onClick={() => onRequest(vehicle)}>
              Request this car
            </Button>
          )
        ) : (
          <p className="text-ink-muted text-[0.8125rem]">{UNAVAILABLE_LABEL}</p>
        )}
      </div>
    </Card>
  )
}

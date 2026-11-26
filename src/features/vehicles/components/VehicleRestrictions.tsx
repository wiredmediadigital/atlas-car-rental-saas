import { useState } from 'react'
import { Link } from 'react-router-dom'
import { CircleSlash, RotateCcw, Wrench } from 'lucide-react'

import { paths } from '@/app/routes/paths'
import { Alert, Button, Dialog, DialogContent, Field, Textarea, useToast } from '@/components/ui'
import {
  useResolveLegacyMaintenance,
  useReturnVehicleToService,
  useTakeVehicleOffRoad,
} from '@/features/vehicles/queries'
import { formatDate } from '@/lib/datetime/format'
import { toErrorMessage } from '@/lib/supabase/errors'

/**
 * What a vehicle's restrictions are, and the actions that change them.
 *
 * This replaces the Operational status dropdown. Status is read-only here
 * because it is derived: maintenance records, actual rental custody, existing
 * reservations and independent off-road restrictions each decide a part of it,
 * and letting somebody overwrite the result would discard whichever of those
 * they could not see. Each action below releases exactly the restriction it
 * names and nothing else -- the database refuses the rest.
 */
export interface VehicleRestrictionsProps {
  vehicleId: string
  operationalStatus: string
  offRoadReason: string | null
  offRoadAt: string | null
  legacyMaintenanceRestriction: boolean
  maintenanceId: string | null
  maintenanceReference: string | null
  canManage: boolean
  locale: string
  timeZone: string
}

type PendingAction = 'off-road' | 'legacy' | null

export function VehicleRestrictions({
  vehicleId,
  operationalStatus,
  offRoadReason,
  offRoadAt,
  legacyMaintenanceRestriction,
  maintenanceId,
  maintenanceReference,
  canManage,
  locale,
  timeZone,
}: VehicleRestrictionsProps) {
  const toast = useToast()
  const [pending, setPending] = useState<PendingAction>(null)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)

  const takeOffRoad = useTakeVehicleOffRoad(vehicleId)
  const returnToService = useReturnVehicleToService(vehicleId)
  const resolveLegacy = useResolveLegacyMaintenance(vehicleId)

  const isOffRoad = operationalStatus === 'unavailable'
  const isBusy = takeOffRoad.isPending || returnToService.isPending || resolveLegacy.isPending

  function close() {
    setPending(null)
    setReason('')
    setError(null)
  }

  async function confirm() {
    const trimmed = reason.trim()
    if (trimmed.length === 0) {
      setError(
        pending === 'legacy'
          ? 'Say why this vehicle is roadworthy.'
          : 'Say why this vehicle is coming off the road.',
      )
      return
    }

    try {
      if (pending === 'legacy') {
        await resolveLegacy.mutateAsync(trimmed)
        toast.success('Maintenance restriction resolved')
      } else {
        await takeOffRoad.mutateAsync(trimmed)
        toast.success('Vehicle taken off the road')
      }
      close()
    } catch (cause) {
      setError(toErrorMessage(cause))
    }
  }

  async function release() {
    setError(null)
    try {
      await returnToService.mutateAsync()
      toast.success('Vehicle returned to service')
    } catch (cause) {
      setError(toErrorMessage(cause))
    }
  }

  if (!canManage && !isOffRoad && !legacyMaintenanceRestriction) return null

  return (
    <div className="border-line space-y-3 border-t pt-4">
      {isOffRoad ? (
        <Alert tone="caution" title="Off the road">
          <p>{offRoadReason ?? 'No reason was recorded.'}</p>
          {offRoadAt ? (
            <p className="mt-1 text-[0.8125rem]">
              Since {formatDate(new Date(offRoadAt), { locale, timeZone })}
            </p>
          ) : null}
        </Alert>
      ) : null}

      {legacyMaintenanceRestriction ? (
        <Alert tone="caution" title="Maintenance restriction from before Maintenance Management">
          <p>
            This vehicle was marked as in maintenance by hand, before maintenance records existed.
            {maintenanceId && maintenanceReference ? (
              <>
                {' '}
                There is also active work on it:{' '}
                <Link
                  className="text-brand-700 hover:underline"
                  to={`${paths.maintenance}/${maintenanceId}`}
                >
                  {maintenanceReference}
                </Link>
                .
              </>
            ) : (
              ' There is no maintenance record behind it, so nothing can complete it.'
            )}
          </p>
          <p className="mt-1">
            Record the work through Maintenance Management if it is still ongoing, or resolve the
            restriction once the vehicle is confirmed roadworthy.
          </p>
        </Alert>
      ) : null}

      {error && pending === null ? (
        <p role="alert" className="text-critical-600 text-sm">
          {error}
        </p>
      ) : null}

      {canManage ? (
        <div className="flex flex-wrap gap-2">
          {isOffRoad ? (
            <Button
              variant="secondary"
              leadingIcon={<RotateCcw />}
              isLoading={returnToService.isPending}
              disabled={isBusy}
              onClick={() => void release()}
            >
              Return to service
            </Button>
          ) : (
            <Button
              variant="secondary"
              leadingIcon={<CircleSlash />}
              disabled={isBusy}
              onClick={() => {
                setError(null)
                setPending('off-road')
              }}
            >
              Take off the road
            </Button>
          )}

          {legacyMaintenanceRestriction ? (
            <Button
              variant="secondary"
              leadingIcon={<Wrench />}
              disabled={isBusy}
              onClick={() => {
                setError(null)
                setPending('legacy')
              }}
            >
              Resolve maintenance restriction
            </Button>
          ) : null}
        </div>
      ) : null}

      <Dialog open={pending !== null} onOpenChange={(open) => (open ? null : close())}>
        <DialogContent
          title={pending === 'legacy' ? 'Resolve maintenance restriction' : 'Take off the road'}
          description={
            pending === 'legacy'
              ? 'This releases the old manual restriction only. It completes no maintenance and releases nothing else.'
              : 'This restricts the vehicle for a reason that is not maintenance. It does not touch maintenance, rentals or contracts.'
          }
        >
          <div className="space-y-4">
            <Field label="Reason" id="restriction-reason" required>
              <Textarea
                id="restriction-reason"
                rows={3}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder={
                  pending === 'legacy'
                    ? 'Inspected and confirmed roadworthy on…'
                    : 'Cracked windscreen, awaiting insurance decision…'
                }
              />
            </Field>

            {error ? (
              <p role="alert" className="text-critical-600 text-sm">
                {error}
              </p>
            ) : null}

            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={close} disabled={isBusy}>
                Cancel
              </Button>
              <Button isLoading={isBusy} onClick={() => void confirm()}>
                {pending === 'legacy' ? 'Resolve restriction' : 'Take off the road'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

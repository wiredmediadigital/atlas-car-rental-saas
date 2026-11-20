import { useState } from 'react'

import {
  Alert,
  Button,
  Dialog,
  DialogContent,
  Field,
  Input,
  Select,
  Textarea,
  useToast,
} from '@/components/ui'
import { fromDateTimeLocalValue, toDateTimeLocalValue } from '@/lib/datetime/timezone'
import { toErrorMessage } from '@/lib/supabase/errors'
import type { VehicleFleetEntry } from '@/types/database'

import { useSwapActiveVehicle } from '../queries'
import { VehiclePicker } from './VehiclePicker'

export interface ActiveSwapDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  rentalId: string
  currentVehicleLabel: string
  startsAt: string
  endsAt: string
  timeZone: string
  locale: string
}

const REASONS = [
  { value: 'breakdown', label: 'Breakdown' },
  { value: 'damage', label: 'Damage or safety' },
  { value: 'maintenance', label: 'Maintenance' },
  { value: 'customer_request', label: 'Customer request' },
  { value: 'availability', label: 'Availability' },
  { value: 'other', label: 'Other' },
] as const

export function ActiveSwapDialog(props: ActiveSwapDialogProps) {
  const toast = useToast()
  const swap = useSwapActiveVehicle(props.rentalId)
  const [chosen, setChosen] = useState<VehicleFleetEntry | null>(null)
  const [reason, setReason] = useState<(typeof REASONS)[number]['value']>('breakdown')
  const [notes, setNotes] = useState('')
  const [consent, setConsent] = useState('')
  const [odometer, setOdometer] = useState('')
  const [fuel, setFuel] = useState('')
  const [at, setAt] = useState(() => toDateTimeLocalValue(new Date(), props.timeZone))

  const submit = async () => {
    const instant = fromDateTimeLocalValue(at, props.timeZone)
    const reading = Number(odometer)
    const fuelValue = fuel.trim() === '' ? null : Number(fuel)
    if (!chosen || !instant || !notes.trim() || !Number.isInteger(reading) || reading < 0) {
      toast.error(
        'Complete the swap details',
        'Choose a vehicle, reason notes, time, and odometer.',
      )
      return
    }
    if (fuelValue !== null && (!Number.isInteger(fuelValue) || fuelValue < 0 || fuelValue > 100)) {
      toast.error('Check the fuel reading', 'Fuel must be between 0 and 100 percent.')
      return
    }
    try {
      await swap.mutateAsync({
        vehicleId: chosen.vehicle_id,
        reason,
        reasonNotes: notes.trim(),
        swapAt: instant.toISOString(),
        odometer: reading,
        fuelPercent: fuelValue,
        consentReference: consent.trim() || null,
        operationKey: crypto.randomUUID(),
      })
      toast.success('Vehicle swapped', `${chosen.registration_plate} is now in custody.`)
      props.onOpenChange(false)
    } catch (error) {
      toast.error('Could not swap the vehicle', toErrorMessage(error))
    }
  }

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent
        title="Swap the active vehicle"
        description={`${props.currentVehicleLabel} is currently in custody.`}
        size="lg"
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => props.onOpenChange(false)}
              disabled={swap.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => void submit()}
              isLoading={swap.isPending}
              disabled={!chosen}
            >
              Record swap
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Alert tone="caution" title="This preserves the contract and payment history">
            The outgoing vehicle will remain in assignment history, and the replacement will receive
            separate swap-out and swap-in inspection records.
          </Alert>
          <VehiclePicker
            from={props.startsAt}
            to={props.endsAt}
            selectedId={chosen?.vehicle_id ?? null}
            onSelect={setChosen}
            locale={props.locale}
            excludeRentalId={props.rentalId}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Reason" required>
              <Select
                options={REASONS}
                value={reason}
                onChange={(event) => setReason(event.target.value as typeof reason)}
              />
            </Field>
            <Field label="Swap time" required>
              <Input
                type="datetime-local"
                value={at}
                onChange={(event) => setAt(event.target.value)}
              />
            </Field>
            <Field label="Odometer" required>
              <Input
                inputMode="numeric"
                value={odometer}
                onChange={(event) => setOdometer(event.target.value)}
              />
            </Field>
            <Field label="Fuel (%)">
              <Input
                inputMode="numeric"
                value={fuel}
                onChange={(event) => setFuel(event.target.value)}
              />
            </Field>
          </div>
          <Field label="Reason notes" required>
            <Textarea
              rows={3}
              maxLength={2000}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </Field>
          <Field
            label="Consent evidence reference"
            hint="Required except for emergency reasons such as breakdown, damage, or maintenance."
          >
            <Input
              value={consent}
              maxLength={512}
              onChange={(event) => setConsent(event.target.value)}
              placeholder="Signed amendment or emergency incident reference"
            />
          </Field>
        </div>
      </DialogContent>
    </Dialog>
  )
}

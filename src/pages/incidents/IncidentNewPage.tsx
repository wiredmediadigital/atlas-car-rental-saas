import { Check, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'

import { incidentDetailPath, paths } from '@/app/routes/paths'
import { Button, ButtonLink, Field, Input, PageHeader, Select, Textarea, useToast } from '@/components/ui'
import { useCreateIncident, useIncidentRentalOption, useIncidentRentalOptions } from '@/features/incidents/queries'
import { rentalLabel, vehicleLabel } from '@/features/incidents/presentation'
import { currentCheckedOutRental } from '@/features/incidents/workflow'
import { useVehicleOptions } from '@/features/expenses/queries'
import type { IncidentResponsibility, IncidentType } from '@/types/database'

const typeOptions = [['breakdown', 'Breakdown'], ['accident', 'Accident'], ['vehicle_damage', 'Vehicle damage'], ['theft', 'Theft'], ['other', 'Other']] as const
const responsibilityOptions = [['customer', 'Customer'], ['agency', 'Rental agency'], ['third_party', 'Third party'], ['undetermined', 'Undetermined']] as const

export function IncidentNewPage() {
  const navigate = useNavigate(); const toast = useToast(); const [params] = useSearchParams(); const create = useCreateIncident(); const vehicles = useVehicleOptions()
  const initialVehicle = params.get('vehicle') ?? ''; const initialRental = params.get('rental') ?? ''
  const [vehicleId, setVehicleId] = useState(initialVehicle); const [rentalId, setRentalId] = useState(initialRental); const [rentalTouched, setRentalTouched] = useState(Boolean(initialRental))
  const [type, setType] = useState<IncidentType>('other'); const [occurredAt, setOccurredAt] = useState(new Date().toISOString().slice(0, 16)); const [location, setLocation] = useState(''); const [description, setDescription] = useState(''); const [responsibility, setResponsibility] = useState<IncidentResponsibility>('undetermined'); const [towingProvider, setTowingProvider] = useState(''); const [towingReference, setTowingReference] = useState(''); const [insuranceProvider, setInsuranceProvider] = useState(''); const [insuranceClaimReference, setInsuranceClaimReference] = useState(''); const [error, setError] = useState('')
  const rentals = useIncidentRentalOptions(vehicleId || undefined); const initialRentalContext = useIncidentRentalOption(initialRental || undefined)

  useEffect(() => { if (!initialRentalContext.data || initialVehicle) return; setVehicleId(initialRentalContext.data.vehicle_id) }, [initialRentalContext.data, initialVehicle])
  useEffect(() => { if (!vehicleId || rentalTouched || rentals.isPending || rentals.isError) return; const active = currentCheckedOutRental(rentals.data ?? []); setRentalId(active?.id ?? '') }, [vehicleId, rentalTouched, rentals.data, rentals.isError, rentals.isPending])

  const selectedRental = useMemo(() => (rentals.data ?? []).find((rental) => rental.id === rentalId) ?? (initialRentalContext.data?.id === rentalId ? initialRentalContext.data : null), [initialRentalContext.data, rentalId, rentals.data])
  const selectedVehicle = (vehicles.data ?? []).find((vehicle) => vehicle.id === vehicleId) ?? null
  const rentalOptions = [{ value: '', label: 'No rental' }, ...(rentals.data ?? []).map((rental) => ({ value: rental.id, label: rentalLabel(rental) }))]
  function selectVehicle(nextVehicleId: string) { setVehicleId(nextVehicleId); setRentalId(''); setRentalTouched(false) }

  async function submit() {
    if (!vehicleId || !description.trim()) { setError('Vehicle and description are required.'); return }
    setError('')
    try {
      const row = await create.mutateAsync({ vehicleId, rentalId: rentalId || null, type, occurredAt: new Date(occurredAt).toISOString(), location, description, responsibility, towingProvider, towingReference, insuranceProvider, insuranceClaimReference })
      toast.success('Incident reported', row.reference); void navigate(incidentDetailPath(row.id))
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to report incident.') }
  }

  return <div className="space-y-6"><PageHeader title="Report incident" eyebrow="Operations" description="Record an event against a vehicle. A rental is optional and remains operator-controlled." actions={<ButtonLink variant="ghost" leadingIcon={<X />} to={paths.incidents}>Cancel</ButtonLink>} /><div className="max-w-3xl space-y-4"><div className="grid gap-4 md:grid-cols-2">
    <Field label="Vehicle" id="vehicle" hint={selectedVehicle ? vehicleLabel(selectedVehicle) : 'Choose the affected vehicle.'}><Select id="vehicle" value={vehicleId} onChange={(event) => selectVehicle(event.target.value)} placeholder="Choose a vehicle" options={(vehicles.data ?? []).filter((vehicle) => !vehicle.archived_at).map((vehicle) => ({ value: vehicle.id, label: vehicleLabel(vehicle) }))} /></Field>
    <Field label="Related rental (optional)" id="rental" hint={selectedRental?.customer?.display_name ? `Customer: ${selectedRental.customer.display_name}` : 'No rental is required for a standalone incident.'}><Select id="rental" value={rentalId} onChange={(event) => { setRentalTouched(true); setRentalId(event.target.value) }} disabled={!vehicleId} options={rentalOptions} /></Field>
    <Field label="Incident type" id="type"><Select id="type" value={type} onChange={(event) => setType(event.target.value as IncidentType)} options={typeOptions.map(([value, label]) => ({ value, label }))} /></Field>
    <Field label="Occurred at" id="occurred"><Input id="occurred" type="datetime-local" value={occurredAt} onChange={(event) => setOccurredAt(event.target.value)} /></Field>
    <Field label="Responsibility" id="responsibility"><Select id="responsibility" value={responsibility} onChange={(event) => setResponsibility(event.target.value as IncidentResponsibility)} options={responsibilityOptions.map(([value, label]) => ({ value, label }))} /></Field>
    <Field label="Location" id="location"><Input id="location" value={location} onChange={(event) => setLocation(event.target.value)} placeholder="Where did it happen?" /></Field>
  </div><Field label="Description" id="description"><Textarea id="description" value={description} onChange={(event) => setDescription(event.target.value)} rows={6} placeholder="What happened?" /></Field><div className="grid gap-4 md:grid-cols-2"><Field label="Towing provider" id="tow"><Input id="tow" value={towingProvider} onChange={(event) => setTowingProvider(event.target.value)} /></Field><Field label="Towing reference" id="towref"><Input id="towref" value={towingReference} onChange={(event) => setTowingReference(event.target.value)} /></Field><Field label="Insurance provider" id="ins"><Input id="ins" value={insuranceProvider} onChange={(event) => setInsuranceProvider(event.target.value)} /></Field><Field label="Insurance claim reference" id="claim"><Input id="claim" value={insuranceClaimReference} onChange={(event) => setInsuranceClaimReference(event.target.value)} /></Field></div>{error ? <p role="alert" className="text-danger">{error}</p> : null}<div className="flex justify-end"><Button leadingIcon={<Check />} onClick={() => void submit()} isLoading={create.isPending}>Report incident</Button></div><p className="text-xs text-ink-subtle">The customer is derived from the selected rental. Choose No rental to record an event involving the vehicle only.</p></div></div>
}

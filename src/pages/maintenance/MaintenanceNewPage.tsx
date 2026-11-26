import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Check, X } from 'lucide-react'
import { paths } from '@/app/routes/paths'
import { Button, ButtonLink, Field, Input, PageHeader, Select, Textarea } from '@/components/ui'
import { useVehicleOptions } from '@/features/expenses/queries'
import { useIncident } from '@/features/incidents/queries'
import { incidentTypeLabels } from '@/features/incidents/presentation'
import { useCreateMaintenance } from '@/features/maintenance/queries'
import type { MaintenanceCategory, MaintenancePriority } from '@/features/maintenance/api'
const categories: [MaintenanceCategory, string][] = [
  ['preventive', 'Preventive service'],
  ['oil_filter', 'Oil and filter'],
  ['tire_service', 'Tire service'],
  ['brake_service', 'Brake service'],
  ['battery_electrical', 'Battery / electrical'],
  ['mechanical_repair', 'Mechanical repair'],
  ['bodywork_collision', 'Bodywork / collision'],
  ['vehicle_inspection', 'Vehicle inspection'],
  ['recall', 'Recall'],
  ['cleaning_detailing', 'Cleaning / detailing'],
  ['other', 'Other'],
]
export function MaintenanceNewPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const vehicles = useVehicleOptions()
  const create = useCreateMaintenance()
  const incidentId = params.get('incident') ?? ''
  const incident = useIncident(incidentId || undefined)
  const incidentRow = incidentId ? incident.data : undefined
  const [vehicleOverride, setVehicleOverride] = useState<string | null>(params.get('vehicle'))
  const vehicleId = vehicleOverride ?? incidentRow?.vehicle_id ?? ''
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState<MaintenanceCategory>('preventive')
  const [priority, setPriority] = useState<MaintenancePriority>('normal')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [descriptionOverride, setDescriptionOverride] = useState<string | null>(null)
  const description = descriptionOverride ?? incidentRow?.description ?? ''
  const [error, setError] = useState('')
  async function submit() {
    if (!vehicleId || !title.trim()) {
      setError('Vehicle and title are required.')
      return
    }
    try {
      const row = await create.mutateAsync({
        p_vehicle_id: vehicleId,
        p_title: title,
        p_category: category,
        p_priority: priority,
        p_scheduled_start: start ? new Date(start).toISOString() : null,
        p_expected_completion: end ? new Date(end).toISOString() : null,
        p_description: description,
        p_incident_id: incidentId || null,
        p_start_immediately: false,
      })
      void navigate(`${paths.maintenance}/${row.id}`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to schedule maintenance.')
    }
  }
  return (
    <div className="space-y-6">
      <PageHeader
        title="Schedule maintenance"
        eyebrow={incidentId ? 'Incident repair' : 'Fleet'}
        actions={
          <ButtonLink variant="ghost" leadingIcon={<X />} to={paths.maintenance}>
            Cancel
          </ButtonLink>
        }
      />
      <div className="max-w-3xl space-y-4">
        {incidentId ? (
          <div className="rounded-md border border-line bg-surface-muted p-3 text-sm">
            <p className="font-medium">
              {incidentRow
                ? `Raised from ${incidentRow.reference} · ${incidentTypeLabels[incidentRow.incident_type]}`
                : 'Raised from an incident'}
            </p>
            <p className="mt-1 text-ink-subtle">
              {incidentRow
                ? `Occurred ${new Date(incidentRow.occurred_at).toLocaleString()}. The vehicle and description below come from the incident; change anything that is not right.`
                : 'The vehicle and description will be filled in from the incident.'}
            </p>
          </div>
        ) : null}
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Vehicle" id="vehicle">
            <Select
              id="vehicle"
              value={vehicleId}
              onChange={(e) => setVehicleOverride(e.target.value)}
              placeholder="Choose a vehicle"
              options={(vehicles.data ?? [])
                .filter((v) => !v.archived_at)
                .map((v) => ({
                  value: v.id,
                  label: `${v.make} ${v.model} · ${v.registration_plate}`,
                }))}
            />
          </Field>
          <Field label="Title" id="title">
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Routine service"
            />
          </Field>
          <Field label="Category" id="category">
            <Select
              id="category"
              value={category}
              onChange={(e) => setCategory(e.target.value as MaintenanceCategory)}
              options={categories.map(([value, label]) => ({ value, label }))}
            />
          </Field>
          <Field label="Priority" id="priority">
            <Select
              id="priority"
              value={priority}
              onChange={(e) => setPriority(e.target.value as MaintenancePriority)}
              options={['low', 'normal', 'high', 'urgent'].map((value) => ({
                value,
                label: `${value[0]?.toUpperCase() ?? ''}${value.slice(1)}`,
              }))}
            />
          </Field>
          <Field label="Scheduled start" id="start">
            <Input
              id="start"
              type="datetime-local"
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
          </Field>
          <Field label="Expected completion" id="end">
            <Input
              id="end"
              type="datetime-local"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
            />
          </Field>
        </div>
        <Field label="Description" id="description">
          <Textarea
            id="description"
            rows={5}
            value={description}
            onChange={(e) => setDescriptionOverride(e.target.value)}
            placeholder="Work required and any reported symptoms."
          />
        </Field>
        {error ? (
          <p role="alert" className="text-critical-600">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end">
          <Button
            leadingIcon={<Check />}
            isLoading={create.isPending}
            onClick={() => void submit()}
          >
            Schedule maintenance
          </Button>
        </div>
      </div>
    </div>
  )
}

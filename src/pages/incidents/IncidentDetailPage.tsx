/* eslint-disable react-hooks/set-state-in-effect */
import { Check, Edit3, Paperclip, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import { customerDetailPath, paths, rentalDetailPath, vehicleDetailPath } from '@/app/routes/paths'
import {
  Badge,
  Button,
  ButtonLink,
  Card,
  CardBody,
  Field,
  Input,
  PageHeader,
  Select,
  Textarea,
  useToast,
} from '@/components/ui'
import { createIncidentSignedUrl } from '@/features/incidents/api'
import {
  useIncident,
  useIncidentAttachments,
  useResolveIncident,
  useUpdateIncident,
  useUploadIncidentAttachment,
} from '@/features/incidents/queries'
import {
  incidentResponsibilityLabels,
  incidentStatusLabels,
  incidentTypeLabels,
  rentalLabel,
  statusTone,
  vehicleLabel,
} from '@/features/incidents/presentation'
import { maintenanceStatusLabels } from '@/features/maintenance/presentation'
import { RelatedMaintenance } from '@/features/maintenance/components/RelatedMaintenance'
import { useMaintenanceForIncident } from '@/features/maintenance/queries'
import { useComplianceOptions } from '@/features/workspace/useOrganizationSettings'
import { useOrganization, usePermission } from '@/features/workspace/workspace-context'
import type { IncidentResponsibility, IncidentStatus, IncidentType } from '@/types/database'

const typeOptions = Object.entries(incidentTypeLabels).map(([value, label]) => ({ value, label }))
const responsibilityOptions = Object.entries(incidentResponsibilityLabels).map(
  ([value, label]) => ({ value, label }),
)

export function IncidentDetailPage() {
  const { incidentId } = useParams()
  const toast = useToast()
  const incident = useIncident(incidentId)
  const attachments = useIncidentAttachments(incidentId)
  const [notes, setNotes] = useState('')
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState('')
  const resolve = useResolveIncident(incidentId ?? '')
  const update = useUpdateIncident(incidentId ?? '')
  const upload = useUploadIncidentAttachment(incidentId ?? '')
  const fileRef = useRef<HTMLInputElement>(null)
  const canEdit = usePermission('incidents.update')
  const canCreateMaintenance = usePermission('maintenance.create')
  const organization = useOrganization()
  const compliance = useComplianceOptions()
  const relatedMaintenance = useMaintenanceForIncident(incidentId)
  const row = incident.data
  const [type, setType] = useState<IncidentType>('other')
  const [occurredAt, setOccurredAt] = useState('')
  const [location, setLocation] = useState('')
  const [description, setDescription] = useState('')
  const [responsibility, setResponsibility] = useState<IncidentResponsibility>('undetermined')
  const [towingProvider, setTowingProvider] = useState('')
  const [towingReference, setTowingReference] = useState('')
  const [insuranceProvider, setInsuranceProvider] = useState('')
  const [insuranceClaimReference, setInsuranceClaimReference] = useState('')
  const [status, setStatus] = useState<Exclude<IncidentStatus, 'resolved'>>('open')

  useEffect(() => {
    if (!row) return
    setType(row.incident_type)
    setOccurredAt(row.occurred_at.slice(0, 16))
    setLocation(row.location ?? '')
    setDescription(row.description)
    setResponsibility(row.responsibility)
    setTowingProvider(row.towing_provider ?? '')
    setTowingReference(row.towing_reference ?? '')
    setInsuranceProvider(row.insurance_provider ?? '')
    setInsuranceClaimReference(row.insurance_claim_reference ?? '')
    setStatus(row.status === 'resolved' ? 'open' : row.status)
  }, [row])
  if (incident.isLoading) return <p>Loading incident…</p>
  if (incident.isError || !row) return <p role="alert">Incident not found.</p>

  async function save() {
    setError('')
    try {
      await update.mutateAsync({
        type,
        occurredAt: new Date(occurredAt).toISOString(),
        location,
        description,
        responsibility,
        towingProvider,
        towingReference,
        insuranceProvider,
        insuranceClaimReference,
        status,
      })
      setEditing(false)
      toast.success('Incident updated')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to update incident.')
    }
  }
  /**
   * Resolving an incident is a statement about the incident, not about the car.
   *
   * It completes no maintenance, releases no restriction and changes no rental.
   * When work is still open the operator is told exactly which records stay
   * open, so "resolved" is never mistaken for "back on the road".
   */
  async function resolveNow() {
    const open = (relatedMaintenance.data ?? []).filter(
      (record) => record.status === 'scheduled' || record.status === 'in_progress',
    )
    if (open.length > 0) {
      const listed = open
        .map((record) => `  ${record.reference} — ${maintenanceStatusLabels[record.status]}`)
        .join('\n')
      const confirmed = window.confirm(
        `This incident still has maintenance open:\n\n${listed}\n\n` +
          'Resolving the incident does not complete that maintenance and does not return the vehicle to service. ' +
          'The vehicle stays restricted until the maintenance itself is completed.\n\n' +
          'Resolve the incident anyway?',
      )
      if (!confirmed) return
    }
    try {
      await resolve.mutateAsync(notes)
      toast.success('Incident resolved')
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Unable to resolve incident')
    }
  }
  async function uploadFile(file: File) {
    try {
      await upload.mutateAsync({
        file,
        kind: file.type.startsWith('image/') ? 'photo' : 'document',
      })
      toast.success('Attachment added')
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Unable to upload attachment')
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={row.reference}
        eyebrow="Incident"
        description={`${incidentTypeLabels[row.incident_type]} · ${new Date(row.occurred_at).toLocaleString()}`}
        actions={
          <div className="flex gap-2">
            {canEdit && row.status !== 'resolved' ? (
              <Button
                variant="secondary"
                leadingIcon={<Edit3 />}
                onClick={() => setEditing((value) => !value)}
              >
                {editing ? 'Cancel edit' : 'Edit incident'}
              </Button>
            ) : null}
            <ButtonLink variant="ghost" leadingIcon={<X />} to={paths.incidents}>
              Back
            </ButtonLink>
          </div>
        }
      />
      {editing ? (
        <Card>
          <CardBody className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Incident type" id="edit-type">
                <Select
                  id="edit-type"
                  value={type}
                  onChange={(event) => setType(event.target.value as IncidentType)}
                  options={typeOptions}
                />
              </Field>
              <Field label="Status" id="edit-status">
                <Select
                  id="edit-status"
                  value={status}
                  onChange={(event) =>
                    setStatus(event.target.value as Exclude<IncidentStatus, 'resolved'>)
                  }
                  options={[
                    { value: 'open', label: 'Open' },
                    { value: 'in_progress', label: 'In progress' },
                  ]}
                />
              </Field>
              <Field label="Occurred at" id="edit-occurred">
                <Input
                  id="edit-occurred"
                  type="datetime-local"
                  value={occurredAt}
                  onChange={(event) => setOccurredAt(event.target.value)}
                />
              </Field>
              <Field label="Responsibility" id="edit-responsibility">
                <Select
                  id="edit-responsibility"
                  value={responsibility}
                  onChange={(event) =>
                    setResponsibility(event.target.value as IncidentResponsibility)
                  }
                  options={responsibilityOptions}
                />
              </Field>
              <Field label="Location" id="edit-location">
                <Input
                  id="edit-location"
                  value={location}
                  onChange={(event) => setLocation(event.target.value)}
                />
              </Field>
            </div>
            <Field label="Description" id="edit-description">
              <Textarea
                id="edit-description"
                rows={5}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </Field>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Towing provider" id="edit-tow">
                <Input
                  id="edit-tow"
                  value={towingProvider}
                  onChange={(event) => setTowingProvider(event.target.value)}
                />
              </Field>
              <Field label="Towing reference" id="edit-towref">
                <Input
                  id="edit-towref"
                  value={towingReference}
                  onChange={(event) => setTowingReference(event.target.value)}
                />
              </Field>
              <Field label="Insurance provider" id="edit-ins">
                <Input
                  id="edit-ins"
                  value={insuranceProvider}
                  onChange={(event) => setInsuranceProvider(event.target.value)}
                />
              </Field>
              <Field label="Insurance claim reference" id="edit-claim">
                <Input
                  id="edit-claim"
                  value={insuranceClaimReference}
                  onChange={(event) => setInsuranceClaimReference(event.target.value)}
                />
              </Field>
            </div>
            {error ? (
              <p role="alert" className="text-critical-600">
                {error}
              </p>
            ) : null}
            <Button onClick={() => void save()} isLoading={update.isPending}>
              Save incident
            </Button>
          </CardBody>
        </Card>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardBody className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <Badge tone={statusTone(row.status)} withDot>
                {incidentStatusLabels[row.status]}
              </Badge>
              <span className="text-sm text-ink-subtle">
                {incidentResponsibilityLabels[row.responsibility]}
              </span>
            </div>
            <p className="whitespace-pre-wrap">{row.description}</p>
            {row.location ? (
              <p>
                <strong>Location:</strong> {row.location}
              </p>
            ) : null}
            <div className="grid gap-3 text-sm md:grid-cols-2">
              <p>
                <strong>Vehicle:</strong>{' '}
                <Link
                  className="text-brand-700 hover:underline"
                  to={vehicleDetailPath(row.vehicle_id)}
                >
                  {vehicleLabel(row.vehicle)}
                </Link>
              </p>
              <p>
                <strong>Related rental:</strong>{' '}
                {row.rental ? (
                  <Link
                    className="text-brand-700 hover:underline"
                    to={rentalDetailPath(row.rental.id)}
                  >
                    {rentalLabel(row.rental)}
                  </Link>
                ) : (
                  'No related rental'
                )}
              </p>
              <p>
                <strong>Customer:</strong>{' '}
                {row.customer ? (
                  <Link
                    className="text-brand-700 hover:underline"
                    to={customerDetailPath(row.customer.id)}
                  >
                    {row.customer.display_name}
                  </Link>
                ) : (
                  'Not applicable'
                )}
              </p>
              <p>
                <strong>Reported by:</strong> {row.reportedBy?.full_name ?? 'Operator unavailable'}
              </p>
              <p>
                <strong>Incident date:</strong> {new Date(row.occurred_at).toLocaleString()}
              </p>
            </div>
            <div className="grid gap-3 border-t pt-4 text-sm md:grid-cols-2">
              <p>
                <strong>Towing provider:</strong> {row.towing_provider ?? 'Not recorded'}
              </p>
              <p>
                <strong>Towing reference:</strong> {row.towing_reference ?? 'Not recorded'}
              </p>
              <p>
                <strong>Insurance provider:</strong> {row.insurance_provider ?? 'Not recorded'}
              </p>
              <p>
                <strong>Insurance claim:</strong> {row.insurance_claim_reference ?? 'Not recorded'}
              </p>
            </div>
            {row.resolution_notes ? (
              <div className="border-t pt-4 text-sm">
                <p>
                  <strong>Resolution notes:</strong> {row.resolution_notes}
                </p>
                <p>
                  <strong>Resolved:</strong>{' '}
                  {row.resolved_at ? new Date(row.resolved_at).toLocaleString() : 'Not recorded'} ·{' '}
                  {row.resolvedBy?.full_name ?? 'Operator unavailable'}
                </p>
              </div>
            ) : null}
          </CardBody>
        </Card>
        <Card>
          <CardBody className="space-y-4">
            <h2 className="font-semibold">Supporting files</h2>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,application/pdf"
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) void uploadFile(file)
                event.currentTarget.value = ''
              }}
            />
            <Button
              variant="secondary"
              leadingIcon={<Paperclip />}
              onClick={() => fileRef.current?.click()}
              isLoading={upload.isPending}
            >
              Add photo or document
            </Button>
            {attachments.data?.map((file) => (
              <button
                key={file.id}
                className="block text-left text-sm underline"
                onClick={() =>
                  void createIncidentSignedUrl(file).then((url) =>
                    window.open(url, '_blank', 'noopener,noreferrer'),
                  )
                }
              >
                {file.file_name}
              </button>
            ))}
          </CardBody>
        </Card>
      </div>
      <RelatedMaintenance
        incidentId={row.id}
        vehicleId={row.vehicle_id}
        canCreate={canCreateMaintenance}
        locale={organization.locale}
        timeZone={compliance.timeZone}
      />
      {canEdit && row.status !== 'resolved' ? (
        <Card>
          <CardBody className="space-y-3">
            <Field label="Resolution notes" id="resolution">
              <Textarea
                id="resolution"
                rows={3}
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="What closed the incident?"
              />
            </Field>
            <Button
              leadingIcon={<Check />}
              onClick={() => void resolveNow()}
              isLoading={resolve.isPending}
            >
              Resolve incident
            </Button>
          </CardBody>
        </Card>
      ) : null}
    </div>
  )
}

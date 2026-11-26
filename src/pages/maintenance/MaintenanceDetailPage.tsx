import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { CheckCircle2, CircleOff, Play } from 'lucide-react'

import { paths } from '@/app/routes/paths'
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ConfirmDialog,
  Field,
  PageHeader,
  Skeleton,
  Textarea,
  useToast,
} from '@/components/ui'
import { MaintenanceDocuments } from '@/features/maintenance/components/MaintenanceDocuments'
import { MaintenanceExpenses } from '@/features/maintenance/components/MaintenanceExpenses'
import { MaintenanceServicePlan } from '@/features/maintenance/components/MaintenanceServicePlan'
import {
  actualDurationMinutes,
  formatDuration,
  incidentStatusLabels,
  incidentTypeLabels,
  isOverdue,
  maintenanceCategoryLabels,
  maintenancePriorityLabels,
  maintenanceStatusLabels,
  maintenanceStatusTones,
  plannedDurationMinutes,
  startedEarly,
  startsLaterThanNow,
} from '@/features/maintenance/presentation'
import { useMaintenance, useMaintenanceAction } from '@/features/maintenance/queries'
import { useComplianceOptions, useDistanceUnit } from '@/features/workspace/useOrganizationSettings'
import { useOrganization, usePermission } from '@/features/workspace/workspace-context'
import { formatDateTime } from '@/lib/datetime/format'
import { toErrorMessage } from '@/lib/supabase/errors'

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="px-5 py-3">
      <dt className="text-ink-subtle text-sm">{label}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  )
}

/**
 * Everything about one maintenance record.
 *
 * The order follows what an operator needs to decide: what state the work is
 * in and what it is doing to the vehicle, then the dates, then what it cost and
 * the paperwork behind it. Lifecycle actions are the only things that change a
 * vehicle's availability from this page.
 */
export function MaintenanceDetailPage() {
  const { maintenanceId } = useParams<{ maintenanceId: string }>()
  const organization = useOrganization()
  const compliance = useComplianceOptions()
  const distanceUnit = useDistanceUnit()
  const toast = useToast()

  const canUpdate = usePermission('maintenance.update')
  const canComplete = usePermission('maintenance.complete')
  const canCancel = usePermission('maintenance.cancel')
  const canViewExpenses = usePermission('expenses.view')

  const [error, setError] = useState<string | null>(null)
  const [isConfirmingEarlyStart, setIsConfirmingEarlyStart] = useState(false)
  const [isCancelling, setIsCancelling] = useState(false)
  const [cancelReason, setCancelReason] = useState('')

  const query = useMaintenance()
  const record = (query.data ?? []).find((item) => item.id === maintenanceId)

  const start = useMaintenanceAction('maintenance_start')
  const complete = useMaintenanceAction('maintenance_complete')
  const cancel = useMaintenanceAction('maintenance_cancel')

  if (query.isPending) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  if (!record) {
    return (
      <div className="space-y-4">
        <PageHeader title="Maintenance" />
        <p>Maintenance record not found.</p>
      </div>
    )
  }

  const overdue = isOverdue(record)
  const early = startedEarly(record)
  const planned = plannedDurationMinutes(record)
  const actual = actualDurationMinutes(record)
  const isOpen = record.status === 'scheduled' || record.status === 'in_progress'

  async function run(
    action: 'start' | 'complete' | 'cancel',
    values: Record<string, unknown>,
  ): Promise<void> {
    setError(null)
    try {
      if (action === 'start') await start.mutateAsync(values)
      if (action === 'complete') await complete.mutateAsync(values)
      if (action === 'cancel') await cancel.mutateAsync(values)
      toast.success(
        action === 'start'
          ? 'Maintenance started'
          : action === 'complete'
            ? 'Maintenance completed'
            : 'Maintenance cancelled',
      )
    } catch (cause) {
      setError(toErrorMessage(cause))
    }
  }

  /**
   * Starting work before the day it was booked for is a real decision: the
   * vehicle goes out of service now rather than later. It is confirmed, and
   * cancelling the confirmation changes nothing at all.
   */
  function requestStart() {
    if (startsLaterThanNow(record!.scheduled_start)) {
      setIsConfirmingEarlyStart(true)
      return
    }
    void beginWork()
  }

  async function beginWork(): Promise<void> {
    setIsConfirmingEarlyStart(false)
    await run('start', { p_maintenance_id: record!.id, p_actual_start: new Date().toISOString() })
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={record.title}
        eyebrow={record.reference}
        description={record.description ?? 'Maintenance record'}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={maintenanceStatusTones[record.status]} withDot>
              {maintenanceStatusLabels[record.status]}
            </Badge>
            {overdue ? <Badge tone="critical">Overdue</Badge> : null}
            {early ? <Badge tone="neutral">Started early</Badge> : null}
          </div>
        }
      />

      {error ? (
        <Alert tone="critical" title="That did not go through">
          <p>{error}</p>
        </Alert>
      ) : null}

      {overdue ? (
        <Alert tone="caution" title="Past its expected completion">
          <p>
            This work was expected to finish{' '}
            {record.expected_completion
              ? formatDateTime(new Date(record.expected_completion), {
                  locale: organization.locale,
                  timeZone: compliance.timeZone,
                })
              : 'earlier'}
            . The vehicle stays restricted and cannot be checked out until the record is completed.
          </p>
        </Alert>
      ) : null}

      <Card>
        <CardHeader title="Work" />
        <CardBody className="p-0">
          <dl className="divide-line grid grid-cols-1 divide-y sm:grid-cols-2 sm:divide-x">
            <DetailRow label="Vehicle">
              <Link
                className="text-brand-700 hover:underline"
                to={`${paths.vehicles}/${record.vehicle_id}`}
              >
                {record.vehicle
                  ? `${record.vehicle.make} ${record.vehicle.model} · ${record.vehicle.registration_plate}`
                  : 'View vehicle'}
              </Link>
            </DetailRow>
            <DetailRow label="Category and priority">
              {maintenanceCategoryLabels[record.category]} ·{' '}
              {maintenancePriorityLabels[record.priority]}
            </DetailRow>
            <DetailRow label="Scheduled">
              {record.scheduled_start
                ? formatDateTime(new Date(record.scheduled_start), {
                    locale: organization.locale,
                    timeZone: compliance.timeZone,
                  })
                : 'Immediate / unscheduled'}
            </DetailRow>
            <DetailRow label="Expected completion">
              {record.expected_completion
                ? formatDateTime(new Date(record.expected_completion), {
                    locale: organization.locale,
                    timeZone: compliance.timeZone,
                  })
                : '—'}
            </DetailRow>
            <DetailRow label="Actual start">
              {record.actual_start
                ? formatDateTime(new Date(record.actual_start), {
                    locale: organization.locale,
                    timeZone: compliance.timeZone,
                  })
                : 'Not started'}
            </DetailRow>
            <DetailRow label="Actual completion">
              {record.actual_completion
                ? formatDateTime(new Date(record.actual_completion), {
                    locale: organization.locale,
                    timeZone: compliance.timeZone,
                  })
                : 'Not completed'}
            </DetailRow>
            <DetailRow label="Planned downtime">{formatDuration(planned)}</DetailRow>
            <DetailRow label={record.actual_completion ? 'Actual downtime' : 'Elapsed so far'}>
              {formatDuration(actual)}
            </DetailRow>
            {record.service_provider || record.technician ? (
              <DetailRow label="Provider">
                {[record.service_provider, record.technician].filter(Boolean).join(' · ')}
              </DetailRow>
            ) : null}
            {record.work_performed ? (
              <DetailRow label="Work performed">{record.work_performed}</DetailRow>
            ) : null}
          </dl>

          <div className="border-line flex flex-wrap gap-3 border-t px-5 py-4">
            {record.status === 'scheduled' && canUpdate ? (
              <Button leadingIcon={<Play />} isLoading={start.isPending} onClick={requestStart}>
                Start maintenance
              </Button>
            ) : null}
            {record.status === 'in_progress' && canComplete ? (
              <Button
                leadingIcon={<CheckCircle2 />}
                isLoading={complete.isPending}
                onClick={() =>
                  void run('complete', {
                    p_maintenance_id: record.id,
                    p_actual_completion: new Date().toISOString(),
                  })
                }
              >
                Complete maintenance
              </Button>
            ) : null}
            {isOpen && canCancel ? (
              <Button
                variant="ghost"
                leadingIcon={<CircleOff />}
                isLoading={cancel.isPending}
                onClick={() => {
                  setCancelReason('')
                  setIsCancelling(true)
                }}
              >
                Cancel maintenance
              </Button>
            ) : null}
          </div>
        </CardBody>
      </Card>

      {/*
        The incident this came from, named rather than hinted at. The old page
        showed a bare "View incident" link with no reference, type or status, so
        an operator had to open it to find out what it was.
      */}
      {record.incident_id ? (
        <Card>
          <CardHeader
            title="Related incident"
            description="Resolving the incident does not complete this maintenance, and completing this does not resolve the incident."
          />
          <CardBody className="p-0">
            <dl className="divide-line grid grid-cols-1 divide-y sm:grid-cols-2 sm:divide-x">
              <DetailRow label="Incident">
                <Link
                  className="text-brand-700 hover:underline"
                  to={`${paths.incidents}/${record.incident_id}`}
                >
                  {record.incident?.reference ?? 'View incident'}
                </Link>
              </DetailRow>
              <DetailRow label="Type">
                {record.incident
                  ? (incidentTypeLabels[record.incident.incident_type] ??
                    record.incident.incident_type)
                  : '—'}
              </DetailRow>
              <DetailRow label="Status">
                {record.incident
                  ? (incidentStatusLabels[record.incident.status] ?? record.incident.status)
                  : '—'}
              </DetailRow>
              <DetailRow label="Occurred">
                {record.incident
                  ? formatDateTime(new Date(record.incident.occurred_at), {
                      locale: organization.locale,
                      timeZone: compliance.timeZone,
                    })
                  : '—'}
              </DetailRow>
            </dl>
          </CardBody>
        </Card>
      ) : null}

      {canViewExpenses ? (
        <MaintenanceExpenses
          maintenanceId={record.id}
          vehicleId={record.vehicle_id}
          reference={record.reference}
          title={record.title}
          category={record.category}
          currency={record.currency}
          estimatedCostMinor={record.estimated_cost_minor}
          canManage={canUpdate}
          locale={organization.locale}
          timeZone={compliance.timeZone}
        />
      ) : null}

      <MaintenanceServicePlan
        record={record}
        vehicleOdometer={record.vehicle?.odometer ?? null}
        distanceUnit={distanceUnit}
        canManage={canUpdate}
        locale={organization.locale}
        timeZone={compliance.timeZone}
      />

      <MaintenanceDocuments
        maintenanceId={record.id}
        canUpload={canUpdate}
        canDelete={canUpdate}
        locale={organization.locale}
        timeZone={compliance.timeZone}
      />

      <ConfirmDialog
        open={isConfirmingEarlyStart}
        onOpenChange={setIsConfirmingEarlyStart}
        title="Start this maintenance now?"
        description={`${record.vehicle?.registration_plate ?? 'The vehicle'} goes out of service immediately, before the date this work was booked for. The scheduled dates are kept, and no existing rental is cancelled or moved.`}
        confirmLabel="Start now"
        isPending={start.isPending}
        onConfirm={() => void beginWork()}
      />

      <ConfirmDialog
        open={isCancelling}
        onOpenChange={setIsCancelling}
        title="Cancel this maintenance?"
        description="The record is kept and marked cancelled. Any restriction it was applying is released, and nothing else about the vehicle changes."
        confirmLabel="Cancel maintenance"
        cancelLabel="Keep it"
        tone="danger"
        isPending={cancel.isPending}
        isConfirmDisabled={cancelReason.trim().length === 0}
        onConfirm={() => {
          setIsCancelling(false)
          void run('cancel', { p_maintenance_id: record.id, p_reason: cancelReason })
        }}
      >
        <Field label="Reason" id="cancel-reason" required>
          <Textarea
            id="cancel-reason"
            rows={3}
            value={cancelReason}
            onChange={(event) => setCancelReason(event.target.value)}
            placeholder="Why is this work no longer needed?"
          />
        </Field>
      </ConfirmDialog>
    </div>
  )
}

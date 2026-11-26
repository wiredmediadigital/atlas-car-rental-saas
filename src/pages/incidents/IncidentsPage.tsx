import { Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { paths } from '@/app/routes/paths'
import { Badge, ButtonLink, Card, CardBody, Input, PageHeader, Select } from '@/components/ui'
import { useIncidents } from '@/features/incidents/queries'
import {
  incidentResponsibilityLabels,
  incidentStatusLabels,
  incidentTypeLabels,
  statusTone,
  vehicleLabel,
} from '@/features/incidents/presentation'
import type { IncidentStatus, IncidentType } from '@/types/database'

export function IncidentsPage() {
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<IncidentStatus | 'all'>('all')
  const [type, setType] = useState<IncidentType | 'all'>('all')
  const query = useIncidents({ search, status, type })
  const rows = query.data ?? []
  const typeOptions = useMemo(
    () => [
      { value: 'all', label: 'All types' },
      ...Object.entries(incidentTypeLabels).map(([value, label]) => ({ value, label })),
    ],
    [],
  )
  return (
    <div className="space-y-6">
      <PageHeader
        title="Incidents"
        eyebrow="Operations"
        description="Track operational events without changing rental or vehicle history."
        actions={
          <ButtonLink to={paths.incidentNew} leadingIcon={<Plus />}>
            Report incident
          </ButtonLink>
        }
      />
      <Card>
        <CardBody>
          <div className="grid gap-3 md:grid-cols-[1fr_180px_180px]">
            <Input
              aria-label="Search incidents"
              placeholder="Search reference, vehicle plate or rental"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <Select
              aria-label="Status"
              value={status}
              onChange={(event) => setStatus(event.target.value as IncidentStatus | 'all')}
              options={[
                { value: 'all', label: 'All statuses' },
                ...Object.entries(incidentStatusLabels).map(([value, label]) => ({ value, label })),
              ]}
            />
            <Select
              aria-label="Type"
              value={type}
              onChange={(event) => setType(event.target.value as IncidentType | 'all')}
              options={typeOptions}
            />
          </div>
        </CardBody>
      </Card>
      <Card>
        <CardBody>
          {query.isLoading ? (
            <p>Loading incidents…</p>
          ) : query.isError ? (
            <p role="alert">Unable to load incidents.</p>
          ) : rows.length === 0 ? (
            <p className="text-ink-subtle">No incidents match these filters.</p>
          ) : (
            <div className="divide-y divide-border">
              {rows.map((row) => (
                <Link
                  key={row.id}
                  to={`${paths.incidents}/${row.id}`}
                  className="block space-y-2 py-4 first:pt-0 last:pb-0 hover:bg-surface-subtle"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="font-medium">
                        {row.reference} · {incidentTypeLabels[row.incident_type]}
                      </p>
                      <p className="text-sm text-ink-subtle">{vehicleLabel(row.vehicle)}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm text-ink-subtle">
                        {new Date(row.occurred_at).toLocaleDateString()}
                      </span>
                      <Badge tone={statusTone(row.status)} withDot>
                        {incidentStatusLabels[row.status]}
                      </Badge>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-ink-subtle">
                    <span>{row.rental?.reference ?? 'No related rental'}</span>
                    <span>{row.customer?.display_name ?? 'No customer'}</span>
                    <span>{incidentResponsibilityLabels[row.responsibility]}</span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  )
}

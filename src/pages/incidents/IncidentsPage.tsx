import { Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { paths } from '@/app/routes/paths'
import { ButtonLink, Card, CardBody, Input, PageHeader, Select, Badge } from '@/components/ui'
import { useIncidents } from '@/features/incidents/queries'
import type { IncidentStatus, IncidentType } from '@/types/database'

const typeLabels: Record<IncidentType, string> = { breakdown: 'Breakdown', accident: 'Accident', vehicle_damage: 'Vehicle damage', theft: 'Theft', other: 'Other' }
export function IncidentsPage() {
  const [search, setSearch] = useState(''); const [status, setStatus] = useState<IncidentStatus | 'all'>('all'); const [type, setType] = useState<IncidentType | 'all'>('all')
  const query = useIncidents({ search, status, type }); const rows = query.data ?? []
  const statusTone = useMemo(() => (value: IncidentStatus) => value === 'resolved' ? 'positive' : value === 'in_progress' ? 'info' : 'caution', [])
  return <div className="space-y-6">
    <PageHeader title="Incidents" eyebrow="Operations" description="Track operational events without changing rental or vehicle history." actions={<ButtonLink to={paths.incidentNew} leadingIcon={<Plus />}>Report incident</ButtonLink>} />
    <Card><CardBody><div className="grid gap-3 md:grid-cols-[1fr_180px_180px]"><Input aria-label="Search incidents" placeholder="Search reference, description or location" value={search} onChange={e => setSearch(e.target.value)} /><Select aria-label="Status" value={status} onChange={e => setStatus(e.target.value as IncidentStatus | 'all')} options={[{ value: 'all', label: 'All statuses' }, { value: 'open', label: 'Open' }, { value: 'in_progress', label: 'In progress' }, { value: 'resolved', label: 'Resolved' }]} /><Select aria-label="Type" value={type} onChange={e => setType(e.target.value as IncidentType | 'all')} options={[{ value: 'all', label: 'All types' }, ...Object.entries(typeLabels).map(([value, label]) => ({ value, label }))]} /></div></CardBody></Card>
    <Card><CardBody>{query.isLoading ? <p>Loading incidents…</p> : query.isError ? <p role="alert">Unable to load incidents.</p> : rows.length === 0 ? <p className="text-ink-subtle">No incidents match these filters.</p> : <div className="divide-y divide-border">{rows.map(row => <Link key={row.id} to={`${paths.incidents}/${row.id}`} className="flex flex-wrap items-center justify-between gap-3 py-4 first:pt-0 last:pb-0 hover:bg-surface-subtle"><div><p className="font-medium">{row.reference} · {typeLabels[row.incident_type]}</p><p className="text-sm text-ink-subtle">{row.description.slice(0, 120)}{row.description.length > 120 ? '…' : ''}</p></div><div className="flex items-center gap-3"><span className="text-sm text-ink-subtle">{new Date(row.occurred_at).toLocaleDateString()}</span><Badge tone={statusTone(row.status)}>{row.status.replace('_', ' ')}</Badge></div></Link>)}</div>}</CardBody></Card>
  </div>
}

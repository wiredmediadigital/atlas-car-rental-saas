import { AlertTriangle } from 'lucide-react'

import { Badge, Button, type BadgeTone } from '@/components/ui'
import { formatMoney } from '@/lib/money/money'

import { overlappingLeadIds, type Lead, type LeadStatus } from '../api'

const STATUS_LABELS: Record<LeadStatus, string> = {
  new: 'New',
  contacted: 'Contacted',
  converted: 'Converted',
  declined: 'Declined',
  lapsed: 'Lapsed',
}

const STATUS_TONES: Record<LeadStatus, BadgeTone> = {
  new: 'info',
  contacted: 'caution',
  converted: 'positive',
  declined: 'neutral',
  lapsed: 'neutral',
}

/** The words the collision warning uses, kept here so the test can name them. */
export const COLLISION_LABEL = 'Another request wants this car on these dates'

export interface LeadTableProps {
  leads: readonly Lead[]
  timeZone: string
  /** Absent for a member who may not convert. */
  onConvert?: (lead: Lead) => void
  /** Absent for anyone below manager; the policy refuses them anyway. */
  onDelete?: (lead: Lead) => void
  onContact?: (lead: Lead) => void
  onDecline?: (lead: Lead) => void
}

function formatPeriod(startsAt: string, endsAt: string, timeZone: string): string {
  const format = (value: string) => {
    try {
      return new Intl.DateTimeFormat('en-GB', {
        timeZone,
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(new Date(value))
    } catch {
      return value.slice(0, 16).replace('T', ' ')
    }
  }
  return `${format(startsAt)} – ${format(endsAt)}`
}

export function LeadTable({
  leads,
  timeZone,
  onConvert,
  onDelete,
  onContact,
  onDecline,
}: LeadTableProps) {
  const collisions = overlappingLeadIds(leads)

  return (
    <div className="border-line overflow-x-auto rounded-lg border">
      <table className="w-full text-left text-sm">
        <thead className="border-line bg-surface-muted border-b">
          <tr>
            <th scope="col" className="px-4 py-3 font-medium">
              Who
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Car
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Dates
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Estimate
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Status
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {leads.map((lead) => (
            <tr key={lead.id} className="border-line border-b last:border-0 align-top">
              <td className="px-4 py-3">
                <div className="font-medium">{lead.fullName}</div>
                <a href={`mailto:${lead.email}`} className="text-brand-700 text-[0.8125rem]">
                  {lead.email}
                </a>
                {lead.phone === null ? null : (
                  <div className="text-ink-muted text-[0.8125rem]">{lead.phone}</div>
                )}
                <div className="text-ink-subtle text-[0.75rem]">{lead.reference}</div>
              </td>

              <td className="px-4 py-3">
                <div>{lead.vehicleLabel}</div>
                {collisions.has(lead.id) ? (
                  <p className="text-caution-700 mt-1 flex items-start gap-1 text-[0.8125rem]">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    {COLLISION_LABEL}
                  </p>
                ) : null}
              </td>

              <td className="px-4 py-3 whitespace-nowrap">
                {formatPeriod(lead.startsAt, lead.endsAt, timeZone)}
              </td>

              <td className="px-4 py-3 whitespace-nowrap">
                {formatMoney(lead.quotedTotalMinor, lead.currency)}
                <div className="text-ink-subtle text-[0.75rem]">as quoted</div>
              </td>

              <td className="px-4 py-3">
                <Badge tone={STATUS_TONES[lead.status]}>{STATUS_LABELS[lead.status]}</Badge>
              </td>

              <td className="px-4 py-3">
                <div className="flex flex-wrap justify-end gap-2">
                  {lead.status === 'new' && onContact !== undefined ? (
                    <Button size="sm" variant="ghost" onClick={() => onContact(lead)}>
                      Mark contacted
                    </Button>
                  ) : null}
                  {lead.status !== 'converted' && onConvert !== undefined ? (
                    <Button size="sm" variant="primary" onClick={() => onConvert(lead)}>
                      Convert
                    </Button>
                  ) : null}
                  {lead.status !== 'converted' && onDecline !== undefined ? (
                    <Button size="sm" variant="ghost" onClick={() => onDecline(lead)}>
                      Decline
                    </Button>
                  ) : null}
                  {onDelete === undefined ? null : (
                    <Button size="sm" variant="ghost" onClick={() => onDelete(lead)}>
                      Delete
                    </Button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

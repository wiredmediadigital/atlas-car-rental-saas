import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { rentalDetailPath } from '@/app/routes/paths'
import { Alert, EmptyState, PageHeader, Spinner } from '@/components/ui'
import type { Lead } from '@/features/leads/api'
import { ConvertLeadDialog } from '@/features/leads/components/ConvertLeadDialog'
import { LeadTable } from '@/features/leads/components/LeadTable'
import { leadKeys, useDeleteLead, useLeads, useSetLeadStatus } from '@/features/leads/queries'
import { useOrganization, useRole } from '@/features/workspace/workspace-context'
import { can } from '@/lib/authz/permissions'
import { toErrorMessage } from '@/lib/supabase/errors'

/**
 * The queue of requests from the agency's public booking page.
 *
 * A work list, not a report. Every column answers something a staff member
 * needs before picking up the telephone: who asked, for what, when, what they
 * were quoted, and whether somebody else has asked for the same car over the
 * same days.
 */
export function LeadsPage() {
  const organization = useOrganization()
  const role = useRole()

  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [converting, setConverting] = useState<Lead | null>(null)

  const leads = useLeads()
  const setStatus = useSetLeadStatus()
  const remove = useDeleteLead()

  const failure = leads.error ?? setStatus.error ?? remove.error

  return (
    <div className="space-y-5">
      <PageHeader
        title="Booking requests"
        description="Enquiries from your public booking page. A request does not hold the car."
      />

      {failure === null ? null : <Alert tone="critical">{toErrorMessage(failure)}</Alert>}

      {leads.isPending ? (
        <div className="flex justify-center py-12">
          <Spinner />
          <span className="sr-only">Loading</span>
        </div>
      ) : (leads.data ?? []).length === 0 ? (
        <EmptyState
          title="No requests yet"
          description="When somebody asks for a car on your public booking page, it arrives here."
        />
      ) : (
        <LeadTable
          leads={leads.data ?? []}
          timeZone={organization.time_zone}
          onContact={(lead: Lead) => setStatus.mutate({ leadId: lead.id, status: 'contacted' })}
          onDecline={(lead: Lead) => setStatus.mutate({ leadId: lead.id, status: 'declined' })}
          /*
           * The controls follow the policies rather than guessing: the
           * database refuses a staff member's delete whatever this renders,
           * and hiding a button somebody cannot use is kinder than letting
           * them press it.
           */
          onConvert={can(role, 'leads.convert') ? (lead: Lead) => setConverting(lead) : undefined}
          onDelete={can(role, 'leads.delete') ? (lead: Lead) => remove.mutate(lead.id) : undefined}
        />
      )}

      {converting === null ? null : (
        <ConvertLeadDialog
          lead={converting}
          open
          onOpenChange={(next) => {
            if (!next) setConverting(null)
          }}
          onConverted={(result) => {
            setConverting(null)
            /*
             * Straight to the rental that now exists. The queue is invalidated
             * on the way out so the lead reads `converted` when staff come
             * back, rather than still offering a Convert button for a request
             * that has already become a contract.
             */
            void queryClient.invalidateQueries({
              queryKey: leadKeys.all(organization.id),
            })
            void navigate(rentalDetailPath(result.rentalId))
          }}
        />
      )}
    </div>
  )
}

import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'

import { useOrganization } from '@/features/workspace/workspace-context'

import { deleteLead, fetchLeads, setLeadStatus, type LeadStatus } from './api'

/**
 * Query keys for booking requests.
 *
 * Prefixed with the organization id like every other module's, so switching
 * agency cannot serve a cached queue from the previous one and the workspace
 * switcher's blanket `['organization']` invalidation reaches it.
 */
export const leadKeys = {
  all: (organizationId: string) => ['organization', organizationId, 'leads'] as const,
  list: (organizationId: string) => ['organization', organizationId, 'leads', 'list'] as const,
}

async function invalidateLeads(client: QueryClient, organizationId: string): Promise<void> {
  await client.invalidateQueries({ queryKey: leadKeys.all(organizationId) })
}

export function useLeads() {
  const organization = useOrganization()

  return useQuery({
    queryKey: leadKeys.list(organization.id),
    queryFn: () => fetchLeads(organization.id),
    /*
     * Shorter than most lists here. A booking request is somebody waiting for
     * a telephone call, and two members of staff working the same queue should
     * not spend a minute each believing they are the first to reach it.
     */
    staleTime: 10_000,
  })
}

export function useSetLeadStatus() {
  const organization = useOrganization()
  const client = useQueryClient()

  return useMutation({
    mutationFn: ({ leadId, status }: { leadId: string; status: LeadStatus }) =>
      setLeadStatus(leadId, status),
    onSuccess: () => invalidateLeads(client, organization.id),
  })
}

export function useDeleteLead() {
  const organization = useOrganization()
  const client = useQueryClient()

  return useMutation({
    mutationFn: (leadId: string) => deleteLead(leadId),
    onSuccess: () => invalidateLeads(client, organization.id),
  })
}

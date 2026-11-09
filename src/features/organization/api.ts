import { getSupabaseClient } from '@/lib/supabase/client'
import { toAppError } from '@/lib/supabase/errors'
import type { Organization } from '@/types/database'

/**
 * Requests closure of an agency. Owner only, enforced by the database.
 *
 * THERE IS NO SECOND ARGUMENT AND THERE MUST NOT BE ONE. The window is thirty
 * days; the function takes only the agency id, so no caller, this one included,
 * can shorten it. Someone who needs data gone sooner asks a person.
 */
export async function requestClosure(organizationId: string): Promise<Organization> {
  const { data, error } = await getSupabaseClient().rpc('organization_request_closure', {
    p_organization_id: organizationId,
  })
  if (error) throw toAppError(error)
  return data
}

/** Withdraws a pending closure. Owner or administrator; refused once the purge has started. */
export async function restoreAccount(organizationId: string): Promise<Organization> {
  const { data, error } = await getSupabaseClient().rpc('organization_restore', {
    p_organization_id: organizationId,
  })
  if (error) throw toAppError(error)
  return data
}

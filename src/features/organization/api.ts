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

  // The request has committed and the in-app notification with it. The emails
  // are sent by a separate function, and a failure to send one must never undo
  // or mask the closure the owner just chose, so every failure here is dropped.
  // The notice stays pending in the database and is sent on a later attempt.
  // Not awaited: sending takes seconds, and the owner should not wait on it.
  void requestClosureNoticeEmails(organizationId)
  return data
}

async function requestClosureNoticeEmails(organizationId: string): Promise<void> {
  try {
    await getSupabaseClient().functions.invoke('account-closure-notice', {
      body: { organization_id: organizationId },
    })
  } catch {
    // Deliberately silent: see requestClosure.
  }
}

/** Withdraws a pending closure. Owner or administrator; refused once the purge has started. */
export async function restoreAccount(organizationId: string): Promise<Organization> {
  const { data, error } = await getSupabaseClient().rpc('organization_restore', {
    p_organization_id: organizationId,
  })
  if (error) throw toAppError(error)
  return data
}

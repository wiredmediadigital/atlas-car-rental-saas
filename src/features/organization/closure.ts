import { formatDate } from '@/lib/datetime/format'
import { hasMinRole } from '@/lib/authz/permissions'
import type { Organization, OrgRole } from '@/types/database'

/**
 * Where an agency is in its closure. The client-side twin of
 * app.closure_state_of: the furthest stage the timestamps record wins.
 *
 * Derived, never stored, so it cannot disagree with the columns it reads. The
 * organization row already reaches the browser through the workspace query, so
 * there is no second request for it.
 */
export type ClosureState = 'open' | 'suspended' | 'purging' | 'closed'

type ClosureColumns = Pick<Organization, 'closure_requested_at' | 'purge_started_at' | 'closed_at'>

export function closureStateOf(organization: ClosureColumns | null | undefined): ClosureState {
  if (!organization) return 'open'
  if (organization.closed_at) return 'closed'
  if (organization.purge_started_at) return 'purging'
  if (organization.closure_requested_at) return 'suspended'
  return 'open'
}

/**
 * Who is offered what. These mirror the database, and the database decides:
 * organization_request_closure is owner only; organization_restore is owner or
 * administrator and is refused once the purge has claimed the agency.
 *
 * THE ASYMMETRY IS DELIBERATE. Closing is harder than restoring, so that a
 * single compromised administrator cannot close an agency, while any of them
 * can undo one. Do not "tidy" these into one rule.
 */
export function canRequestClosure(role: OrgRole | null, state: ClosureState): boolean {
  return role === 'owner' && state === 'open'
}

export function canRestoreAgency(role: OrgRole | null, state: ClosureState): boolean {
  return hasMinRole(role, 'admin') && state === 'suspended'
}

/** The purge date as the agency reads dates, or null when none is recorded. */
export function formatPurgeDate(
  organization: Pick<Organization, 'closure_purge_after' | 'time_zone' | 'locale'>,
): string | null {
  if (!organization.closure_purge_after) return null
  return formatDate(new Date(organization.closure_purge_after), {
    locale: organization.locale,
    timeZone: organization.time_zone,
  })
}

/** How long the window is. Fixed in the database; stated here only so the copy can say it. */
export const CLOSURE_WINDOW_DAYS = 30

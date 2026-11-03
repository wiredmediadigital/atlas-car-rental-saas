import { createContext, useContext } from 'react'

import type { Permission } from '@/lib/authz/permissions'
import { can, isWithdrawnWhenRestricted } from '@/lib/authz/permissions'
import type {
  BillingAccessState,
  Organization,
  OrganizationMember,
  OrgRole,
} from '@/types/database'

export interface WorkspaceMembership {
  readonly organization: Organization
  readonly membership: OrganizationMember
}

export type WorkspaceStatus = 'loading' | 'ready' | 'no-organization' | 'error'

export interface WorkspaceContextValue {
  readonly status: WorkspaceStatus
  /** Every agency the signed-in user belongs to. */
  readonly memberships: readonly WorkspaceMembership[]
  /** The agency currently being worked in. Null unless status is 'ready'. */
  readonly organization: Organization | null
  readonly membership: OrganizationMember | null
  readonly role: OrgRole | null
  /**
   * What the product does about this agency's billing, or null while it is
   * still being read. Null is treated as "not restricted" by usePermission:
   * see the comment there.
   */
  readonly billingAccessState: BillingAccessState | null
  readonly error: Error | null
  readonly switchOrganization: (organizationId: string) => void
  readonly refresh: () => Promise<void>
}

export const WorkspaceContext = createContext<WorkspaceContextValue | null>(null)

export function useWorkspace(): WorkspaceContextValue {
  const context = useContext(WorkspaceContext)
  if (!context) {
    throw new Error('useWorkspace must be used inside <WorkspaceProvider>.')
  }
  return context
}

/**
 * The active agency. Throws if called outside a route that guarantees one —
 * which is deliberate: a component that reads the organization should never
 * have to branch on it being absent.
 */
export function useOrganization(): Organization {
  const { organization } = useWorkspace()
  if (!organization) {
    throw new Error('useOrganization was called outside an organization-scoped route.')
  }
  return organization
}

export function useRole(): OrgRole | null {
  return useWorkspace().role
}

/**
 * Whether this agency's records are read-only because nobody is paying for it.
 *
 * Note what it is NOT: `attention` is not restricted. A card that has just
 * failed leaves the agency fully able to work while Stripe retries, which is
 * the whole point of the distinction.
 */
export function useIsBillingRestricted(): boolean {
  return useWorkspace().billingAccessState === 'restricted'
}

/**
 * Whether the interface should offer an action.
 *
 * This mirrors the controls that will actually decide the outcome — the role
 * matrix in RLS, and since 20261103100100 the billing gate beside it. It hides
 * controls; it does not secure them.
 *
 * WHILE THE BILLING STATE IS UNKNOWN, NOTHING IS WITHDRAWN. The alternative is
 * every button on every page rendering disabled for a moment on each load and
 * then enabling itself, which looks like a broken product to the overwhelming
 * majority of agencies that are paying perfectly normally. The cost of guessing
 * wrong is that a restricted agency briefly sees a control that the database
 * will refuse — which is the ordinary, already-handled case, because hiding a
 * button was never what stopped the write.
 */
export function usePermission(permission: Permission): boolean {
  const { role, billingAccessState } = useWorkspace()
  if (!can(role, permission)) return false
  if (billingAccessState !== 'restricted') return true
  return !isWithdrawnWhenRestricted(permission)
}

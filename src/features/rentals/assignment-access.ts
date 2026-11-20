import { hasMinRole, type OrgRole } from '@/lib/authz/permissions'

export interface AssignmentActivation {
  readonly organizationId: string
  readonly enabled: boolean
}

export interface AssignmentFeatureEligibility {
  readonly enabled: boolean
  readonly canViewHistory: boolean
  readonly canSwap: boolean
}

export const deniedAssignmentFeatureEligibility: AssignmentFeatureEligibility = {
  enabled: false,
  canViewHistory: false,
  canSwap: false,
}

export function assignmentFeatureEnabled(
  organizationId: string | null,
  activation: AssignmentActivation | null,
): boolean {
  return Boolean(
    organizationId && activation?.enabled && activation.organizationId === organizationId,
  )
}

export function assignmentAccess(
  organizationId: string | null,
  membershipOrganizationId: string | null,
  role: OrgRole | null,
  activation: AssignmentActivation | null,
): { canViewHistory: boolean; canSwap: boolean } {
  const eligible =
    membershipOrganizationId === organizationId &&
    assignmentFeatureEnabled(organizationId, activation)
  return {
    canViewHistory: eligible && hasMinRole(role, 'staff'),
    canSwap: eligible && hasMinRole(role, 'manager'),
  }
}

/** Legacy pure helper retained for callers that need a fail-closed default. */
export function currentAssignmentAccess(
  organizationId: string | null,
  membershipOrganizationId: string | null,
  role: OrgRole | null,
) {
  return assignmentAccess(organizationId, membershipOrganizationId, role, null)
}

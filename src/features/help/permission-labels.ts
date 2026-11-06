import { PERMISSIONS, ROLE_LABELS } from '@/lib/authz/permissions'

export type PermissionKey = keyof typeof PERMISSIONS

/**
 * Help pages name permission keys, never roles. The visible role label is
 * derived here from the PERMISSIONS matrix so the two cannot drift apart.
 */
export function isPermissionKey(value: string): value is PermissionKey {
  return Object.hasOwn(PERMISSIONS, value)
}

/** `null` when every member can do it (minimum role is staff). */
export function roleLabelFor(permission: PermissionKey): string | null {
  const minimum = PERMISSIONS[permission]
  if (minimum === 'staff') return null
  if (minimum === 'owner') return 'Owner only'
  return `${ROLE_LABELS[minimum]} and above`
}

/** Matches `<!-- permission: <key> -->`, the line after a `##` heading. */
export const SECTION_PERMISSION_PATTERN = /<!--\s*permission:\s*([^\s>]+?)\s*-->/g

/** Every section permission key in document order, validated or not. */
export function sectionPermissions(body: string): readonly string[] {
  return Array.from(body.matchAll(SECTION_PERMISSION_PATTERN), (match) => match[1] ?? '')
}

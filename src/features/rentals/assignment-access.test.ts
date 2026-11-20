import { describe, expect, it } from 'vitest'

import { assignmentAccess, currentAssignmentAccess } from './assignment-access'

const enabled = { organizationId: 'org-a', enabled: true } as const

describe('assignment feature eligibility', () => {
  it('is disabled by default, with no browser override', () => {
    expect(currentAssignmentAccess('org-a', 'org-a', 'manager')).toEqual({
      canViewHistory: false,
      canSwap: false,
    })
  })

  it('accepts only a matched, active organization and manager for swaps', () => {
    expect(assignmentAccess('org-a', 'org-a', 'manager', enabled)).toEqual({
      canViewHistory: true,
      canSwap: true,
    })
    expect(assignmentAccess('org-a', 'org-a', 'staff', enabled)).toEqual({
      canViewHistory: true,
      canSwap: false,
    })
    for (const [organizationId, membershipId, role] of [
      ['org-b', 'org-a', 'manager'],
      ['org-a', 'org-b', 'manager'],
      ['org-a', null, 'manager'],
      [null, null, 'manager'],
      ['org-a', 'org-a', null],
    ] as const) {
      expect(assignmentAccess(organizationId, membershipId, role, enabled)).toEqual({
        canViewHistory: false,
        canSwap: false,
      })
    }
    expect(assignmentAccess('org-a', 'org-a', 'manager', null).canSwap).toBe(false)
    expect(
      assignmentAccess('org-a', 'org-a', 'manager', { ...enabled, enabled: false }).canSwap,
    ).toBe(false)
  })
})

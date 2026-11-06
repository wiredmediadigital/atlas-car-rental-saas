import { isPermissionKey, roleLabelFor, sectionPermissions } from './permission-labels'

describe('roleLabelFor', () => {
  test('returns null when the minimum role is staff', () => {
    expect(roleLabelFor('rentals.view')).toBeNull()
  })

  test('names the minimum role and above for a manager-minimum permission', () => {
    expect(roleLabelFor('expenses.create')).toBe('Manager and above')
    expect(roleLabelFor('financing.view')).toBe('Manager and above')
  })

  test('uses the matrix label for admin, not the raw role name', () => {
    expect(roleLabelFor('vehicles.delete')).toBe('Administrator and above')
  })

  test('names owner only for an owner-minimum permission', () => {
    expect(roleLabelFor('team.transferOwnership')).toBe('Owner only')
    expect(roleLabelFor('billing.manage')).toBe('Owner only')
  })
})

describe('isPermissionKey', () => {
  test('accepts a key in the matrix', () => {
    expect(isPermissionKey('rentals.view')).toBe(true)
  })

  test('rejects an unknown key and inherited object properties', () => {
    expect(isPermissionKey('rentals.vew')).toBe(false)
    expect(isPermissionKey('toString')).toBe(false)
    expect(isPermissionKey('')).toBe(false)
  })
})

describe('sectionPermissions', () => {
  test('extracts every permission comment in document order', () => {
    const body = [
      '## Rentals',
      '<!-- permission: rentals.view -->',
      'Text.',
      '## Money',
      '<!-- permission: expenses.create -->',
      '## Ownership',
      '<!--permission:team.transferOwnership-->',
    ].join('\n')

    expect(sectionPermissions(body)).toEqual([
      'rentals.view',
      'expenses.create',
      'team.transferOwnership',
    ])
  })

  test('returns unknown keys unfiltered so validation can report them', () => {
    expect(sectionPermissions('## A\n<!-- permission: nope.nothing -->')).toEqual(['nope.nothing'])
  })

  test('returns an empty list when the body has no permission comments', () => {
    expect(sectionPermissions('## A\n<!-- a plain comment -->\nText')).toEqual([])
  })

  test('is repeatable across calls', () => {
    const body = '## A\n<!-- permission: rentals.view -->'
    expect(sectionPermissions(body)).toEqual(sectionPermissions(body))
  })
})

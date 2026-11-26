import { describe, expect, it } from 'vitest'

import type { ExpenseCategoryRecord } from '@/types/database'

import {
  buildMaintenanceExpenseForm,
  maintenanceExpenseCategoryId,
  maintenanceExpenseDescription,
  MAINTENANCE_EXPENSE_CATEGORY_KEYS,
} from './expense-prefill'

/**
 * What a cost recorded from a maintenance record starts out saying.
 *
 * The claims worth holding are that the context is carried across rather than
 * retyped, that the category is read off the agency's own list by its stable
 * handle, and that an agency which has pruned its categories is asked rather
 * than having one picked for it.
 */

function category(overrides: Partial<ExpenseCategoryRecord> = {}): ExpenseCategoryRecord {
  return {
    id: 'cat-maintenance',
    organization_id: 'org-1',
    name: 'Maintenance',
    description: null,
    system_key: 'maintenance',
    is_system: true,
    default_allocation: 'vehicle',
    sort_order: 20,
    archived_at: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

const CATEGORIES: ExpenseCategoryRecord[] = [
  category(),
  category({ id: 'cat-repair', name: 'Repairs', system_key: 'repair', sort_order: 30 }),
  category({ id: 'cat-tyres', name: 'Tyres', system_key: 'tyres', sort_order: 40 }),
  category({
    id: 'cat-cleaning',
    name: 'Cleaning',
    system_key: 'cleaning',
    default_allocation: null,
    sort_order: 50,
  }),
]

describe('maintenanceExpenseCategoryId', () => {
  it('files a tire service under the agency’s Tyres category', () => {
    expect(maintenanceExpenseCategoryId('tire_service', CATEGORIES)).toBe('cat-tyres')
  })

  it('files a mechanical repair under Repairs, not Maintenance', () => {
    expect(maintenanceExpenseCategoryId('mechanical_repair', CATEGORIES)).toBe('cat-repair')
  })

  it('matches on the stable handle, so a renamed category still works', () => {
    const renamed = [category({ id: 'cat-renamed', name: 'Servicing & upkeep' })]
    expect(maintenanceExpenseCategoryId('preventive', renamed)).toBe('cat-renamed')
  })

  it('falls back to Maintenance when the mapped category was archived', () => {
    const withoutTyres = CATEGORIES.filter((row) => row.system_key !== 'tyres')
    expect(maintenanceExpenseCategoryId('tire_service', withoutTyres)).toBe('cat-maintenance')
  })

  it('ignores an archived category rather than filing a cost into it', () => {
    const archived = [category({ archived_at: '2026-05-01T00:00:00Z' })]
    expect(maintenanceExpenseCategoryId('preventive', archived)).toBe('')
  })

  it('chooses nothing when the agency has neither, so the form has to ask', () => {
    expect(maintenanceExpenseCategoryId('other', [])).toBe('')
  })

  it('maps every maintenance category to a seeded expense category', () => {
    const seeded = new Set(['fuel', 'maintenance', 'repair', 'tyres', 'cleaning'])
    for (const key of Object.values(MAINTENANCE_EXPENSE_CATEGORY_KEYS)) {
      expect(seeded).toContain(key)
    }
  })
})

describe('maintenanceExpenseDescription', () => {
  it('carries the maintenance reference into the ledger text', () => {
    expect(maintenanceExpenseDescription('MNT-2026-00014', 'Front brake pads')).toBe(
      'MNT-2026-00014 — Front brake pads',
    )
  })

  it('stays inside the 500 characters the column accepts', () => {
    const description = maintenanceExpenseDescription('MNT-1', 'x'.repeat(900))
    expect(description.length).toBe(500)
  })
})

describe('buildMaintenanceExpenseForm', () => {
  const prefill = {
    reference: 'MNT-2026-00014',
    title: 'Front brake pads',
    category: 'brake_service' as const,
    vehicleId: 'vehicle-1',
    currency: 'MAD',
    categories: CATEGORIES,
    todayIso: '2026-07-14',
  }

  it('fills in the vehicle, the reference, the description and the category', () => {
    const values = buildMaintenanceExpenseForm(prefill)

    expect(values.allocation).toBe('vehicle')
    expect(values.vehicleId).toBe('vehicle-1')
    expect(values.rentalId).toBe('')
    expect(values.description).toBe('MNT-2026-00014 — Front brake pads')
    expect(values.categoryId).toBe('cat-repair')
  })

  it('uses the maintenance record’s currency and the agency’s today', () => {
    const values = buildMaintenanceExpenseForm(prefill)

    expect(values.currency).toBe('MAD')
    expect(values.incurredOn).toBe('2026-07-14')
  })

  it('leaves the supplier’s document number alone', () => {
    // `reference` is the invoice number and half of the duplicate check. The
    // maintenance reference lives in the description instead, so an operator
    // typing the garage's number does not have to delete ours first.
    expect(buildMaintenanceExpenseForm(prefill).reference).toBe('')
  })

  it('fills in no amount, so nothing can be recorded by accident', () => {
    const values = buildMaintenanceExpenseForm(prefill)

    expect(values.amount).toBe('')
    expect(values.vendorId).toBe('')
  })
})

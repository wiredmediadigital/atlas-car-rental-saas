import { emptyExpenseForm, type ExpenseFormInput } from '@/features/expenses/schemas'
import type { ExpenseCategoryRecord } from '@/types/database'

import type { MaintenanceCategory } from './api'

/**
 * What a cost recorded from a maintenance record starts out saying.
 *
 * All of this is a starting point, not a decision: every field stays editable
 * in the form, and the database applies the same constraints it would to a
 * cost typed in from scratch. Nothing here is a second ledger — the expense
 * created from these values is an ordinary row in `public.expenses`, linked
 * afterwards by the same `maintenance_link_expense` an operator uses by hand.
 */

/**
 * Which seeded expense category a kind of maintenance belongs under.
 *
 * Keyed on `system_key` rather than the name, because an agency can rename
 * 'Repairs' and the seeded handle is the only thing that survives it.
 *
 * The new-expense page deliberately preselects no category, on the grounds
 * that a default nobody read makes every cost drift to whichever category
 * sorts first. That objection is about an *arbitrary* default. This one is
 * read off the maintenance record's own category, so it carries a fact the
 * operator already stated rather than a guess, and it still shows in the
 * category field for them to change.
 */
export const MAINTENANCE_EXPENSE_CATEGORY_KEYS: Readonly<Record<MaintenanceCategory, string>> = {
  preventive: 'maintenance',
  oil_filter: 'maintenance',
  tire_service: 'tyres',
  brake_service: 'repair',
  battery_electrical: 'repair',
  mechanical_repair: 'repair',
  bodywork_collision: 'repair',
  vehicle_inspection: 'maintenance',
  recall: 'repair',
  cleaning_detailing: 'cleaning',
  other: 'maintenance',
}

/** The fallback when an agency has deleted or renamed away the mapped one. */
const FALLBACK_CATEGORY_KEY = 'maintenance'

/**
 * The category id to start on, or `''` when the agency has none of them.
 *
 * An empty string is what `emptyExpenseForm` uses and what the schema rejects
 * with "Choose a category." — so an agency that has pruned its categories gets
 * asked rather than silently filed under whatever was left.
 */
export function maintenanceExpenseCategoryId(
  category: MaintenanceCategory,
  categories: readonly ExpenseCategoryRecord[],
): string {
  const wanted = MAINTENANCE_EXPENSE_CATEGORY_KEYS[category]
  const match =
    categories.find((row) => row.system_key === wanted && row.archived_at === null) ??
    categories.find((row) => row.system_key === FALLBACK_CATEGORY_KEY && row.archived_at === null)
  return match?.id ?? ''
}

/** 500 is the `description` ceiling in both the schema and the CHECK constraint. */
const DESCRIPTION_LIMIT = 500

/**
 * The description a maintenance cost arrives with.
 *
 * The maintenance reference goes here, not in `reference`: that field is the
 * supplier's document number, it is half of the duplicate check, and an
 * operator typing the invoice number into it would otherwise have to delete
 * ours first. The reference reads in the ledger either way, and the hard
 * association is the `maintenance_id` column, not a string anyone can edit.
 */
export function maintenanceExpenseDescription(reference: string, title: string): string {
  return `${reference} — ${title}`.slice(0, DESCRIPTION_LIMIT)
}

export interface MaintenanceExpensePrefill {
  reference: string
  title: string
  category: MaintenanceCategory
  vehicleId: string
  currency: string
  categories: readonly ExpenseCategoryRecord[]
  todayIso: string
}

/**
 * @param todayIso Today in the agency's time zone, for the same reason
 *   `buildExpenseSchema` demands it: UTC's today is the wrong day for half
 *   the world for part of every day.
 */
export function buildMaintenanceExpenseForm(prefill: MaintenanceExpensePrefill): ExpenseFormInput {
  return {
    ...emptyExpenseForm(prefill.currency, prefill.todayIso),
    description: maintenanceExpenseDescription(prefill.reference, prefill.title),
    allocation: 'vehicle',
    vehicleId: prefill.vehicleId,
    rentalId: '',
    categoryId: maintenanceExpenseCategoryId(prefill.category, prefill.categories),
  }
}

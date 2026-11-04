import { csvMoney, csvNumber, csvPercent, csvText } from '@/features/reports/csv'
import {
  buildExportFile,
  csvBoolean,
  csvInstant,
  type ExportContext,
  type ExportFile,
} from '@/lib/export/csv-export'
import type { ExpenseLedgerEntry } from '@/types/database'

/**
 * Taking the expense ledger out of the product.
 *
 * THIS IS THE ONE AN ACCOUNTANT ASKS FOR. Of the four exports, this is the one
 * most likely to be opened by somebody who has never seen the product — so the
 * tax columns are separated rather than merged, and each one is named the way a
 * bookkeeper names it: gross, tax, net, rate, and whatever the agency calls the
 * tax locally.
 *
 * VOIDED ROWS ARE INCLUDED, AND SAID SO. They are in the ledger, they are in
 * the running totals the screen shows, and an export that quietly dropped them
 * would not reconcile against the product it came from. `Voided` and
 * `Void reason` are columns rather than a filter, so whoever opens the file can
 * exclude them deliberately instead of never knowing they existed.
 *
 * ARCHIVED CATEGORIES, VENDORS AND VEHICLES ARE FLAGGED for the same reason: an
 * expense against a vendor an agency stopped using last year is still a real
 * expense, and the row says which ones those are rather than presenting them as
 * current.
 *
 * WHAT IS EXCLUDED. The UUIDs, and `created_by` / `updated_by`, which are user
 * identifiers rather than names — a column of opaque keys that identify staff
 * is neither useful to an accountant nor something to put in a file that will
 * be emailed around. The timestamps stay, because when a record was entered is
 * part of the record.
 */

const HEADERS = [
  'Date',
  'Description',
  'Category',
  'Vendor',
  'Vendor archived',
  'Category archived',
  'Amount',
  'Tax',
  'Net',
  'Tax rate %',
  'Tax label',
  'Currency',
  'Status',
  'Source',
  'Allocation',
  'Payment method',
  'Reference',
  'Vehicle',
  'Vehicle plate',
  'Vehicle archived',
  'Odometer',
  'Rental',
  'Attachments',
  'Voided',
  'Void reason',
  'Notes',
  'Created',
  'Updated',
] as const

/** `Peugeot 208`, or nothing when the expense is not against a vehicle. */
function vehicleLabel(row: ExpenseLedgerEntry): string {
  if (!row.vehicle_make && !row.vehicle_model) return ''
  return [row.vehicle_make, row.vehicle_model].filter(Boolean).join(' ')
}

export function buildExpensesCsv(
  context: ExportContext,
  rows: readonly ExpenseLedgerEntry[],
): string {
  return exportExpenses(context, rows).contents
}

export function exportExpenses(
  context: ExportContext,
  rows: readonly ExpenseLedgerEntry[],
): ExportFile {
  const body = rows.map((row) => [
    csvText(row.incurred_on),
    csvText(row.description),
    csvText(row.category_name),
    csvText(row.vendor_name),
    csvBoolean(row.vendor_archived),
    csvBoolean(row.category_archived),
    csvMoney(row.amount_minor, row.currency),
    csvMoney(row.tax_amount_minor, row.currency),
    csvMoney(row.net_amount_minor, row.currency),
    row.tax_rate_bps === null ? '' : csvPercent(row.tax_rate_bps),
    csvText(row.tax_label),
    csvText(row.currency),
    csvText(row.status),
    csvText(row.source),
    csvText(row.allocation),
    csvText(row.payment_method),
    csvText(row.reference),
    csvText(vehicleLabel(row)),
    csvText(row.vehicle_plate),
    csvBoolean(row.vehicle_archived),
    row.odometer === null ? '' : csvNumber(row.odometer),
    csvText(row.rental_reference),
    csvNumber(row.attachment_count),
    csvInstant(row.voided_at),
    csvText(row.void_reason),
    csvText(row.notes),
    csvInstant(row.created_at),
    csvInstant(row.updated_at),
  ])

  return buildExportFile(context, 'expenses', 'Expenses', HEADERS, body)
}

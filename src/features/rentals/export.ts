import { csvMoney, csvNumber, csvText } from '@/features/reports/csv'
import {
  buildExportFile,
  csvBoolean,
  csvInstant,
  exportFilename,
  type ExportContext,
  type ExportFile,
} from '@/lib/export/csv-export'
import type { RentalBoardEntry } from '@/types/database'

/**
 * Taking the rental book out of the product.
 *
 * WHY THIS EXISTS, AND WHY IT SHIPPED WITH THE BILLING RESTRICTION.
 *
 * An agency whose subscription lapses keeps read access to everything it ever
 * recorded — that is the whole design of the wind-down, and the reason the 44
 * SELECT policies were left alone. But "you can still read it" is a hollow
 * promise if the only way to read four years of rentals is twenty-five rows at
 * a time in a browser. A read-only state without an export is a slower kind of
 * hostage-taking, so the export landed with it rather than after it.
 *
 * It is NOT a billing feature and is not gated on anything. An agency in good
 * standing exports its rental book for its accountant, for a tax authority, for
 * a bank, or because it wants to. The restriction was only the reason it was
 * written when it was.
 *
 * WHAT IT CONTAINS, AND WHY THAT DIFFERS FROM A REPORT.
 *
 * The reports module deliberately emits no customer name, no identity document
 * and no device identifier: a report is a summary that circulates. This is the
 * opposite — the agency's own operational record, exported by the agency, and a
 * rental book with the customer column removed is not a rental book. So names
 * are included. What is still excluded is anything the board view does not
 * carry anyway: no address, no telephone number, no identity document, no
 * licence number, no stored card, no GPS position.
 *
 * The file-level rules it used to define for itself — the byte order mark, the
 * provenance block, the truncation note, the filename that names nobody — now
 * live in `@/lib/export/csv-export` and are shared with the other three
 * exports. What stays here is the column set, which is the only part that is
 * about rentals.
 */

export type RentalsExportContext = ExportContext
export type RentalsExport = ExportFile

const HEADERS = [
  'Reference',
  'Status',
  'Overdue',
  'Starts',
  'Ends',
  'Picked up',
  'Returned',
  'Extensions',
  'Pick-up location',
  'Return location',
  'Customer',
  'Customer type',
  'Primary driver',
  'Drivers',
  'Vehicle',
  'Plate',
  'Currency',
  'Total',
  'Paid',
  'Balance due',
  'Deposit taken',
  'Deposit held',
  'Payment status',
  'Contract status',
  'Contract version',
  'Contract signed',
  'Created',
] as const

function vehicleLabel(row: RentalBoardEntry): string {
  const year = row.vehicle_model_year ? ` ${row.vehicle_model_year}` : ''
  return `${row.vehicle_make} ${row.vehicle_model}${year}`
}

export function exportRentals(
  context: RentalsExportContext,
  rows: readonly RentalBoardEntry[],
): RentalsExport {
  const body = rows.map((row) => [
    csvText(row.reference),
    csvText(row.status),
    csvBoolean(row.is_overdue),
    csvInstant(row.starts_at),
    csvInstant(row.ends_at),
    csvInstant(row.picked_up_at),
    csvInstant(row.returned_at),
    csvNumber(row.extension_count),
    csvText(row.pickup_location),
    csvText(row.return_location),
    csvText(row.customer_name),
    csvText(row.customer_type),
    csvText(row.primary_driver_name),
    csvNumber(row.driver_count),
    csvText(vehicleLabel(row)),
    csvText(row.vehicle_plate),
    csvText(row.currency),
    csvMoney(row.total_minor, row.currency),
    csvMoney(row.amount_paid_minor, row.currency),
    csvMoney(row.balance_due_minor, row.currency),
    csvMoney(row.deposit_minor, row.currency),
    csvMoney(row.deposit_held_minor, row.currency),
    csvText(row.payment_status),
    csvText(row.contract_status),
    row.contract_version === null ? '' : csvNumber(row.contract_version),
    csvInstant(row.contract_signed_at),
    csvInstant(row.created_at),
  ])

  return buildExportFile(context, 'rentals', 'Rentals and contracts', HEADERS, body)
}

export function buildRentalsCsv(
  context: RentalsExportContext,
  rows: readonly RentalBoardEntry[],
): string {
  return exportRentals(context, rows).contents
}

export function rentalsExportFilename(generatedAt: string): string {
  return exportFilename('rentals', generatedAt)
}

import { csvDate, csvMoney, csvNumber, csvText, guardCsvCell } from '@/features/reports/csv'
import { buildCsv } from '@/lib/import/csv'
import type { RentalBoardEntry } from '@/types/database'

/**
 * Taking the rental book out of the product.
 *
 * WHY THIS EXISTS, AND WHY IT SHIPS WITH THE BILLING RESTRICTION.
 *
 * An agency whose subscription lapses keeps read access to everything it ever
 * recorded — that is the whole design of the wind-down, and it is the reason the
 * 44 SELECT policies were left alone. But "you can still read it" is a hollow
 * promise if the only way to read four years of rentals is twenty-five rows at
 * a time in a browser. A read-only state without an export is a slower kind of
 * hostage-taking, so the export lands with it rather than after it.
 *
 * It is NOT a billing feature, and it is not gated on anything. An agency in
 * perfectly good standing exports its rental book for its accountant, for a
 * tax authority, for a bank, or because it wants to. The restriction is only
 * the reason it was written now.
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
 * THE FILENAME NAMES NOBODY. A download folder is shared, indexed and backed
 * up, so the file is called after the agency's export and the date, never after
 * a customer or a plate — the same rule reportFilename follows.
 *
 * EVERY CELL GOES THROUGH THE REPORT CELL HELPERS. They are what stop a
 * customer recorded as `=HYPERLINK(...)` becoming a live formula in whoever
 * opens the file next. Reusing them rather than restating them means a fix to
 * the formula guard reaches this export too.
 */

export interface RentalsExport {
  readonly filename: string
  readonly contents: string
}

export interface RentalsExportContext {
  readonly agencyName: string
  /** What the person was looking at, in words. Travels into the file. */
  readonly filterLabel: string
  readonly generatedAt: string
  /** True when the export stopped at the row ceiling rather than the last row. */
  readonly truncated?: boolean
}

const BOM = '﻿'

/** Mirrors the escaping `buildCsv` applies, for the provenance block. */
function escapeForCsv(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

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

/** An ISO instant as a date-and-time a spreadsheet will not reinterpret. */
function csvInstant(value: string | null | undefined): string {
  if (!value) return ''
  // Seconds, no timezone suffix mangling: `2026-11-03 14:05`.
  return guardCsvCell(value.slice(0, 16).replace('T', ' '))
}

function vehicleLabel(row: RentalBoardEntry): string {
  const year = row.vehicle_model_year ? ` ${row.vehicle_model_year}` : ''
  return `${row.vehicle_make} ${row.vehicle_model}${year}`
}

export function buildRentalsCsv(
  context: RentalsExportContext,
  rows: readonly RentalBoardEntry[],
): string {
  const provenance: string[][] = [
    ['Agency', csvText(context.agencyName)],
    ['Export', csvText('Rentals and contracts')],
    ['Showing', csvText(context.filterLabel)],
    ['Rows', csvNumber(rows.length)],
    ['Generated', csvText(context.generatedAt)],
  ]

  /*
   * A truncated export that does not say so is worse than no export: somebody
   * reconciles against it and finds the totals short. The note is a row in the
   * file itself, not a toast that is gone by the time the file is opened.
   */
  if (context.truncated) {
    provenance.push([
      'Note',
      csvText('This export reached its row limit. Narrow the filters and export again.'),
    ])
  }
  provenance.push([])

  const body = rows.map((row) => [
    csvText(row.reference),
    csvText(row.status),
    row.is_overdue ? 'Yes' : 'No',
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

  const width = HEADERS.length
  const head = provenance
    .map((line) => {
      const padded = [...line]
      while (padded.length < width) padded.push('')
      return padded.map(escapeForCsv).join(',')
    })
    .join('\n')

  // The byte order mark is what stops Excel guessing the code page.
  return `${BOM}${head}\n${buildCsv(HEADERS.map(guardCsvCell), body)}`
}

export function rentalsExportFilename(generatedAt: string): string {
  return `rentals-${csvDate(generatedAt)}.csv`
}

export function exportRentals(
  context: RentalsExportContext,
  rows: readonly RentalBoardEntry[],
): RentalsExport {
  return {
    filename: rentalsExportFilename(context.generatedAt),
    contents: buildRentalsCsv(context, rows),
  }
}

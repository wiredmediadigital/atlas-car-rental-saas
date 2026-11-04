import { csvMoney, csvNumber, csvText } from '@/features/reports/csv'
import {
  buildExportFile,
  csvBoolean,
  csvInstant,
  type ExportContext,
  type ExportFile,
} from '@/lib/export/csv-export'
import type { CustomerDirectoryEntry } from '@/types/database'

/**
 * Taking the customer directory out of the product.
 *
 * WHAT THIS CONTAINS THAT A REPORT NEVER WOULD.
 *
 * The reports module deliberately emits no customer name, no contact detail and
 * no identity document, because a report is a summary that circulates — to an
 * accountant, a bank, a tax authority. This is the opposite: the agency's own
 * customer record, exported by the agency, for the agency. A customer directory
 * with the contact columns removed is not a customer directory, and the whole
 * purpose of this file is that an agency whose subscription lapses can still
 * take its own records with it.
 *
 * So names, addresses, telephone numbers and dates of birth are included. They
 * are what the agency typed in, about its own customers, and a product that
 * holds them hostage behind a payment is a product nobody should trust with
 * them in the first place.
 *
 * WHAT IS STILL EXCLUDED, AND WHY.
 *
 *   * EVERY INTERNAL IDENTIFIER. `customer_id`, `driver_license_id`,
 *     `active_rental_id` — UUIDs mean nothing outside this database and reveal
 *     its shape. Rentals are named by their reference, which is the thing
 *     people actually say out loud.
 *   * THE LICENCE NUMBER. `driver_license_id` is the document row's key, not
 *     the number on the licence; the number lives on the document record and
 *     does not reach this view. That is the right side of the line to be on,
 *     and this export does not go looking for it.
 *
 * MIXED CURRENCIES ARE NAMED, NOT SILENTLY DROPPED. The directory reports an
 * outstanding balance only when exactly one currency is involved. Writing an
 * empty cell for a customer who owes money in two would be a lie of omission in
 * the one column somebody chases people over, so the currency column says
 * `Multiple` and the amount stays empty.
 */

const HEADERS = [
  'Name',
  'Type',
  'First name',
  'Last name',
  'Company',
  'Email',
  'Phone',
  'Secondary phone',
  'Date of birth',
  'Nationality',
  'Address line 1',
  'Address line 2',
  'City',
  'Region',
  'Postal code',
  'Country',
  'Preferred language',
  'Licence held',
  'Licence country',
  'Licence issued',
  'Licence expires',
  'Licence classes',
  'Identity documents',
  'Identity expires',
  'Documents',
  'Rentals',
  'First rental',
  'Last rental ended',
  'Current rental',
  'Current rental ends',
  'Next rental',
  'Next rental starts',
  'Outstanding',
  'Outstanding currency',
  'Notes',
  'Created',
  'Archived',
] as const

/** The balance, and an honest answer when there is more than one currency. */
function outstanding(row: CustomerDirectoryEntry): readonly [string, string] {
  if (row.outstanding_currency_count > 1) return ['', 'Multiple']
  if (row.outstanding_minor === null || row.outstanding_currency === null) return ['', '']
  return [
    csvMoney(row.outstanding_minor, row.outstanding_currency),
    csvText(row.outstanding_currency),
  ]
}

export function buildCustomersCsv(
  context: ExportContext,
  rows: readonly CustomerDirectoryEntry[],
): string {
  return exportCustomers(context, rows).contents
}

export function exportCustomers(
  context: ExportContext,
  rows: readonly CustomerDirectoryEntry[],
): ExportFile {
  const body = rows.map((row) => {
    const [owed, owedCurrency] = outstanding(row)

    return [
      csvText(row.display_name),
      csvText(row.customer_type),
      csvText(row.first_name),
      csvText(row.last_name),
      csvText(row.company_name),
      csvText(row.email),
      csvText(row.phone),
      csvText(row.secondary_phone),
      csvText(row.date_of_birth),
      csvText(row.nationality_country_code),
      csvText(row.address_line1),
      csvText(row.address_line2),
      csvText(row.city),
      csvText(row.region),
      csvText(row.postal_code),
      csvText(row.country_code),
      csvText(row.preferred_locale),
      csvBoolean(row.has_driver_license),
      csvText(row.driver_license_country),
      csvText(row.driver_license_issued_on),
      csvText(row.driver_license_expires_on),
      csvText((row.driver_license_classes ?? []).join(' ')),
      csvNumber(row.identity_document_count),
      csvText(row.identity_expires_on),
      csvNumber(row.document_count),
      csvNumber(row.rental_count),
      csvInstant(row.first_rental_at),
      csvInstant(row.last_rental_ends_at),
      csvText(row.active_rental_reference),
      csvInstant(row.active_rental_ends_at),
      csvText(row.upcoming_rental_reference),
      csvInstant(row.upcoming_rental_starts_at),
      owed,
      owedCurrency,
      csvText(row.notes),
      csvInstant(row.created_at),
      csvInstant(row.archived_at),
    ]
  })

  return buildExportFile(context, 'customers', 'Customers', HEADERS, body)
}

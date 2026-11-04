import { describe, expect, it } from 'vitest'

import type { ExportContext } from '@/lib/export/csv-export'
import type { CustomerDirectoryEntry } from '@/types/database'

import { exportCustomers } from './export'

function entry(over: Partial<CustomerDirectoryEntry> = {}): CustomerDirectoryEntry {
  return {
    customer_id: 'c1',
    organization_id: 'org1',
    customer_type: 'individual',
    display_name: 'Yasmine Cherkaoui',
    first_name: 'Yasmine',
    last_name: 'Cherkaoui',
    company_name: null,
    email: 'yasmine@example.test',
    phone: '+212600000000',
    secondary_phone: null,
    date_of_birth: '1990-04-02',
    nationality_country_code: 'MA',
    country_code: 'MA',
    city: 'Casablanca',
    region: null,
    postal_code: '20000',
    address_line1: '12 Rue des Écoles',
    address_line2: null,
    preferred_locale: 'fr',
    notes: null,
    created_at: '2026-01-04T10:00:00.000Z',
    updated_at: '2026-01-04T10:00:00.000Z',
    archived_at: null,
    identity_document_count: 1,
    document_count: 2,
    identity_expires_on: '2030-01-01',
    driver_license_id: 'licence-1',
    driver_license_country: 'MA',
    driver_license_issued_on: '2012-06-01',
    driver_license_expires_on: '2032-06-01',
    driver_license_classes: ['B', 'C'],
    has_driver_license: true,
    rental_count: 3,
    first_rental_at: '2026-02-01T09:00:00.000Z',
    last_rental_ends_at: '2026-09-01T09:00:00.000Z',
    active_rental_id: 'r1',
    active_rental_reference: 'RNT-0007',
    active_rental_ends_at: '2026-11-10T09:00:00.000Z',
    upcoming_rental_id: null,
    upcoming_rental_reference: null,
    upcoming_rental_starts_at: null,
    outstanding_currency_count: 1,
    outstanding_minor: 45000,
    outstanding_currency: 'MAD',
    ...over,
  }
}

const context: ExportContext = {
  agencyName: 'Atlas Cars',
  filterLabel: 'All customers',
  generatedAt: '2026-11-04T12:00:00.000Z',
}

describe('the customers export', () => {
  it('carries the contact detail that makes it a customer directory', () => {
    // A report would emit none of this. This is the agency's own record, and a
    // directory without contact columns is not one.
    const csv = exportCustomers(context, [entry()]).contents

    expect(csv).toContain('Yasmine Cherkaoui')
    expect(csv).toContain('yasmine@example.test')
    expect(csv).toContain('+212600000000')
    expect(csv).toContain('12 Rue des Écoles')
    expect(csv).toContain('Casablanca')
  })

  it('leaves every internal identifier behind', () => {
    // UUIDs mean nothing outside this database and reveal its shape. A rental
    // is named by the reference people actually say out loud.
    const csv = exportCustomers(context, [entry()]).contents

    expect(csv).not.toContain('c1')
    expect(csv).not.toContain('org1')
    expect(csv).not.toContain('licence-1')
    expect(csv).toContain('RNT-0007')
  })

  it('names a mixed-currency balance instead of writing an empty cell', () => {
    /*
     * The directory reports a balance only when one currency is involved.
     * Silently emitting nothing in the column people chase debts with would be
     * a lie of omission, so the currency column says so.
     */
    const csv = exportCustomers(context, [
      entry({ outstanding_currency_count: 2, outstanding_minor: null, outstanding_currency: null }),
    ]).contents

    expect(csv).toContain('Multiple')
  })

  it('writes a single-currency balance as a plain decimal', () => {
    const csv = exportCustomers(context, [entry()]).contents
    expect(csv).toContain('450.00')
    expect(csv).toContain('MAD')
  })

  it('flattens licence classes into one readable cell', () => {
    expect(exportCustomers(context, [entry()]).contents).toContain('B C')
  })

  it('keeps an empty cell empty rather than writing null', () => {
    const csv = exportCustomers(context, [
      entry({ company_name: null, region: null, notes: null, driver_license_classes: null }),
    ]).contents
    expect(csv).not.toContain('null')
  })

  it('defuses a company name a spreadsheet would run as a formula', () => {
    const csv = exportCustomers(context, [
      entry({ company_name: '=HYPERLINK("http://evil.example","Click")' }),
    ]).contents

    expect(csv).toContain("'=HYPERLINK")
    expect(csv).not.toMatch(/(^|,)"?=HYPERLINK/m)
  })

  it('names nobody in the filename', () => {
    const file = exportCustomers(context, [entry()])
    expect(file.filename).toBe('customers-2026-11-04.csv')
    expect(file.filename).not.toMatch(/cherkaoui/i)
  })

  it('writes one line per customer under the header', () => {
    const csv = exportCustomers(context, [
      entry(),
      entry({ customer_id: 'c2', display_name: 'Omar Idrissi' }),
    ]).contents

    const headerIndex = csv.split('\n').findIndex((line) => line.startsWith('Name,'))
    const body = csv
      .split('\n')
      .slice(headerIndex + 1)
      .filter((line) => line.trim().length > 0)

    expect(body).toHaveLength(2)
    expect(body[1]).toContain('Omar Idrissi')
  })
})

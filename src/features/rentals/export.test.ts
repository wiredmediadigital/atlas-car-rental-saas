import { describe, expect, it } from 'vitest'

import type { RentalBoardEntry } from '@/types/database'

import { buildRentalsCsv, exportRentals, rentalsExportFilename } from './export'

function entry(over: Partial<RentalBoardEntry> = {}): RentalBoardEntry {
  return {
    id: 'r1',
    organization_id: 'org1',
    reference: 'RNT-0001',
    status: 'active',
    starts_at: '2026-10-01T09:00:00.000Z',
    ends_at: '2026-10-08T09:00:00.000Z',
    pickup_location: 'Airport',
    return_location: 'Downtown',
    currency: 'EUR',
    total_minor: 123456,
    amount_paid_minor: 100000,
    balance_due_minor: 23456,
    deposit_minor: 50000,
    deposit_held_minor: 50000,
    payment_status: 'partial',
    picked_up_at: '2026-10-01T09:12:00.000Z',
    returned_at: null,
    extension_count: 1,
    created_at: '2026-09-28T16:40:00.000Z',
    vehicle_id: 'v1',
    vehicle_make: 'Peugeot',
    vehicle_model: 'Citroën C3',
    vehicle_model_year: 2024,
    vehicle_plate: 'AB-123-CD',
    customer_id: 'c1',
    customer_name: 'Yasmine Cherkaoui',
    customer_type: 'individual',
    primary_driver_id: 'd1',
    primary_driver_name: 'Yasmine Cherkaoui',
    renter_is_not_driver: false,
    driver_count: 1,
    is_overdue: false,
    contract_version: 2,
    contract_status: 'signed',
    contract_pdf_path: 'contracts/r1.pdf',
    contract_signed_at: '2026-10-01T09:20:00.000Z',
    ...over,
  } as RentalBoardEntry
}

const context = {
  agencyName: 'Atlas Cars',
  filterLabel: 'Live rentals (draft, reserved, active)',
  generatedAt: '2026-11-03T12:00:00.000Z',
}

describe('the rentals export', () => {
  it('writes the provenance a file needs to still make sense next year', () => {
    const csv = buildRentalsCsv(context, [entry()])

    expect(csv).toContain('Agency,Atlas Cars')
    expect(csv).toContain('Rentals and contracts')
    expect(csv).toContain('Live rentals (draft, reserved, active)')
    expect(csv).toContain('Rows,1')
  })

  it('opens with a byte order mark so Excel does not guess the code page', () => {
    // Without it, "Citroën" arrives as mojibake on a Windows machine.
    const csv = buildRentalsCsv(context, [entry()])
    expect(csv.startsWith('﻿')).toBe(true)
    expect(csv).toContain('Citroën')
  })

  it('carries the contract alongside the rental', () => {
    const csv = buildRentalsCsv(context, [entry()])
    const header = csv.split('\n').find((line) => line.startsWith('Reference,'))

    expect(header).toContain('Contract status')
    expect(header).toContain('Contract signed')
    expect(csv).toContain('signed')
  })

  it('writes money as a plain decimal with the currency beside it', () => {
    // Never through a locale formatter: 1.234,56 and 1,234.56 are the same
    // amount and different files.
    const csv = buildRentalsCsv(context, [entry()])
    expect(csv).toContain('1234.56')
    expect(csv).toContain('EUR')
  })

  it('defuses a customer name that a spreadsheet would run as a formula', () => {
    const csv = buildRentalsCsv(context, [
      entry({ customer_name: '=HYPERLINK("http://evil.example","Click")' }),
    ])

    // The value survives; the leading apostrophe makes it text.
    expect(csv).toContain("'=HYPERLINK")
    expect(csv).not.toMatch(/(^|,)"?=HYPERLINK/m)
  })

  it('keeps an empty cell empty rather than writing null', () => {
    const csv = buildRentalsCsv(context, [
      entry({ returned_at: null, contract_status: null, contract_version: null }),
    ])
    expect(csv).not.toContain('null')
  })

  it('says so in the file when it stopped at the row limit', () => {
    // A truncated export that does not say so is worse than no export.
    const csv = buildRentalsCsv({ ...context, truncated: true }, [entry()])
    expect(csv).toContain('row limit')
  })

  it('says nothing about a limit it did not reach', () => {
    expect(buildRentalsCsv(context, [entry()])).not.toContain('row limit')
  })

  it('names nobody in the filename', () => {
    // A download folder is shared, indexed and backed up.
    const name = rentalsExportFilename(context.generatedAt)
    expect(name).toBe('rentals-2026-11-03.csv')
    expect(name).not.toMatch(/cherkaoui|AB-123-CD/i)
  })

  it('produces a file and a name together', () => {
    const file = exportRentals(context, [entry()])
    expect(file.filename).toBe('rentals-2026-11-03.csv')
    expect(file.contents).toContain('RNT-0001')
  })

  it('writes one line per rental under the header', () => {
    const rows = [entry(), entry({ id: 'r2', reference: 'RNT-0002' })]
    const csv = buildRentalsCsv(context, rows)

    const headerIndex = csv.split('\n').findIndex((line) => line.startsWith('Reference,'))
    const body = csv
      .split('\n')
      .slice(headerIndex + 1)
      .filter((line) => line.trim().length > 0)

    expect(body).toHaveLength(2)
    expect(body[0]).toContain('RNT-0001')
    expect(body[1]).toContain('RNT-0002')
  })
})

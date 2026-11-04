import { describe, expect, it } from 'vitest'

import type { ExportContext } from '@/lib/export/csv-export'
import type { ExpenseLedgerEntry } from '@/types/database'

import { exportExpenses } from './export'

function entry(over: Partial<ExpenseLedgerEntry> = {}): ExpenseLedgerEntry {
  return {
    id: 'e1',
    organization_id: 'org1',
    incurred_on: '2026-10-12',
    description: 'Tyres, front axle',
    amount_minor: 120_000,
    tax_amount_minor: 20_000,
    net_amount_minor: 100_000,
    tax_rate_bps: 2000,
    tax_label: 'TVA',
    currency: 'MAD',
    status: 'recorded',
    source: 'manual',
    allocation: 'vehicle',
    payment_method: 'card',
    reference: 'INV-5512',
    notes: null,
    odometer: 41_500,
    category_id: 'cat1',
    category_name: 'Maintenance',
    category_system_key: 'maintenance',
    category_archived: false,
    vendor_id: 'ven1',
    vendor_name: 'Garage Atlas',
    vendor_archived: false,
    effective_vehicle_id: 'v1',
    vehicle_plate: 'AB-123-CD',
    vehicle_make: 'Peugeot',
    vehicle_model: '208',
    vehicle_archived: false,
    rental_id: null,
    rental_reference: null,
    attachment_count: 1,
    voided_at: null,
    void_reason: null,
    created_by: 'user-1',
    created_at: '2026-10-12T16:40:00.000Z',
    updated_by: 'user-1',
    updated_at: '2026-10-12T16:40:00.000Z',
    ...over,
  }
}

const context: ExportContext = {
  agencyName: 'Atlas Cars',
  filterLabel: 'Expenses 2026-10-01 to 2026-10-31, recorded only',
  generatedAt: '2026-11-04T12:00:00.000Z',
}

describe('the expenses export', () => {
  it('separates gross, tax and net the way a bookkeeper reads them', () => {
    // This is the export most likely to be opened by somebody who has never
    // seen the product, so the tax columns are separate rather than merged.
    const csv = exportExpenses(context, [entry()]).contents

    expect(csv).toContain('1200.00')
    expect(csv).toContain('200.00')
    expect(csv).toContain('1000.00')
    expect(csv).toContain('TVA')
    expect(csv).toContain('20')
  })

  it('carries the period it covers into the file', () => {
    // The filter somebody is most likely to assume an export ignored.
    expect(exportExpenses(context, [entry()]).contents).toContain('2026-10-01 to 2026-10-31')
  })

  it('includes a voided expense and says that it is voided', () => {
    /*
     * Voided rows are in the ledger and in the totals the screen shows. An
     * export that silently dropped them would not reconcile against the product
     * it came from, so they are a column rather than a filter.
     */
    const csv = exportExpenses(context, [
      entry({
        status: 'voided',
        voided_at: '2026-10-20T09:00:00.000Z',
        void_reason: 'Duplicate of INV-5512',
      }),
    ]).contents

    expect(csv).toContain('voided')
    expect(csv).toContain('2026-10-20 09:00')
    expect(csv).toContain('Duplicate of INV-5512')
  })

  it('flags an archived vendor rather than presenting it as current', () => {
    const csv = exportExpenses(context, [
      entry({ vendor_archived: true, category_archived: true }),
    ]).contents

    const header = csv.split('\n').find((line) => line.startsWith('Date,'))
    expect(header).toContain('Vendor archived')
    expect(csv).toContain('Yes')
  })

  it('leaves out the staff identifiers, which name nobody useful', () => {
    // A column of opaque user keys helps no accountant and belongs in no file
    // that gets emailed around.
    const csv = exportExpenses(context, [entry()]).contents
    expect(csv).not.toContain('user-1')
    expect(csv).not.toContain('e1,')
    expect(csv).not.toContain('ven1')
  })

  it('joins make and model into one vehicle cell, and stays empty without one', () => {
    expect(exportExpenses(context, [entry()]).contents).toContain('Peugeot 208')

    const unallocated = exportExpenses(context, [
      entry({
        allocation: 'overhead',
        effective_vehicle_id: null,
        vehicle_make: null,
        vehicle_model: null,
        vehicle_plate: null,
      }),
    ]).contents
    expect(unallocated).not.toContain('null')
  })

  it('defuses a description a spreadsheet would run as a formula', () => {
    const csv = exportExpenses(context, [entry({ description: "=cmd|'/c calc'!A0" })]).contents
    expect(csv).toContain("'=cmd")
    expect(csv).not.toMatch(/(^|,)"?=cmd/m)
  })

  it('names nobody in the filename', () => {
    expect(exportExpenses(context, [entry()]).filename).toBe('expenses-2026-11-04.csv')
  })
})

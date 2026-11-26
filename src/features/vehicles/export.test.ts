import { describe, expect, it } from 'vitest'

import type { ServiceOptions } from '@/lib/compliance/service'
import type { ExportContext } from '@/lib/export/csv-export'
import type { VehicleFleetEntry } from '@/types/database'

import {
  exportVehicles,
  resolveExportServiceDates,
  type ExportServicePlan,
  type VehicleExportRow,
} from './export'

function entry(over: Partial<VehicleFleetEntry> = {}): VehicleFleetEntry {
  return {
    vehicle_id: 'v1',
    organization_id: 'org1',
    make: 'Peugeot',
    model: 'Citroën C3',
    model_year: 2024,
    registration_plate: 'AB-123-CD',
    vin: 'VF7XXXXXXXXXXXXXX',
    color: 'White',
    category: 'Economy',
    fuel_type: 'diesel',
    transmission: 'manual',
    seats: 5,
    odometer: 42_000,
    daily_rate_minor: 35000,
    currency: 'MAD',
    insurance_expires_on: '2027-03-01',
    inspection_expires_on: '2027-01-15',
    registration_expires_on: '2028-05-20',
    next_service_on: '2026-12-01',
    notes: null,
    created_at: '2026-01-04T10:00:00.000Z',
    updated_at: '2026-01-04T10:00:00.000Z',
    archived_at: null,
    operational_status: 'available',
    current_rental_id: 'r1',
    current_rental_reference: 'RNT-0007',
    current_customer_id: 'c1',
    current_rental_ends_at: '2026-11-10T09:00:00.000Z',
    next_rental_id: null,
    next_rental_reference: null,
    next_customer_id: null,
    next_rental_starts_at: null,
    effective_status: 'rented',
    is_available_now: false,
    acquisition_method: 'purchase',
    acquired_on: '2024-02-01',
    acquisition_price_minor: 18_000_000,
    acquisition_currency: 'MAD',
    acquisition_supplier: 'Dealer SARL',
    acquisition_notes: null,
    ...over,
  } as VehicleFleetEntry
}

const context: ExportContext = {
  agencyName: 'Atlas Cars',
  filterLabel: 'Fleet excluding archived',
  generatedAt: '2026-11-04T12:00:00.000Z',
}

const OPTIONS: ServiceOptions = {
  timeZone: 'Africa/Casablanca',
  leadDays: 30,
  now: new Date('2026-11-26T12:00:00.000Z'),
}

function plan(over: Partial<ExportServicePlan> = {}): ExportServicePlan {
  return {
    id: 'm1',
    vehicle_id: 'v1',
    status: 'scheduled',
    created_at: '2026-11-20T10:00:00.000Z',
    next_service_on: null,
    next_service_odometer: null,
    service_interval_days: null,
    service_interval_odometer: null,
    ...over,
  }
}

/**
 * The rows exactly as the page hands them to the builder.
 *
 * The tests go through the resolver rather than hand-building a resolved row,
 * so they exercise the path the product actually runs. A fixture that set
 * `service_next_on` directly would still pass if the resolver were deleted.
 */
function resolved(
  rows: readonly VehicleFleetEntry[],
  plans: readonly ExportServicePlan[] = [],
): VehicleExportRow[] {
  return resolveExportServiceDates(rows, plans, OPTIONS)
}

/** The cell under a named header, for assertions that must not match elsewhere. */
function cell(csv: string, header: string): string {
  const lines = csv.split('\n')
  const headerIndex = lines.findIndex((line) => line.startsWith('Plate,'))
  const column = (lines[headerIndex] ?? '').split(',').indexOf(header)
  expect(column).toBeGreaterThan(-1)
  return ((lines[headerIndex + 1] ?? '').split(',')[column] ?? '').trim()
}

describe('the fleet export', () => {
  it('carries every compliance date, which is the reason it exists', () => {
    // Makes and plates can be reconstructed from the vehicles. Which of forty
    // has insurance expiring in March cannot.
    const csv = exportVehicles(context, resolved([entry()])).contents

    expect(csv).toContain('2027-03-01')
    expect(csv).toContain('2027-01-15')
    expect(csv).toContain('2028-05-20')
    expect(csv).toContain('2026-12-01')
  })

  it('carries the acquisition record an accountant depreciates from', () => {
    const csv = exportVehicles(context, resolved([entry()])).contents

    expect(csv).toContain('purchase')
    expect(csv).toContain('2024-02-01')
    expect(csv).toContain('180000.00')
    expect(csv).toContain('Dealer SARL')
  })

  it('names the current rental but not the customer holding the car', () => {
    /*
     * A fleet export is a list of vehicles. A renter's name is not a fact about
     * a car, and the rentals export already joins the two for anybody who needs
     * the pairing.
     */
    const csv = exportVehicles(context, resolved([entry()])).contents

    expect(csv).toContain('RNT-0007')
    expect(csv).not.toContain('c1')
    expect(csv).not.toContain('v1')
  })

  it('opens with a byte order mark so an accented model survives Excel', () => {
    const csv = exportVehicles(context, resolved([entry()])).contents
    expect(csv.startsWith('﻿')).toBe(true)
    expect(csv).toContain('Citroën')
  })

  it('writes money as a plain decimal with the currency beside it', () => {
    const csv = exportVehicles(context, resolved([entry()])).contents
    expect(csv).toContain('350.00')
    expect(csv).toContain('MAD')
  })

  it('leaves an unrecorded acquisition price empty rather than writing zero', () => {
    // Zero is a price. Unknown is not, and an export that confuses them puts a
    // free car in somebody's depreciation schedule. Checked on the column
    // rather than the line: the daily rate also ends in `0.00`.
    const csv = exportVehicles(
      context,
      resolved([entry({ acquisition_price_minor: null, acquisition_currency: null })]),
    ).contents

    const lines = csv.split('\n')
    const headerIndex = lines.findIndex((line) => line.startsWith('Plate,'))
    const column = (lines[headerIndex] ?? '').split(',').indexOf('Acquisition price')
    const cells = (lines[headerIndex + 1] ?? '').split(',')

    expect(column).toBeGreaterThan(-1)
    expect(cells[column]).toBe('')
    expect(csv).not.toContain('null')
  })

  it('defuses a plate a spreadsheet would run as a formula', () => {
    const csv = exportVehicles(context, resolved([entry({ registration_plate: '=1+1' })])).contents
    expect(csv).toContain("'=1+1")
  })

  it('names nobody in the filename', () => {
    const file = exportVehicles(context, resolved([entry()]))
    expect(file.filename).toBe('vehicles-2026-11-04.csv')
    expect(file.filename).not.toMatch(/AB-123-CD/i)
  })
})

describe('the Next service column', () => {
  it('keeps its name and its place, so existing spreadsheets still work', () => {
    // The column is the same fact it always was. Only its source changed, and
    // a rename would break every pivot built on a file exported last month.
    const lines = exportVehicles(context, resolved([entry()])).contents.split('\n')
    const columns = (lines.find((line) => line.startsWith('Plate,')) ?? '').split(',')

    expect(columns).toContain('Next service')
    expect(columns.indexOf('Next service')).toBe(columns.indexOf('Registration expires') + 1)
    expect(columns).toHaveLength(33)
  })

  it('publishes the configured plan date rather than the legacy one', () => {
    const csv = exportVehicles(
      context,
      resolved([entry()], [plan({ next_service_on: '2027-06-08', service_interval_days: 180 })]),
    ).contents

    expect(cell(csv, 'Next service')).toBe('2027-06-08')
    // The frozen column must not survive anywhere in the row.
    expect(csv).not.toContain('2026-12-01')
  })

  it('leaves a mileage-only plan blank instead of reviving the legacy date', () => {
    /*
     * This is the case the whole correction turns on. The vehicle IS planned --
     * it is due at 60,200 km -- but it is not due on a DAY, so there is no date
     * to publish. Falling back here would print 2026-12-01: specific, plausible,
     * wrong, and indistinguishable in the file from a real date.
     */
    const csv = exportVehicles(
      context,
      resolved(
        [entry()],
        [plan({ next_service_odometer: 60_200, service_interval_odometer: 5_000 })],
      ),
    ).contents

    expect(cell(csv, 'Next service')).toBe('')
    expect(csv).not.toContain('2026-12-01')
  })

  it('falls back to the legacy date only when no plan exists at all', () => {
    // An agency that never configured a plan still relies on this date, and
    // this export is often taken precisely because somebody is leaving.
    const csv = exportVehicles(context, resolved([entry()], [])).contents
    expect(cell(csv, 'Next service')).toBe('2026-12-01')
  })

  it('does not read one vehicle’s plan onto another', () => {
    const csv = exportVehicles(
      context,
      resolved([entry()], [plan({ vehicle_id: 'v2', next_service_on: '2027-06-08' })]),
    ).contents

    expect(cell(csv, 'Next service')).toBe('2026-12-01')
    expect(csv).not.toContain('2027-06-08')
  })

  it('ignores a cancelled record, which is not a plan', () => {
    const csv = exportVehicles(
      context,
      resolved([entry()], [plan({ status: 'cancelled', next_service_on: '2027-06-08' })]),
    ).contents

    expect(cell(csv, 'Next service')).toBe('2026-12-01')
  })

  it('writes a blank, not the word null, when there is no date anywhere', () => {
    const csv = exportVehicles(context, resolved([entry({ next_service_on: null })], [])).contents

    expect(cell(csv, 'Next service')).toBe('')
    expect(csv).not.toContain('null')
  })
})

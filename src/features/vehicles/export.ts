import { csvMoney, csvNumber, csvText } from '@/features/reports/csv'
import {
  buildExportFile,
  csvBoolean,
  csvInstant,
  type ExportContext,
  type ExportFile,
} from '@/lib/export/csv-export'
import type { VehicleFleetEntry } from '@/types/database'

/**
 * Taking the fleet out of the product.
 *
 * THE COMPLIANCE DATES ARE THE POINT. An agency can reconstruct makes and
 * plates from memory or from its own paperwork; what it cannot reconstruct is
 * which of forty vehicles has insurance expiring in March, an inspection
 * overdue, and a service due at the next 10,000 km. That is the column set
 * somebody actually needs on the day they leave, or on the day their accountant
 * asks, and it is why every expiry in the fleet view travels.
 *
 * ACQUISITION TRAVELS TOO. What a vehicle cost, when, from whom, and on what
 * terms is the basis of every depreciation schedule an accountant will ever
 * build. It is also the part of the record an agency is least able to
 * reconstruct from the vehicles themselves.
 *
 * WHAT IS EXCLUDED. The UUIDs — `vehicle_id`, `current_rental_id`,
 * `current_customer_id` and their `next_` counterparts. A rental is named by
 * its reference. The CUSTOMER currently holding a vehicle is deliberately NOT
 * named here: this is a fleet export, a renter's name is not a fact about a
 * car, and the rentals export already joins the two for anybody who needs it.
 */

const HEADERS = [
  'Plate',
  'Make',
  'Model',
  'Year',
  'VIN',
  'Colour',
  'Category',
  'Fuel',
  'Transmission',
  'Seats',
  'Odometer',
  'Daily rate',
  'Currency',
  'Status',
  'Operational status',
  'Available now',
  'Insurance expires',
  'Inspection expires',
  'Registration expires',
  'Next service',
  'Current rental',
  'Current rental ends',
  'Next rental',
  'Next rental starts',
  'Acquisition method',
  'Acquired on',
  'Acquisition price',
  'Acquisition currency',
  'Acquisition supplier',
  'Acquisition notes',
  'Notes',
  'Created',
  'Archived',
] as const

export function buildVehiclesCsv(
  context: ExportContext,
  rows: readonly VehicleFleetEntry[],
): string {
  return exportVehicles(context, rows).contents
}

export function exportVehicles(
  context: ExportContext,
  rows: readonly VehicleFleetEntry[],
): ExportFile {
  const body = rows.map((row) => [
    csvText(row.registration_plate),
    csvText(row.make),
    csvText(row.model),
    row.model_year === null ? '' : csvNumber(row.model_year),
    csvText(row.vin),
    csvText(row.color),
    csvText(row.category),
    csvText(row.fuel_type),
    csvText(row.transmission),
    row.seats === null ? '' : csvNumber(row.seats),
    csvNumber(row.odometer),
    csvMoney(row.daily_rate_minor, row.currency),
    csvText(row.currency),
    csvText(row.effective_status),
    csvText(row.operational_status),
    csvBoolean(row.is_available_now),
    csvText(row.insurance_expires_on),
    csvText(row.inspection_expires_on),
    csvText(row.registration_expires_on),
    csvText(row.next_service_on),
    csvText(row.current_rental_reference),
    csvInstant(row.current_rental_ends_at),
    csvText(row.next_rental_reference),
    csvInstant(row.next_rental_starts_at),
    csvText(row.acquisition_method),
    csvText(row.acquired_on),
    row.acquisition_price_minor === null || row.acquisition_currency === null
      ? ''
      : csvMoney(row.acquisition_price_minor, row.acquisition_currency),
    csvText(row.acquisition_currency),
    csvText(row.acquisition_supplier),
    csvText(row.acquisition_notes),
    csvText(row.notes),
    csvInstant(row.created_at),
    csvInstant(row.archived_at),
  ])

  return buildExportFile(context, 'vehicles', 'Fleet', HEADERS, body)
}

import { csvMoney, csvNumber, csvText } from '@/features/reports/csv'
import {
  evaluateVehicleServicing,
  type ServiceOptions,
  type ServicePlan,
} from '@/lib/compliance/service'
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

/**
 * A fleet row with its service date already resolved against Maintenance.
 *
 * Required rather than optional ON PURPOSE. `VehicleFleetEntry.next_service_on`
 * is the pre-Maintenance column, and nothing in the product writes it any more:
 * Edit Vehicle no longer carries the field and the write key was removed from
 * the payload. If this were optional, a caller that forgot to resolve would
 * quietly fall back to that frozen column and publish a date the product itself
 * no longer believes -- a wrong date in a file somebody keeps, which is worse
 * than a blank one. The type now refuses to build the file until the question
 * has been answered.
 */
export interface VehicleExportRow extends VehicleFleetEntry {
  /** The date the Service and maintenance card shows, or null. */
  readonly service_next_on: string | null
}

/** A service plan carried by one of the vehicle's maintenance records. */
export type ExportServicePlan = ServicePlan & {
  readonly vehicle_id: string
  readonly id?: string
  readonly status?: string | null
  readonly created_at?: string | null
}

/**
 * Fill the `Next service` column from the authoritative preventive service plan.
 *
 * WHY THE COLUMN KEPT ITS NAME. It is the same fact it always was -- when this
 * vehicle is next due -- so renaming it would break every spreadsheet, filter
 * and pivot built on an earlier export for no gain. What changed is where the
 * answer is read from, not what the question is.
 *
 * THE THREE RULES, and the reason each one is not the obvious alternative:
 *
 *   A configured plan wins.        Read through `evaluateVehicleServicing`, the
 *                                  same call Vehicle Details makes, so the file
 *                                  and the screen cannot disagree about the same
 *                                  car on the same day.
 *
 *   A mileage-only plan is blank.  Such a vehicle is due at a READING, not on a
 *                                  day. There is no date to publish, and falling
 *                                  back to the legacy one here would be the worst
 *                                  outcome of the three: a plausible, specific,
 *                                  wrong date, indistinguishable in the file from
 *                                  a real one.
 *
 *   The legacy date only when      Agencies that never configured a plan would
 *   there is no plan at all.       otherwise lose a date they still rely on, and
 *                                  this export is often taken precisely because
 *                                  somebody is leaving.
 */
export function resolveExportServiceDates(
  rows: readonly VehicleFleetEntry[],
  plans: readonly ExportServicePlan[],
  options: ServiceOptions,
): VehicleExportRow[] {
  const byVehicle = new Map<string, ExportServicePlan[]>()
  for (const plan of plans) {
    const existing = byVehicle.get(plan.vehicle_id)
    if (existing) existing.push(plan)
    else byVehicle.set(plan.vehicle_id, [plan])
  }

  return rows.map((row) => {
    const { record, status } = evaluateVehicleServicing(
      byVehicle.get(row.vehicle_id) ?? [],
      row.odometer,
      options,
    )
    // `record` is the test for "a plan exists", NOT `status.nextServiceOn`.
    // A mileage-only plan is a configured plan with no date, and testing the
    // date instead would send exactly that case down the legacy branch.
    return { ...row, service_next_on: record ? status.nextServiceOn : row.next_service_on }
  })
}

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
  rows: readonly VehicleExportRow[],
): string {
  return exportVehicles(context, rows).contents
}

export function exportVehicles(
  context: ExportContext,
  rows: readonly VehicleExportRow[],
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
    csvText(row.service_next_on),
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

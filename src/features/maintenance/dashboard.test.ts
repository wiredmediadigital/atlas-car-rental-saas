import { describe, expect, it } from 'vitest'

import type { ServiceOptions } from '@/lib/compliance/service'

import type { MaintenanceRow, ServicingVehicle } from './api'
import { buildServicingRows, countServicing, sortServicingRows } from './dashboard'

/**
 * The dashboard figures.
 *
 * The claims worth pinning are the ones an operator would act on and an
 * accountant would query: that a vehicle with two concurrent jobs is one
 * vehicle off the road, that due-soon and overdue do not double count the same
 * car, and that a vehicle nobody has planned a service for still appears.
 */

const OPTIONS: ServiceOptions = {
  timeZone: 'Africa/Casablanca',
  leadDays: 30,
  now: new Date('2026-11-26T12:00:00Z'),
}

function record(overrides: Partial<MaintenanceRow> = {}): MaintenanceRow {
  return {
    id: 'maintenance-1',
    organization_id: 'org-1',
    vehicle_id: 'vehicle-1',
    reference: 'MNT-2026-00001',
    title: 'Service',
    category: 'preventive',
    priority: 'normal',
    status: 'scheduled',
    scheduled_start: null,
    expected_completion: null,
    actual_start: null,
    actual_completion: null,
    description: null,
    reported_issue: null,
    work_performed: null,
    completion_notes: null,
    service_provider: null,
    technician: null,
    provider_reference: null,
    estimated_cost_minor: null,
    currency: 'MAD',
    incident_id: null,
    start_odometer: null,
    completion_odometer: null,
    service_interval_days: null,
    service_interval_odometer: null,
    next_service_on: null,
    next_service_odometer: null,
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

function vehicle(overrides: Partial<ServicingVehicle> = {}): ServicingVehicle {
  return {
    id: 'vehicle-1',
    registration_plate: 'DEMO-004',
    make: 'Kia',
    model: 'Forte',
    odometer: 54375,
    next_service_on: null,
    ...overrides,
  }
}

describe('buildServicingRows', () => {
  it('includes a vehicle nobody has planned a service for', () => {
    const rows = buildServicingRows([vehicle()], [], OPTIONS)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.status.state).toBe('not_configured')
    expect(rows[0]!.record).toBeNull()
  })

  it('attaches the soonest plan and evaluates it against the vehicle’s odometer', () => {
    const rows = buildServicingRows(
      [vehicle({ odometer: 60000 })],
      [
        record({ id: 'later', next_service_on: '2027-06-08', next_service_odometer: 70000 }),
        record({ id: 'sooner', next_service_on: '2026-12-01', next_service_odometer: 60200 }),
      ],
      OPTIONS,
    )
    expect(rows[0]!.record?.id).toBe('sooner')
    // 5 days away on the date limb, 200 units away on the distance limb.
    expect(rows[0]!.status.state).toBe('due_soon')
  })

  it('does not attribute one vehicle’s plan to another', () => {
    const rows = buildServicingRows(
      [vehicle({ id: 'v1' }), vehicle({ id: 'v2', registration_plate: 'DEMO-005' })],
      [record({ vehicle_id: 'v1', next_service_on: '2026-01-01' })],
      OPTIONS,
    )
    expect(rows.find((r) => r.vehicle.id === 'v1')!.status.state).toBe('overdue')
    expect(rows.find((r) => r.vehicle.id === 'v2')!.status.state).toBe('not_configured')
  })
})

describe('countServicing', () => {
  it('never counts the same vehicle as both due soon and overdue', () => {
    const rows = buildServicingRows(
      [vehicle({ id: 'v1' }), vehicle({ id: 'v2' }), vehicle({ id: 'v3' }), vehicle({ id: 'v4' })],
      [
        record({ id: 'a', vehicle_id: 'v1', next_service_on: '2026-01-01' }), // overdue
        record({ id: 'b', vehicle_id: 'v2', next_service_on: '2026-11-26' }), // due today
        record({ id: 'c', vehicle_id: 'v3', next_service_on: '2026-12-10' }), // due soon
        record({ id: 'd', vehicle_id: 'v4', next_service_on: '2028-01-01' }), // up to date
      ],
      OPTIONS,
    )
    const counts = countServicing(rows)
    expect(counts.overdue).toBe(2)
    expect(counts.dueSoon).toBe(1)
    expect(counts.notConfigured).toBe(0)
    expect(counts.overdue + counts.dueSoon).toBeLessThanOrEqual(rows.length)
  })

  it('counts vehicles with no plan separately', () => {
    const counts = countServicing(buildServicingRows([vehicle()], [], OPTIONS))
    expect(counts).toEqual({ dueSoon: 0, overdue: 0, notConfigured: 1 })
  })
})

describe('sortServicingRows', () => {
  it('puts the most urgent first and unplanned vehicles last', () => {
    const rows = buildServicingRows(
      [
        vehicle({ id: 'none', registration_plate: 'AAA' }),
        vehicle({ id: 'ok', registration_plate: 'BBB' }),
        vehicle({ id: 'late', registration_plate: 'CCC' }),
        vehicle({ id: 'soon', registration_plate: 'DDD' }),
      ],
      [
        record({ id: 'b', vehicle_id: 'ok', next_service_on: '2028-01-01' }),
        record({ id: 'c', vehicle_id: 'late', next_service_on: '2026-01-01' }),
        record({ id: 'd', vehicle_id: 'soon', next_service_on: '2026-12-10' }),
      ],
      OPTIONS,
    )
    expect(sortServicingRows(rows).map((r) => r.vehicle.id)).toEqual(['late', 'soon', 'ok', 'none'])
  })
})

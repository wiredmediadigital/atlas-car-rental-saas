import { describe, expect, it } from 'vitest'

import {
  DEFAULT_SERVICE_LEAD_DISTANCE,
  describeServiceDate,
  describeServiceDistance,
  evaluateServicePlan,
  selectVehicleServicePlan,
  type ServiceOptions,
} from './service'

/**
 * The service horizon, pinned at its boundaries.
 *
 * Every case here is a claim two screens have to agree on, so the interesting
 * ones are the edges: the threshold day itself, the threshold reading itself,
 * and what happens when one limb is set and the other is not.
 */

const OPTIONS: ServiceOptions = {
  timeZone: 'Africa/Casablanca',
  leadDays: 30,
  now: new Date('2026-11-26T12:00:00Z'),
}

function plan(next_service_on: string | null, next_service_odometer: number | null) {
  return { next_service_on, next_service_odometer }
}

describe('evaluateServicePlan — nothing configured', () => {
  it('reports not_configured for a null plan', () => {
    const status = evaluateServicePlan(null, 54375, OPTIONS)
    expect(status.state).toBe('not_configured')
    expect(status.trigger).toBeNull()
  })

  it('reports not_configured when both limbs are empty', () => {
    expect(evaluateServicePlan(plan(null, null), 54375, OPTIONS).state).toBe('not_configured')
  })
})

describe('evaluateServicePlan — the date limb', () => {
  it('is up to date well before the lead window', () => {
    const status = evaluateServicePlan(plan('2027-06-08', null), null, OPTIONS)
    expect(status.state).toBe('up_to_date')
    expect(status.byDate.remaining).toBe(194)
  })

  it('turns due_soon exactly on the lead-day boundary', () => {
    // 2026-12-26 is 30 days away; leadDays is 30, so it is inside the window.
    expect(evaluateServicePlan(plan('2026-12-26', null), null, OPTIONS).state).toBe('due_soon')
    // One day further out is not.
    expect(evaluateServicePlan(plan('2026-12-27', null), null, OPTIONS).state).toBe('up_to_date')
  })

  it('is due — not overdue — on the day itself', () => {
    const status = evaluateServicePlan(plan('2026-11-26', null), null, OPTIONS)
    expect(status.state).toBe('due')
    expect(status.byDate.remaining).toBe(0)
  })

  it('is overdue the day after', () => {
    const status = evaluateServicePlan(plan('2026-11-25', null), null, OPTIONS)
    expect(status.state).toBe('overdue')
    expect(status.byDate.remaining).toBe(-1)
  })

  it('reads the day in the agency’s zone, not UTC', () => {
    // 2026-11-26T02:00Z is still 2026-11-25 in Los Angeles. A plan due on the
    // 26th must not be "due" there yet.
    const inLosAngeles: ServiceOptions = {
      timeZone: 'America/Los_Angeles',
      leadDays: 30,
      now: new Date('2026-11-26T02:00:00Z'),
    }
    expect(evaluateServicePlan(plan('2026-11-26', null), null, inLosAngeles).byDate.remaining).toBe(
      1,
    )
    // The same instant in Casablanca is already the 26th.
    expect(evaluateServicePlan(plan('2026-11-26', null), null, OPTIONS).byDate.remaining).toBe(0)
  })

  it('honours an agency that warns 14 days ahead rather than 30', () => {
    const short: ServiceOptions = { ...OPTIONS, leadDays: 14 }
    expect(evaluateServicePlan(plan('2026-12-20', null), null, short).state).toBe('up_to_date')
    expect(evaluateServicePlan(plan('2026-12-20', null), null, OPTIONS).state).toBe('due_soon')
  })
})

describe('evaluateServicePlan — the odometer limb', () => {
  it('is up to date well below the threshold', () => {
    const status = evaluateServicePlan(plan(null, 60200), 54375, OPTIONS)
    expect(status.state).toBe('up_to_date')
    expect(status.byOdometer.remaining).toBe(5825)
  })

  it('turns due_soon exactly on the lead-distance boundary', () => {
    expect(
      evaluateServicePlan(plan(null, 60200), 60200 - DEFAULT_SERVICE_LEAD_DISTANCE, OPTIONS).state,
    ).toBe('due_soon')
    expect(
      evaluateServicePlan(plan(null, 60200), 60200 - DEFAULT_SERVICE_LEAD_DISTANCE - 1, OPTIONS)
        .state,
    ).toBe('up_to_date')
  })

  it('is due at exactly the threshold reading, overdue past it', () => {
    expect(evaluateServicePlan(plan(null, 60200), 60200, OPTIONS).state).toBe('due')
    expect(evaluateServicePlan(plan(null, 60200), 60201, OPTIONS).state).toBe('overdue')
  })

  it('says nothing about distance when the reading is unknown', () => {
    const status = evaluateServicePlan(plan(null, 60200), null, OPTIONS)
    expect(status.state).toBe('not_configured')
    expect(status.odometerKnown).toBe(false)
    expect(status.byOdometer.configured).toBe(false)
  })
})

describe('evaluateServicePlan — whichever threshold is reached first', () => {
  it('lets the odometer decide when distance has run out but the date has not', () => {
    const status = evaluateServicePlan(plan('2027-06-08', 60200), 60500, OPTIONS)
    expect(status.state).toBe('overdue')
    expect(status.trigger).toBe('odometer')
    expect(status.byDate.state).toBe('up_to_date')
  })

  it('lets the date decide when the date has passed but distance has not', () => {
    const status = evaluateServicePlan(plan('2026-01-01', 60200), 54375, OPTIONS)
    expect(status.state).toBe('overdue')
    expect(status.trigger).toBe('date')
    expect(status.byOdometer.state).toBe('up_to_date')
  })

  it('takes the more urgent of two live limbs', () => {
    const status = evaluateServicePlan(plan('2026-12-20', 60200), 54375, OPTIONS)
    expect(status.byDate.state).toBe('due_soon')
    expect(status.byOdometer.state).toBe('up_to_date')
    expect(status.state).toBe('due_soon')
    expect(status.trigger).toBe('date')
  })

  it('falls back to the date limb alone when the reading is unknown', () => {
    const status = evaluateServicePlan(plan('2026-11-25', 60200), null, OPTIONS)
    expect(status.state).toBe('overdue')
    expect(status.trigger).toBe('date')
    expect(status.odometerKnown).toBe(false)
  })
})

describe('phrasing', () => {
  it('describes days remaining and days overdue', () => {
    expect(
      describeServiceDate(evaluateServicePlan(plan('2026-11-26', null), null, OPTIONS).byDate),
    ).toBe('Due today')
    expect(
      describeServiceDate(evaluateServicePlan(plan('2026-11-27', null), null, OPTIONS).byDate),
    ).toBe('Due tomorrow')
    expect(
      describeServiceDate(evaluateServicePlan(plan('2026-11-25', null), null, OPTIONS).byDate),
    ).toBe('1 day overdue')
    expect(
      describeServiceDate(evaluateServicePlan(plan('2026-12-06', null), null, OPTIONS).byDate),
    ).toBe('Due in 10 days')
  })

  it('describes distance in the agency’s own unit', () => {
    const status = evaluateServicePlan(plan(null, 60200), 54375, OPTIONS)
    expect(describeServiceDistance(status.byOdometer, 'km')).toContain('km')
    expect(describeServiceDistance(status.byOdometer, 'mi')).toContain('mi')
    const over = evaluateServicePlan(plan(null, 60200), 60300, OPTIONS)
    expect(describeServiceDistance(over.byOdometer, 'km')).toBe('100 km overdue')
  })

  it('returns null for a limb that was never configured', () => {
    const status = evaluateServicePlan(plan(null, null), null, OPTIONS)
    expect(describeServiceDate(status.byDate)).toBeNull()
    expect(describeServiceDistance(status.byOdometer, 'km')).toBeNull()
  })
})

describe('selectVehicleServicePlan', () => {
  it('returns null when no record carries a plan', () => {
    expect(
      selectVehicleServicePlan([
        { next_service_on: null, next_service_odometer: null, status: 'completed' },
      ]),
    ).toBeNull()
  })

  it('picks the soonest date across several records', () => {
    const picked = selectVehicleServicePlan([
      { next_service_on: '2027-06-08', next_service_odometer: null, status: 'completed' },
      { next_service_on: '2026-12-20', next_service_odometer: null, status: 'scheduled' },
    ])
    expect(picked?.next_service_on).toBe('2026-12-20')
  })

  it('ignores a cancelled record’s reminder', () => {
    const picked = selectVehicleServicePlan([
      { next_service_on: '2026-01-01', next_service_odometer: null, status: 'cancelled' },
      { next_service_on: '2027-06-08', next_service_odometer: null, status: 'scheduled' },
    ])
    expect(picked?.next_service_on).toBe('2027-06-08')
  })

  it('falls back to the lowest odometer threshold when no date is set', () => {
    const picked = selectVehicleServicePlan([
      { next_service_on: null, next_service_odometer: 70000, status: 'scheduled' },
      { next_service_on: null, next_service_odometer: 60200, status: 'scheduled' },
    ])
    expect(picked?.next_service_odometer).toBe(60200)
  })

  it('prefers a record with a date over one with only a distance', () => {
    const picked = selectVehicleServicePlan([
      { next_service_on: null, next_service_odometer: 60200, status: 'scheduled' },
      { next_service_on: '2027-06-08', next_service_odometer: null, status: 'scheduled' },
    ])
    expect(picked?.next_service_on).toBe('2027-06-08')
  })
})

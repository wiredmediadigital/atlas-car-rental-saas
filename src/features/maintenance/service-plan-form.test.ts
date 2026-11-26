import { describe, expect, it } from 'vitest'

import { parseServicePlanForm, servicePlanToForm } from './service-plan-form'

/**
 * Reading the preventive servicing form.
 *
 * The case that matters most is the one that used to lose data silently: the
 * RPC overwrites all four columns on every call, so a box parsed to null does
 * not leave the stored value alone — it erases it.
 */

const EMPTY = { nextOn: '', nextOdometer: '', intervalDays: '', intervalOdometer: '' }

describe('parseServicePlanForm — accepted plans', () => {
  it('accepts a date-only plan', () => {
    const { payload, errors } = parseServicePlanForm({ ...EMPTY, nextOn: '2027-06-08' })
    expect(errors).toEqual({})
    expect(payload).toEqual({
      p_next_service_on: '2027-06-08',
      p_next_service_odometer: null,
      p_interval_days: null,
      p_interval_odometer: null,
    })
  })

  it('accepts a mileage-only plan', () => {
    const { payload } = parseServicePlanForm({ ...EMPTY, nextOdometer: '60200' })
    expect(payload).toMatchObject({ p_next_service_odometer: 60200, p_next_service_on: null })
  })

  it('accepts both thresholds together with both recurring intervals', () => {
    const { payload } = parseServicePlanForm({
      nextOn: '2027-06-08',
      nextOdometer: '60200',
      intervalDays: '180',
      intervalOdometer: '5000',
    })
    expect(payload).toEqual({
      p_next_service_on: '2027-06-08',
      p_next_service_odometer: 60200,
      p_interval_days: 180,
      p_interval_odometer: 5000,
    })
  })

  it('accepts a zero reading, which is a legitimate odometer', () => {
    const { payload } = parseServicePlanForm({ ...EMPTY, nextOdometer: '0' })
    expect(payload).toMatchObject({ p_next_service_odometer: 0 })
  })
})

describe('parseServicePlanForm — refuses rather than erases', () => {
  it('refuses a thousands separator instead of sending null', () => {
    // This is the regression. "5,000" used to parse to null, pass the
    // all-empty guard because other boxes were filled, and overwrite the
    // stored interval with nothing while reporting success.
    const { payload, errors } = parseServicePlanForm({
      ...EMPTY,
      nextOn: '2027-06-08',
      intervalOdometer: '5,000',
    })
    expect(payload).toBeNull()
    expect(errors.intervalOdometer).toMatch(/whole number/i)
  })

  it.each(['5 000', '5000 km', '~180', '1.5', 'soon', '-10'])('refuses %o', (entry) => {
    const { payload, errors } = parseServicePlanForm({ ...EMPTY, intervalDays: entry })
    expect(payload).toBeNull()
    expect(errors.intervalDays).toBeDefined()
  })

  it('refuses a zero interval, mirroring the database CHECK', () => {
    expect(parseServicePlanForm({ ...EMPTY, intervalDays: '0' }).errors.intervalDays).toMatch(
      /at least one day/i,
    )
    expect(
      parseServicePlanForm({ ...EMPTY, intervalOdometer: '0' }).errors.intervalOdometer,
    ).toMatch(/more than nothing/i)
  })

  it('refuses an unparseable date', () => {
    const { errors } = parseServicePlanForm({ ...EMPTY, nextOn: '08/06/2027' })
    expect(errors.nextOn).toMatch(/valid date/i)
  })

  it('refuses a date that does not exist', () => {
    expect(parseServicePlanForm({ ...EMPTY, nextOn: '2027-02-30' }).payload).toBeNull()
  })

  it('reports every bad field at once, not just the first', () => {
    const { errors } = parseServicePlanForm({
      nextOn: 'not-a-date',
      nextOdometer: 'abc',
      intervalDays: '1.5',
      intervalOdometer: '5,000',
    })
    expect(Object.keys(errors).sort()).toEqual([
      'intervalDays',
      'intervalOdometer',
      'nextOdometer',
      'nextOn',
    ])
  })

  it('refuses an entirely empty form with a form-level message', () => {
    const { payload, errors } = parseServicePlanForm(EMPTY)
    expect(payload).toBeNull()
    expect(errors.form).toMatch(/at least one reminder/i)
  })
})

describe('servicePlanToForm', () => {
  it('round-trips a stored plan back into form text', () => {
    expect(
      servicePlanToForm({
        next_service_on: '2027-06-08',
        next_service_odometer: 60200,
        service_interval_days: 180,
        service_interval_odometer: 5000,
      }),
    ).toEqual({
      nextOn: '2027-06-08',
      nextOdometer: '60200',
      intervalDays: '180',
      intervalOdometer: '5000',
    })
  })

  it('renders nulls as empty boxes, not as "null"', () => {
    expect(
      servicePlanToForm({
        next_service_on: null,
        next_service_odometer: null,
        service_interval_days: null,
        service_interval_odometer: null,
      }),
    ).toEqual(EMPTY)
  })

  it('round-trips a zero reading rather than blanking it', () => {
    expect(
      servicePlanToForm({
        next_service_on: null,
        next_service_odometer: 0,
        service_interval_days: null,
        service_interval_odometer: null,
      }).nextOdometer,
    ).toBe('0')
  })
})

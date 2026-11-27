import { describe, expect, it } from 'vitest'

import { isOutstandingMaintenance } from './api'
import type { IncidentDashboardRow, IncidentMaintenanceLink } from './api'
import {
  EMPTY_INCIDENT_FILTERS,
  countActiveFilters,
  filterIncidentRows,
  incidentVehicleOptions,
  summariseIncidents,
  type IncidentListFilters,
  type IncidentPeriod,
} from './dashboard'

/** November 2026, in UTC, as the page computes it. */
const NOVEMBER: IncidentPeriod = {
  fromInstant: '2026-11-01T00:00:00.000Z',
  toInstant: '2026-12-01T00:00:00.000Z',
}

let sequence = 0

function row(over: Partial<IncidentDashboardRow> = {}): IncidentDashboardRow {
  sequence += 1
  return {
    id: `i${sequence}`,
    reference: `INC-2026-${String(sequence).padStart(5, '0')}`,
    incident_type: 'breakdown',
    status: 'open',
    responsibility: 'undetermined',
    occurred_at: '2026-11-10T09:00:00.000Z',
    vehicle_id: 'v1',
    rental_id: null,
    customer_id: null,
    location: null,
    description: 'Engine warning light',
    vehicle: {
      id: 'v1',
      registration_plate: 'AB-123-CD',
      make: 'Dacia',
      model: 'Logan',
      model_year: 2024,
    },
    rental: null,
    customer: null,
    ...over,
  }
}

function links(
  entries: Record<string, IncidentMaintenanceLink>,
): Readonly<Record<string, IncidentMaintenanceLink>> {
  return entries
}

const NO_LINKS = links({})

describe('the incident summary', () => {
  it('counts what was reported in the selected period', () => {
    // Arrange
    const rows = [
      row({ occurred_at: '2026-11-02T08:00:00.000Z' }),
      row({ occurred_at: '2026-11-28T08:00:00.000Z' }),
      row({ occurred_at: '2026-10-30T08:00:00.000Z' }),
    ]

    // Act
    const figures = summariseIncidents(rows, NO_LINKS, NOVEMBER)

    // Assert
    expect(figures.total).toBe(2)
  })

  it('treats the period as inclusive at the start and exclusive at the end', () => {
    // A month boundary counted twice is how the same incident appears in two
    // months' figures and the year does not add up.
    const rows = [
      row({ occurred_at: '2026-11-01T00:00:00.000Z' }),
      row({ occurred_at: '2026-12-01T00:00:00.000Z' }),
    ]

    expect(summariseIncidents(rows, NO_LINKS, NOVEMBER).total).toBe(1)
  })

  it('compares instants rather than strings, so the Postgres spelling works', () => {
    /*
     * Postgres returns `2026-11-10T09:00:00+00:00`; `Date.toISOString()`
     * produces `2026-11-10T09:00:00.000Z`. Compared as text, '+' sorts before
     * '.', so a lexicographic implementation gets ordinary dates wrong. This
     * row is in November whichever spelling arrives.
     */
    const rows = [row({ occurred_at: '2026-11-10T09:00:00+00:00' })]

    expect(summariseIncidents(rows, NO_LINKS, NOVEMBER).total).toBe(1)
  })

  it('counts resolved and rental-related within the period only', () => {
    const rows = [
      row({ status: 'resolved', rental_id: 'r1' }),
      row({ status: 'open', rental_id: 'r2' }),
      row({ status: 'resolved', rental_id: 'r3', occurred_at: '2026-09-01T08:00:00.000Z' }),
    ]

    const figures = summariseIncidents(rows, NO_LINKS, NOVEMBER)

    expect(figures.resolved).toBe(1)
    expect(figures.rentalRelated).toBe(2)
  })

  it('counts open incidents whenever they happened, not just in the period', () => {
    /*
     * THE POINT OF THE WHOLE SPLIT. An incident opened in March and never
     * closed is the most actionable row in the product, and a dashboard that
     * hid it behind a month selector would be worse than no dashboard.
     */
    const rows = [
      row({ status: 'open', occurred_at: '2026-03-04T08:00:00.000Z' }),
      row({ status: 'in_progress', occurred_at: '2026-01-09T08:00:00.000Z' }),
      row({ status: 'resolved', occurred_at: '2026-11-10T08:00:00.000Z' }),
    ]

    const figures = summariseIncidents(rows, NO_LINKS, NOVEMBER)

    expect(figures.open).toBe(2)
    expect(figures.total).toBe(1)
  })

  it('counts a vehicle with several open incidents once', () => {
    const rows = [
      row({ vehicle_id: 'v1', status: 'open' }),
      row({ vehicle_id: 'v1', status: 'in_progress' }),
      row({ vehicle_id: 'v2', status: 'open' }),
    ]

    expect(summariseIncidents(rows, NO_LINKS, NOVEMBER).vehiclesAffected).toBe(2)
  })

  it('does not count a vehicle whose only incident is resolved', () => {
    const rows = [
      row({ vehicle_id: 'v1', status: 'resolved' }),
      row({ vehicle_id: 'v2', status: 'open' }),
    ]

    expect(summariseIncidents(rows, NO_LINKS, NOVEMBER).vehiclesAffected).toBe(1)
  })

  it('counts an incident with several maintenance records once', () => {
    // The figure counts incidents, not jobs. Three repairs raised from one
    // breakdown is one incident with outstanding work.
    const incident = row({ id: 'i-many' })
    const map = links({ 'i-many': { total: 3, outstanding: 2 } })

    expect(summariseIncidents([incident], map, NOVEMBER).withOutstandingMaintenance).toBe(1)
  })

  it('counts outstanding maintenance on a RESOLVED incident', () => {
    /*
     * The two lifecycles are independent, and this is where that shows up as a
     * number. Resolving the incident does not complete the repair, so the work
     * is still outstanding and must stay visible — omitting it would quietly
     * lose jobs the moment somebody tidied up the incident.
     */
    const incident = row({ id: 'i-resolved', status: 'resolved' })
    const map = links({ 'i-resolved': { total: 1, outstanding: 1 } })

    const figures = summariseIncidents([incident], map, NOVEMBER)

    expect(figures.withOutstandingMaintenance).toBe(1)
    expect(figures.open).toBe(0)
  })

  it('does not treat completed or cancelled maintenance as outstanding', () => {
    const incident = row({ id: 'i-done' })
    const map = links({ 'i-done': { total: 2, outstanding: 0 } })

    expect(summariseIncidents([incident], map, NOVEMBER).withOutstandingMaintenance).toBe(0)
  })

  it('reports zeroes for an agency with no incidents at all', () => {
    const figures = summariseIncidents([], NO_LINKS, NOVEMBER)

    expect(figures).toEqual({
      total: 0,
      resolved: 0,
      rentalRelated: 0,
      open: 0,
      vehiclesAffected: 0,
      withOutstandingMaintenance: 0,
    })
  })

  it('counts every incident when there is no period', () => {
    const rows = [
      row({ occurred_at: '2024-01-01T08:00:00.000Z' }),
      row({ occurred_at: '2026-11-10T08:00:00.000Z' }),
    ]

    expect(summariseIncidents(rows, NO_LINKS, null).total).toBe(2)
  })
})

describe('the incident list filter', () => {
  const filters = (over: Partial<IncidentListFilters> = {}): IncidentListFilters => ({
    ...EMPTY_INCIDENT_FILTERS,
    ...over,
  })

  it('narrows to the selected period by default', () => {
    const rows = [
      row({ occurred_at: '2026-11-10T08:00:00.000Z' }),
      row({ occurred_at: '2026-04-10T08:00:00.000Z' }),
    ]

    expect(filterIncidentRows(rows, NO_LINKS, filters(), NOVEMBER, 'UTC')).toHaveLength(1)
  })

  it('shows historical unresolved incidents when the period is off', () => {
    // "All time" is the period switched off, and it is how somebody finds the
    // incident nobody closed in April.
    const rows = [
      row({ status: 'open', occurred_at: '2026-04-10T08:00:00.000Z' }),
      row({ occurred_at: '2026-11-10T08:00:00.000Z' }),
    ]

    const visible = filterIncidentRows(rows, NO_LINKS, filters({ status: 'open' }), null, 'UTC')

    expect(visible).toHaveLength(2)
  })

  it('treats "unresolved" as open OR in progress, matching the Open incidents tile', () => {
    /*
     * The tile counts everything that is not resolved. If this filter meant
     * the literal status 'open', the tile would say three and its own
     * drill-down would show two — and an operator would have no way to tell
     * which of the two numbers was wrong.
     */
    const rows = [
      row({ id: 'a', status: 'open' }),
      row({ id: 'b', status: 'in_progress' }),
      row({ id: 'c', status: 'resolved' }),
    ]

    const visible = filterIncidentRows(
      rows,
      NO_LINKS,
      filters({ status: 'unresolved' }),
      NOVEMBER,
      'UTC',
    )

    expect(visible.map((entry) => entry.id)).toEqual(['a', 'b'])
    expect(visible).toHaveLength(summariseIncidents(rows, NO_LINKS, NOVEMBER).open)
  })

  it('still filters on an exact status when one is chosen', () => {
    const rows = [row({ id: 'a', status: 'open' }), row({ id: 'b', status: 'in_progress' })]

    expect(
      filterIncidentRows(rows, NO_LINKS, filters({ status: 'open' }), NOVEMBER, 'UTC').map(
        (e) => e.id,
      ),
    ).toEqual(['a'])
  })

  it('filters by status, type, responsibility and vehicle', () => {
    const wanted = row({
      status: 'in_progress',
      incident_type: 'accident',
      responsibility: 'customer',
      vehicle_id: 'v9',
    })
    const rows = [wanted, row(), row({ status: 'in_progress' })]

    const visible = filterIncidentRows(
      rows,
      NO_LINKS,
      filters({
        status: 'in_progress',
        type: 'accident',
        responsibility: 'customer',
        vehicleId: 'v9',
      }),
      NOVEMBER,
      'UTC',
    )

    expect(visible.map((entry) => entry.id)).toEqual([wanted.id])
  })

  it('filters to incidents that have outstanding maintenance', () => {
    const withWork = row({ id: 'i-work' })
    const withoutWork = row({ id: 'i-none' })
    const map = links({ 'i-work': { total: 1, outstanding: 1 } })

    const visible = filterIncidentRows(
      [withWork, withoutWork],
      map,
      filters({ maintenance: 'outstanding' }),
      NOVEMBER,
      'UTC',
    )

    expect(visible.map((entry) => entry.id)).toEqual(['i-work'])
  })

  it('filters to incidents with no maintenance raised at all', () => {
    // A completed repair still counts as maintenance raised, so this must not
    // return an incident whose work is merely finished.
    const completed = row({ id: 'i-completed' })
    const untouched = row({ id: 'i-untouched' })
    const map = links({ 'i-completed': { total: 1, outstanding: 0 } })

    const visible = filterIncidentRows(
      [completed, untouched],
      map,
      filters({ maintenance: 'none' }),
      NOVEMBER,
      'UTC',
    )

    expect(visible.map((entry) => entry.id)).toEqual(['i-untouched'])
  })

  it('filters on the incident’s own calendar day', () => {
    const rows = [
      row({ occurred_at: '2026-11-05T08:00:00.000Z' }),
      row({ occurred_at: '2026-11-20T08:00:00.000Z' }),
    ]

    const visible = filterIncidentRows(
      rows,
      NO_LINKS,
      filters({ from: '2026-11-10', to: '2026-11-30' }),
      NOVEMBER,
      'UTC',
    )

    expect(visible).toHaveLength(1)
  })

  it('filters on the AGENCY’s calendar day, not the UTC one', () => {
    /*
     * 23:30 UTC on the 10th is already the 11th in Paris, and the table
     * displays the 11th. Reading the UTC day here would drop a row whose own
     * printed date sits inside the range the operator typed, with nothing on
     * screen to explain where it went.
     *
     * Europe/Paris rather than Africa/Casablanca on purpose: Morocco's offset
     * has moved around and the installed tzdata puts it at UTC+0 on this date,
     * so the assertion would prove nothing there.
     */
    const rows = [row({ occurred_at: '2026-11-10T23:30:00.000Z' })]
    const eleventh = filters({ from: '2026-11-11', to: '2026-11-11' })

    expect(filterIncidentRows(rows, NO_LINKS, eleventh, NOVEMBER, 'Europe/Paris')).toHaveLength(1)
    // The same row and the same filter, read in UTC: there it is still the 10th.
    expect(filterIncidentRows(rows, NO_LINKS, eleventh, NOVEMBER, 'UTC')).toEqual([])
  })

  it.each([
    ['the reference', 'INC-2026-'],
    ['the plate', 'ab-123'],
    ['the make', 'dacia'],
    ['the model', 'logan'],
  ])('searches %s', (_label, term) => {
    const rows = [row()]

    expect(
      filterIncidentRows(rows, NO_LINKS, filters({ search: term }), NOVEMBER, 'UTC'),
    ).toHaveLength(1)
  })

  it('searches the rental reference and the customer name', () => {
    const rows = [
      row({
        rental_id: 'r1',
        rental: { id: 'r1', reference: 'RNT-0007' },
        customer_id: 'c1',
        customer: { id: 'c1', display_name: 'Amina Haddad' },
      }),
    ]

    expect(
      filterIncidentRows(rows, NO_LINKS, filters({ search: 'rnt-0007' }), NOVEMBER, 'UTC'),
    ).toHaveLength(1)
    expect(
      filterIncidentRows(rows, NO_LINKS, filters({ search: 'haddad' }), NOVEMBER, 'UTC'),
    ).toHaveLength(1)
  })

  it('still searches the location and the free text, as the old list did', () => {
    // Dropping these would be a silent regression in an accepted feature: a
    // search somebody used last week would stop matching.
    const rows = [row({ location: 'Marrakech ring road', description: 'Gearbox failure' })]

    expect(
      filterIncidentRows(rows, NO_LINKS, filters({ search: 'ring road' }), NOVEMBER, 'UTC'),
    ).toHaveLength(1)
    expect(
      filterIncidentRows(rows, NO_LINKS, filters({ search: 'gearbox' }), NOVEMBER, 'UTC'),
    ).toHaveLength(1)
  })

  it('filters to rental-related incidents, and to those without a rental', () => {
    // The "Rental-related" summary tile sets this. Without it the tile would
    // clear the filters and apply none, showing every incident under a figure
    // that had counted a subset.
    const withRental = row({ id: 'i-rental', rental_id: 'r1' })
    const without = row({ id: 'i-alone', rental_id: null })

    expect(
      filterIncidentRows(
        [withRental, without],
        NO_LINKS,
        filters({ rental: 'rental' }),
        NOVEMBER,
        'UTC',
      ),
    ).toHaveLength(1)
    expect(
      filterIncidentRows(
        [withRental, without],
        NO_LINKS,
        filters({ rental: 'standalone' }),
        NOVEMBER,
        'UTC',
      ).map((entry) => entry.id),
    ).toEqual(['i-alone'])
  })

  it('returns nothing when the term matches nothing', () => {
    expect(
      filterIncidentRows([row()], NO_LINKS, filters({ search: 'submarine' }), NOVEMBER, 'UTC'),
    ).toEqual([])
  })
})

describe('the filter count', () => {
  it('ignores the search term, which has its own visible box', () => {
    expect(countActiveFilters({ ...EMPTY_INCIDENT_FILTERS, search: 'anything' })).toBe(0)
  })

  it('counts each narrowed filter once', () => {
    expect(
      countActiveFilters({
        ...EMPTY_INCIDENT_FILTERS,
        status: 'open',
        type: 'theft',
        maintenance: 'outstanding',
      }),
    ).toBe(3)
  })
})

describe('the vehicle filter options', () => {
  it('lists each vehicle once, sorted, however many incidents it has', () => {
    const rows = [
      row({
        vehicle_id: 'v2',
        vehicle: {
          id: 'v2',
          registration_plate: 'ZZ-1',
          make: 'Zeta',
          model: 'Two',
          model_year: null,
        },
      }),
      row({
        vehicle_id: 'v1',
        vehicle: {
          id: 'v1',
          registration_plate: 'AA-1',
          make: 'Alpha',
          model: 'One',
          model_year: null,
        },
      }),
      row({
        vehicle_id: 'v1',
        vehicle: {
          id: 'v1',
          registration_plate: 'AA-1',
          make: 'Alpha',
          model: 'One',
          model_year: null,
        },
      }),
    ]

    const options = incidentVehicleOptions(rows)

    expect(options).toEqual([
      { id: 'v1', label: 'Alpha One · AA-1' },
      { id: 'v2', label: 'Zeta Two · ZZ-1' },
    ])
  })

  it('still offers a vehicle whose record could not be read', () => {
    // The incident is real even when the join came back empty, and dropping it
    // from the filter would make those rows unreachable.
    const options = incidentVehicleOptions([row({ vehicle_id: 'v-gone', vehicle: null })])

    expect(options).toEqual([{ id: 'v-gone', label: 'Vehicle unavailable' }])
  })
})

describe('the outstanding-maintenance rule', () => {
  it.each([
    ['scheduled', true],
    ['in_progress', true],
    ['completed', false],
    ['cancelled', false],
  ] as const)('treats %s as outstanding: %s', (status, expected) => {
    // Exercised directly rather than through a database. The rule used to be
    // an inline condition inside a paging loop, where the only way to test it
    // was to stand up Postgres -- so nothing did.
    expect(isOutstandingMaintenance(status)).toBe(expected)
  })

  it('does not treat cancelled work as done, only as not outstanding', () => {
    // It still counts towards the incident's total: the record exists, and an
    // operator opening the incident will see it.
    expect(isOutstandingMaintenance('cancelled')).toBe(false)
  })
})

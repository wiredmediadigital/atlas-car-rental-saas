import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { IncidentDashboardRow, IncidentMaintenanceLink } from '@/features/incidents/api'

import { IncidentsPage } from './IncidentsPage'

interface TestState {
  rows: IncidentDashboardRow[]
  links: Record<string, IncidentMaintenanceLink>
  isPending: boolean
  isError: boolean
  linksSuccess: boolean
  linksPending: boolean
  linksError: boolean
}

const state = vi.hoisted<TestState>(() => ({
  rows: [],
  links: {},
  isPending: false,
  isError: false,
  linksSuccess: true,
  linksPending: false,
  linksError: false,
}))

vi.mock('@/features/incidents/queries', () => ({
  useIncidentDashboard: () => ({
    data: state.rows,
    isPending: state.isPending,
    isError: state.isError,
  }),
  useIncidentMaintenanceLinks: () => ({
    data: state.links,
    isPending: state.linksPending,
    isSuccess: state.linksSuccess,
    isError: state.linksError,
  }),
}))

vi.mock('@/features/workspace/workspace-context', () => ({
  useOrganization: () => ({
    id: 'org-1',
    name: 'Agency',
    locale: 'en-GB',
    time_zone: 'UTC',
  }),
  usePermission: () => true,
}))

let sequence = 0

function row(over: Partial<IncidentDashboardRow> = {}): IncidentDashboardRow {
  sequence += 1
  return {
    id: `i${sequence}`,
    reference: `INC-2026-${String(sequence).padStart(5, '0')}`,
    incident_type: 'breakdown',
    status: 'open',
    responsibility: 'undetermined',
    occurred_at: '2026-04-10T09:00:00.000Z',
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

function renderPage(path = '/incidents?period=all') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <IncidentsPage />
    </MemoryRouter>,
  )
}

/** The tile button, found by the visually hidden line that says what it does. */
function tile(label: string) {
  return screen.getByRole('button', { name: new RegExp(`Filter the list by ${label}`) })
}

/** The figure a tile is displaying, read off the tile itself. */
function tileValue(label: string): string {
  const button = tile(label)
  return within(button).getByText((_, node) => node?.hasAttribute('data-numeric') === true)
    .textContent
}

beforeEach(() => {
  state.rows = []
  state.links = {}
  state.isPending = false
  state.isError = false
  state.linksSuccess = true
  state.linksPending = false
  state.linksError = false
})

describe('the Incidents dashboard', () => {
  it('keeps the Incidents route heading and the Report incident action', () => {
    renderPage()

    expect(screen.getByRole('heading', { name: 'Incidents' })).toBeTruthy()
    // Two of them on an empty agency: the header action and the empty state's.
    // Both must reach the accepted reporting route.
    const report = screen.getAllByRole('link', { name: 'Report incident' })
    expect(report.length).toBeGreaterThan(0)
    for (const link of report) expect(link.getAttribute('href')).toBe('/incidents/new')
  })

  it('links each row to the existing Incident Details route', () => {
    state.rows = [row({ id: 'abc', reference: 'INC-2026-00042' })]

    renderPage()

    const link = screen.getAllByRole('link', { name: 'INC-2026-00042' })[0]!
    expect(link.getAttribute('href')).toBe('/incidents/abc')
  })

  it('shows the actual figures on the tiles, not just their labels', () => {
    /*
     * Asserting the labels alone would pass with every figure wired to the
     * wrong field, or to nothing. These are the numbers an operator acts on.
     */
    state.rows = [
      row({ id: 'a', status: 'open', vehicle_id: 'v1' }),
      row({ id: 'b', status: 'in_progress', vehicle_id: 'v1' }),
      row({ id: 'c', status: 'resolved', vehicle_id: 'v2', rental_id: 'r1' }),
    ]
    state.links = { a: { total: 2, outstanding: 1 } }

    renderPage()

    expect(tileValue('Total incidents')).toBe('3')
    expect(tileValue('Resolved')).toBe('1')
    expect(tileValue('Rental-related')).toBe('1')
    expect(tileValue('Open incidents')).toBe('2')
    // Two open incidents, both on v1: one vehicle.
    expect(tileValue('Vehicles affected')).toBe('1')
    // One incident with outstanding work, though it has two records.
    expect(tileValue('Outstanding maintenance')).toBe('1')
  })

  it('announces the figure to a screen reader rather than hiding it', () => {
    // An aria-label on the button would REPLACE the name computed from the
    // content, silently withholding the only part that matters: the number.
    state.rows = [row({ status: 'open' })]

    renderPage()

    expect(tile('Open incidents').textContent).toContain('1')
  })

  it('shows a dash rather than a confident zero when the incidents could not be read', () => {
    state.isError = true

    renderPage()

    expect(screen.getByRole('alert').textContent).toContain('Unable to load incidents')
    expect(screen.queryByText('0')).toBeNull()
  })

  it('shows a dash on the maintenance tile when only the maintenance read failed', () => {
    /*
     * The two queries fail independently. A failed maintenance read used to
     * leave the link map empty, so this tile reported a confident 0 while the
     * table in the same card admitted it did not know — the page contradicted
     * itself on one screen.
     */
    state.rows = [row({ status: 'open' })]
    state.linksSuccess = false
    state.linksError = true

    renderPage()

    expect(tileValue('Open incidents')).toBe('1')
    expect(screen.getByRole('button', { name: /Outstanding maintenance/ }).textContent).toContain(
      '—',
    )
    expect(screen.getAllByText('Unavailable').length).toBeGreaterThan(0)
  })

  it('disables the maintenance filter when the link could not be read', async () => {
    // Left enabled over an empty link map, "No maintenance raised" matches
    // every incident in the agency and looks like a confident answer.
    state.rows = [row()]
    state.linksSuccess = false
    state.linksError = true

    renderPage()
    await userEvent.click(screen.getByRole('button', { name: /Filters/ }))

    expect(screen.getByLabelText('Maintenance')).toHaveProperty('disabled', true)
    expect(screen.getAllByRole('link', { name: /INC-/ }).length).toBeGreaterThan(0)
  })

  it('narrows the list when a summary tile is used as a filter', async () => {
    state.rows = [
      row({ id: 'open-one', reference: 'INC-OPEN', status: 'open' }),
      // In progress is NOT resolved, so the tile counted it. If the drill-down
      // filtered on the literal status 'open' this row would vanish and the
      // figure would no longer match the list it produced.
      row({ id: 'busy-one', reference: 'INC-BUSY', status: 'in_progress' }),
      row({ id: 'done-one', reference: 'INC-DONE', status: 'resolved' }),
    ]

    renderPage()
    expect(screen.getAllByRole('link', { name: 'INC-DONE' }).length).toBeGreaterThan(0)

    await userEvent.click(tile('Open incidents'))

    expect(screen.queryByRole('link', { name: 'INC-DONE' })).toBeNull()
    expect(screen.getAllByRole('link', { name: 'INC-OPEN' }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('link', { name: 'INC-BUSY' }).length).toBeGreaterThan(0)
  })

  it('applies a real filter when the Rental-related tile is used', async () => {
    // A tile that cleared the filters and applied none would show every
    // incident under a figure that had counted only some of them.
    state.rows = [
      row({ reference: 'INC-WITH', rental_id: 'r1', rental: { id: 'r1', reference: 'RNT-1' } }),
      row({ reference: 'INC-WITHOUT', rental_id: null }),
    ]

    renderPage()
    await userEvent.click(tile('Rental-related'))

    expect(screen.queryByRole('link', { name: 'INC-WITHOUT' })).toBeNull()
    expect(screen.getAllByRole('link', { name: 'INC-WITH' }).length).toBeGreaterThan(0)
  })

  it('keeps All time selected when a period tile is used', async () => {
    /*
     * The period tiles counted whatever window is selected. Resetting the
     * period here would drop the list back to the current month under a figure
     * that had just counted every year on record.
     */
    state.rows = [row({ reference: 'INC-OLD', occurred_at: '2026-04-10T09:00:00.000Z' })]

    renderPage()
    await userEvent.click(tile('Total incidents'))

    expect(screen.getAllByRole('link', { name: 'INC-OLD' }).length).toBeGreaterThan(0)
  })

  it('reaches a historical unresolved incident through the All time toggle', async () => {
    // The row is from April; the default period is the current month.
    state.rows = [row({ reference: 'INC-OLD', occurred_at: '2026-04-10T09:00:00.000Z' })]

    renderPage('/incidents')
    expect(screen.queryByRole('link', { name: 'INC-OLD' })).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'All time' }))

    expect(screen.getAllByRole('link', { name: 'INC-OLD' }).length).toBeGreaterThan(0)
  })

  it('steps the period backwards and forwards, and disables the month controls on All time', async () => {
    renderPage('/incidents?month=2026-11')

    expect(screen.getByText('November 2026')).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: 'Previous month' }))
    expect(screen.getByText('October 2026')).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: 'Next month' }))
    await userEvent.click(screen.getByRole('button', { name: 'Next month' }))
    expect(screen.getByText('December 2026')).toBeTruthy()

    // Stepping a period that is not in use would read as a broken control.
    await userEvent.click(screen.getByRole('button', { name: 'All time' }))

    expect(screen.queryByText('December 2026')).toBeNull()
    for (const name of ['Previous month', 'Next month', 'This month']) {
      expect(screen.getByRole('button', { name })).toHaveProperty('disabled', true)
    }
  })

  it('pages the list and clamps a page number beyond the end', () => {
    state.rows = Array.from({ length: 30 }, (_, index) =>
      row({ id: `p${index}`, reference: `INC-PAGE-${String(index).padStart(2, '0')}` }),
    )

    renderPage()
    // 30 rows, 25 to a page: the 26th belongs on page two.
    expect(screen.queryByRole('link', { name: 'INC-PAGE-25' })).toBeNull()

    renderPage('/incidents?period=all&page=2')
    expect(screen.getAllByRole('link', { name: 'INC-PAGE-25' }).length).toBeGreaterThan(0)

    // A stale or hand-edited page number shows the last page, not a blank card.
    renderPage('/incidents?period=all&page=99')
    expect(screen.getAllByRole('link', { name: 'INC-PAGE-25' }).length).toBeGreaterThan(0)
  })

  it('searches from the toolbar, once the typing settles', async () => {
    state.rows = [
      row({ reference: 'INC-FIND-ME' }),
      row({
        reference: 'INC-OTHER',
        vehicle: {
          id: 'v2',
          registration_plate: 'ZZ-999',
          make: 'Other',
          model: 'Car',
          model_year: null,
        },
        vehicle_id: 'v2',
      }),
    ]

    renderPage()
    await userEvent.type(screen.getByLabelText('Search incidents'), 'FIND-ME')

    // The box is debounced, so the list settles a moment after the last key.
    await vi.waitFor(() => {
      expect(screen.queryByRole('link', { name: 'INC-OTHER' })).toBeNull()
    })
    expect(screen.getAllByRole('link', { name: 'INC-FIND-ME' }).length).toBeGreaterThan(0)
  })

  it('shows outstanding maintenance on a row, and an ellipsis while it is unknown', () => {
    state.rows = [row({ id: 'linked', reference: 'INC-LINKED' })]
    state.links = { linked: { total: 2, outstanding: 1 } }

    const view = renderPage()
    expect(screen.getAllByText('1 outstanding').length).toBeGreaterThan(0)
    expect(screen.getAllByText('2 records').length).toBeGreaterThan(0)

    // Unknown is not the same as none: "None" would read as an incident nobody
    // had raised any work for.
    view.unmount()
    state.linksSuccess = false
    state.linksPending = true
    renderPage()
    expect(screen.getAllByText('…').length).toBeGreaterThan(0)
    expect(screen.queryByText('None')).toBeNull()
  })

  it('offers to report one when the agency has no incidents at all', () => {
    renderPage()

    const empty = screen.getByText('No incidents yet')
    expect(empty).toBeTruthy()
    expect(
      within(empty.parentElement!.parentElement!).getByRole('link', {
        name: 'Report incident',
      }),
    ).toBeTruthy()
  })

  it('distinguishes an empty filter result from an empty agency', () => {
    state.rows = [row({ status: 'resolved' })]

    renderPage('/incidents?period=all&status=open')

    expect(screen.getByText('Nothing matches those filters')).toBeTruthy()
  })
})

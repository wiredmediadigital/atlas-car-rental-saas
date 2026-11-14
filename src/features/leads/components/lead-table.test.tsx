import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { Lead } from '../api'

import { COLLISION_LABEL, LeadTable } from './LeadTable'

let counter = 0

function lead(overrides: Partial<Lead> = {}): Lead {
  counter += 1
  return {
    id: `lead-${counter}`,
    reference: `REQ-0000000${counter}`,
    status: 'new',
    vehicleId: 'veh-1',
    vehicleLabel: 'Renault Clio',
    startsAt: '2027-05-01T09:00:00Z',
    endsAt: '2027-05-05T09:00:00Z',
    fullName: `Asker ${counter}`,
    email: `asker${counter}@example.test`,
    phone: null,
    note: null,
    currency: 'EUR',
    dailyRateMinor: 4500,
    billableDays: 4,
    quotedTotalMinor: 18000,
    convertedRentalId: null,
    createdAt: '2027-04-01T09:00:00Z',
    ...overrides,
  }
}

function renderTable(leads: Lead[], props: Partial<Parameters<typeof LeadTable>[0]> = {}) {
  return render(<LeadTable leads={leads} timeZone="Europe/Paris" {...props} />)
}

function rowFor(name: string): HTMLElement {
  return screen.getByText(name).closest('tr') as HTMLElement
}

describe('the queue', () => {
  it('lists leads in the order it is given, oldest first', () => {
    // The page sorts oldest-first on purpose: a lead is somebody waiting, and
    // the one who has waited longest is nearest the end of their patience.
    const first = lead({ fullName: 'Waited Longest' })
    const second = lead({ fullName: 'Arrived Later' })
    renderTable([first, second])

    const names = screen
      .getAllByRole('row')
      .slice(1)
      .map((row) => within(row).getAllByRole('cell')[0]?.textContent ?? '')
    expect(names[0]).toContain('Waited Longest')
    expect(names[1]).toContain('Arrived Later')
  })

  it('shows who asked, for what, when and for how much', () => {
    renderTable([lead({ fullName: 'Grace Hopper', phone: '+33 1 23 45 67 89' })])
    const row = rowFor('Grace Hopper')
    expect(within(row).getByText('Renault Clio')).toBeInTheDocument()
    expect(within(row).getByText('+33 1 23 45 67 89')).toBeInTheDocument()
    expect(within(row).getByText(/180[.,]00/)).toBeInTheDocument()
    expect(within(row).getByRole('link', { name: /asker|grace/i })).toHaveAttribute(
      'href',
      expect.stringContaining('mailto:'),
    )
  })

  it('reads the dates in the agency time zone', () => {
    renderTable([lead({ fullName: 'Zoned', startsAt: '2027-05-01T23:30:00Z' })])
    // 23:30 UTC on 1 May is 01:30 on 2 May in Paris. The agency's counter is
    // what the dates have to match.
    expect(within(rowFor('Zoned')).getByText(/2 May/)).toBeInTheDocument()
  })
})

describe('two people wanting the same car', () => {
  it('flags both of them', () => {
    const first = lead({ fullName: 'First Asker' })
    const second = lead({
      fullName: 'Second Asker',
      startsAt: '2027-05-03T09:00:00Z',
      endsAt: '2027-05-08T09:00:00Z',
    })
    renderTable([first, second])

    expect(within(rowFor('First Asker')).getByText(COLLISION_LABEL)).toBeInTheDocument()
    expect(within(rowFor('Second Asker')).getByText(COLLISION_LABEL)).toBeInTheDocument()
  })

  it('says nothing when the dates do not meet', () => {
    const first = lead({ fullName: 'Early Asker' })
    const second = lead({
      fullName: 'Late Asker',
      startsAt: '2027-06-01T09:00:00Z',
      endsAt: '2027-06-04T09:00:00Z',
    })
    renderTable([first, second])
    expect(screen.queryByText(COLLISION_LABEL)).not.toBeInTheDocument()
  })
})

describe('what a member may do', () => {
  it('offers Delete only when the caller may delete', () => {
    // The policy refuses a staff member's delete whatever this renders;
    // hiding the control is kinder than letting them press it.
    renderTable([lead({ fullName: 'Deletable' })], { onDelete: vi.fn() })
    expect(within(rowFor('Deletable')).getByRole('button', { name: /delete/i })).toBeInTheDocument()
  })

  it('offers no Delete when the caller may not', () => {
    renderTable([lead({ fullName: 'Protected' })])
    expect(within(rowFor('Protected')).queryByRole('button', { name: /delete/i })).toBeNull()
  })

  it('calls back with the lead that was pressed', async () => {
    const onDelete = vi.fn()
    const onContact = vi.fn()
    const target = lead({ fullName: 'Pressed' })
    const user = userEvent.setup()
    renderTable([target, lead({ fullName: 'Untouched' })], { onDelete, onContact })

    await user.click(within(rowFor('Pressed')).getByRole('button', { name: /delete/i }))
    await user.click(within(rowFor('Pressed')).getByRole('button', { name: /mark contacted/i }))

    expect(onDelete).toHaveBeenCalledWith(expect.objectContaining({ id: target.id }))
    expect(onContact).toHaveBeenCalledWith(expect.objectContaining({ id: target.id }))
  })

  it('offers nothing to convert or decline on a lead already converted', () => {
    renderTable([lead({ fullName: 'Already Done', status: 'converted' })], {
      onConvert: vi.fn(),
      onDecline: vi.fn(),
    })
    const row = rowFor('Already Done')
    expect(within(row).queryByRole('button', { name: /convert/i })).toBeNull()
    expect(within(row).queryByRole('button', { name: /decline/i })).toBeNull()
    expect(within(row).getByText('Converted')).toBeInTheDocument()
  })

  it('offers Mark contacted only while a lead is new', () => {
    renderTable([lead({ fullName: 'Spoken To', status: 'contacted' })], { onContact: vi.fn() })
    expect(
      within(rowFor('Spoken To')).queryByRole('button', { name: /mark contacted/i }),
    ).toBeNull()
  })
})

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type * as LeadsApi from '../api'
import type { Lead } from '../api'

import { ConvertLeadDialog, DRIFT_LABEL } from './ConvertLeadDialog'

const convertLead = vi.hoisted(() => vi.fn())
const fetchCurrentDailyRate = vi.hoisted(() => vi.fn())

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof LeadsApi>()
  return { ...actual, convertLead, fetchCurrentDailyRate }
})

const LEAD: Lead = {
  id: 'lead-1',
  reference: 'REQ-ABCD2345',
  status: 'new',
  vehicleId: 'veh-1',
  vehicleLabel: 'Renault Clio',
  startsAt: '2027-05-01T09:00:00Z',
  endsAt: '2027-05-05T09:00:00Z',
  fullName: 'Grace Hopper',
  email: 'grace@example.test',
  phone: '+33 1 23 45 67 89',
  note: 'Arriving on the evening train.',
  currency: 'EUR',
  dailyRateMinor: 4500,
  billableDays: 4,
  quotedTotalMinor: 18000,
  convertedRentalId: null,
  createdAt: '2027-04-01T09:00:00Z',
}

function renderDialog(onConverted = vi.fn(), lead: Lead = LEAD) {
  render(<ConvertLeadDialog lead={lead} open onOpenChange={vi.fn()} onConverted={onConverted} />)
  return { onConverted }
}

beforeEach(() => {
  convertLead.mockReset()
  fetchCurrentDailyRate.mockReset()
  convertLead.mockResolvedValue({ customerId: 'cus-1', rentalId: 'rental-1' })
  fetchCurrentDailyRate.mockResolvedValue({ dailyRateMinor: 4500, currency: 'EUR' })
})

describe('the price', () => {
  it('warns when the vehicle rate has moved since the request', async () => {
    // Both figures, neither applied silently. An estimate from three weeks ago
    // is not a price the agency is bound by, and quietly honouring it or
    // quietly replacing it are both worse than saying so.
    fetchCurrentDailyRate.mockResolvedValue({ dailyRateMinor: 6000, currency: 'EUR' })
    renderDialog()

    expect(await screen.findByText(DRIFT_LABEL)).toBeInTheDocument()
    const warning = screen.getByText(DRIFT_LABEL).parentElement as HTMLElement
    expect(warning.textContent).toMatch(/45[.,]00/) // what they were quoted, per day
    expect(warning.textContent).toMatch(/60[.,]00/) // what it costs now, per day
    expect(warning.textContent).toMatch(/240[.,]00/) // what the rental will be
    expect(warning.textContent).toMatch(/180[.,]00/) // what the renter was told
  })

  it('says nothing special when the rate has not moved', async () => {
    renderDialog()
    await waitFor(() => expect(fetchCurrentDailyRate).toHaveBeenCalled())
    expect(screen.queryByText(DRIFT_LABEL)).not.toBeInTheDocument()
    expect(screen.getByText(/the same as quoted/i)).toBeInTheDocument()
  })

  it('still converts when the current rate cannot be read', async () => {
    // Losing the comparison must not lose the button.
    fetchCurrentDailyRate.mockRejectedValue(new Error('offline'))
    const user = userEvent.setup()
    renderDialog()
    await user.click(screen.getByRole('button', { name: /create customer and rental/i }))
    await waitFor(() => expect(convertLead).toHaveBeenCalled())
  })
})

describe('the customer it will create', () => {
  it('offers the name split in two so a wrong split can be fixed', () => {
    renderDialog()
    expect(screen.getByLabelText(/first name/i)).toHaveValue('Grace')
    expect(screen.getByLabelText(/last name/i)).toHaveValue('Hopper')
  })

  it('sends the corrections rather than what the renter typed', async () => {
    const user = userEvent.setup()
    renderDialog()

    await user.clear(screen.getByLabelText(/last name/i))
    await user.type(screen.getByLabelText(/last name/i), 'Hopper-Murray')
    await user.click(screen.getByRole('button', { name: /create customer and rental/i }))

    await waitFor(() =>
      expect(convertLead).toHaveBeenCalledWith(
        'lead-1',
        expect.objectContaining({ first_name: 'Grace', last_name: 'Hopper-Murray' }),
      ),
    )
  })

  it('shows what the renter wrote', () => {
    renderDialog()
    expect(screen.getByText('Arriving on the evening train.')).toBeInTheDocument()
  })
})

describe('when it cannot be done', () => {
  it('explains plainly when the vehicle is no longer free', async () => {
    convertLead.mockRejectedValue(new Error('That vehicle is no longer free for those dates.'))
    const user = userEvent.setup()
    renderDialog()

    await user.click(screen.getByRole('button', { name: /create customer and rental/i }))
    expect(await screen.findByText(/no longer free for those dates/i)).toBeInTheDocument()
    // And the dialog stays open with everything still filled in.
    expect(screen.getByLabelText(/first name/i)).toHaveValue('Grace')
  })

  it('lets staff try again after a failure', async () => {
    convertLead.mockRejectedValueOnce(new Error('Something went wrong.'))
    const user = userEvent.setup()
    renderDialog()

    await user.click(screen.getByRole('button', { name: /create customer and rental/i }))
    await screen.findByText(/something went wrong/i)
    expect(screen.getByRole('button', { name: /create customer and rental/i })).toBeEnabled()
  })
})

describe('pressing it twice', () => {
  it('cannot be submitted twice', async () => {
    // A second press would be a second rental, and the car can only be let
    // once. The database locks the lead as well; this is the near half.
    let release: (value: unknown) => void = () => {}
    convertLead.mockReturnValue(
      new Promise((resolve) => {
        release = resolve
      }),
    )
    const user = userEvent.setup()
    renderDialog()

    const button = screen.getByRole('button', { name: /create customer and rental/i })
    await user.click(button)
    expect(button).toBeDisabled()
    await user.click(button)

    expect(convertLead).toHaveBeenCalledTimes(1)
    release({ customerId: 'cus-1', rentalId: 'rental-1' })
  })
})

describe('when it works', () => {
  it('hands back the rental it created', async () => {
    const user = userEvent.setup()
    const { onConverted } = renderDialog()

    await user.click(screen.getByRole('button', { name: /create customer and rental/i }))
    await waitFor(() =>
      expect(onConverted).toHaveBeenCalledWith({ customerId: 'cus-1', rentalId: 'rental-1' }),
    )
  })
})

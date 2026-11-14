import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as BookingApi from '../api'
import type { PublicAgency, PublicVehicle } from '../api'

import { RequestForm } from './RequestForm'

const submitBookingRequest = vi.hoisted(() => vi.fn())

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof BookingApi>()
  return { ...actual, submitBookingRequest }
})

const AGENCY: PublicAgency = {
  name: 'Atlas Cars',
  phone: '+33 1 23 45 67 89',
  logoUrl: null,
  timeZone: 'Europe/Paris',
  currency: 'EUR',
  acceptsRequests: true,
}

const VEHICLE: PublicVehicle = {
  id: 'veh-1',
  make: 'Renault',
  model: 'Clio',
  year: 2024,
  category: 'Compact',
  transmission: 'manual',
  fuelType: 'petrol',
  seats: 5,
  doors: 5,
  imageUrl: null,
  currency: 'EUR',
  dailyRateMinor: 4500,
  billableDays: 3,
  quotedTotalMinor: 13500,
  isAvailable: true,
}

const PERIOD = { from: '2027-03-01T09:00:00.000Z', to: '2027-03-04T09:00:00.000Z' }

function renderForm(onClose = vi.fn()) {
  render(
    <RequestForm
      agency={AGENCY}
      vehicle={VEHICLE}
      slug="atlas-cars"
      period={PERIOD}
      onClose={onClose}
    />,
  )
  return { onClose }
}

async function fillIn(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/your name/i), 'Grace Hopper')
  await user.type(screen.getByLabelText(/email/i), 'grace@example.test')
}

beforeEach(() => {
  submitBookingRequest.mockReset()
  submitBookingRequest.mockResolvedValue({ status: 'sent', reference: 'REQ-ABCD2345' })
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('what the form asks for', () => {
  it('asks for name, email and phone and nothing else', () => {
    renderForm()

    expect(screen.getByLabelText(/your name/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/telephone/i)).toBeInTheDocument()

    /*
     * An enquiry is not a hire. Pevvy holds identity documents behind a
     * verified second factor for people an agency has actually rented to;
     * asking a stranger for their licence on the strength of a question
     * nobody has answered yet would mean holding their papers for nothing.
     */
    for (const forbidden of [
      /date of birth/i,
      /licence|license/i,
      /passport/i,
      /identity|id number/i,
      /address/i,
      /post ?code/i,
      /card|payment/i,
    ]) {
      expect(screen.queryByLabelText(forbidden)).not.toBeInTheDocument()
    }
  })

  it('has no file input anywhere', () => {
    const { container } = render(
      <RequestForm
        agency={AGENCY}
        vehicle={VEHICLE}
        slug="atlas-cars"
        period={PERIOD}
        onClose={vi.fn()}
      />,
    )
    expect(container.querySelector('input[type="file"]')).toBeNull()
  })

  it('shows the car, the dates and the estimate while they type', () => {
    renderForm()
    expect(screen.getByRole('heading', { name: /request renault clio/i })).toBeInTheDocument()
    expect(screen.getByText(/135\.00|135,00/)).toBeInTheDocument()
  })

  it('carries a honeypot field hidden from assistive technology', () => {
    const { container } = render(
      <RequestForm
        agency={AGENCY}
        vehicle={VEHICLE}
        slug="atlas-cars"
        period={PERIOD}
        onClose={vi.fn()}
      />,
    )

    const honeypot = container.querySelector('input[name="company"]')
    expect(honeypot).not.toBeNull()
    // Out of the tab order, and inside a subtree hidden from screen readers:
    // no person is ever asked to fill it in.
    expect(honeypot).toHaveAttribute('tabindex', '-1')
    expect(honeypot?.closest('[aria-hidden="true"]')).not.toBeNull()
    // Queried by ROLE, not by label: role queries honour aria-hidden, which is
    // what a screen reader does. getByLabelText would find it and prove nothing.
    expect(screen.queryByRole('textbox', { name: /company/i })).not.toBeInTheDocument()
    // Not display:none, which the better scrapers already skip.
    // The standalone `hidden` class, not `overflow-hidden`: display:none is what
    // the better scrapers skip, and off-screen positioning is what they do not.
    expect(honeypot?.closest('div')?.className).not.toMatch(/(^|\s)hidden(\s|$)/)
  })
})

describe('sending it', () => {
  it('says the request is not confirmed and the car is not held', async () => {
    const user = userEvent.setup()
    renderForm()
    await fillIn(user)
    await user.click(screen.getByRole('button', { name: /send request/i }))

    expect(await screen.findByText(/your request has been sent/i)).toBeInTheDocument()
    expect(screen.getByText('REQ-ABCD2345')).toBeInTheDocument()

    // The sentence that keeps this honest: a renter who believes a car is
    // booked and arrives to find it gone was misled by this screen.
    const confirmation = screen.getByText(/not a confirmed booking/i)
    expect(confirmation).toBeInTheDocument()
    expect(confirmation.textContent).toMatch(/not held/i)
    expect(confirmation.textContent).toMatch(/estimate/i)
  })

  it('offers the telephone number for someone who needs an answer sooner', async () => {
    const user = userEvent.setup()
    renderForm()
    await fillIn(user)
    await user.click(screen.getByRole('button', { name: /send request/i }))

    await screen.findByText(/your request has been sent/i)
    expect(screen.getByRole('link', { name: '+33 1 23 45 67 89' })).toHaveAttribute(
      'href',
      'tel:+33123456789',
    )
  })

  it('sends the honeypot and the time the form was opened', async () => {
    const user = userEvent.setup()
    renderForm()
    await fillIn(user)
    await user.click(screen.getByRole('button', { name: /send request/i }))

    await screen.findByText(/your request has been sent/i)
    expect(submitBookingRequest).toHaveBeenCalledTimes(1)
    const sent = submitBookingRequest.mock.calls[0]![0] as Record<string, unknown>
    expect(sent).toMatchObject({
      slug: 'atlas-cars',
      vehicleId: 'veh-1',
      fullName: 'Grace Hopper',
      email: 'grace@example.test',
      company: '',
    })
    expect(typeof sent.startedAt).toBe('number')
  })

  it('sends an empty optional field as nothing at all', async () => {
    const user = userEvent.setup()
    renderForm()
    await fillIn(user)
    await user.type(screen.getByLabelText(/telephone/i), '   ')
    await user.click(screen.getByRole('button', { name: /send request/i }))

    await screen.findByText(/your request has been sent/i)
    const sent = submitBookingRequest.mock.calls[0]![0] as Record<string, unknown>
    expect(sent.phone).toBeNull()
    expect(sent.note).toBeNull()
  })
})

describe('when it fails', () => {
  it('keeps what was typed', async () => {
    // A form that empties itself asks somebody to type it all again to find
    // out whether the second attempt works any better.
    submitBookingRequest.mockResolvedValue({
      status: 'failed',
      message: 'That car is not available for those dates.',
    })
    const user = userEvent.setup()
    renderForm()

    await user.type(screen.getByLabelText(/your name/i), 'Grace Hopper')
    await user.type(screen.getByLabelText(/email/i), 'grace@example.test')
    await user.type(screen.getByLabelText(/anything the agency/i), 'Arriving late.')
    await user.click(screen.getByRole('button', { name: /send request/i }))

    expect(
      await screen.findByText(/that car is not available for those dates/i),
    ).toBeInTheDocument()
    expect(screen.getByLabelText(/your name/i)).toHaveValue('Grace Hopper')
    expect(screen.getByLabelText(/email/i)).toHaveValue('grace@example.test')
    expect(screen.getByLabelText(/anything the agency/i)).toHaveValue('Arriving late.')
    expect(screen.getByRole('button', { name: /send request/i })).toBeEnabled()
  })

  it('shows the message the server chose, not one of its own', async () => {
    submitBookingRequest.mockResolvedValue({
      status: 'failed',
      message: 'Please wait a little before sending another request.',
    })
    const user = userEvent.setup()
    renderForm()
    await fillIn(user)
    await user.click(screen.getByRole('button', { name: /send request/i }))

    expect(await screen.findByText(/please wait a little/i)).toBeInTheDocument()
  })
})

describe('leaving the form', () => {
  it('goes back to the cars', async () => {
    const user = userEvent.setup()
    const { onClose } = renderForm()
    await user.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

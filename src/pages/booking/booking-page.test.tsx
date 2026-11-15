import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { UNAVAILABLE_LABEL } from '@/features/booking/components/VehicleCard'
import type * as BookingApi from '@/features/booking/api'
import type { PublicBookingPage, PublicVehicle } from '@/features/booking/api'

import { BookingPage } from './BookingPage'

const fetchBookingPage = vi.hoisted(() => vi.fn())

vi.mock('@/features/booking/api', async (importOriginal) => {
  const actual = await importOriginal<typeof BookingApi>()
  return { ...actual, fetchBookingPage }
})

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

function page(overrides: Partial<PublicBookingPage> = {}): PublicBookingPage {
  return {
    agency: {
      name: 'Atlas Cars',
      phone: '+33 1 23 45 67 89',
      logoUrl: null,
      timeZone: 'Europe/Paris',
      currency: 'EUR',
      acceptsRequests: true,
    },
    window: { from: '2027-03-01T09:00:00.000Z', to: '2027-03-04T09:00:00.000Z' },
    vehicles: [VEHICLE],
    ...overrides,
  }
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/book/atlas-cars']}>
      <Routes>
        <Route path="/book/:slug" element={<BookingPage />} />
        <Route path="/sign-in" element={<p>Sign in</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  fetchBookingPage.mockReset()
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('the page a stranger sees', () => {
  it('renders vehicles without asking for dates first', async () => {
    // A visitor who has just arrived from the agency's own website should see
    // cars, not a form. The server chose a window and said which.
    fetchBookingPage.mockResolvedValue({ status: 'ok', page: page() })
    renderPage()

    expect(await screen.findByRole('heading', { name: 'Atlas Cars' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Renault Clio' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /request this car/i })).toBeInTheDocument()
  })

  it('renders outside the workspace and second-factor guards', async () => {
    // No session, no workspace, no enrolment: nothing here may redirect.
    fetchBookingPage.mockResolvedValue({ status: 'ok', page: page() })
    renderPage()

    await screen.findByRole('heading', { name: 'Atlas Cars' })
    expect(screen.queryByText('Sign in')).not.toBeInTheDocument()
  })

  it('shows a dimmed card reading exactly "not free for these dates"', async () => {
    fetchBookingPage.mockResolvedValue({
      status: 'ok',
      page: page({ vehicles: [{ ...VEHICLE, isAvailable: false }] }),
    })
    renderPage()

    expect(await screen.findByText(UNAVAILABLE_LABEL)).toBeInTheDocument()
    expect(UNAVAILABLE_LABEL).toBe('not free for these dates')
    // The car is still listed, and still priced: a page showing three of eight
    // cars reads as an agency with three cars.
    expect(screen.getByRole('heading', { name: 'Renault Clio' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /request this car/i })).not.toBeInTheDocument()
  })

  it('says nothing about why a car is unavailable', async () => {
    fetchBookingPage.mockResolvedValue({
      status: 'ok',
      page: page({ vehicles: [{ ...VEHICLE, isAvailable: false }] }),
    })
    const { container } = renderPage()
    await screen.findByText(UNAVAILABLE_LABEL)
    expect(container.textContent).not.toMatch(/maintenance|workshop|booked|reserved|service/i)
  })

  it('shows no count of how many vehicles are unavailable', async () => {
    fetchBookingPage.mockResolvedValue({
      status: 'ok',
      page: page({
        vehicles: [
          VEHICLE,
          { ...VEHICLE, id: 'veh-2', isAvailable: false },
          { ...VEHICLE, id: 'veh-3', isAvailable: false },
        ],
      }),
    })
    const { container } = renderPage()
    await screen.findByRole('heading', { name: 'Atlas Cars' })

    // How busy an agency is on a weekend is commercially theirs. No "1 of 3",
    // no "2 unavailable", no total.
    expect(container.textContent).not.toMatch(/\d+\s*(of|\/)\s*\d+/)
    expect(container.textContent).not.toMatch(/unavailable|available now|cars free/i)
    expect(screen.getAllByTestId('vehicle-card')).toHaveLength(3)
  })

  it('shows "To book, please call us" with the phone number when requests are off', async () => {
    fetchBookingPage.mockResolvedValue({
      status: 'ok',
      page: page({
        agency: { ...page().agency, acceptsRequests: false },
      }),
    })
    renderPage()

    expect(await screen.findByText('To book, please call us')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '+33 1 23 45 67 89' })).toHaveAttribute(
      'href',
      'tel:+33123456789',
    )
    // The fleet and the prices stay; only the form goes.
    expect(screen.getByRole('heading', { name: 'Renault Clio' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /request this car/i })).not.toBeInTheDocument()
  })
})

describe('when there is no page to show', () => {
  it('says so without hinting whether the agency exists', async () => {
    fetchBookingPage.mockResolvedValue({ status: 'not-found' })
    const { container } = renderPage()

    expect(
      await screen.findByRole('heading', { name: /this booking page is not available/i }),
    ).toBeInTheDocument()
    expect(container.textContent).not.toMatch(/switched off|closed|suspended|billing/i)
  })

  it('reports a failure without blaming the visitor', async () => {
    fetchBookingPage.mockResolvedValue({ status: 'unavailable', message: 'Try again shortly.' })
    renderPage()
    expect(await screen.findByRole('heading', { name: /could not load/i })).toBeInTheDocument()
  })

  it('shows a waiting state rather than an empty page', async () => {
    let settle: (value: unknown) => void = () => {}
    fetchBookingPage.mockReturnValue(
      new Promise((resolve) => {
        settle = resolve
      }),
    )
    renderPage()
    expect(screen.getByText('Loading')).toBeInTheDocument()
    settle({ status: 'ok', page: page() })
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Atlas Cars' })).toBeVisible())
  })
})

describe('an agency with nothing to show', () => {
  it('says the page has no cars rather than rendering an empty grid', async () => {
    fetchBookingPage.mockResolvedValue({ status: 'ok', page: page({ vehicles: [] }) })
    renderPage()
    expect(await screen.findByText(/no cars on this page/i)).toBeInTheDocument()
  })
})

describe('choosing the dates', () => {
  /*
   * The whole value of the page is "do you have a car on MY dates". Without
   * this it only ever answers for the next three days, which is the agency's
   * question rather than the visitor's.
   */
  it('seeds the inputs from the window the server used, in the agency time zone', async () => {
    fetchBookingPage.mockResolvedValue({ status: 'ok', page: page() })
    renderPage()

    // 09:00 UTC on 1 March is 10:00 in Paris, and Paris is where the counter is.
    expect(await screen.findByLabelText(/pick-up/i)).toHaveValue('2027-03-01T10:00')
    expect(screen.getByLabelText(/return/i)).toHaveValue('2027-03-04T10:00')
  })

  it('asks the server again for the window the visitor picked', async () => {
    fetchBookingPage.mockResolvedValue({ status: 'ok', page: page() })
    renderPage()

    const pickUp = await screen.findByLabelText(/pick-up/i)
    fetchBookingPage.mockClear()
    fireEvent.change(pickUp, { target: { value: '2027-04-10T09:00' } })

    await waitFor(() => expect(fetchBookingPage).toHaveBeenCalled())
    const [, period] = fetchBookingPage.mock.calls.at(-1) as [string, { from: Date; to: Date }]
    // Sent as an instant: 09:00 in Paris is 07:00 UTC.
    expect(period.from.toISOString()).toBe('2027-04-10T07:00:00.000Z')
  })

  it('carries the return along when the pick-up moves past it', async () => {
    // Otherwise changing one field is a dead end: the visitor is told the
    // window is inverted and has to fix something they did not break.
    fetchBookingPage.mockResolvedValue({ status: 'ok', page: page() })
    renderPage()

    const pickUp = await screen.findByLabelText(/pick-up/i)
    fireEvent.change(pickUp, { target: { value: '2027-04-10T09:00' } })

    // The original window was three days; it stays three days.
    await waitFor(() => expect(screen.getByLabelText(/return/i)).toHaveValue('2027-04-13T09:00'))
    expect(screen.queryByText(/return has to be after/i)).not.toBeInTheDocument()
  })

  it('refuses a return before the pick-up without asking the server', async () => {
    fetchBookingPage.mockResolvedValue({ status: 'ok', page: page() })
    renderPage()

    const returnAt = await screen.findByLabelText(/return/i)
    fetchBookingPage.mockClear()
    fireEvent.change(returnAt, { target: { value: '2027-02-01T10:00' } })

    expect(await screen.findByText(/return has to be after the pick-up/i)).toBeInTheDocument()
    expect(fetchBookingPage).not.toHaveBeenCalled()
  })

  it('keeps the fleet on screen when the server refuses the window', async () => {
    // Somebody who typed a date in the past has made a small mistake. Taking
    // the page down to tell them is a punishment, not an answer.
    fetchBookingPage.mockResolvedValue({ status: 'ok', page: page() })
    renderPage()

    const pickUp = await screen.findByLabelText(/pick-up/i)
    fetchBookingPage.mockResolvedValue({
      status: 'unavailable',
      message: 'Please choose a pick-up date and a return date in the future.',
    })
    fireEvent.change(pickUp, { target: { value: '2020-01-01T10:00' } })

    expect(await screen.findByText(/date in the future/i)).toBeInTheDocument()
    // The server's own sentence, and the cars are still there.
    expect(screen.getByRole('heading', { name: 'Renault Clio' })).toBeInTheDocument()
  })

  it('sends the request for the window the fleet was priced against', async () => {
    // Not what is half-typed into the inputs: the estimate on the card is for
    // the window the server last answered for, and that is what is asked for.
    const second = page({
      window: { from: '2027-04-10T07:00:00.000Z', to: '2027-04-13T07:00:00.000Z' },
    })
    fetchBookingPage.mockResolvedValueOnce({ status: 'ok', page: page() })
    fetchBookingPage.mockResolvedValue({ status: 'ok', page: second })

    const user = userEvent.setup()
    renderPage()

    const pickUp = await screen.findByLabelText(/pick-up/i)
    fireEvent.change(pickUp, { target: { value: '2027-04-10T09:00' } })

    await waitFor(() => expect(screen.getByLabelText(/pick-up/i)).toHaveValue('2027-04-10T09:00'))
    await user.click(await screen.findByRole('button', { name: /request this car/i }))
    expect(
      await screen.findByRole('heading', { name: /request renault clio/i }),
    ).toBeInTheDocument()
  })

  it('offers no date inputs once the form is open', async () => {
    // The request is for the dates on the card they pressed.
    fetchBookingPage.mockResolvedValue({ status: 'ok', page: page() })
    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByRole('button', { name: /request this car/i }))
    expect(screen.queryByLabelText(/pick-up/i)).not.toBeInTheDocument()
  })
})

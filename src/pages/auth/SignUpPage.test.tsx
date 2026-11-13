import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { paths } from '@/app/routes/paths'

import { SignUpPage } from './SignUpPage'

/**
 * Creating an account now means agreeing to something.
 *
 * The Terms carry a liability cap and an indemnity, so the box is unticked when
 * the screen opens and the form will not submit without it. The two links are
 * checked here as well: a cap that points at the wrong document is no better
 * than one nobody accepted.
 */

const auth = vi.hoisted(() => ({ signUp: vi.fn() }))

vi.mock('@/features/auth/api', () => ({ signUp: auth.signUp }))

function renderPage() {
  return render(
    <MemoryRouter initialEntries={[paths.signUp]}>
      <Routes>
        <Route path={paths.signUp} element={<SignUpPage />} />
        <Route path={paths.confirmEmail} element={<p>confirm screen</p>} />
        <Route path={paths.overview} element={<p>overview screen</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

/** Everything except the agreement, which each test decides for itself. */
async function fillTheForm(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/your name/i), 'Ada Lovelace')
  await user.type(screen.getByLabelText(/work email/i), 'ada@agency.test')
  await user.type(screen.getByLabelText(/^password/i), 'correct horse battery')
  await user.type(screen.getByLabelText(/confirm password/i), 'correct horse battery')
  await user.type(screen.getByLabelText(/agency name/i), 'Lovelace Motors')
  await user.selectOptions(screen.getByLabelText(/country/i), 'PT')
  await user.selectOptions(screen.getByLabelText(/currency/i), 'EUR')
  await user.selectOptions(screen.getByLabelText(/time zone/i), 'Europe/Lisbon')
}

function agreement(): HTMLInputElement {
  return screen.getByRole('checkbox', { name: /i agree to the terms of service/i })
}

beforeEach(() => {
  vi.resetAllMocks()
  auth.signUp.mockResolvedValue({ hasSession: false, email: 'ada@agency.test' })
})

describe('agreeing to the terms', () => {
  it('starts unticked', () => {
    renderPage()

    expect(agreement()).not.toBeChecked()
  })

  it('refuses the form and says so when the box is left unticked', async () => {
    const user = userEvent.setup()
    renderPage()
    await fillTheForm(user)

    await user.click(screen.getByRole('button', { name: /create agency/i }))

    expect(await screen.findByText(/terms of service to continue/i)).toBeVisible()
    expect(auth.signUp).not.toHaveBeenCalled()
  })

  it('announces the refusal, so it is not silence to a screen reader', async () => {
    const user = userEvent.setup()
    renderPage()
    await fillTheForm(user)

    await user.click(screen.getByRole('button', { name: /create agency/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/terms of service to continue/i)
  })

  it('creates the account once the box is ticked', async () => {
    const user = userEvent.setup()
    renderPage()
    await fillTheForm(user)
    await user.click(agreement())

    await user.click(screen.getByRole('button', { name: /create agency/i }))

    expect(await screen.findByText('confirm screen')).toBeVisible()
    expect(auth.signUp).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'ada@agency.test', acceptedTerms: true }),
    )
  })

  it('points at the terms and at the privacy notice, in this tab', () => {
    renderPage()

    const terms = screen.getByRole('link', { name: /terms of service/i })
    const privacy = screen.getByRole('link', { name: /privacy policy/i })

    expect(terms).toHaveAttribute('href', paths.terms)
    expect(privacy).toHaveAttribute('href', paths.privacy)
    expect(terms).not.toHaveAttribute('target')
    expect(privacy).not.toHaveAttribute('target')
  })

  it('agrees to the terms but is only informed by the privacy notice', () => {
    renderPage()

    // Two different verbs, deliberately: you agree to a contract, you are
    // informed by a privacy notice. Bundling consent to both muddies the
    // lawful basis and weakens each document.
    expect(agreement()).toHaveAccessibleName(
      'I agree to the Terms of Service and have read the Privacy Policy.',
    )
  })
})

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { paths } from '@/app/routes/paths'
import { AppError } from '@/lib/supabase/errors'

import { ChallengeFactorPage } from './ChallengeFactorPage'

const mfa = vi.hoisted(() => ({
  listFactorState: vi.fn(),
  challenge: vi.fn(),
}))

vi.mock('@/features/auth/mfa', () => ({
  listFactorState: mfa.listFactorState,
  challenge: mfa.challenge,
}))

function renderPage(from?: string) {
  const entry = from ? { pathname: paths.challengeFactor, state: { from } } : paths.challengeFactor
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path={paths.challengeFactor} element={<ChallengeFactorPage />} />
        <Route path={paths.recoverFactor} element={<p>recovery screen</p>} />
        <Route path={paths.enrollFactor} element={<p>enrolment screen</p>} />
        <Route path={paths.overview} element={<p>overview screen</p>} />
        <Route path="/vehicles" element={<p>vehicles screen</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

async function submitCode(code: string) {
  const user = userEvent.setup()
  await user.type(await screen.findByLabelText(/6-digit code/i), code)
  await user.click(screen.getByRole('button', { name: /^verify$/i }))
  return user
}

beforeEach(() => {
  vi.resetAllMocks()
  mfa.listFactorState.mockResolvedValue({ status: 'verified', factorId: 'factor-1' })
  mfa.challenge.mockResolvedValue(undefined)
})

describe('ChallengeFactorPage', () => {
  it('checks the code against the verified factor', async () => {
    renderPage()

    await submitCode('123456')

    expect(mfa.challenge).toHaveBeenCalledWith('factor-1', '123456')
  })

  it('takes the user to the page they were heading for after a correct code', async () => {
    renderPage('/vehicles')

    await submitCode('123456')

    expect(await screen.findByText('vehicles screen')).toBeVisible()
  })

  it('falls back to the overview when no destination was recorded', async () => {
    renderPage()

    await submitCode('123456')

    expect(await screen.findByText('overview screen')).toBeVisible()
  })

  it('shows an error on a wrong code, stays put, and allows another try', async () => {
    mfa.challenge.mockRejectedValueOnce(new AppError('auth', 'Invalid TOTP code entered'))
    renderPage()
    const user = await submitCode('111111')

    expect(await screen.findByRole('alert')).toHaveTextContent(/not correct/i)
    expect(screen.getByRole('heading', { name: /verify/i })).toBeVisible()

    const input = screen.getByLabelText(/6-digit code/i)
    await user.clear(input)
    await user.type(input, '222222')
    await user.click(screen.getByRole('button', { name: /^verify$/i }))

    expect(await screen.findByText('overview screen')).toBeVisible()
    expect(mfa.challenge).toHaveBeenCalledTimes(2)
  })

  it('tells the user about a connection problem rather than blaming the code', async () => {
    mfa.challenge.mockRejectedValueOnce(new AppError('network', 'Could not reach the server.'))
    renderPage()

    await submitCode('123456')

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not reach the server/i)
  })

  it('offers a visible way out for someone who has lost their device', async () => {
    renderPage('/vehicles')
    const user = userEvent.setup()

    await user.click(await screen.findByRole('link', { name: /lost your device/i }))

    expect(await screen.findByText('recovery screen')).toBeVisible()
  })

  it('sends a user with no working authenticator to set one up', async () => {
    mfa.listFactorState.mockResolvedValue({ status: 'none', factorId: null })
    renderPage()

    expect(await screen.findByText('enrolment screen')).toBeVisible()
  })

  it('lets the user retry when their factor could not be read', async () => {
    mfa.listFactorState.mockRejectedValueOnce(
      new AppError('network', 'Could not reach the server.'),
    )
    renderPage()

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not reach the server/i)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /try again/i }))

    expect(await screen.findByLabelText(/6-digit code/i)).toBeVisible()
  })
})

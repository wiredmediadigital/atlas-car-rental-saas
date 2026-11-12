import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { paths } from '@/app/routes/paths'
import { ToastProvider } from '@/components/ui'
import { SecondFactorContext, type SecondFactorGate } from '@/features/auth/second-factor-context'
import { AppError } from '@/lib/supabase/errors'

import { EnrollFactorPage } from './EnrollFactorPage'

const mfa = vi.hoisted(() => ({
  listFactorState: vi.fn(),
  beginEnrolment: vi.fn(),
  completeEnrolment: vi.fn(),
  generateRecoveryCodes: vi.fn(),
}))

vi.mock('@/features/auth/mfa', () => ({
  listFactorState: mfa.listFactorState,
  beginEnrolment: mfa.beginEnrolment,
  completeEnrolment: mfa.completeEnrolment,
}))
vi.mock('@/features/auth/mfa-recovery', () => ({
  generateRecoveryCodes: mfa.generateRecoveryCodes,
}))

/** The shared answer the guard above the application is holding. */
const refresh = vi.fn()
const gate: SecondFactorGate = {
  state: { status: 'none', factorId: null },
  level: 'aal1',
  isLoading: false,
  refresh: () => {
    refresh()
  },
}

const CODES = Array.from({ length: 10 }, (_, index) => `CODE00000${index}`)
const SECRET = 'JBSWY3DPEHPK3PXP'

function renderPage(from?: string) {
  const entry = from ? { pathname: paths.enrollFactor, state: { from } } : paths.enrollFactor
  return render(
    <SecondFactorContext.Provider value={gate}>
      <ToastProvider>
        <MemoryRouter initialEntries={[entry]}>
          <Routes>
            <Route path={paths.enrollFactor} element={<EnrollFactorPage />} />
            <Route path={paths.challengeFactor} element={<p>challenge screen</p>} />
            <Route path={paths.overview} element={<p>overview screen</p>} />
            <Route path="/rentals" element={<p>rentals screen</p>} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </SecondFactorContext.Provider>,
  )
}

async function enterCode(code: string) {
  const user = userEvent.setup()
  await user.type(await screen.findByLabelText(/6-digit code/i), code)
  await user.click(screen.getByRole('button', { name: /verify and continue/i }))
  return user
}

beforeEach(() => {
  vi.resetAllMocks()
  mfa.listFactorState.mockResolvedValue({ status: 'none', factorId: null })
  mfa.beginEnrolment.mockResolvedValue({
    factorId: 'factor-1',
    qrCodeSvg: 'data:image/svg+xml;utf-8,<svg xmlns="http://www.w3.org/2000/svg"></svg>',
    secret: SECRET,
  })
  mfa.completeEnrolment.mockResolvedValue(undefined)
  mfa.generateRecoveryCodes.mockResolvedValue(CODES)
  refresh.mockReset()
})

describe('EnrollFactorPage scan step', () => {
  it('shows the QR code and the typed-entry key', async () => {
    renderPage()

    expect(await screen.findByRole('img', { name: /qr code/i })).toBeVisible()
    expect(screen.getByText(SECRET)).toBeVisible()
  })

  it('does not show recovery codes before the first code is proved', async () => {
    renderPage()
    await screen.findByRole('img', { name: /qr code/i })

    expect(mfa.generateRecoveryCodes).not.toHaveBeenCalled()
    expect(screen.queryByText(CODES[0]!)).toBeNull()
  })

  it('shows an error and stays on the scan step when the code is wrong', async () => {
    mfa.completeEnrolment.mockRejectedValue(new AppError('auth', 'Invalid TOTP code entered'))
    renderPage()

    await enterCode('123456')

    expect(await screen.findByRole('alert')).toHaveTextContent(/not correct/i)
    expect(screen.getByRole('img', { name: /qr code/i })).toBeVisible()
    expect(mfa.generateRecoveryCodes).not.toHaveBeenCalled()
  })

  it('asks for a six digit code before calling the server', async () => {
    renderPage()

    await enterCode('12')

    expect(await screen.findByText(/enter the 6-digit code/i)).toBeVisible()
    expect(mfa.completeEnrolment).not.toHaveBeenCalled()
  })

  it('accepts the code with the space an authenticator app shows', async () => {
    renderPage()

    await enterCode('123 456')

    expect(mfa.completeEnrolment).toHaveBeenCalledWith('factor-1', '123456')
  })

  it('offers a retry when the QR code could not be created', async () => {
    mfa.beginEnrolment.mockRejectedValueOnce(new AppError('network', 'Could not reach the server.'))
    renderPage()

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not reach the server/i)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /try again/i }))

    expect(await screen.findByRole('img', { name: /qr code/i })).toBeVisible()
  })

  it('sends someone who already has a working authenticator to verify instead of adding a second', async () => {
    mfa.listFactorState.mockResolvedValue({ status: 'verified', factorId: 'factor-0' })
    renderPage()

    expect(await screen.findByText('challenge screen')).toBeVisible()
    expect(mfa.beginEnrolment).not.toHaveBeenCalled()
  })
})

describe('what enrolment tells the rest of the application', () => {
  it('refreshes the shared factor state as soon as the first code is proved', async () => {
    /*
     * Without this the guard above the application is still holding "no factor,
     * aal1" when the user finishes, and sends them straight back here — forever,
     * on the first sign-in of every account.
     */
    renderPage()
    expect(refresh).not.toHaveBeenCalled()

    await enterCode('123456')

    await waitFor(() => expect(refresh).toHaveBeenCalled())
  })
})

describe('EnrollFactorPage recovery codes step', () => {
  it('shows all ten codes only after the code is accepted, and says they are shown once', async () => {
    renderPage()

    await enterCode('123456')

    expect(await screen.findByRole('heading', { name: /save your recovery codes/i })).toBeVisible()
    expect(screen.getAllByRole('listitem')).toHaveLength(10)
    expect(screen.getByRole('list', { name: 'Recovery codes' })).toBeVisible()
    expect(screen.getByText(/do not leave this page until you have saved them/i)).toBeVisible()
    for (const code of CODES) expect(screen.getByText(code)).toBeVisible()
    expect(screen.getByText(/shown only once/i)).toBeVisible()
    expect(screen.getByText(/cannot be shown again/i)).toBeVisible()
    expect(mfa.completeEnrolment.mock.invocationCallOrder[0]).toBeLessThan(
      mfa.generateRecoveryCodes.mock.invocationCallOrder[0]!,
    )
  })

  it('will not continue until the user acknowledges they have saved the codes', async () => {
    renderPage()
    const user = await enterCode('123456')

    const continueButton = await screen.findByRole('button', { name: /^continue$/i })
    expect(continueButton).toBeDisabled()

    await user.click(screen.getByRole('checkbox', { name: /i have saved these recovery codes/i }))
    expect(continueButton).toBeEnabled()
  })

  it('goes to the page the user was heading for once acknowledged, and the codes are gone', async () => {
    renderPage('/rentals')
    const user = await enterCode('123456')
    await user.click(await screen.findByRole('checkbox', { name: /i have saved/i }))
    await user.click(screen.getByRole('button', { name: /^continue$/i }))

    expect(await screen.findByText('rentals screen')).toBeVisible()
    expect(screen.queryByText(CODES[0]!)).toBeNull()
  })

  it('falls back to the overview when no destination was recorded', async () => {
    renderPage()
    const user = await enterCode('123456')
    await user.click(await screen.findByRole('checkbox', { name: /i have saved/i }))
    await user.click(screen.getByRole('button', { name: /^continue$/i }))

    expect(await screen.findByText('overview screen')).toBeVisible()
  })

  it('asks again for the codes, not for another authenticator code, if minting them failed', async () => {
    mfa.generateRecoveryCodes
      .mockRejectedValueOnce(new AppError('network', 'Could not reach the server.'))
      .mockResolvedValueOnce(CODES)
    renderPage()
    const user = await enterCode('123456')

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/authenticator is set up/i)
    expect(alert).toHaveTextContent(/do not close or reload this page until you have your codes/i)
    await user.click(screen.getByRole('button', { name: /get my recovery codes/i }))

    expect(await screen.findByText(CODES[0]!)).toBeVisible()
    expect(mfa.completeEnrolment).toHaveBeenCalledTimes(1)
  })

  it('copies the codes when asked', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    renderPage()
    await user.type(await screen.findByLabelText(/6-digit code/i), '123456')
    await user.click(screen.getByRole('button', { name: /verify and continue/i }))
    await user.click(await screen.findByRole('button', { name: /copy codes/i }))

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(CODES.join('\n')))
  })

  it('never writes a recovery code to the console', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => undefined),
    )
    renderPage()
    await enterCode('123456')
    await screen.findByText(CODES[0]!)

    for (const spy of spies) {
      expect(JSON.stringify(spy.mock.calls)).not.toContain(CODES[0])
      spy.mockRestore()
    }
  })
})

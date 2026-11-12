import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { paths } from '@/app/routes/paths'
import { ToastProvider } from '@/components/ui'
import type * as MfaRecovery from '@/features/auth/mfa-recovery'
import { FactorResetError, type ResetFailureReason } from '@/features/auth/mfa-recovery'

import { RecoverFactorPage } from './RecoverFactorPage'

const recovery = vi.hoisted(() => ({ resetOwnFactor: vi.fn() }))

vi.mock('@/features/auth/mfa-recovery', async (importOriginal) => ({
  ...(await importOriginal<typeof MfaRecovery>()),
  resetOwnFactor: recovery.resetOwnFactor,
}))

function renderPage() {
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={[paths.recoverFactor]}>
        <Routes>
          <Route path={paths.recoverFactor} element={<RecoverFactorPage />} />
          <Route path={paths.enrollFactor} element={<p>enrolment screen</p>} />
          <Route path={paths.challengeFactor} element={<p>challenge screen</p>} />
        </Routes>
      </MemoryRouter>
    </ToastProvider>,
  )
}

async function submitCode(code: string) {
  const user = userEvent.setup()
  await user.type(screen.getByLabelText(/recovery code/i), code)
  await user.click(screen.getByRole('button', { name: /remove my authenticator/i }))
  return user
}

function refusedWith(reason: ResetFailureReason) {
  recovery.resetOwnFactor.mockRejectedValue(new FactorResetError(reason))
}

beforeEach(() => {
  vi.resetAllMocks()
  recovery.resetOwnFactor.mockResolvedValue(undefined)
})

describe('RecoverFactorPage', () => {
  it('says before submitting that a code removes the authenticator and does not sign the user in', () => {
    renderPage()

    expect(screen.getByText(/removes the authenticator on your account/i)).toBeVisible()
    expect(screen.getByText(/does not sign you in/i)).toBeVisible()
    expect(screen.getByText(/old authenticator will stop working/i)).toBeVisible()
    expect(screen.getByText(/set up a new authenticator/i)).toBeVisible()
  })

  it('submits the recovery code in self mode, tidied of spaces, hyphens and case', async () => {
    renderPage()

    await submitCode('abcde-fghjk ')

    expect(recovery.resetOwnFactor).toHaveBeenCalledWith('ABCDEFGHJK')
  })

  it('reads a hand-copied O, I or L as the zero or one the codes use', async () => {
    renderPage()

    await submitCode('OIl0OIl0OI')

    expect(recovery.resetOwnFactor).toHaveBeenCalledWith('0110011001')
  })

  it('sends the user to set up a new authenticator when the code is accepted', async () => {
    renderPage()

    await submitCode('ABCDEFGHJK')

    expect(await screen.findByText('enrolment screen')).toBeVisible()
  })

  it('does not call the server for something that cannot be a recovery code', async () => {
    renderPage()

    await submitCode('abc')

    expect(await screen.findByText(/10-character recovery code/i)).toBeVisible()
    expect(recovery.resetOwnFactor).not.toHaveBeenCalled()
  })

  it('shows an error and does not navigate when the code is rejected', async () => {
    refusedWith('invalid_code')
    renderPage()

    await submitCode('ABCDEFGHJK')

    expect(await screen.findByRole('alert')).toHaveTextContent(/was not accepted/i)
    expect(screen.queryByText('enrolment screen')).toBeNull()
    expect(screen.getByRole('button', { name: /remove my authenticator/i })).toBeEnabled()
  })

  it('explains a refusal that is not about the code', async () => {
    refusedWith('not_permitted')
    renderPage()

    await submitCode('ABCDEFGHJK')

    expect(await screen.findByRole('alert')).toHaveTextContent(/sign in again/i)
    expect(screen.queryByText('enrolment screen')).toBeNull()
  })

  it('points a user with no authenticator at set-up', async () => {
    refusedWith('no_factor')
    renderPage()

    await submitCode('ABCDEFGHJK')

    expect(await screen.findByRole('alert')).toHaveTextContent(/no authenticator/i)
    expect(screen.getByRole('link', { name: /set up an authenticator/i })).toHaveAttribute(
      'href',
      paths.enrollFactor,
    )
  })

  it('reports an unreachable service without blaming the code', async () => {
    refusedWith('unavailable')
    renderPage()

    await submitCode('ABCDEFGHJK')

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/could not be completed/i)
    expect(alert).not.toHaveTextContent(/was not accepted/i)
  })

  it('lets someone who found their device go back to verification', async () => {
    renderPage()
    const user = userEvent.setup()

    await user.click(screen.getByRole('link', { name: /back to verification/i }))

    expect(await screen.findByText('challenge screen')).toBeVisible()
  })

  it('never writes the recovery code to the console', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => undefined),
    )
    refusedWith('invalid_code')
    renderPage()
    await submitCode('ABCDEFGHJK')
    await screen.findByRole('alert')

    for (const spy of spies) {
      expect(JSON.stringify(spy.mock.calls)).not.toContain('ABCDEFGHJK')
      spy.mockRestore()
    }
  })
})

import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useLocation, useNavigate } from 'react-router-dom'

import { paths } from '@/app/routes/paths'
import { FullPageLoader } from '@/components/feedback/FullPageLoader'
import { Alert, Button, Field, Input } from '@/components/ui'
import { AuthLayout } from '@/features/auth/components/AuthLayout'
import {
  type EnrolmentStart,
  beginEnrolment,
  completeEnrolment,
  listFactorState,
} from '@/features/auth/mfa'
import { verificationErrorMessage } from '@/features/auth/mfa-messages'
import { generateRecoveryCodes } from '@/features/auth/mfa-recovery'
import { type TotpCodeInput, totpCodeSchema } from '@/features/auth/schemas'
import { toErrorMessage } from '@/lib/supabase/errors'

type Phase =
  | { readonly kind: 'preparing' }
  | { readonly kind: 'prepare-failed'; readonly message: string }
  | { readonly kind: 'scan'; readonly start: EnrolmentStart }
  | { readonly kind: 'codes-failed'; readonly message: string }
  | { readonly kind: 'codes'; readonly codes: readonly string[] }

interface LocationState {
  from?: string
}

/**
 * Sets up an authenticator app, then shows the recovery codes.
 *
 * The recovery codes live only in this component's state. They are not written
 * to the URL, to storage, to a log or to the router, because the database cannot
 * return them a second time: leaving the page is the end of them, and the page
 * says so.
 */
export function EnrollFactorPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const routeState: unknown = location.state
  const state = routeState as LocationState | null

  const [phase, setPhase] = useState<Phase>({ kind: 'preparing' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let active = true
    prepareEnrolment()
      .then((start) => {
        if (!active) return
        if (start === null) {
          // Adding a second authenticator beside a working one would only
          // leave the account with two to lose.
          void navigate(paths.challengeFactor, { replace: true, state: routeState })
          return
        }
        setPhase({ kind: 'scan', start })
      })
      .catch((error: unknown) => {
        if (active) setPhase({ kind: 'prepare-failed', message: toErrorMessage(error) })
      })

    return () => {
      active = false
    }
  }, [attempt, navigate, routeState])

  const retryPrepare = () => {
    setPhase({ kind: 'preparing' })
    setAttempt((count) => count + 1)
  }

  const loadCodes = async () => {
    try {
      setPhase({ kind: 'codes', codes: await generateRecoveryCodes() })
    } catch (error) {
      setPhase({ kind: 'codes-failed', message: toErrorMessage(error) })
    }
  }

  const finish = () => {
    void navigate(state?.from ?? paths.overview, { replace: true })
  }

  switch (phase.kind) {
    case 'preparing':
      return <FullPageLoader label="Preparing two-factor set-up" />
    case 'prepare-failed':
      return (
        <AuthLayout
          title="Set up two-factor authentication"
          description="We could not start the set-up."
        >
          <Alert tone="critical">{phase.message}</Alert>
          <Button variant="primary" size="lg" fullWidth className="mt-4" onClick={retryPrepare}>
            Try again
          </Button>
        </AuthLayout>
      )
    case 'scan':
      return <ScanStep start={phase.start} onVerified={loadCodes} />
    case 'codes-failed':
      return (
        <AuthLayout
          title="Save your recovery codes"
          description="Your authenticator is set up. One step is left."
        >
          <Alert tone="critical">
            Your authenticator is set up, but we could not create your recovery codes.{' '}
            {phase.message} Do not close or reload this page until you have your codes: if you leave
            now, you will have no recovery codes and nothing to fall back on if you lose your phone.
          </Alert>
          <Button
            variant="primary"
            size="lg"
            fullWidth
            className="mt-4"
            onClick={() => void loadCodes()}
          >
            Get my recovery codes
          </Button>
        </AuthLayout>
      )
    case 'codes':
      return <CodesStep codes={phase.codes} onDone={finish} />
  }
}

/** Clears any abandoned attempt and starts a fresh one, unless the user is already protected. */
async function prepareEnrolment(): Promise<EnrolmentStart | null> {
  const current = await listFactorState()
  if (current.status === 'verified') return null
  return beginEnrolment()
}

interface ScanStepProps {
  start: EnrolmentStart
  onVerified: () => Promise<void>
}

function ScanStep({ start, onVerified }: ScanStepProps) {
  const [formError, setFormError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<TotpCodeInput>({
    resolver: zodResolver(totpCodeSchema),
    defaultValues: { code: '' },
  })

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null)
    try {
      await completeEnrolment(start.factorId, values.code)
    } catch (error) {
      setFormError(verificationErrorMessage(error))
      return
    }
    // Only now: minting codes needs the second-factor session this just created.
    await onVerified()
  })

  return (
    <AuthLayout
      title="Set up two-factor authentication"
      description="Every account needs it. Use an authenticator app such as Google Authenticator, Microsoft Authenticator, 1Password or Authy."
    >
      <div className="space-y-4">
        <div className="flex justify-center">
          <img
            src={start.qrCodeSvg}
            alt="QR code to scan with your authenticator app"
            width={176}
            height={176}
            className="border-line rounded-lg border bg-white p-2"
          />
        </div>

        <div className="space-y-1">
          <p className="text-ink-muted text-[0.8125rem] leading-5">
            Scan the picture with your app. If you cannot scan it, add an account by hand and use
            this key:
          </p>
          <code className="bg-surface-inset block rounded-md px-3 py-2 text-center font-mono text-[0.8125rem] tracking-wider break-all select-all">
            {start.secret}
          </code>
        </div>

        <form onSubmit={(event) => void onSubmit(event)} className="space-y-4" noValidate>
          {formError ? <Alert tone="critical">{formError}</Alert> : null}

          <Field
            label="6-digit code"
            error={errors.code?.message}
            hint="Shown in your app once the account is added."
            required
          >
            <Input
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              placeholder="123456"
              {...register('code')}
            />
          </Field>

          <Button type="submit" variant="primary" size="lg" fullWidth isLoading={isSubmitting}>
            Verify and continue
          </Button>
        </form>
      </div>
    </AuthLayout>
  )
}

interface CodesStepProps {
  codes: readonly string[]
  onDone: () => void
}

function CodesStep({ codes, onDone }: CodesStepProps) {
  const [hasSaved, setHasSaved] = useState(false)
  const [copyResult, setCopyResult] = useState<'idle' | 'copied' | 'failed'>('idle')

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(codes.join('\n'))
      setCopyResult('copied')
    } catch {
      setCopyResult('failed')
    }
  }

  return (
    <AuthLayout title="Save your recovery codes" description="These codes are shown only once.">
      <div className="space-y-4">
        <Alert tone="caution" title="Save them before you go on">
          If you lose your phone, these are the only way back into your account. Each one works a
          single time. Recovery codes cannot be shown again once you leave this page, so keep them
          somewhere safe that is not on that phone, such as a password manager or a printout. Do not
          leave this page until you have saved them.
        </Alert>

        <ul
          aria-label="Recovery codes"
          className="bg-surface-inset grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-lg px-4 py-3 font-mono text-[0.875rem] tracking-wider"
        >
          {codes.map((code) => (
            <li key={code}>{code}</li>
          ))}
        </ul>

        <div className="flex items-center gap-3">
          <Button variant="secondary" size="sm" onClick={() => void copy()}>
            Copy codes
          </Button>
          <p className="text-ink-muted text-[0.8125rem]" role="status">
            {copyResult === 'copied' ? 'Copied.' : null}
            {copyResult === 'failed'
              ? 'Could not copy. Select the codes and copy them by hand.'
              : null}
          </p>
        </div>

        <label className="flex items-start gap-2.5 text-[0.875rem] leading-5">
          <input
            type="checkbox"
            checked={hasSaved}
            onChange={(event) => setHasSaved(event.target.checked)}
            className="mt-0.5 size-4"
          />
          <span>I have saved these recovery codes somewhere safe</span>
        </label>

        <Button variant="primary" size="lg" fullWidth disabled={!hasSaved} onClick={onDone}>
          Continue
        </Button>
      </div>
    </AuthLayout>
  )
}

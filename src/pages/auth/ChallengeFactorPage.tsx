import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link, useLocation, useNavigate } from 'react-router-dom'

import { paths } from '@/app/routes/paths'
import { FullPageLoader } from '@/components/feedback/FullPageLoader'
import { Alert, Button, Field, Input } from '@/components/ui'
import { AuthLayout } from '@/features/auth/components/AuthLayout'
import { challenge, listFactorState } from '@/features/auth/mfa'
import { verificationErrorMessage } from '@/features/auth/mfa-messages'
import { type TotpCodeInput, totpCodeSchema } from '@/features/auth/schemas'
import { toErrorMessage } from '@/lib/supabase/errors'

type Phase =
  | { readonly kind: 'loading' }
  | { readonly kind: 'failed'; readonly message: string }
  | { readonly kind: 'ready'; readonly factorId: string }

interface LocationState {
  from?: string
}

/**
 * The second step of signing in: the current code from the authenticator app.
 *
 * Whoever lands here has passed their password but not yet a second factor, so
 * the way out for a lost device sits on the screen rather than behind a menu.
 */
export function ChallengeFactorPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const routeState: unknown = location.state
  const state = routeState as LocationState | null

  const [phase, setPhase] = useState<Phase>({ kind: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const [formError, setFormError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<TotpCodeInput>({
    resolver: zodResolver(totpCodeSchema),
    defaultValues: { code: '' },
  })

  useEffect(() => {
    let active = true
    listFactorState()
      .then((factor) => {
        if (!active) return
        if (factor.status === 'verified' && factor.factorId !== null) {
          setPhase({ kind: 'ready', factorId: factor.factorId })
          return
        }
        // Nothing to verify against: an unfinished enrolment is not a factor.
        void navigate(paths.enrollFactor, { replace: true, state: routeState })
      })
      .catch((error: unknown) => {
        if (active) setPhase({ kind: 'failed', message: toErrorMessage(error) })
      })

    return () => {
      active = false
    }
  }, [attempt, navigate, routeState])

  const retry = () => {
    setPhase({ kind: 'loading' })
    setAttempt((count) => count + 1)
  }

  const onSubmit = handleSubmit(async (values) => {
    if (phase.kind !== 'ready') return
    setFormError(null)
    try {
      await challenge(phase.factorId, values.code)
    } catch (error) {
      setFormError(verificationErrorMessage(error))
      return
    }
    // Return the user to wherever they were headed before the redirect.
    void navigate(state?.from ?? paths.overview, { replace: true })
  })

  if (phase.kind === 'loading') {
    return <FullPageLoader label="Checking your sign-in" />
  }

  if (phase.kind === 'failed') {
    return (
      <AuthLayout
        title="Verify your sign-in"
        description="We could not check how your account is protected."
      >
        <Alert tone="critical">{phase.message}</Alert>
        <Button variant="primary" size="lg" fullWidth className="mt-4" onClick={retry}>
          Try again
        </Button>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout
      title="Verify your sign-in"
      description="Open your authenticator app and type the code it is showing now."
      footer={
        <Link
          to={paths.recoverFactor}
          state={routeState}
          className="text-brand-700 font-medium hover:underline"
        >
          Lost your device? Use a recovery code
        </Link>
      }
    >
      <form onSubmit={(event) => void onSubmit(event)} className="space-y-4" noValidate>
        {formError ? <Alert tone="critical">{formError}</Alert> : null}

        <Field label="6-digit code" error={errors.code?.message} required>
          <Input
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            placeholder="123456"
            {...register('code')}
          />
        </Field>

        <Button type="submit" variant="primary" size="lg" fullWidth isLoading={isSubmitting}>
          Verify
        </Button>
      </form>
    </AuthLayout>
  )
}

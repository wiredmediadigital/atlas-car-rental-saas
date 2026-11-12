import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link, useLocation, useNavigate } from 'react-router-dom'

import { paths } from '@/app/routes/paths'
import { Alert, Button, Field, Input, useToast } from '@/components/ui'
import { AuthLayout } from '@/features/auth/components/AuthLayout'
import { SignOutLink } from '@/features/auth/components/SignOutLink'
import {
  FactorResetError,
  type ResetFailureReason,
  resetOwnFactor,
} from '@/features/auth/mfa-recovery'
import { type RecoveryCodeInput, recoveryCodeSchema } from '@/features/auth/schemas'

const FAILURE_MESSAGES: Record<ResetFailureReason, string> = {
  invalid_code:
    'That recovery code was not accepted. Check it and try again. Each recovery code works only once.',
  not_permitted:
    'This request was refused for your current session. Sign in again, then try once more.',
  no_factor: 'Your account has no authenticator to remove.',
  // Both say the same thing about the code: the server spends it before it
  // removes the authenticator, so after a failure it may no longer work, and
  // telling the user to retry the same one sends them to a guaranteed refusal.
  unavailable:
    'The reset could not be completed. That recovery code may already have been used, so try a different recovery code.',
  unreachable:
    'We could not reach the server. Check your connection and try again. If it keeps failing, that recovery code may already have been used, so try a different recovery code.',
}

function failureReason(error: unknown): ResetFailureReason {
  return error instanceof FactorResetError ? error.reason : 'unavailable'
}

/**
 * For someone who has lost their authenticator and is spending a recovery code.
 *
 * The code does not sign anybody in. It removes the authenticator, after which
 * the user sets up a new one, so the page says that before the button is
 * pressed: someone who expects to be let in will otherwise read the next screen
 * as the product being broken.
 */
export function RecoverFactorPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const routeState: unknown = location.state
  const toast = useToast()
  const [failure, setFailure] = useState<ResetFailureReason | null>(null)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RecoveryCodeInput>({
    resolver: zodResolver(recoveryCodeSchema),
    defaultValues: { code: '' },
  })

  const onSubmit = handleSubmit(async (values) => {
    setFailure(null)
    try {
      await resetOwnFactor(values.code)
    } catch (error) {
      setFailure(failureReason(error))
      return
    }
    toast.success('Authenticator removed', 'Set up a new one now to get back into your account.')
    // Keep where they were headed: the new authenticator leads there too.
    void navigate(paths.enrollFactor, { replace: true, state: routeState })
  })

  return (
    <AuthLayout
      title="Lost your device?"
      description="Use one of your recovery codes to start again with a new authenticator."
      footer={
        <div className="space-y-1">
          <p>
            <Link
              to={paths.challengeFactor}
              state={routeState}
              className="text-brand-700 font-medium hover:underline"
            >
              Found your device? Back to verification
            </Link>
          </p>
          <p>
            <SignOutLink />
          </p>
        </div>
      }
    >
      <Alert tone="caution" title="Read this before you continue">
        <p>
          Using a recovery code removes the authenticator on your account. It does not sign you in.
        </p>
        <p className="mt-1">
          Your old authenticator will stop working straight away. Next you will set up a new
          authenticator and get a new set of recovery codes. Any codes you have left will stop
          working.
        </p>
      </Alert>

      <form onSubmit={(event) => void onSubmit(event)} className="mt-4 space-y-4" noValidate>
        {failure ? (
          <Alert tone="critical">
            {FAILURE_MESSAGES[failure]}
            {failure === 'no_factor' ? (
              <>
                {' '}
                <Link to={paths.enrollFactor} state={routeState} className="font-medium underline">
                  Set up an authenticator
                </Link>
              </>
            ) : null}
          </Alert>
        ) : null}

        <Field
          label="Recovery code"
          error={errors.code?.message}
          hint="Ten characters. Spaces and capital letters do not matter."
          required
        >
          <Input
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            autoFocus
            {...register('code')}
          />
        </Field>

        <Button type="submit" variant="primary" size="lg" fullWidth isLoading={isSubmitting}>
          Remove my authenticator
        </Button>
      </form>
    </AuthLayout>
  )
}

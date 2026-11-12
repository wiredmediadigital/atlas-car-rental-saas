import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { paths } from '@/app/routes/paths'
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  ConfirmDialog,
  Dialog,
  DialogContent,
} from '@/components/ui'
import { removeFactor } from '@/features/auth/mfa'
import { generateRecoveryCodes } from '@/features/auth/mfa-recovery'
import { useSecondFactorGate } from '@/features/auth/second-factor-context'
import { toErrorMessage } from '@/lib/supabase/errors'

/**
 * The person's own two-factor authentication.
 *
 * Two controls, and the second matters more than its size suggests. Enrolment
 * shows the recovery codes exactly once; somebody who clicked past that screen
 * has no way back into their account if they lose their phone, and this is the
 * only place that gives them one. It is deliberately not hidden behind the
 * replace control, which would cost them their authenticator to fix a missing
 * piece of paper.
 *
 * Nothing here is a security boundary. Both actions need the aal2 session that
 * reaching this page already proves, and both are decided again by the auth
 * server and the database.
 */
export function SecurityCard() {
  const navigate = useNavigate()
  const { state, refresh } = useSecondFactorGate()

  const [isReplaceOpen, setIsReplaceOpen] = useState(false)
  const [isCodesOpen, setIsCodesOpen] = useState(false)
  const [codes, setCodes] = useState<readonly string[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const factorId = state?.factorId ?? null
  const isEnrolled = state?.status === 'verified'

  const replace = useMutation({
    mutationFn: (id: string) => removeFactor(id),
    onSuccess: () => {
      setIsReplaceOpen(false)
      // Order matters only in that both must happen: the guard above this page
      // is holding "verified", and would otherwise let the user wander an
      // application their account no longer has a second factor for.
      void navigate(paths.enrollFactor, { state: { from: paths.settings } })
      refresh()
    },
    onError: (cause: unknown) => setError(toErrorMessage(cause)),
  })

  const mint = useMutation({
    mutationFn: () => generateRecoveryCodes(),
    onSuccess: (fresh) => {
      setError(null)
      setCodes(fresh)
    },
    onError: (cause: unknown) => setError(toErrorMessage(cause)),
  })

  const openCodes = () => {
    setError(null)
    setCodes(null)
    setIsCodesOpen(true)
  }

  const closeCodes = () => {
    setIsCodesOpen(false)
    // The plaintext exists nowhere else, and it is not going to sit in a
    // mutation cache after the dialog has said "shown only once".
    setCodes(null)
    mint.reset()
  }

  return (
    <Card>
      <CardHeader
        title="Two-factor authentication"
        description="Required on every account. This is yours alone, not the agency's."
      />
      <CardBody className="space-y-4">
        {error && !isCodesOpen && !isReplaceOpen ? <Alert tone="critical">{error}</Alert> : null}

        <p className="text-[0.8125rem] leading-5">
          {isEnrolled
            ? 'Your account is protected by an authenticator app.'
            : 'Your account has no working authenticator yet.'}
        </p>

        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            size="sm"
            disabled={!isEnrolled}
            onClick={() => {
              setError(null)
              setIsReplaceOpen(true)
            }}
          >
            Replace authenticator
          </Button>
          <Button variant="secondary" size="sm" onClick={openCodes}>
            Generate new recovery codes
          </Button>
        </div>

        <p className="text-ink-muted text-[0.75rem] leading-4">
          Generate new codes if you no longer have the ones you were given, or if you think somebody
          else has seen them.
        </p>
      </CardBody>

      <ConfirmDialog
        open={isReplaceOpen}
        onOpenChange={(open) => !open && setIsReplaceOpen(false)}
        title="Replace your authenticator?"
        confirmLabel="Remove it and set up a new one"
        tone="danger"
        isPending={replace.isPending}
        onConfirm={() => {
          if (factorId !== null) replace.mutate(factorId)
        }}
      >
        <div className="space-y-3 text-[0.8125rem] leading-5">
          {error ? <Alert tone="critical">{error}</Alert> : null}
          <p>
            Your current authenticator stops working straight away, and you set up the new one on
            the next screen.
          </p>
          <p>
            Until you have, your account has no second factor and you will not be able to reach
            anything else here. You will be given a new set of recovery codes; the ones you have now
            stop working.
          </p>
        </div>
      </ConfirmDialog>

      <Dialog open={isCodesOpen} onOpenChange={(open) => !open && closeCodes()}>
        <DialogContent
          title="New recovery codes"
          size="sm"
          footer={
            codes ? (
              <Button variant="primary" onClick={closeCodes}>
                Done
              </Button>
            ) : (
              <>
                <Button variant="ghost" onClick={closeCodes} disabled={mint.isPending}>
                  Cancel
                </Button>
                <Button variant="primary" onClick={() => mint.mutate()} isLoading={mint.isPending}>
                  Generate new codes
                </Button>
              </>
            )
          }
        >
          <div className="space-y-3 text-[0.8125rem] leading-5">
            {error ? <Alert tone="critical">{error}</Alert> : null}

            {codes ? (
              <>
                <Alert tone="caution" title="Save them before you close this">
                  These codes are shown only once and cannot be shown again. Keep them somewhere
                  that is not the phone your authenticator is on.
                </Alert>
                <ul
                  aria-label="Recovery codes"
                  className="bg-surface-inset grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-lg px-4 py-3 font-mono text-[0.875rem] tracking-wider"
                >
                  {codes.map((code) => (
                    <li key={code}>{code}</li>
                  ))}
                </ul>
              </>
            ) : (
              <p>
                Ten new codes, each usable once. Any recovery codes you still have stop working the
                moment these are created, and your authenticator app is not affected.
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  )
}

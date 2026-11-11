import { useState } from 'react'

import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  ConfirmDialog,
  Field,
  Input,
  useToast,
} from '@/components/ui'
import { useWorkspace } from '@/features/workspace/workspace-context'
import { hasMinRole } from '@/lib/authz/permissions'
import { toErrorMessage } from '@/lib/supabase/errors'
import type { Organization } from '@/types/database'

import {
  CLOSURE_WINDOW_DAYS,
  canRequestClosure,
  canRestoreAgency,
  formatPurgeDate,
} from '../closure'
import { useClosureState, useRequestClosure } from '../queries'

import { RestoreAgencyButton } from './RestoreAgencyButton'
import { SupportLink } from './SupportLink'

/**
 * Closing the agency, and taking it back.
 *
 * WHO SEES WHAT. The card is for owners and administrators; everyone else sees
 * nothing, because nothing here is theirs to do. Within it the asymmetry is the
 * point: only an owner is offered the close control, an administrator is offered
 * restore. That is the mitigation for a compromised single-owner account, and
 * the database enforces it either way. This component's job is only to not show
 * somebody a button that will refuse them.
 *
 * THERE IS NO "DELETE NOW". The window is thirty days and no parameter shortens
 * it. Anyone who needs the data gone sooner is told to ask, in words, because a
 * control that did it would be the most dangerous button in the product.
 */
export function CloseAccountCard() {
  const { organization, role } = useWorkspace()
  const { state } = useClosureState()

  if (!organization || !hasMinRole(role, 'admin')) return null

  return (
    <Card>
      <CardHeader
        title="Close this agency"
        description="Stop using the agency and have its data deleted."
      />
      <CardBody className="space-y-4">
        {state === 'open' ? (
          canRequestClosure(role, state) ? (
            <CloseControl organization={organization} />
          ) : (
            <p className="text-ink-muted text-[0.8125rem] leading-5">
              Only an owner can close this agency. An owner or administrator can restore it
              afterwards, until its data is deleted.
            </p>
          )
        ) : (
          <ClosingStatus organization={organization} canRestore={canRestoreAgency(role, state)} />
        )}
      </CardBody>
    </Card>
  )
}

function ClosingStatus({
  organization,
  canRestore,
}: {
  organization: Organization
  canRestore: boolean
}) {
  const { state } = useClosureState()
  const purgeDate = formatPurgeDate(organization)

  if (state === 'closed') {
    return <p className="text-[0.8125rem] leading-5">This agency has been closed.</p>
  }
  if (state === 'purging') {
    return (
      <p className="text-[0.8125rem] leading-5">
        This agency&rsquo;s data is being deleted. It can no longer be restored.
      </p>
    )
  }

  return (
    <>
      <p className="text-[0.8125rem] leading-5">
        Closure has been requested. The agency is read-only
        {purgeDate ? ` and its data will be permanently deleted on or after ${purgeDate}.` : '.'}
      </p>
      <p className="text-ink-muted text-[0.8125rem] leading-5">
        {/*
          What restoring actually does, rather than "everything is as it was".
          The write gate needs billing unrestricted AND closure open, and
          cancelling the subscription is a manual step we take when we process
          the request -- so a restore after that brings the records back and
          leaves the agency read-only until the subscription is started again.
        */}
        Restoring makes the agency writable again if its subscription is still active. If it has
        already been cancelled, your records come back but the agency stays read-only until the
        subscription is started again from Billing.
      </p>
      <p className="text-ink-muted text-[0.8125rem] leading-5">
        If the data has to be gone sooner, ask us at <SupportLink />. There is deliberately no
        button for it.
      </p>
      {canRestore ? (
        <div className="flex flex-wrap gap-2">
          <RestoreAgencyButton organizationId={organization.id} />
        </div>
      ) : null}
    </>
  )
}

function CloseControl({ organization }: { organization: Organization }) {
  const toast = useToast()
  const { memberships } = useWorkspace()
  const request = useRequestClosure()
  const [isOpen, setIsOpen] = useState(false)
  const [typedName, setTypedName] = useState('')

  const isOnlyAgency = memberships.length <= 1

  function handleOpenChange(open: boolean) {
    setIsOpen(open)
    if (!open) {
      setTypedName('')
      request.reset()
    }
  }

  function handleConfirm() {
    request.mutate(organization.id, {
      onSuccess: () => {
        setIsOpen(false)
        setTypedName('')
        toast.success('Closure requested', 'The agency is now read-only.')
      },
    })
  }

  return (
    <>
      <p className="text-ink-muted text-[0.8125rem] leading-5">
        Closing suspends the agency straight away and deletes its data after {CLOSURE_WINDOW_DAYS}{' '}
        days. Until then an owner or administrator can restore it.
      </p>
      <div>
        <Button variant="danger" onClick={() => setIsOpen(true)}>
          Close this agency&hellip;
        </Button>
      </div>

      <ConfirmDialog
        open={isOpen}
        onOpenChange={handleOpenChange}
        title={`Close ${organization.name}?`}
        description="Closing starts a countdown that ends in permanent deletion."
        confirmLabel="Request closure"
        isPending={request.isPending}
        isConfirmDisabled={typedName !== organization.name}
        onConfirm={handleConfirm}
      >
        <div className="space-y-4 text-[0.8125rem] leading-5">
          <ul className="list-disc space-y-2 ps-5">
            <li>
              The agency becomes read-only immediately. Nothing new can be recorded, but everything
              already here can still be opened and exported.
            </li>
            <li>
              In {CLOSURE_WINDOW_DAYS} days from now, everything is permanently deleted: customers,
              rentals, contracts, vehicles, documents and photos, expenses, financing and the team.
              This cannot be undone.
            </li>
            <li>
              Before then, an owner or administrator can restore the agency from Settings. Restoring
              makes it writable again if its subscription is still active; if it has been cancelled
              in the meantime, it has to be started again from Billing.
            </li>
            <li>
              {/*
                Minor 10. The Terms say this; the moment of decision did not,
                and that is where the belief forms. Cancelling is a deliberate
                manual operator step, not something closing does by itself.
              */}
              The subscription is not cancelled by closing. We cancel it when we process the
              request, which is a manual step, so it keeps billing until then and anything charged
              before it is not refunded.
            </li>
            <li>
              If the data must be gone sooner, ask us at <SupportLink />. There is deliberately no
              button for it.
            </li>
          </ul>

          <Alert tone="critical" title="Your own login is affected too">
            <p>
              {isOnlyAgency
                ? 'This is the only agency on your account, so your own login will be removed when the data is deleted, and you will no longer be able to sign in.'
                : 'If this is the last agency you belong to, your own login will be removed when the data is deleted, and you will no longer be able to sign in.'}
            </p>
            <p className="mt-1">
              Team members who belong to no other agency lose their logins too.
            </p>
          </Alert>

          <Field
            label="Type the agency name to confirm"
            hint={
              <>
                Type <strong>{organization.name}</strong> exactly, including capital letters.
              </>
            }
          >
            <Input
              value={typedName}
              onChange={(event) => setTypedName(event.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </Field>

          {request.isError ? (
            <p role="alert" className="text-critical-700">
              {toErrorMessage(request.error)}
            </p>
          ) : null}
        </div>
      </ConfirmDialog>
    </>
  )
}

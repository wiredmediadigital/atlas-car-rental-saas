import { Link } from 'react-router-dom'

import { paths } from '@/app/routes/paths'
import { Alert } from '@/components/ui'
import { useOrganization, useWorkspace } from '@/features/workspace/workspace-context'
import { can } from '@/lib/authz/permissions'

import { CLOSURE_WINDOW_DAYS, canRestoreAgency, formatPurgeDate } from '../closure'
import { useClosureState } from '../queries'

import { RestoreAgencyButton } from './RestoreAgencyButton'
import { SupportLink } from './SupportLink'

/**
 * What every member sees, on every page, while the agency is closing.
 *
 * WHY IT IS ON EVERY PAGE. An agency that does not realise it is suspended
 * thinks the product is broken: a blocked write says "row-level security" or
 * "record not found", neither of which is true in any way a person can act on.
 * So the state is described here, once, above whatever page they are on.
 *
 * WHY IT IS NOT DISMISSIBLE. It describes a state, not an event.
 *
 * WHO IT NAMES. The people who can undo this are the owners and administrators,
 * so that is who a manager or a member of staff is told to ask. Only they get the
 * restore button; the database refuses everyone else.
 *
 * Mounted in the shell, where there may be no agency at all, so it reads the
 * workspace directly and renders nothing without one.
 */
export function ClosureBanner() {
  const { organization, role } = useWorkspace()
  const { state } = useClosureState()

  if (!organization || state === 'open') return null

  if (state === 'closed') {
    return (
      <Alert tone="critical" title="This agency has been closed" className="mb-6">
        Its data has been deleted and cannot be recovered.
      </Alert>
    )
  }

  if (state === 'purging') {
    return (
      <Alert tone="critical" title="This agency is being deleted" className="mb-6">
        The {CLOSURE_WINDOW_DAYS}-day window has ended and the deletion has started. It can no
        longer be restored. Questions? Email <SupportLink />.
      </Alert>
    )
  }

  return (
    <SuspendedBanner
      canRestore={canRestoreAgency(role, state)}
      canOpenBilling={can(role, 'billing.manage')}
    />
  )
}

function SuspendedBanner({
  canRestore,
  canOpenBilling,
}: {
  canRestore: boolean
  canOpenBilling: boolean
}) {
  const organization = useOrganization()
  const purgeDate = formatPurgeDate(organization)

  return (
    <Alert
      tone="caution"
      title="This agency is suspended and read-only"
      className="mb-6"
      actions={canRestore ? <RestoreAgencyButton organizationId={organization.id} /> : null}
    >
      <p>
        Nothing new can be recorded. Everything already here can still be opened and exported.
        {purgeDate
          ? ` All of it will be permanently deleted on or after ${purgeDate}.`
          : ' All of it will be permanently deleted.'}
      </p>
      <p className="mt-1">
        {/*
          What restoring actually does. The write gate needs billing
          unrestricted AND closure open, and cancelling the subscription is
          done by the agency from Manage billing, so "everything is as
          it was" would be untrue for an agency whose subscription has already
          gone.
        */}
        {canRestore
          ? 'Restoring takes effect immediately, and makes the agency writable again if its subscription is still active. If it has been cancelled, your records come back but nothing new can be recorded until the subscription is started again from Billing.'
          : 'Ask an owner or administrator of this agency to restore it.'}
      </p>
      <p className="mt-1">
        {/*
          Gated on raw can(), NOT usePermission: usePermission withdraws
          billing.manage for a suspended agency, owner included, which would
          strip the link from the one person who can use it. The /billing route
          guard uses raw can() as well, so everyone else would land on "You do
          not have access to this section".
        */}
        The subscription keeps running until it is cancelled.{' '}
        {canOpenBilling ? (
          <>
            Cancel it from Manage billing in{' '}
            <Link to={paths.billing} className="underline underline-offset-2">
              Billing
            </Link>
            .
          </>
        ) : (
          'An owner can cancel it from Manage billing.'
        )}{' '}
        Nothing is deleted until the subscription has ended.
      </p>
      <p className="mt-1">
        Questions, or need the data deleted sooner? Email <SupportLink />.
      </p>
    </Alert>
  )
}

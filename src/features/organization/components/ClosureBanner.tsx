import { Alert } from '@/components/ui'
import { useOrganization } from '@/features/workspace/workspace-context'
import { useWorkspace } from '@/features/workspace/workspace-context'

import { canRestoreAgency, formatPurgeDate } from '../closure'
import { useClosureState } from '../queries'

import { RestoreAgencyButton } from './RestoreAgencyButton'

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
        The 30-day window has ended and the deletion has started. It can no longer be restored.
      </Alert>
    )
  }

  return <SuspendedBanner canRestore={canRestoreAgency(role, state)} />
}

function SuspendedBanner({ canRestore }: { canRestore: boolean }) {
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
        {canRestore
          ? 'Restoring the agency takes effect immediately.'
          : 'Ask an owner or administrator of this agency to restore it.'}
      </p>
    </Alert>
  )
}

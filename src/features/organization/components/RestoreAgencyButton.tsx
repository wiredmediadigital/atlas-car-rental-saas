import { Button } from '@/components/ui'
import { useToast } from '@/components/ui'
import { toErrorMessage } from '@/lib/supabase/errors'

import { useRestoreAccount } from '../queries'

/**
 * Restores a suspended agency.
 *
 * Rendered only where the caller has already decided the person may restore
 * (canRestoreAgency): the database would refuse anybody else, and a button that
 * can only fail is worse than no button. A refusal that does happen anyway, such
 * as the purge claiming the agency a moment ago, is said in words beside the
 * button rather than lost.
 */
export function RestoreAgencyButton({ organizationId }: { organizationId: string }) {
  const toast = useToast()
  const restore = useRestoreAccount()

  return (
    <>
      <Button
        size="sm"
        variant="primary"
        isLoading={restore.isPending}
        onClick={() =>
          restore.mutate(organizationId, {
            onSuccess: () => toast.success('Agency restored'),
          })
        }
      >
        Restore this agency
      </Button>
      {restore.isError ? (
        <p role="alert" className="text-critical-700 w-full text-[0.8125rem] leading-5">
          {toErrorMessage(restore.error)}
        </p>
      ) : null}
    </>
  )
}

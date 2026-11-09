import { paths } from '@/app/routes/paths'
import { Alert, ButtonLink } from '@/components/ui'
import { usePermission } from '@/features/workspace/workspace-context'

import { vehicleLimitCopy } from '../limit'
import { useVehicleLimit } from '../queries'

/**
 * "5 of 5", beside the Vehicles heading from the first day. Hidden while the
 * number is unknown and when there is no limit: a denominator that means nothing
 * is worse than none.
 */
export function VehicleLimitCounter() {
  const { data } = useVehicleLimit()
  if (!data || data.limit === null) return null

  return (
    <span
      className="bg-surface-inset text-ink-muted rounded-full px-2.5 py-0.5 text-[0.8125rem] font-medium tabular-nums"
      title="Vehicles in your fleet, out of what your plan covers"
    >
      {data.count} of {data.limit}
    </span>
  )
}

/** The one message at the limit. Silent below it. */
export function VehicleLimitNotice() {
  const { data } = useVehicleLimit()
  const canManageBilling = usePermission('billing.manage')
  const copy = data ? vehicleLimitCopy(data, canManageBilling) : null
  if (!copy) return null

  return (
    <Alert
      tone="info"
      actions={
        copy.showUpgradeButton ? (
          <ButtonLink to={paths.billing} size="sm" variant="primary">
            Upgrade
          </ButtonLink>
        ) : null
      }
    >
      {copy.sentence}
    </Alert>
  )
}

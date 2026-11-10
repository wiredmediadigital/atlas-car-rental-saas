import { paths } from '@/app/routes/paths'
import { Alert, ButtonLink } from '@/components/ui'
import { SUPPORT_EMAIL } from '@/features/help/constants'
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
      <span className="sr-only"> vehicles, the most your plan covers</span>
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
        copy.action === 'upgrade' ? (
          <ButtonLink to={paths.billing} size="sm" variant="primary">
            Upgrade
          </ButtonLink>
        ) : copy.action === 'contact' ? (
          <a
            href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('Vehicle limit')}`}
            className="font-medium underline"
          >
            Email {SUPPORT_EMAIL}
          </a>
        ) : null
      }
    >
      {copy.sentence}
    </Alert>
  )
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Copy } from 'lucide-react'
import { useId, useState } from 'react'

import { bookingPath } from '@/app/routes/paths'
import { Alert, Button, Card, CardBody, CardHeader, Switch } from '@/components/ui'
import { useOrganization, useRole } from '@/features/workspace/workspace-context'
import { updateOrganization } from '@/features/workspace/api'
import { can } from '@/lib/authz/permissions'
import { getSupabaseClient } from '@/lib/supabase/client'
import { toAppError, toErrorMessage } from '@/lib/supabase/errors'

/** The sentence shown when the plan does not include the feature. */
export const UNAVAILABLE_ON_PLAN =
  'Your current plan does not include a public booking page. Upgrade from Billing to switch it on.'

/**
 * Whether this agency's plan includes public booking.
 *
 * Null means the question could not be answered -- an agency somebody is not a
 * verified member of gets the same null as one that does not exist, which is
 * deliberate in app.plan_allows_public_booking. A null is treated as "allowed"
 * here for the same reason the entitlement itself fails open: a paying agency
 * must not lose a feature because a lookup failed.
 */
async function fetchPlanAllows(organizationId: string): Promise<boolean> {
  const { data, error } = await getSupabaseClient().rpc('plan_allows_public_booking', {
    p_organization_id: organizationId,
  })
  if (error) throw toAppError(error)
  return data ?? true
}

/**
 * The agency's public booking page: the master switch and the address.
 *
 * ADMINISTRATOR AND ABOVE. Publishing the fleet and its prices to anybody who
 * has the link is a decision about the business, not about the day, so it sits
 * with organization.update like the agency's other public details.
 *
 * TURNING THIS ON PUBLISHES NOTHING BY ITSELF. Every vehicle is opted in
 * separately and defaults to off, so an agency that switches the page on sees
 * an empty page until it chooses what to show. That is two deliberate acts
 * before a stranger can see a car, and it is the shape the spec asked for:
 * nothing reaches the page by accident.
 */
export function BookingPageCard() {
  const organization = useOrganization()
  const role = useRole()
  const client = useQueryClient()
  const [copied, setCopied] = useState(false)
  const switchId = useId()

  const entitlement = useQuery({
    queryKey: ['organization', organization.id, 'public-booking', 'entitlement'],
    queryFn: () => fetchPlanAllows(organization.id),
    staleTime: 5 * 60_000,
  })

  const setEnabled = useMutation({
    mutationFn: (enabled: boolean) =>
      updateOrganization(organization.id, { public_booking_enabled: enabled }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['organization'] }),
  })

  // Hidden entirely below administrator: a control somebody cannot use is
  // noise on a page that is already long.
  if (!can(role, 'organization.update')) return null

  const isOn = organization.public_booking_enabled
  const allowed = entitlement.data ?? true
  const link = `${window.location.origin}${bookingPath(organization.slug)}`

  async function copy() {
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2_000)
    } catch {
      // A browser that refuses the clipboard is not a failure worth a banner;
      // the address is on screen and can be selected.
    }
  }

  return (
    <Card>
      <CardHeader
        title="Public booking page"
        description="A page on your own address showing the cars you choose, where visitors can ask to hire one."
      />
      <CardBody className="space-y-5">
        {setEnabled.error === null ? null : (
          <Alert tone="critical">{toErrorMessage(setEnabled.error)}</Alert>
        )}

        {allowed ? null : <Alert tone="info">{UNAVAILABLE_ON_PLAN}</Alert>}

        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <label htmlFor={switchId} className="text-ink text-[0.8125rem] font-medium">
              Show my booking page
            </label>
            <p className="text-ink-muted mt-0.5 text-[0.75rem] leading-4">
              {isOn
                ? 'Visitors with the link can see the cars you have opted in, and send a request.'
                : 'Nobody can reach the page while this is off: the link answers as though the page does not exist.'}
            </p>
          </div>
          <Switch
            id={switchId}
            className="mt-0.5"
            checked={isOn}
            disabled={!allowed || setEnabled.isPending}
            onChange={(event) => setEnabled.mutate(event.target.checked)}
          />
        </div>

        {isOn ? (
          <div className="space-y-2">
            <p className="text-ink-muted text-[0.8125rem]">
              Link this from your own website. Choose which cars appear on each vehicle&rsquo;s
              page; every one starts hidden.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <code className="border-line bg-surface-muted min-w-0 flex-1 truncate rounded-md border px-3 py-2 text-[0.8125rem]">
                {link}
              </code>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void copy()}
                leadingIcon={
                  copied ? (
                    <Check className="size-4" aria-hidden="true" />
                  ) : (
                    <Copy className="size-4" aria-hidden="true" />
                  )
                }
              >
                {copied ? 'Copied' : 'Copy link'}
              </Button>
            </div>
          </div>
        ) : null}
      </CardBody>
    </Card>
  )
}

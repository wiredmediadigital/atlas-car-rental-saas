import { describe, expect, it } from 'vitest'

import { incidentKeys } from './queries'

/**
 * The dashboard refreshes because of where its query keys sit, not because
 * anything explicitly refreshes it.
 *
 * `useCreateIncident`, `useUpdateIncident` and `useResolveIncident` all
 * invalidate `incidentKeys.all(org)`, and React Query matches query keys by
 * PREFIX. So a dashboard key that begins with that prefix is refreshed by
 * reporting, editing or resolving an incident, and one that does not is
 * silently stale until the page is reloaded -- which is exactly how a summary
 * ends up contradicting the list beneath it.
 *
 * `invalidateVehicleRestrictions`, which every maintenance mutation runs,
 * invalidates `['organization', org, 'incidents']` as well as the maintenance
 * namespace. That is why the incident-to-maintenance link is keyed here rather
 * than under maintenance: this one prefix is refreshed from both directions.
 *
 * These assertions are the contract. They look trivial and they are the only
 * thing standing between a working dashboard and a stale one.
 */
const ORG = 'org-1'
const INCIDENTS_PREFIX = ['organization', ORG, 'incidents']

function startsWithPrefix(key: readonly unknown[], prefix: readonly unknown[]): boolean {
  return prefix.every((segment, index) => key[index] === segment)
}

describe('the incident query keys', () => {
  it('puts the dashboard under the prefix incident mutations invalidate', () => {
    expect(startsWithPrefix(incidentKeys.dashboard(ORG), INCIDENTS_PREFIX)).toBe(true)
  })

  it('puts the maintenance link under the same prefix, so both directions refresh it', () => {
    // Maintenance mutations invalidate the incidents namespace too, so keying
    // this here covers starting, completing and cancelling a job as well as
    // resolving the incident.
    expect(startsWithPrefix(incidentKeys.maintenanceLinks(ORG), INCIDENTS_PREFIX)).toBe(true)
  })

  it('agrees with incidentKeys.all, which is what the mutations actually pass', () => {
    expect(incidentKeys.all(ORG)).toEqual(INCIDENTS_PREFIX)
  })

  it('keeps the two dashboard keys distinct, so one does not evict the other', () => {
    expect(incidentKeys.dashboard(ORG)).not.toEqual(incidentKeys.maintenanceLinks(ORG))
  })

  it('scopes every key by organization, so switching agency cannot reuse a cache', () => {
    expect(incidentKeys.dashboard('org-2')).not.toEqual(incidentKeys.dashboard(ORG))
    expect(incidentKeys.maintenanceLinks('org-2')).not.toEqual(incidentKeys.maintenanceLinks(ORG))
  })
})

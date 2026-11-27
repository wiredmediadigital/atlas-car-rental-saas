// @vitest-environment node
/**
 * Tenant isolation for the two reads the Incidents dashboard adds.
 *
 * The dashboard scans every incident in the agency and every maintenance record
 * carrying an `incident_id`, and it counts from those lists rather than from a
 * server-side aggregate. Both filter on `organization_id` in the query, but a
 * filter in a query is a client's promise, not a boundary: the only thing that
 * makes it safe is RLS refusing the rows whatever the client asks for.
 *
 * So each read is run twice as the same signed-in user -- once for their own
 * agency, once with a second agency's id substituted, which is exactly what a
 * tampered request would look like. The second must come back empty.
 *
 * This runs on the repository's PGlite harness, which replays the real ordered
 * migrations. It does not cover hosted PostgREST, and nothing here should be
 * read as manual acceptance.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { TestDatabase, signUp } from './support/harness'

let db: TestDatabase

let ownerA: string
let orgA: string
let incidentA: string

let ownerB: string
let orgB: string

async function seedAgency(
  email: string,
  organizationName: string,
  plate: string,
): Promise<{ ownerId: string; organizationId: string; incidentId: string }> {
  const { userId, organizationId } = await signUp(db, { email, organizationName })
  if (!organizationId) throw new Error('Sign-up did not create an organization.')

  const [vehicle] = await db.sql<{ id: string }>(
    `insert into public.vehicles
       (organization_id, make, model, registration_plate, currency, daily_rate_minor)
     values ($1, 'Test', 'Dashboard', $2, 'EUR', 1000) returning id`,
    [organizationId, plate],
  )

  const [incident] = await db.asUser(userId, (session) =>
    session.sql<{ id: string }>(
      `select id from public.incident_create(
         $1, $2, null, 'breakdown', now(), null, 'Engine warning light')`,
      [organizationId, vehicle!.id],
    ),
  )

  await db.asUser(userId, (session) =>
    session.sql(
      `select public.maintenance_create($1, $2, 'Repair', 'mechanical_repair', 'normal',
         now(), now() + interval '1 day',
         null, null, null, null, null, null, 'EUR', $3, null, false, null)`,
      [organizationId, vehicle!.id, incident!.id],
    ),
  )

  return { ownerId: userId, organizationId, incidentId: incident!.id }
}

/** The incident scan, exactly as `fetchIncidentDashboard` issues it. */
function scanIncidents(userId: string, organizationId: string) {
  return db.asUser(userId, (session) =>
    session.sql<{ id: string }>(
      `select id from public.incidents where organization_id = $1 order by occurred_at desc`,
      [organizationId],
    ),
  )
}

/** The link scan, exactly as `fetchIncidentMaintenanceLinks` issues it. */
function scanLinks(userId: string, organizationId: string) {
  return db.asUser(userId, (session) =>
    session.sql<{ incident_id: string; status: string }>(
      `select incident_id, status from public.maintenance_records
        where organization_id = $1 and incident_id is not null`,
      [organizationId],
    ),
  )
}

beforeAll(async () => {
  db = await TestDatabase.create()

  const a = await seedAgency('owner-a@dashboard.test', 'Agency A', 'INC-DASH-A')
  ownerA = a.ownerId
  orgA = a.organizationId
  incidentA = a.incidentId

  const b = await seedAgency('owner-b@dashboard.test', 'Agency B', 'INC-DASH-B')
  ownerB = b.ownerId
  orgB = b.organizationId
}, 120_000)

afterAll(async () => {
  await db.close()
})

describe('the incident dashboard reads', () => {
  it('returns the agency its own incidents', async () => {
    const rows = await scanIncidents(ownerA, orgA)

    expect(rows).toHaveLength(1)
    expect(rows[0]!.id).toBe(incidentA)
  })

  it('returns nothing when one agency asks for another agency’s incidents', async () => {
    // The query filter says orgB; the signed-in user belongs to orgA. Without
    // RLS this would return Agency B's incident and the dashboard would count
    // another tenant's data into its totals.
    const rows = await scanIncidents(ownerA, orgB)

    expect(rows).toEqual([])
  })

  it('returns the agency its own incident-to-maintenance links', async () => {
    const rows = await scanLinks(ownerA, orgA)

    expect(rows).toHaveLength(1)
    expect(rows[0]!.incident_id).toBe(incidentA)
    expect(rows[0]!.status).toBe('scheduled')
  })

  it('returns nothing when one agency asks for another agency’s maintenance links', async () => {
    const rows = await scanLinks(ownerA, orgB)

    expect(rows).toEqual([])
  })

  it('is symmetric: the second agency cannot read the first either', async () => {
    // Asserted in both directions on purpose. A policy that happens to let the
    // older row through, or that keys off something other than membership,
    // would pass a one-directional test.
    expect(await scanIncidents(ownerB, orgA)).toEqual([])
    expect(await scanLinks(ownerB, orgA)).toEqual([])
    expect(await scanIncidents(ownerB, orgB)).toHaveLength(1)
  })
})

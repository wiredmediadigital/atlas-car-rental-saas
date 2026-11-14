// @vitest-environment node
/**
 * public.booking_leads — the table a request from the public booking page lands
 * in.
 *
 * A lead holds a stranger's name, email and phone, so it is tenant-isolated and
 * second-factor gated like every other personal record here: the chokepoint
 * functions (app.is_org_member, app.has_min_role) already require aal2, and
 * these tests pin that the table actually sits behind them.
 *
 * `asUser` stamps an aal2 session unless told otherwise.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { TestDatabase, addMember, signUp } from './support/harness'

let db: TestDatabase
let organizationId: string
let ownerId: string
let staffId: string
let managerId: string
let vehicleId: string
let seq = 0

/** A second agency, to prove a lead never crosses the tenant boundary. */
let otherOrganizationId: string
let otherOwnerId: string
let otherVehicleId: string

async function createVehicle(organization: string, plate: string): Promise<string> {
  const [row] = await db.sql<{ id: string }>(
    `insert into public.vehicles (organization_id, make, model, registration_plate, currency)
     values ($1, 'Renault', 'Clio', $2, 'EUR') returning id`,
    [organization, plate],
  )
  return row!.id
}

/** Inserts a lead the way Task 5's definer function will: as the service role. */
async function insertLead(
  overrides: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const values: Record<string, unknown> = {
    organization_id: organizationId,
    vehicle_id: vehicleId,
    starts_at: '2026-12-01T09:00:00Z',
    ends_at: '2026-12-05T09:00:00Z',
    full_name: 'Renter Person',
    email: 'renter@example.test',
    phone: '+33 1 23 45 67 89',
    note: 'Is the child seat included?',
    currency: 'EUR',
    daily_rate_minor: 4500,
    billable_days: 4,
    quoted_total_minor: 18000,
    ...overrides,
  }
  const columns = Object.keys(values)
  const placeholders = columns.map((_, index) => `$${index + 1}`).join(', ')
  const [row] = await db.asServiceRole(ownerId, (session) =>
    session.sql<Record<string, unknown>>(
      `insert into public.booking_leads (${columns.join(', ')})
       values (${placeholders}) returning *`,
      Object.values(values),
    ),
  )
  return row!
}

beforeAll(async () => {
  db = await TestDatabase.create()
})

afterAll(async () => {
  await db.close()
})

beforeEach(async () => {
  seq += 1
  const owner = await signUp(db, {
    email: `owner${seq}@leads.test`,
    organizationName: `Leads ${seq}`,
    currency: 'EUR',
    timeZone: 'Europe/Paris',
  })
  if (!owner.organizationId) throw new Error('provisioning failed')
  organizationId = owner.organizationId
  ownerId = owner.userId

  const staff = await signUp(db, { email: `staff${seq}@leads.test` })
  staffId = staff.userId
  await addMember(db, organizationId, staffId, 'staff')
  const manager = await signUp(db, { email: `manager${seq}@leads.test` })
  managerId = manager.userId
  await addMember(db, organizationId, managerId, 'manager')
  vehicleId = await createVehicle(organizationId, `LED-${seq}`)

  const other = await signUp(db, {
    email: `rival${seq}@leads.test`,
    organizationName: `Rival ${seq}`,
    currency: 'EUR',
  })
  if (!other.organizationId) throw new Error('provisioning failed')
  otherOrganizationId = other.organizationId
  otherOwnerId = other.userId
  otherVehicleId = await createVehicle(otherOrganizationId, `RIV-${seq}`)
})

describe('who can see a lead', () => {
  it('is invisible to another agency', async () => {
    await insertLead()
    const rows = await db.asUser(otherOwnerId, (session) =>
      session.sql(`select id from public.booking_leads`),
    )
    expect(rows).toHaveLength(0)
  })

  it('is unreadable at aal1', async () => {
    await insertLead()
    const rows = await db.asUser(
      ownerId,
      (session) => session.sql(`select id from public.booking_leads`),
      { aal: 'aal1' },
    )
    expect(rows).toHaveLength(0)
  })

  it('is readable by a member of its own agency, down to staff', async () => {
    await insertLead()
    for (const userId of [ownerId, staffId]) {
      const rows = await db.asUser(userId, (session) =>
        session.sql(`select id, full_name from public.booking_leads`),
      )
      expect(rows).toHaveLength(1)
    }
  })

  it('is not readable by anon at all', async () => {
    await insertLead()
    await db.expectRejection(
      () => db.asAnon((session) => session.sql(`select id from public.booking_leads`)),
      /permission denied/i,
    )
  })
})

describe('what staff may do with a lead', () => {
  it('lets staff work the queue', async () => {
    const lead = await insertLead()
    const updated = await db.asUser(staffId, (session) =>
      session.sql<{ status: string }>(
        `update public.booking_leads set status = 'contacted' where id = $1 returning status`,
        [lead.id],
      ),
    )
    expect(updated[0]!.status).toBe('contacted')
  })

  it('lets a manager delete a lead and a staff member not', async () => {
    /*
     * Everything else staff do to a lead is additive or recoverable. Deleting
     * one destroys a real person's enquiry -- their name, their address and
     * whatever they wrote -- with nothing to undo it with, which is why it
     * sits where rentals_delete and customer_documents_delete sit.
     *
     * The DPA promise survives: an agency can still act on a renter's erasure
     * request, it just takes a manager rather than anyone at the front desk.
     */
    const lead = await insertLead()

    const refused = await db.asUser(staffId, (session) =>
      session.sql(`delete from public.booking_leads where id = $1 returning id`, [lead.id]),
    )
    expect(refused).toHaveLength(0)

    const deleted = await db.asUser(managerId, (session) =>
      session.sql(`delete from public.booking_leads where id = $1 returning id`, [lead.id]),
    )
    expect(deleted).toHaveLength(1)
  })

  it('lets a manager erase a lead even while the agency is billing-restricted', async () => {
    // A restricted agency is read-only for new work and still owes an erasure.
    const lead = await insertLead()
    await db.sql(`select app.billing_report_platform_state(true, 'test', 'Configured.')`)
    await db.sql(`select app.billing_replace_catalogue($1::jsonb)`, [
      JSON.stringify([
        {
          plan_key: 'pro_monthly',
          display_name: 'Pro',
          stripe_price_id: 'price_test_pro_monthly',
          currency: 'EUR',
          amount_minor: 4900,
          interval: 'month',
          interval_count: 1,
          mode: 'test',
          sort_order: 0,
        },
      ]),
    ])
    try {
      const deleted = await db.asUser(managerId, (session) =>
        session.sql(`delete from public.booking_leads where id = $1 returning id`, [lead.id]),
      )
      expect(deleted).toHaveLength(1)
    } finally {
      await db.sql(`select app.billing_replace_catalogue('[]'::jsonb)`)
      await db.sql(`select app.billing_report_platform_state(false, 'test', 'Not configured.')`)
    }
  })

  it('does not let a session without a second factor touch one', async () => {
    const lead = await insertLead()
    const updated = await db
      .asUser(
        ownerId,
        (session) =>
          session.sql(
            `update public.booking_leads set status = 'declined' where id = $1 returning id`,
            [lead.id],
          ),
        { aal: 'aal1' },
      )
      .catch(() => [])
    expect(updated).toHaveLength(0)
  })
})

describe('what the table refuses', () => {
  it("refuses a lead pointing at another agency's vehicle", async () => {
    await expect(insertLead({ vehicle_id: otherVehicleId })).rejects.toThrow()
  })

  it('refuses a stay that ends before it starts', async () => {
    await expect(
      insertLead({ starts_at: '2026-12-05T09:00:00Z', ends_at: '2026-12-01T09:00:00Z' }),
    ).rejects.toThrow()
  })

  it('refuses the converted status without the records it claims', async () => {
    const lead = await insertLead()
    await db.expectRejection(() =>
      db.asServiceRole(ownerId, (session) =>
        session.sql(`update public.booking_leads set status = 'converted' where id = $1`, [
          lead.id,
        ]),
      ),
    )
  })

  it('gives every lead its own reference within an agency', async () => {
    const first = await insertLead()
    const second = await insertLead()
    expect(first.reference).toBeTruthy()
    expect(second.reference).not.toBe(first.reference)
    await db.expectRejection(() => insertLead({ reference: first.reference }))
  })
})

describe('account closure', () => {
  it('appears in both closure purge lists', async () => {
    const [row] = await db.sql<{ agree: boolean }>(
      `select app.organization_purge_lists_agree() as agree`,
    )
    expect(row!.agree).toBe(true)
  })

  it('is emptied when the agency is purged', async () => {
    await insertLead()
    // The purge runs only against an agency whose closure is due and claimed.
    await db.sql(
      `update public.organizations
          set closure_requested_at = now() - interval '31 days',
              closure_requested_by = (select user_id from public.organization_members
                                       where organization_id = $1 and role = 'owner' limit 1),
              closure_purge_after = now() - interval '1 day'
        where id = $1`,
      [organizationId],
    )
    await db.sql(`select app.organization_claim_purge($1)`, [organizationId])
    await db.sql(`select app.organization_purge_data($1)`, [organizationId])
    const [row] = await db.sql<{ count: string }>(
      `select count(*)::text as count from public.booking_leads where organization_id = $1`,
      [organizationId],
    )
    expect(row!.count).toBe('0')
  })
})

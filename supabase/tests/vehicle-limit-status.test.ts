// @vitest-environment node
/**
 * public.vehicle_limit_status: the member-gated door to the vehicle limit.
 *
 * The resolver functions behind it are service_role only because they take any
 * organization id. This function is what a signed-in browser calls, so the
 * interesting tests are who it refuses and what it returns for a member.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// Importing from src/ is deliberate: it is what lets this test catch the interface's
// tier ladder drifting from the authored limits. Do not tidy it away.
import { VEHICLE_TIERS, tierKeyOfPlan } from '../../src/features/billing/tiers'

import { TestDatabase, signUp } from './support/harness'

let db: TestDatabase
let ownerA: string
let orgA: string
let ownerB: string
let orgB: string

async function enrol(email: string, name: string) {
  const account = await signUp(db, {
    email,
    fullName: name,
    organizationName: name,
    currency: 'EUR',
    timeZone: 'Europe/Paris',
  })
  if (!account.organizationId) throw new Error('provisioning failed')
  return { userId: account.userId, organizationId: account.organizationId }
}

beforeAll(async () => {
  db = await TestDatabase.create()
  ;({ userId: ownerA, organizationId: orgA } = await enrol('a@status.test', 'Agency A'))
  ;({ userId: ownerB, organizationId: orgB } = await enrol('b@status.test', 'Agency B'))
})

afterAll(async () => {
  await db.close()
})

describe('public.vehicle_limit_status', () => {
  it("returns the agency's own count to a member", async () => {
    await db.sql(
      `insert into public.vehicles (organization_id, make, model, registration_plate, currency)
       values ($1, 'Renault', 'Clio', 'STATUS-1', 'EUR')`,
      [orgA],
    )
    const [row] = await db.asUser(ownerA, (session) =>
      session.sql<{ vehicle_limit: number | null; vehicle_count: number; tier: string | null }>(
        `select * from public.vehicle_limit_status($1)`,
        [orgA],
      ),
    )
    expect(row!.vehicle_count).toBe(1)
    // No billing platform is configured here, so no plan limit applies.
    expect(row!.vehicle_limit).toBeNull()
  })

  it('returns the limit and tier of its plan once billing is configured', async () => {
    await db.sql(`select app.billing_report_platform_state(true, 'test', 'Stripe is configured.')`)
    await db.sql(`select app.billing_replace_catalogue($1::jsonb)`, [
      JSON.stringify([
        {
          plan_key: 'pro_monthly',
          display_name: 'Pro',
          stripe_price_id: 'price_test_pro_monthly',
          currency: 'EUR',
          amount_minor: 11900,
          interval: 'month',
          interval_count: 1,
          mode: 'test',
          sort_order: 0,
        },
      ]),
    ])
    await db.sql(`select app.billing_claim_customer($1, 'cus_status_a', 'test', 'a@status.test')`, [
      orgA,
    ])
    await db.sql(
      `select app.billing_apply_subscription(
         'sub_status_a', 'cus_status_a', 'test', 'active'::public.stripe_subscription_status,
         'price_test_pro_monthly', 'EUR', 11900, 'month', 1, 1,
         now() - interval '5 days', now() + interval '25 days',
         false, null, null, null, null, null,
         now(), 'evt_status_a'
       )`,
    )
    const [row] = await db.asUser(ownerA, (session) =>
      session.sql<{ vehicle_limit: number | null; vehicle_count: number; tier: string | null }>(
        `select * from public.vehicle_limit_status($1)`,
        [orgA],
      ),
    )
    expect(row).toEqual({ vehicle_limit: 20, vehicle_count: 1, tier: 'pro' })
  })

  it('refuses a signed-in user who is not a member, so no ceiling or fleet size leaks', async () => {
    await db.asUser(ownerB, (session) =>
      session.expectRejection(
        () => session.sql(`select * from public.vehicle_limit_status($1)`, [orgA]),
        /not a member/i,
      ),
    )
  })

  it('is not callable anonymously', async () => {
    await db.asAnon((session) =>
      session.expectRejection(
        () => session.sql(`select * from public.vehicle_limit_status($1)`, [orgB]),
        /permission denied/i,
      ),
    )
  })
})

describe('the tiers the interface knows', () => {
  it('match the authored plan_vehicle_limits', async () => {
    const rows = await db.sql<{ tier: string; vehicle_limit: number }>(
      `select distinct tier, vehicle_limit from public.plan_vehicle_limits order by vehicle_limit, tier`,
    )
    expect(rows).toEqual(
      VEHICLE_TIERS.map((tier) => ({ tier: tier.key, vehicle_limit: tier.limit })),
    )
  })

  /*
   * The pair above agrees today by luck of naming: nothing makes the tier the
   * interface READS OUT OF A PLAN KEY equal the tier authored beside that key.
   * Author `enterprise_plus_monthly` with tier `enterprise_plus` and
   * `tierKeyOfPlan` answers `enterprise` -- whereupon the pricing page silently
   * drops the plan, the Billing list calls every move to it a "switch", and the
   * Vehicles notice falls into the contact-us branch. One loop closes the class.
   */
  it('read the same tier out of every authored plan key as the row names', async () => {
    const rows = await db.sql<{ plan_key: string; tier: string }>(
      `select plan_key, tier from public.plan_vehicle_limits order by plan_key`,
    )
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      expect([row.plan_key, tierKeyOfPlan(row.plan_key)]).toEqual([row.plan_key, row.tier])
    }
  })
})

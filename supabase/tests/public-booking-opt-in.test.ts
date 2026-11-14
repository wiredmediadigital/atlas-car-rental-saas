// @vitest-environment node
/**
 * The two switches behind the public booking page, and the plan entitlement
 * behind the first one.
 *
 * Nothing reaches the public page by accident: the agency turns the feature on
 * (organizations.public_booking_enabled), then opts each vehicle in
 * (vehicles.public_booking_enabled). The plan carries the allowance in
 * plan_vehicle_limits, like the vehicle limit, and a trigger refuses the agency
 * switch while the plan does not include it. Everything runs as `authenticated`
 * with RLS in force; `asUser` stamps an aal2 session unless told otherwise.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { TestDatabase, addMember, signUp } from './support/harness'

let db: TestDatabase
let organizationId: string
let ownerId: string
let adminId: string
let staffId: string
let seq = 0

const PLAN_KEYS = ['starter_monthly', 'pro_monthly', 'business_yearly', 'unlisted_plan']

function catalogueEntry(planKey: string) {
  return {
    plan_key: planKey,
    display_name: planKey,
    stripe_price_id: `price_test_${planKey}`,
    currency: 'EUR',
    amount_minor: 4900,
    interval: planKey.endsWith('yearly') ? 'year' : 'month',
    interval_count: 1,
    mode: 'test',
    sort_order: 0,
  }
}

/** Applies a subscription on `planKey`. Calling it again moves the plan. */
async function subscribe(planKey: string): Promise<void> {
  const tag = organizationId.slice(0, 8)
  await db.sql(`select app.billing_claim_customer($1, $2, 'test', $3)`, [
    organizationId,
    `cus_test_${tag}`,
    'billing@agency.test',
  ])
  await db.sql(
    `select app.billing_apply_subscription(
       $1, $2, 'test', 'active'::public.stripe_subscription_status, $3,
       'EUR', 4900, 'month', 1, 1,
       now() - interval '5 days', now() + interval '25 days',
       false, null, null, null, null, null,
       now(), $4
     )`,
    [`sub_test_${tag}`, `cus_test_${tag}`, `price_test_${planKey}`, `evt_${tag}_${planKey}`],
  )
}

/**
 * Moves the agency's subscription to another plan, as a later Stripe event would.
 *
 * The same subscription and customer with a new price and a new event id. A
 * direct UPDATE is refused: billing rows are written by the billing service
 * alone (20260823100000).
 */
async function changePlan(planKey: string): Promise<void> {
  await subscribe(planKey)
}

async function createVehicle(plate: string): Promise<string> {
  const [row] = await db.sql<{ id: string }>(
    `insert into public.vehicles (organization_id, make, model, registration_plate, currency)
     values ($1, 'Renault', 'Clio', $2, 'EUR') returning id`,
    [organizationId, plate],
  )
  return row!.id
}

async function setAgencySwitch(userId: string, on: boolean, aal?: 'aal1' | 'aal2') {
  return db.asUser(
    userId,
    (session) =>
      session.sql<{ public_booking_enabled: boolean }>(
        `update public.organizations set public_booking_enabled = $2
          where id = $1 returning public_booking_enabled`,
        [organizationId, on],
      ),
    aal ? { aal } : {},
  )
}

async function agencySwitch(): Promise<boolean> {
  const [row] = await db.sql<{ on: boolean }>(
    `select public_booking_enabled as "on" from public.organizations where id = $1`,
    [organizationId],
  )
  return row!.on
}

async function vehicleSwitch(vehicleId: string): Promise<boolean> {
  const [row] = await db.sql<{ on: boolean }>(
    `select public_booking_enabled as "on" from public.vehicles where id = $1`,
    [vehicleId],
  )
  return row!.on
}

/** The entitlement as a member sees it, or as the service role does when userId is null. */
async function allows(userId: string | null): Promise<boolean | null> {
  const run = (session: TestDatabase) =>
    session.sql<{ ok: boolean | null }>(`select app.plan_allows_public_booking($1) as ok`, [
      organizationId,
    ])
  const [row] = userId ? await db.asUser(userId, run) : await db.asServiceRole(ownerId, run)
  return row!.ok
}

beforeAll(async () => {
  db = await TestDatabase.create()
  await db.sql(`select app.billing_report_platform_state(true, 'test', 'Stripe is configured.')`)
  await db.sql(`select app.billing_replace_catalogue($1::jsonb)`, [
    JSON.stringify(PLAN_KEYS.map(catalogueEntry)),
  ])
})

afterAll(async () => {
  await db.close()
})

beforeEach(async () => {
  seq += 1
  const owner = await signUp(db, {
    email: `owner${seq}@booking.test`,
    organizationName: `Booking ${seq}`,
    currency: 'EUR',
    timeZone: 'Europe/Paris',
  })
  if (!owner.organizationId) throw new Error('provisioning failed')
  organizationId = owner.organizationId
  ownerId = owner.userId
  const admin = await signUp(db, { email: `admin${seq}@booking.test` })
  const staff = await signUp(db, { email: `staff${seq}@booking.test` })
  adminId = admin.userId
  staffId = staff.userId
  await addMember(db, organizationId, adminId, 'admin')
  await addMember(db, organizationId, staffId, 'staff')
})

describe('the defaults', () => {
  it('defaults both switches to off', async () => {
    const vehicleId = await createVehicle(`DEF-${seq}`)
    expect(await agencySwitch()).toBe(false)
    expect(await vehicleSwitch(vehicleId)).toBe(false)
  })
})

describe('the plan entitlement', () => {
  it('refuses to turn the agency switch on without an entitled plan', async () => {
    await subscribe('starter_monthly')
    const message = await db.expectRejection(
      () => setAgencySwitch(ownerId, true),
      /public booking/i,
    )
    expect(message).toMatch(/plan/i)
    expect(await agencySwitch()).toBe(false)
  })

  it('refuses the service role too, with 42501', async () => {
    await subscribe('starter_monthly')
    let code: string | undefined
    try {
      await db.asServiceRole(ownerId, (session) =>
        session.sql(`update public.organizations set public_booking_enabled = true where id = $1`, [
          organizationId,
        ]),
      )
    } catch (error) {
      code = (error as { code?: string }).code
    }
    expect(code).toBe('42501')
    expect(await agencySwitch()).toBe(false)
  })

  it('lets an admin turn the agency switch on and off with an entitled plan', async () => {
    await subscribe('pro_monthly')
    expect((await setAgencySwitch(adminId, true))[0]!.public_booking_enabled).toBe(true)
    expect(await agencySwitch()).toBe(true)
    expect((await setAgencySwitch(adminId, false))[0]!.public_booking_enabled).toBe(false)
  })

  it('fails open with no subscription and for a plan key with no authored row', async () => {
    expect((await setAgencySwitch(ownerId, true))[0]!.public_booking_enabled).toBe(true)
    await setAgencySwitch(ownerId, false)
    await subscribe('unlisted_plan')
    expect((await setAgencySwitch(ownerId, true))[0]!.public_booking_enabled).toBe(true)
  })

  it('leaves an agency switched on after a downgrade, and lets it edit other fields', async () => {
    await subscribe('pro_monthly')
    await setAgencySwitch(ownerId, true)
    await changePlan('starter_monthly')
    await db.asUser(ownerId, (session) =>
      session.sql(`update public.organizations set name = 'Renamed' where id = $1`, [
        organizationId,
      ]),
    )
    expect(await agencySwitch()).toBe(true)
  })

  it('does not tell a non-member the plan through the error text', async () => {
    await subscribe('starter_monthly')
    const outsider = await signUp(db, { email: `outsider${seq}@booking.test` })
    const rows = await setAgencySwitch(outsider.userId, true).catch((error: Error) => error.message)
    if (typeof rows === 'string') expect(rows).not.toMatch(/public booking|plan/i)
    expect(await agencySwitch()).toBe(false)
  })

  it('does not let a session without a second factor turn it on', async () => {
    await subscribe('pro_monthly')
    const rows = await setAgencySwitch(ownerId, true, 'aal1').catch(() => [])
    expect(rows).toHaveLength(0)
    expect(await agencySwitch()).toBe(false)
  })
})

describe('app.plan_allows_public_booking', () => {
  it('answers a member by plan', async () => {
    await subscribe('starter_monthly')
    expect(await allows(staffId)).toBe(false)
    await changePlan('business_yearly')
    expect(await allows(staffId)).toBe(true)
  })

  it('answers the service role, which has no user', async () => {
    await subscribe('starter_monthly')
    expect(await allows(null)).toBe(false)
  })

  it('tells a non-member nothing, whatever the plan', async () => {
    await subscribe('starter_monthly')
    const outsider = await signUp(db, { email: `stranger${seq}@booking.test` })
    expect(await allows(outsider.userId)).toBeNull()
    await changePlan('pro_monthly')
    expect(await allows(outsider.userId)).toBeNull()
  })

  it('is not callable by anon', async () => {
    await db.expectRejection(
      () =>
        db.asAnon((session) =>
          session.sql(`select app.plan_allows_public_booking($1)`, [organizationId]),
        ),
      /permission denied/i,
    )
  })
})

describe('the vehicle switch', () => {
  it('lets an owner turn a vehicle on and a staff member not', async () => {
    // Billing is configured in this file, so an agency with no subscription is
    // restricted and no role may write anything. This test is about the role
    // boundary, so give it a plan first.
    await subscribe('pro_monthly')
    const vehicleId = await createVehicle(`OWN-${seq}`)
    const turnOn = (userId: string) =>
      db.asUser(userId, (session) =>
        session.sql<{ public_booking_enabled: boolean }>(
          `update public.vehicles set public_booking_enabled = true
            where id = $1 returning public_booking_enabled`,
          [vehicleId],
        ),
      )

    expect(await turnOn(staffId)).toHaveLength(0)
    expect(await vehicleSwitch(vehicleId)).toBe(false)

    expect((await turnOn(ownerId))[0]!.public_booking_enabled).toBe(true)
    expect(await vehicleSwitch(vehicleId)).toBe(true)
  })
})

// @vitest-environment node
/**
 * The gate: the database refuses a vehicle past the agency's limit.
 *
 * The interface may not be the only barrier between an agency and its
 * fifty-first vehicle, so every test here writes straight to public.vehicles and
 * the refusal has to come from the write itself.
 *
 * The limit is never retroactive: only an insert, or an archived-to-active
 * transition, is checked. Every other update passes, so an agency that is over
 * its limit for any reason can still edit, rent and archive what it has.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { TestDatabase, signUp } from './support/harness'

let db: TestDatabase
let organizationId: string
let owner: string
let seq = 0
let plate = 0

const PLAN_KEYS = ['starter_monthly', 'pro_monthly']
const REFUSAL = /Your plan covers (\d+) vehicles\. You have (\d+)\./

function catalogueEntry(planKey: string) {
  return {
    plan_key: planKey,
    display_name: planKey,
    stripe_price_id: `price_test_${planKey}`,
    currency: 'EUR',
    amount_minor: 4900,
    interval: 'month',
    interval_count: 1,
    mode: 'test',
    sort_order: 0,
  }
}

async function subscribe(planKey: string): Promise<void> {
  const tag = organizationId.slice(0, 8)
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

async function setOverride(limit: number): Promise<void> {
  await db.sql(
    `update public.organizations
        set vehicle_limit_override = $2, vehicle_limit_override_set_by = $3,
            vehicle_limit_override_set_at = now()
      where id = $1`,
    [organizationId, limit, owner],
  )
}

async function insertVehicle(archived = false, run: TestDatabase = db): Promise<string> {
  plate += 1
  const [row] = await run.sql<{ id: string }>(
    `insert into public.vehicles (organization_id, make, model, registration_plate, currency, archived_at)
     values ($1, 'Renault', 'Clio', $2, 'EUR', $3) returning id`,
    [organizationId, `LIM-${plate}`, archived ? new Date().toISOString() : null],
  )
  return row!.id
}

async function fill(count: number): Promise<string[]> {
  const ids: string[] = []
  for (let i = 0; i < count; i += 1) ids.push(await insertVehicle())
  return ids
}

async function activeCount(): Promise<number> {
  const [row] = await db.sql<{ n: number }>(`select app.vehicle_count_of($1) as n`, [
    organizationId,
  ])
  return row!.n
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
  const account = await signUp(db, {
    email: `owner${seq}@enforce.test`,
    fullName: 'Owner One',
    organizationName: `Enforce ${seq}`,
    currency: 'EUR',
    timeZone: 'Europe/Paris',
  })
  if (!account.organizationId) throw new Error('provisioning failed')
  organizationId = account.organizationId
  owner = account.userId
  const tag = organizationId.slice(0, 8)
  await db.sql(`select app.billing_claim_customer($1, $2, 'test', $3)`, [
    organizationId,
    `cus_test_${tag}`,
    'billing@agency.test',
  ])
})

describe('adding a vehicle', () => {
  it('allows the fifth vehicle on starter', async () => {
    await subscribe('starter_monthly')
    await fill(4)
    await insertVehicle()
    expect(await activeCount()).toBe(5)
  })

  it('refuses the sixth vehicle on starter, stating the fact', async () => {
    await subscribe('starter_monthly')
    await fill(5)
    const message = await db.expectRejection(() => insertVehicle(), REFUSAL)
    expect(message).toContain('Your plan covers 5 vehicles. You have 5.')
    expect(await activeCount()).toBe(5)
  })

  it('raises errcode 55000', async () => {
    await subscribe('starter_monthly')
    await fill(5)
    const code = await insertVehicle()
      .then(() => null)
      .catch((error: { code?: string }) => error.code)
    expect(code).toBe('55000')
  })

  it('refuses when the signed-in agency itself adds the vehicle', async () => {
    await subscribe('starter_monthly')
    await fill(5)
    await db.asUser(owner, (session) =>
      session.expectRejection(() => insertVehicle(false, session), REFUSAL),
    )
  })

  it('allows any number when the agency has no limit', async () => {
    await fill(8)
    expect(await activeCount()).toBe(8)
  })

  it('allows the insert when an override raises the ceiling', async () => {
    await subscribe('starter_monthly')
    await fill(5)
    await setOverride(6)
    await insertVehicle()
    await db.expectRejection(() => insertVehicle(), /Your plan covers 6 vehicles\. You have 6\./)
  })

  it('does not count archived vehicles, and allows adding an already-archived one', async () => {
    await subscribe('starter_monthly')
    await fill(5)
    await insertVehicle(true)
    expect(await activeCount()).toBe(5)
  })
})

describe('restoring an archived vehicle', () => {
  it('refuses restoring an archived vehicle when the fleet is full', async () => {
    await subscribe('starter_monthly')
    await fill(5)
    const archivedId = await insertVehicle(true)
    await db.expectRejection(
      () => db.sql(`update public.vehicles set archived_at = null where id = $1`, [archivedId]),
      /Your plan covers 5 vehicles\. You have 5\./,
    )
    expect(await activeCount()).toBe(5)
  })

  it('allows restoring when a slot is free', async () => {
    await subscribe('starter_monthly')
    await fill(4)
    const archivedId = await insertVehicle(true)
    await db.sql(`update public.vehicles set archived_at = null where id = $1`, [archivedId])
    expect(await activeCount()).toBe(5)
  })
})

describe('everything else stays allowed', () => {
  it('allows archiving regardless of the limit', async () => {
    await subscribe('starter_monthly')
    const ids = await fill(5)
    await db.sql(`update public.vehicles set archived_at = now() where id = $1`, [ids[0]])
    expect(await activeCount()).toBe(4)
  })

  it('leaves an over-limit agency able to edit and rent what it has', async () => {
    const ids = await fill(3)
    await setOverride(1)
    expect(await activeCount()).toBe(3)

    await db.sql(`update public.vehicles set model = 'Megane' where id = $1`, [ids[0]])
    const [vehicle] = await db.sql<{ model: string }>(
      `select model from public.vehicles where id = $1`,
      [ids[0]],
    )
    expect(vehicle!.model).toBe('Megane')

    const [customer] = await db.sql<{ id: string }>(
      `insert into public.customers (organization_id, first_name, last_name)
       values ($1, 'Amina', 'Tazi') returning id`,
      [organizationId],
    )
    await db.sql(
      `insert into public.rentals
         (organization_id, vehicle_id, customer_id, starts_at, ends_at, currency, status,
          deposit_minor, tax_rate_bps, daily_rate_minor)
       values ($1, $2, $3, '2029-01-01T09:00:00Z', '2029-01-04T09:00:00Z', 'EUR', 'reserved', 0, 0, 5000)`,
      [organizationId, ids[0], customer!.id],
    )

    // ...and a new vehicle is still refused.
    await db.expectRejection(() => insertVehicle(), /Your plan covers 1 vehicles\. You have 3\./)
  })
})

describe('where the gate lives', () => {
  // The suite replays every migration on one in-memory connection, so two real
  // parallel sessions are not available. This proves the gate's LOCATION, not its
  // behaviour under true parallelism: the check fires on the insert statement
  // itself, with no client-side pre-check anywhere in the path. Of two inserts
  // aimed at the last slot, the second is the one refused.
  it('refuses the second of two concurrent inserts at the last slot', async () => {
    await subscribe('starter_monthly')
    await fill(4)
    const outcomes = await Promise.allSettled([insertVehicle(), insertVehicle()])
    const refused = outcomes.filter((outcome) => outcome.status === 'rejected')
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1)
    expect(refused).toHaveLength(1)
    expect(String((refused[0] as PromiseRejectedResult).reason)).toMatch(REFUSAL)
    expect(await activeCount()).toBe(5)
  })
})

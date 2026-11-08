// @vitest-environment node
/**
 * The closure state, and the one write gate that knows about it.
 *
 * app.may_write is THE answer to "may this organization be written to?".
 * Policies reach it through app.billing_may_write and SECURITY DEFINER
 * functions through app.billing_require_write, both thin delegates. What is
 * asserted here is that all four spellings agree, in every state, because a
 * policy and a definer function that can disagree is the hole this design
 * exists to avoid.
 *
 * The 75 policies themselves are not re-tested here: billing-restricted-access
 * does that, and it must still pass untouched.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { TestDatabase, addMember, signUp } from './support/harness'

let db: TestDatabase
let organizationId: string
let owner: string
let admin: string
let seq = 0

async function configureBillingAndSubscribe(orgId: string, status: string): Promise<void> {
  await db.sql(`select app.billing_report_platform_state(true, 'test', 'Stripe is configured.')`)
  await db.sql(`select app.billing_replace_catalogue($1::jsonb)`, [
    JSON.stringify([
      {
        plan_key: 'standard',
        display_name: 'Standard',
        stripe_price_id: 'price_test_standard',
        currency: 'EUR',
        amount_minor: 4900,
        interval: 'month',
        interval_count: 1,
        mode: 'test',
        sort_order: 0,
      },
    ]),
  ])
  await db.sql(`select app.billing_claim_customer($1, $2, 'test', $3)`, [
    orgId,
    `cus_test_${orgId.slice(0, 8)}`,
    'billing@agency.test',
  ])
  await db.sql(
    `select app.billing_apply_subscription(
       $1, $2, 'test', $3::public.stripe_subscription_status, 'price_test_standard',
       'EUR', 4900, 'month', 1, 1,
       now() - interval '5 days', now() + interval '25 days',
       false, null, null, null, null, null,
       now(), $4
     )`,
    [
      `sub_test_${orgId.slice(0, 8)}`,
      `cus_test_${orgId.slice(0, 8)}`,
      status,
      `evt_${orgId.slice(0, 8)}`,
    ],
  )
}

/** All four spellings of the gate, so a test can assert they never disagree. */
async function askEveryGate(): Promise<{
  mayWrite: boolean
  billingMayWrite: boolean
  requireWriteRaises: boolean
  billingRequireWriteRaises: boolean
}> {
  const [row] = await db.sql<{ a: boolean; b: boolean }>(
    `select app.may_write($1) as a, app.billing_may_write($1) as b`,
    [organizationId],
  )
  const raises = async (fn: string): Promise<boolean> => {
    try {
      await db.sql(`select app.${fn}($1)`, [organizationId])
      return false
    } catch (error) {
      expect((error as { code?: string }).code).toBe('42501')
      return true
    }
  }
  return {
    mayWrite: row!.a,
    billingMayWrite: row!.b,
    requireWriteRaises: await raises('require_write'),
    billingRequireWriteRaises: await raises('billing_require_write'),
  }
}

async function expectOpenGate(): Promise<void> {
  expect(await askEveryGate()).toEqual({
    mayWrite: true,
    billingMayWrite: true,
    requireWriteRaises: false,
    billingRequireWriteRaises: false,
  })
}

async function expectShutGate(): Promise<void> {
  expect(await askEveryGate()).toEqual({
    mayWrite: false,
    billingMayWrite: false,
    requireWriteRaises: true,
    billingRequireWriteRaises: true,
  })
}

async function stateOf(): Promise<string> {
  const [row] = await db.sql<{ s: string }>(`select app.closure_state_of($1)::text as s`, [
    organizationId,
  ])
  return row!.s
}

async function insertCustomerAsOwner(): Promise<unknown> {
  return db.asUser(owner, (session) =>
    session.sql(
      `insert into public.customers (organization_id, first_name, last_name, email)
       values ($1, 'Some', 'Customer', $2)`,
      [organizationId, `c-${seq}-${Math.random()}@example.test`],
    ),
  )
}

beforeAll(async () => {
  db = await TestDatabase.create()
})

afterAll(async () => {
  await db.close()
})

beforeEach(async () => {
  seq += 1
  const o = await signUp(db, {
    email: `owner${seq}@closure.test`,
    fullName: 'Owner One',
    organizationName: `Closure ${seq}`,
    currency: 'EUR',
    timeZone: 'Europe/Paris',
  })
  if (!o.organizationId) throw new Error('provisioning failed')
  organizationId = o.organizationId
  owner = o.userId

  const a = await signUp(db, { email: `admin${seq}@closure.test`, fullName: 'Admin One' })
  admin = a.userId
  await addMember(db, organizationId, admin, 'admin')

  await configureBillingAndSubscribe(organizationId, 'active')
})

describe('the closure state and the one write gate', () => {
  it('lets an open, subscribed agency write', async () => {
    expect(await stateOf()).toBe('open')
    await expectOpenGate()
    await expect(insertCustomerAsOwner()).resolves.toBeDefined()
  })

  it('refuses a write once closure is requested', async () => {
    await db.sql(
      `update public.organizations
          set closure_requested_at = now(), closure_requested_by = $2,
              closure_purge_after = now() + interval '30 days'
        where id = $1`,
      [organizationId, owner],
    )
    expect(await stateOf()).toBe('suspended')
    await expectShutGate()

    // The same refusal, as a policy gives it, and reads survive.
    await db.asUser(owner, (session) =>
      session.expectRejection(() => insertCustomerAsOwner(), /row-level security/i),
    )
    const readable = await db.asUser(owner, (session) =>
      session.sql(`select id from public.organizations where id = $1`, [organizationId]),
    )
    expect(readable).toHaveLength(1)
  })

  it('refuses a write while purging', async () => {
    await db.sql(
      `update public.organizations
          set closure_requested_at = now() - interval '31 days',
              purge_started_at = now()
        where id = $1`,
      [organizationId],
    )
    expect(await stateOf()).toBe('purging')
    await expectShutGate()
  })

  it('refuses a write when closed', async () => {
    await db.sql(
      `update public.organizations
          set closure_requested_at = now() - interval '31 days',
              purge_started_at = now() - interval '1 day', closed_at = now()
        where id = $1`,
      [organizationId],
    )
    expect(await stateOf()).toBe('closed')
    await expectShutGate()
  })

  it('still refuses a write when billing is restricted and closure is open', async () => {
    await db.exec(`select app.billing_writing(); delete from public.billing_subscriptions;`)
    await configureBillingAndSubscribe(organizationId, 'canceled')

    expect(await stateOf()).toBe('open')
    await expectShutGate()
    await db.asUser(owner, (session) =>
      session.expectRejection(() => insertCustomerAsOwner(), /row-level security/i),
    )
  })

  it('reports closed only after closed_at is set', async () => {
    await db.sql(
      `update public.organizations
          set closure_requested_at = now(), purge_started_at = now()
        where id = $1`,
      [organizationId],
    )
    expect(await stateOf()).toBe('purging')

    await db.sql(`update public.organizations set closed_at = now() where id = $1`, [
      organizationId,
    ])
    expect(await stateOf()).toBe('closed')
  })

  it('gives billing and closure their own sentences', async () => {
    await db.sql(`update public.organizations set closure_requested_at = now() where id = $1`, [
      organizationId,
    ])
    await expect(db.sql(`select app.require_write($1)`, [organizationId])).rejects.toThrow(
      /closed or closing/,
    )

    await db.sql(`update public.organizations set closure_requested_at = null where id = $1`, [
      organizationId,
    ])
    await db.exec(`select app.billing_writing(); delete from public.billing_subscriptions;`)
    await configureBillingAndSubscribe(organizationId, 'canceled')
    await expect(db.sql(`select app.require_write($1)`, [organizationId])).rejects.toThrow(
      /no active subscription/,
    )
  })

  it('treats an organization that does not exist as open, leaving billing to decide', async () => {
    const [row] = await db.sql<{ s: string }>(
      `select app.closure_state_of('00000000-0000-0000-0000-000000000000')::text as s`,
    )
    expect(row!.s).toBe('open')
  })
})

describe('who may move the closure columns', () => {
  it('refuses an administrator who tries to reopen a suspended agency', async () => {
    await db.sql(`update public.organizations set closure_requested_at = now() where id = $1`, [
      organizationId,
    ])
    await db.asUser(admin, (session) =>
      session.expectRejection(
        () =>
          session.sql(`update public.organizations set closure_requested_at = null where id = $1`, [
            organizationId,
          ]),
        /cannot be changed directly/i,
      ),
    )
    expect(await stateOf()).toBe('suspended')
  })

  it('refuses an administrator who tries to stamp closed_at', async () => {
    await db.asUser(admin, (session) =>
      session.expectRejection(
        () =>
          session.sql(`update public.organizations set closed_at = now() where id = $1`, [
            organizationId,
          ]),
        /cannot be changed directly/i,
      ),
    )
  })

  it('still lets an administrator edit the rest of the organization', async () => {
    const rows = await db.asUser(admin, (session) =>
      session.sql(`update public.organizations set name = 'Renamed' where id = $1 returning id`, [
        organizationId,
      ]),
    )
    expect(rows).toHaveLength(1)
  })
})

describe('what stays untouched', () => {
  it('keeps the grants the policies rely on', async () => {
    const [row] = await db.sql<{ auth_new: boolean; auth_old: boolean; anon_new: boolean }>(
      `select has_function_privilege('authenticated', 'app.may_write(uuid)', 'EXECUTE') as auth_new,
              has_function_privilege('authenticated', 'app.billing_may_write(uuid)', 'EXECUTE') as auth_old,
              has_function_privilege('anon', 'app.may_write(uuid)', 'EXECUTE') as anon_new`,
    )
    expect(row).toEqual({ auth_new: true, auth_old: true, anon_new: false })
  })

  it('leaves the organization row in place with the billing tables still attached', async () => {
    await db.sql(`update public.organizations set closed_at = now() where id = $1`, [
      organizationId,
    ])
    const [row] = await db.sql<{ n: string }>(
      `select count(*)::text as n from public.billing_customers where organization_id = $1`,
      [organizationId],
    )
    expect(Number(row!.n)).toBe(1)
  })
})

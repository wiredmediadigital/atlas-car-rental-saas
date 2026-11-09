// @vitest-environment node
/**
 * Requesting closure, and restoring it.
 *
 * The asymmetry is the point: closing an agency is owner-only, restoring one is
 * owner or admin. Each half is asserted next to the other, because a test for
 * one proves nothing about the other.
 *
 * Both functions are exempt from the write gate (a lapsed agency must still be
 * able to leave and to come back) and both are SECURITY DEFINER, because the
 * guard trigger refuses closure-column writes made as `authenticated`.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { TestDatabase, addMember, signUp } from './support/harness'

let db: TestDatabase
let organizationId: string
let owner: string
let admin: string
let manager: string
let staff: string
let seq = 0

const ONLY_OWNER = /only an owner can close/i
const ONLY_OWNER_OR_ADMIN = /only an owner or an administrator can restore/i

async function subscribe(orgId: string, status: string): Promise<void> {
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

interface ClosureRow {
  closure_requested_at: Date | null
  closure_requested_by: string | null
  closure_purge_after: Date | null
  purge_started_at: Date | null
  closed_at: Date | null
}

const requestAs = (userId: string, orgId = organizationId) =>
  db.asUser(userId, (s) =>
    s.sql<ClosureRow>(`select * from public.organization_request_closure($1)`, [orgId]),
  )

const restoreAs = (userId: string, orgId = organizationId) =>
  db.asUser(userId, (s) =>
    s.sql<ClosureRow>(`select * from public.organization_restore($1)`, [orgId]),
  )

async function stateOf(): Promise<string> {
  const [row] = await db.sql<{ s: string }>(`select app.closure_state_of($1)::text as s`, [
    organizationId,
  ])
  return row!.s
}

async function closureColumns(): Promise<ClosureRow> {
  const [row] = await db.sql<ClosureRow>(
    `select closure_requested_at, closure_requested_by, closure_purge_after,
            purge_started_at, closed_at
       from public.organizations where id = $1`,
    [organizationId],
  )
  return row!
}

async function mayWrite(): Promise<boolean> {
  const [row] = await db.sql<{ w: boolean }>(`select app.may_write($1) as w`, [organizationId])
  return row!.w
}

async function newMember(role: 'admin' | 'manager' | 'staff'): Promise<string> {
  const u = await signUp(db, { email: `${role}${seq}@actions.test`, fullName: `${role} user` })
  await addMember(db, organizationId, u.userId, role)
  return u.userId
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
    email: `owner${seq}@actions.test`,
    fullName: 'Owner One',
    organizationName: `Actions ${seq}`,
    currency: 'EUR',
    timeZone: 'Europe/Paris',
  })
  if (!o.organizationId) throw new Error('provisioning failed')
  organizationId = o.organizationId
  owner = o.userId
  admin = await newMember('admin')
  manager = await newMember('manager')
  staff = await newMember('staff')
  await subscribe(organizationId, 'active')
})

describe('requesting closure', () => {
  it('lets an owner request closure', async () => {
    const [row] = await requestAs(owner)

    expect(row!.closure_requested_at).not.toBeNull()
    expect(row!.closure_requested_by).toBe(owner)
    expect(row!.purge_started_at).toBeNull()
    expect(row!.closed_at).toBeNull()
    expect(await stateOf()).toBe('suspended')
    expect(await mayWrite()).toBe(false)
  })

  it('refuses closure to an admin', async () => {
    await db.asUser(admin, (s) =>
      s.expectRejection(
        () => s.sql(`select public.organization_request_closure($1)`, [organizationId]),
        ONLY_OWNER,
      ),
    )
    expect(await stateOf()).toBe('open')
  })

  it('refuses closure to a manager and to staff', async () => {
    for (const who of [manager, staff]) {
      await db.asUser(who, (s) =>
        s.expectRejection(
          () => s.sql(`select public.organization_request_closure($1)`, [organizationId]),
          ONLY_OWNER,
        ),
      )
    }
    expect(await stateOf()).toBe('open')
  })

  it('sets the purge date 30 days out', async () => {
    await requestAs(owner)
    const [row] = await db.sql<{ gap: string }>(
      `select (closure_purge_after - closure_requested_at)::text as gap
         from public.organizations where id = $1`,
      [organizationId],
    )
    expect(row!.gap).toBe('30 days')
  })

  it('has no way for a caller to shorten the window', async () => {
    // One function, one parameter: nothing to pass.
    const sigs = await db.sql<{ nargs: number; secdef: boolean }>(
      `select p.pronargs::int as nargs, p.prosecdef as secdef
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'organization_request_closure'`,
    )
    expect(sigs).toEqual([{ nargs: 1, secdef: true }])

    await db.asUser(owner, (s) =>
      s.expectRejection(() =>
        s.sql(`select public.organization_request_closure($1, now())`, [organizationId]),
      ),
    )

    // And the purge date cannot be pulled in afterwards, by hand or by asking again.
    await requestAs(owner)
    const before = await closureColumns()
    await db.asUser(owner, (s) =>
      s.expectRejection(
        () =>
          s.sql(`update public.organizations set closure_purge_after = now() where id = $1`, [
            organizationId,
          ]),
        /cannot be changed directly/i,
      ),
    )
    await db.asUser(owner, (s) =>
      s.expectRejection(
        () => s.sql(`select public.organization_request_closure($1)`, [organizationId]),
        /already/i,
      ),
    )
    expect(await closureColumns()).toEqual(before)
  })

  it('lets a billing-restricted agency request closure', async () => {
    await db.exec(`select app.billing_writing(); delete from public.billing_subscriptions;`)
    await subscribe(organizationId, 'canceled')
    expect(await mayWrite()).toBe(false)

    await expect(requestAs(owner)).resolves.toHaveLength(1)
    expect(await stateOf()).toBe('suspended')
  })

  it('lets an agency that never subscribed request closure', async () => {
    await db.exec(`select app.billing_writing(); delete from public.billing_subscriptions;`)
    expect(await mayWrite()).toBe(false)

    await expect(requestAs(owner)).resolves.toHaveLength(1)
    expect(await stateOf()).toBe('suspended')
  })

  it('records the requester by id and never their email', async () => {
    await requestAs(owner)
    expect((await closureColumns()).closure_requested_by).toBe(owner)

    const columns = await db.sql<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_schema = 'public' and table_name = 'account_closure_events'`,
    )
    const names = columns.map((c) => c.column_name)
    expect(names).toContain('requested_by')
    expect(names.filter((n) => /mail/i.test(n))).toEqual([])
  })

  it('refuses a member of another agency entirely', async () => {
    const other = await signUp(db, {
      email: `other${seq}@actions.test`,
      fullName: 'Other Owner',
      organizationName: `Other ${seq}`,
    })
    await db.asUser(other.userId, (s) =>
      s.expectRejection(
        () => s.sql(`select public.organization_request_closure($1)`, [organizationId]),
        ONLY_OWNER,
      ),
    )
    // Restoring someone else's closure is refused just the same, and a
    // missing organization gets the identical answer: no existence oracle.
    await requestAs(owner)
    await db.asUser(other.userId, (s) =>
      s.expectRejection(
        () => s.sql(`select public.organization_restore($1)`, [organizationId]),
        ONLY_OWNER_OR_ADMIN,
      ),
    )
    await db.asUser(other.userId, (s) =>
      s.expectRejection(
        () =>
          s.sql(`select public.organization_request_closure($1)`, [
            '00000000-0000-0000-0000-000000000000',
          ]),
        ONLY_OWNER,
      ),
    )
    expect(await stateOf()).toBe('suspended')
  })
})

describe('restoring', () => {
  beforeEach(async () => {
    await requestAs(owner)
  })

  it('lets an admin restore', async () => {
    const [row] = await restoreAs(admin)

    expect(row!.closure_requested_at).toBeNull()
    expect(row!.closure_requested_by).toBeNull()
    expect(row!.closure_purge_after).toBeNull()
    expect(await stateOf()).toBe('open')
    expect(await mayWrite()).toBe(true)
  })

  it('lets an owner restore', async () => {
    await restoreAs(owner)
    expect(await stateOf()).toBe('open')
  })

  it('refuses a restore to a manager and to staff', async () => {
    for (const who of [manager, staff]) {
      await db.asUser(who, (s) =>
        s.expectRejection(
          () => s.sql(`select public.organization_restore($1)`, [organizationId]),
          ONLY_OWNER_OR_ADMIN,
        ),
      )
    }
    expect(await stateOf()).toBe('suspended')
  })

  it('lets a billing-restricted agency restore', async () => {
    await db.exec(`select app.billing_writing(); delete from public.billing_subscriptions;`)
    await subscribe(organizationId, 'canceled')

    await expect(restoreAs(admin)).resolves.toHaveLength(1)
    expect(await stateOf()).toBe('open')
  })

  it('refuses a restore once the purge has started', async () => {
    await db.sql(`update public.organizations set purge_started_at = now() where id = $1`, [
      organizationId,
    ])
    await db.asUser(admin, (s) =>
      s.expectRejection(
        () => s.sql(`select public.organization_restore($1)`, [organizationId]),
        /purge of this agency has started/i,
      ),
    )
    expect(await stateOf()).toBe('purging')

    await db.sql(`update public.organizations set closed_at = now() where id = $1`, [
      organizationId,
    ])
    await db.asUser(owner, (s) =>
      s.expectRejection(
        () => s.sql(`select public.organization_restore($1)`, [organizationId]),
        /purge of this agency has started/i,
      ),
    )
    expect(await stateOf()).toBe('closed')
  })

  it('refuses to restore an agency that is not closing', async () => {
    await restoreAs(admin)
    await db.asUser(admin, (s) =>
      s.expectRejection(
        () => s.sql(`select public.organization_restore($1)`, [organizationId]),
        /not closing/i,
      ),
    )
  })

  it('lets the agency be closed again after a restore', async () => {
    await restoreAs(admin)
    await requestAs(owner)
    expect(await stateOf()).toBe('suspended')
  })
})

describe('privileges and the evidence tables', () => {
  it('is callable by a signed-in user and not by anon', async () => {
    const [row] = await db.sql<{ a1: boolean; a2: boolean; n1: boolean; n2: boolean }>(
      `select has_function_privilege('authenticated', 'public.organization_request_closure(uuid)', 'EXECUTE') as a1,
              has_function_privilege('authenticated', 'public.organization_restore(uuid)', 'EXECUTE') as a2,
              has_function_privilege('anon', 'public.organization_request_closure(uuid)', 'EXECUTE') as n1,
              has_function_privilege('anon', 'public.organization_restore(uuid)', 'EXECUTE') as n2`,
    )
    expect(row).toEqual({ a1: true, a2: true, n1: false, n2: false })
  })

  it('makes both functions SECURITY DEFINER with an empty search_path', async () => {
    const rows = await db.sql<{ proname: string; secdef: boolean; cfg: string[] | null }>(
      `select p.proname, p.prosecdef as secdef, p.proconfig as cfg
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname in ('organization_request_closure', 'organization_restore')
        order by p.proname`,
    )
    expect(rows).toHaveLength(2)
    for (const r of rows) {
      expect(r.secdef).toBe(true)
      expect(r.cfg).toContain('search_path=""')
    }
  })

  it('keeps the evidence tables away from browser roles and open to the service role', async () => {
    for (const table of ['account_closure_events', 'account_closure_objects']) {
      await db.asUser(owner, (s) =>
        s.expectRejection(() => s.sql(`select * from public.${table}`), /permission denied/i),
      )
      await db.asAnon((s) =>
        s.expectRejection(() => s.sql(`select * from public.${table}`), /permission denied/i),
      )
      const rows = await db.asServiceRole(owner, (s) =>
        s.sql(`select count(*)::int as n from public.${table}`),
      )
      expect(rows).toHaveLength(1)
    }
  })

  it('has no policy that admits a browser role', async () => {
    const policies = await db.sql<{ qual: string | null; cmd: string }>(
      `select pg_get_expr(p.polqual, p.polrelid) as qual, p.polcmd::text as cmd
         from pg_policy p join pg_class c on c.oid = p.polrelid
        where c.relname in ('account_closure_events', 'account_closure_objects')`,
    )
    expect(policies).toHaveLength(2)
    for (const p of policies) expect(p.qual).toBe('false')
  })

  it('stores counts as jsonb and storage keys for a resumable sweep', async () => {
    const cols = await db.sql<{ table_name: string; column_name: string; data_type: string }>(
      `select table_name, column_name, data_type from information_schema.columns
        where table_schema = 'public'
          and table_name in ('account_closure_events', 'account_closure_objects')`,
    )
    const has = (t: string, c: string) =>
      cols.find((x) => x.table_name === t && x.column_name === c)
    expect(has('account_closure_events', 'table_counts')?.data_type).toBe('jsonb')
    expect(has('account_closure_events', 'organization_id')).toBeDefined()
    expect(has('account_closure_events', 'organization_name')).toBeDefined()
    expect(has('account_closure_events', 'requested_at')).toBeDefined()
    expect(has('account_closure_events', 'purged_at')).toBeDefined()
    expect(has('account_closure_objects', 'storage_key')).toBeDefined()
    expect(has('account_closure_objects', 'bucket')).toBeDefined()
  })
})

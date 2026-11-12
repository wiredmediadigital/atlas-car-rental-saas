// @vitest-environment node
/**
 * The read-only wind-down, against a real PostgreSQL.
 *
 * An agency without a live subscription keeps everything it can READ and loses
 * everything it can WRITE. That sentence is a commercial decision, and this file
 * exists because a commercial decision implemented in 54 policies and four
 * function bodies is only as true as the last person to edit one of them.
 *
 * Three things are being asserted, and the second is the one that matters most.
 *
 *   1. THE MAPPING. Which Stripe statuses restrict and which do not. past_due
 *      must not restrict — Stripe is still retrying, and a large share of those
 *      retries succeed. unpaid and canceled must, because that is Stripe saying
 *      it has given up.
 *
 *   2. THAT READS SURVIVE. Every test that asserts a write is refused is paired
 *      with one asserting the same actor can still read the same table. A
 *      regression here would not look like a bug: it would look like the
 *      product working, right up until a customer with four years of records
 *      stopped paying and found they could not open any of them.
 *
 *   3. THAT THE WAYS OUT STAY OPEN. Billing, settings, the owner's own profile,
 *      removing staff and transferring ownership all keep working while
 *      restricted. A restriction nobody can undo from inside is not a
 *      restriction, it is a trap.
 *
 * Nothing here talks to Stripe. The webhook's own half is billing.test.ts.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { TestDatabase, addMember, signUp } from './support/harness'

let db: TestDatabase

interface Cast {
  organizationId: string
  owner: string
  admin: string
  manager: string
  staff: string
  outsider: string
}

let cast: Cast
let seq = 0

async function seedCast(): Promise<Cast> {
  seq += 1
  const owner = await signUp(db, {
    email: `owner${seq}@restrict.test`,
    fullName: 'Owner One',
    organizationName: `Restricted ${seq}`,
    currency: 'EUR',
    timeZone: 'Europe/Paris',
  })
  if (!owner.organizationId) throw new Error('provisioning failed')

  const admin = await signUp(db, { email: `admin${seq}@restrict.test`, fullName: 'Admin One' })
  const manager = await signUp(db, { email: `manager${seq}@restrict.test`, fullName: 'Mgr One' })
  const staff = await signUp(db, { email: `staff${seq}@restrict.test`, fullName: 'Staff One' })
  const outsider = await signUp(db, { email: `out${seq}@restrict.test`, fullName: 'Outsider' })

  await addMember(db, owner.organizationId, admin.userId, 'admin')
  await addMember(db, owner.organizationId, manager.userId, 'manager')
  await addMember(db, owner.organizationId, staff.userId, 'staff')

  return {
    organizationId: owner.organizationId,
    owner: owner.userId,
    admin: admin.userId,
    manager: manager.userId,
    staff: staff.userId,
    outsider: outsider.userId,
  }
}

/** Puts the deployment into a configured state, the way the billing service would. */
async function configurePlatform(organizationId: string): Promise<void> {
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
    organizationId,
    `cus_test_${organizationId.slice(0, 8)}`,
    'billing@agency.test',
  ])
}

/** Applies a subscription the way a verified webhook would. */
async function applySubscription(organizationId: string, status: string): Promise<void> {
  await db.sql(
    `select app.billing_apply_subscription(
       $1, $2, 'test', $3::public.stripe_subscription_status, 'price_test_standard',
       'EUR', 4900, 'month', 1, 1,
       now() - interval '5 days', now() + interval '25 days',
       false, null, null, null, null, null,
       now(), $4
     )`,
    [
      `sub_test_${organizationId.slice(0, 8)}`,
      `cus_test_${organizationId.slice(0, 8)}`,
      status,
      `evt_${status}_${organizationId.slice(0, 8)}`,
    ],
  )
}

async function clearSubscriptions(): Promise<void> {
  await db.exec(`
    select app.billing_writing();
    delete from public.billing_subscriptions;
  `)
}

/** The state as the product sees it, read through the member-facing function. */
async function accessState(actor: string): Promise<string> {
  const [row] = await db.asUser(actor, (session) =>
    session.sql<{ state: string }>(`select public.billing_access($1) as state`, [
      cast.organizationId,
    ]),
  )
  return row!.state
}

/** Puts the agency into the fully restricted state used by most tests below. */
async function restrict(): Promise<void> {
  await clearSubscriptions()
  await applySubscription(cast.organizationId, 'canceled')
}

beforeAll(async () => {
  db = await TestDatabase.create()
})

afterAll(async () => {
  await db.close()
})

beforeEach(async () => {
  cast = await seedCast()
  await configurePlatform(cast.organizationId)
})

// ---------------------------------------------------------------------------
// 1. The mapping
// ---------------------------------------------------------------------------

describe('Stripe status becomes product access', () => {
  const KEEPS_ACCESS = ['active', 'trialing', 'past_due', 'incomplete'] as const
  const RESTRICTS = ['unpaid', 'canceled', 'paused', 'incomplete_expired'] as const

  it.each(KEEPS_ACCESS)('%s is not restricted', async (status) => {
    await clearSubscriptions()
    await applySubscription(cast.organizationId, status)
    expect(await accessState(cast.owner)).not.toBe('restricted')
  })

  it.each(RESTRICTS)('%s is restricted', async (status) => {
    await clearSubscriptions()
    await applySubscription(cast.organizationId, status)
    expect(await accessState(cast.owner)).toBe('restricted')
  })

  it('calls a healthy subscription normal and a retrying one attention', async () => {
    await clearSubscriptions()
    await applySubscription(cast.organizationId, 'active')
    expect(await accessState(cast.owner)).toBe('normal')

    await clearSubscriptions()
    await applySubscription(cast.organizationId, 'trialing')
    expect(await accessState(cast.owner)).toBe('normal')

    await clearSubscriptions()
    await applySubscription(cast.organizationId, 'past_due')
    expect(await accessState(cast.owner)).toBe('attention')
  })

  it('restricts an agency that has never subscribed', async () => {
    await clearSubscriptions()
    expect(await accessState(cast.owner)).toBe('restricted')
  })

  it('leaves a deployment that never launched billing alone', async () => {
    /*
     * The self-hosted case, and the one that must never be locked out: no
     * Stripe credential and no sellable plan means nobody was ever offered a
     * subscription, so there is nothing to withhold.
     */
    await clearSubscriptions()
    await db.sql(`select app.billing_report_platform_state(false, null, 'Not configured.')`)
    await db.sql(`select app.billing_replace_catalogue('[]'::jsonb)`)

    expect(await accessState(cast.owner)).toBe('platform_unconfigured')

    await db.asUser(cast.manager, (session) =>
      session.sql(
        `insert into public.vehicles (organization_id, make, model, registration_plate, currency, daily_rate_minor)
         values ($1, 'Toyota', 'Corolla', $2, 'EUR', 45000)`,
        [cast.organizationId, `UNCONF-${seq}`],
      ),
    )
  })
})

// ---------------------------------------------------------------------------
// 2. Read-only, and genuinely read-only
// ---------------------------------------------------------------------------

describe('a restricted agency', () => {
  beforeEach(async () => {
    // Something to read later, written while the subscription was still live.
    await applySubscription(cast.organizationId, 'active')
    await db.asUser(cast.manager, (session) =>
      session.sql(
        `insert into public.vehicles (organization_id, make, model, registration_plate, currency, daily_rate_minor)
         values ($1, 'Toyota', 'Corolla', $2, 'EUR', 45000)`,
        [cast.organizationId, `PLATE-${seq}`],
      ),
    )
    await db.asUser(cast.staff, (session) =>
      session.sql(
        `insert into public.customers (organization_id, first_name, last_name, email)
         values ($1, 'Past', 'Customer', $2)`,
        [cast.organizationId, `past-${seq}@example.test`],
      ),
    )
    await restrict()
  })

  it('can still read everything it recorded', async () => {
    const vehicles = await db.asUser(cast.staff, (session) =>
      session.sql(`select id from public.vehicles where organization_id = $1`, [
        cast.organizationId,
      ]),
    )
    const customers = await db.asUser(cast.staff, (session) =>
      session.sql(`select id from public.customers where organization_id = $1`, [
        cast.organizationId,
      ]),
    )

    expect(vehicles).toHaveLength(1)
    expect(customers).toHaveLength(1)
  })

  it('can still run the reports it could run before', async () => {
    const rows = await db.asUser(cast.owner, (session) =>
      session.sql(
        `select * from public.organization_overview($1::uuid, now() - interval '30 days', now())`,
        [cast.organizationId],
      ),
    )
    expect(rows).toHaveLength(1)
  })

  it('cannot create a vehicle', async () => {
    await db.asUser(cast.manager, (session) =>
      session.expectRejection(
        () =>
          session.sql(
            `insert into public.vehicles (organization_id, make, model, registration_plate, currency, daily_rate_minor)
             values ($1, 'New', 'Car', $2, 'EUR', 45000)`,
            [cast.organizationId, `BLOCKED-${seq}`],
          ),
        /row-level security/i,
      ),
    )
  })

  it('cannot create a customer', async () => {
    await db.asUser(cast.staff, (session) =>
      session.expectRejection(
        () =>
          session.sql(
            `insert into public.customers (organization_id, first_name, last_name, email)
             values ($1, 'New', 'Customer', $2)`,
            [cast.organizationId, `new-${seq}@example.test`],
          ),
        /row-level security/i,
      ),
    )
  })

  it('cannot change a vehicle it already has', async () => {
    const affected = await db.asUser(cast.manager, (session) =>
      session.sql(
        `update public.vehicles set model = 'Renamed' where organization_id = $1
                   returning id`,
        [cast.organizationId],
      ),
    )
    expect(affected).toHaveLength(0)
  })

  it('cannot delete a customer it already has', async () => {
    const affected = await db.asUser(cast.admin, (session) =>
      session.sql(`delete from public.customers where organization_id = $1 returning id`, [
        cast.organizationId,
      ]),
    )
    expect(affected).toHaveLength(0)
  })

  it('is refused at every role, including the owner', async () => {
    for (const actor of [cast.owner, cast.admin, cast.manager, cast.staff]) {
      await db.asUser(actor, (session) =>
        session.expectRejection(
          () =>
            session.sql(
              `insert into public.customers (organization_id, first_name, last_name)
               values ($1, 'Role', 'Test')`,
              [cast.organizationId],
            ),
          /row-level security/i,
        ),
      )
    }
  })
})

// ---------------------------------------------------------------------------
// 3. The ways out stay open
// ---------------------------------------------------------------------------

describe('while restricted, an agency can still', () => {
  beforeEach(restrict)

  it('reach its own Billing workspace', async () => {
    const [row] = await db.asUser(cast.owner, (session) =>
      session.sql<{ access_state: string }>(`select * from public.billing_overview($1)`, [
        cast.organizationId,
      ]),
    )
    expect(row!.access_state).toBe('restricted')
  })

  it('see the plans it could buy', async () => {
    const plans = await db.asUser(cast.owner, (session) =>
      session.sql(`select * from public.billing_available_plans($1)`, [cast.organizationId]),
    )
    expect(plans.length).toBeGreaterThan(0)
  })

  it('correct the address its invoices are sent to', async () => {
    await db.asUser(cast.owner, (session) =>
      session.sql(`select public.billing_set_email($1, 'new-billing@agency.test')`, [
        cast.organizationId,
      ]),
    )
    const [row] = await db.sql<{ billing_email: string }>(
      `select billing_email from public.billing_customers where organization_id = $1`,
      [cast.organizationId],
    )
    expect(row!.billing_email).toBe('new-billing@agency.test')
  })

  it('edit its own agency settings', async () => {
    const affected = await db.asUser(cast.admin, (session) =>
      session.sql(
        `update public.organizations set name = 'Renamed Agency' where id = $1
                   returning id`,
        [cast.organizationId],
      ),
    )
    expect(affected).toHaveLength(1)
  })

  it('edit a person their own profile', async () => {
    const affected = await db.asUser(cast.staff, (session) =>
      session.sql(
        `update public.profiles set full_name = 'Renamed Person' where id = $1
                   returning id`,
        [cast.staff],
      ),
    )
    expect(affected).toHaveLength(1)
  })

  it('remove a member of staff', async () => {
    await db.asUser(cast.owner, (session) =>
      session.sql(`select public.remove_team_member($1, $2)`, [cast.organizationId, cast.staff]),
    )
    const rows = await db.sql(
      `select 1 from public.organization_members where organization_id = $1 and user_id = $2`,
      [cast.organizationId, cast.staff],
    )
    expect(rows).toEqual([])
  })

  it('hand the agency to somebody who can pay for it', async () => {
    /*
     * The single most important exemption in the whole design. An agency whose
     * owner has gone needs this to reach a paying subscription at all; gating
     * it would make the restriction permanent by construction.
     */
    await db.asUser(cast.owner, (session) =>
      session.sql(`select public.transfer_organization_ownership($1, $2)`, [
        cast.organizationId,
        cast.admin,
      ]),
    )
    const [row] = await db.sql<{ role: string }>(
      `select role from public.organization_members where organization_id = $1 and user_id = $2`,
      [cast.organizationId, cast.admin],
    )
    expect(row!.role).toBe('owner')
  })

  it('put away the notification telling it that it is restricted', async () => {
    const feed = await db.asUser(cast.owner, (session) =>
      session.sql<{ fingerprint: string; severity: string }>(
        `select fingerprint, severity from public.notification_feed($1)`,
        [cast.organizationId],
      ),
    )
    const billing = feed.find((row) => row.fingerprint.startsWith('billing_attention:'))
    expect(billing?.severity).toBe('urgent')

    await db.asUser(cast.owner, (session) =>
      session.sql(`select public.notification_dismiss($1, $2)`, [
        cast.organizationId,
        billing!.fingerprint,
      ]),
    )
  })
})

// ---------------------------------------------------------------------------
// 4. The functions that bypass RLS
// ---------------------------------------------------------------------------

describe('functions that write around the policies', () => {
  let vehicleId: string
  let lenderId: string
  let agreementId: string

  beforeEach(async () => {
    await applySubscription(cast.organizationId, 'active')

    const [vehicle] = await db.sql<{ id: string }>(
      `insert into public.vehicles (organization_id, make, model, registration_plate, currency, daily_rate_minor)
       values ($1, 'Dacia', 'Logan', $2, 'EUR', 30000) returning id`,
      [cast.organizationId, `FIN-${seq}`],
    )
    const [lender] = await db.sql<{ id: string }>(
      `insert into public.lenders (organization_id, name, kind) values ($1, 'A Bank', 'bank')
       returning id`,
      [cast.organizationId],
    )
    const [agreement] = await db.sql<{ id: string }>(
      `insert into public.financing_agreements (
         organization_id, vehicle_id, lender_id, mode, currency,
         financed_amount_minor, rate_bps, installments_count,
         payment_frequency, first_payment_on, schedule_anchor_day, starts_on
       ) values ($1, $2, $3, 'amortizing', 'EUR', 1200000, 600, 24,
         'monthly', current_date, extract(day from current_date)::smallint, current_date)
       returning id`,
      [cast.organizationId, vehicle!.id, lender!.id],
    )
    vehicleId = vehicle!.id
    lenderId = lender!.id
    agreementId = agreement!.id

    await restrict()
  })

  it('refuses to activate a financing agreement', async () => {
    await db.asUser(cast.admin, (session) =>
      session.expectRejection(
        () => session.sql(`select public.financing_activate_agreement($1)`, [agreementId]),
        /no active subscription/i,
      ),
    )
  })

  it('refuses to generate a financing schedule', async () => {
    await db.asUser(cast.admin, (session) =>
      session.expectRejection(
        () => session.sql(`select public.financing_generate_schedule($1)`, [agreementId]),
        /no active subscription/i,
      ),
    )
  })

  it('still answers "not found" for another agency, not "unpaid"', async () => {
    /*
     * The order of the checks inside the function. Billing is asked only after
     * the record is found and the role is confirmed, so an id belonging to
     * somebody else cannot be used to learn which agencies have stopped paying.
     */
    await db.asUser(cast.outsider, (session) =>
      session.expectRejection(
        () => session.sql(`select public.financing_activate_agreement($1)`, [agreementId]),
        /not found/i,
      ),
    )
  })

  it('refuses to invite new staff', async () => {
    await db.asUser(cast.owner, (session) =>
      session.expectRejection(
        () =>
          session.sql(`select * from public.create_team_invitation($1, $2, 'staff')`, [
            cast.organizationId,
            `recruit-${seq}@example.test`,
          ]),
        /no active subscription/i,
      ),
    )
  })

  it('refuses to resend an invitation issued while it was paying', async () => {
    await clearSubscriptions()
    await applySubscription(cast.organizationId, 'active')
    const [invitation] = await db.asUser(cast.owner, (session) =>
      session.sql<{ invitation_id: string }>(
        `select * from public.create_team_invitation($1, $2, 'staff')`,
        [cast.organizationId, `recruit2-${seq}@example.test`],
      ),
    )
    await restrict()

    await db.asUser(cast.owner, (session) =>
      session.expectRejection(
        () =>
          session.sql(`select * from public.resend_team_invitation($1)`, [
            invitation!.invitation_id,
          ]),
        /no active subscription/i,
      ),
    )
  })

  it('still lets an invitation be revoked', async () => {
    await clearSubscriptions()
    await applySubscription(cast.organizationId, 'active')
    const [invitation] = await db.asUser(cast.owner, (session) =>
      session.sql<{ invitation_id: string }>(
        `select * from public.create_team_invitation($1, $2, 'staff')`,
        [cast.organizationId, `recruit3-${seq}@example.test`],
      ),
    )
    await restrict()

    await db.asUser(cast.owner, (session) =>
      session.sql(`select public.revoke_team_invitation($1)`, [invitation!.invitation_id]),
    )
    const [row] = await db.sql<{ revoked_at: string | null }>(
      `select revoked_at from public.organization_invitations where id = $1`,
      [invitation!.invitation_id],
    )
    expect(row!.revoked_at).not.toBeNull()
  })

  it('lets all of it through again once the subscription is live', async () => {
    await clearSubscriptions()
    await applySubscription(cast.organizationId, 'active')

    const [written] = await db.asUser(cast.admin, (session) =>
      session.sql<{ n: number }>(`select public.financing_generate_schedule($1) as n`, [
        agreementId,
      ]),
    )
    expect(written!.n).toBe(24)
    expect(vehicleId).toBeTruthy()
    expect(lenderId).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
// 5. past_due keeps working, because Stripe has not given up
// ---------------------------------------------------------------------------

describe('an agency whose card just failed', () => {
  beforeEach(async () => {
    await clearSubscriptions()
    await applySubscription(cast.organizationId, 'past_due')
  })

  it('is told to pay attention, not shut out', async () => {
    expect(await accessState(cast.owner)).toBe('attention')
  })

  it('carries on working', async () => {
    await db.asUser(cast.staff, (session) =>
      session.sql(
        `insert into public.customers (organization_id, first_name, last_name, email)
         values ($1, 'Still', 'Working', $2)`,
        [cast.organizationId, `pastdue-${seq}@example.test`],
      ),
    )
    const rows = await db.asUser(cast.staff, (session) =>
      session.sql(`select id from public.customers where organization_id = $1`, [
        cast.organizationId,
      ]),
    )
    expect(rows).toHaveLength(1)
  })

  it('is shut out the moment Stripe moves it to unpaid', async () => {
    await clearSubscriptions()
    await applySubscription(cast.organizationId, 'unpaid')
    expect(await accessState(cast.owner)).toBe('restricted')

    await db.asUser(cast.staff, (session) =>
      session.expectRejection(
        () =>
          session.sql(
            `insert into public.customers (organization_id, first_name, last_name)
             values ($1, 'No', 'Longer')`,
            [cast.organizationId],
          ),
        /row-level security/i,
      ),
    )
  })
})

// ---------------------------------------------------------------------------
// 6. The shape of the gate itself
//
// These do not exercise behaviour; they assert that the gate is where it is
// supposed to be and nowhere it is not. They are the tests that catch a later
// migration adding an ungated write policy, or folding the billing check into
// the role helper and taking reads down with it.
// ---------------------------------------------------------------------------

describe('the gate, structurally', () => {
  it('is on no SELECT policy anywhere', async () => {
    const rows = await db.sql<{ tablename: string; policyname: string }>(`
      select tablename, policyname from pg_policies
      where schemaname = 'public' and cmd = 'SELECT'
        and coalesce(qual, '') like '%billing_may_write%'
    `)
    expect(rows).toEqual([])
  })

  it('is on every write policy of every tenant data table', async () => {
    const rows = await db.sql<{ tablename: string; policyname: string }>(`
      select tablename, policyname from pg_policies
      where schemaname = 'public'
        and cmd <> 'SELECT'
        and tablename in (
          'vehicles','vehicle_images','vehicle_documents','gps_unit_assignments',
          'customers','customer_documents',
          'rentals','rental_line_items','rental_drivers','rental_contracts',
          'rental_condition_photos','payments',
          'expenses','expense_categories','expense_vendors','expense_attachments',
          'lenders','financing_agreements','financing_payments','financing_documents')
        and coalesce(qual, '') || coalesce(with_check, '') not like '%billing_may_write%'
    `)
    expect(rows).toEqual([])
  })

  it('covers 54 write policies and no fewer', async () => {
    const [row] = await db.sql<{ n: number }>(`
      select count(*)::int as n from pg_policies
      where schemaname = 'public' and cmd <> 'SELECT'
        and coalesce(qual, '') || coalesce(with_check, '') like '%billing_may_write%'
    `)
    expect(row!.n).toBe(54)
  })

  it('is not inside app.has_min_role, which guards reads too', async () => {
    const [row] = await db.sql<{ body: string }>(`
      select pg_get_functiondef(p.oid) as body from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'app' and p.proname = 'has_min_role'
    `)
    expect(row!.body).not.toMatch(/billing/i)
  })

  it('is executable by authenticated and by nobody else', async () => {
    const [row] = await db.sql<{ auth: boolean; anon: boolean; pub: boolean }>(`
      select has_function_privilege('authenticated', 'app.billing_may_write(uuid)', 'EXECUTE') as auth,
             has_function_privilege('anon', 'app.billing_may_write(uuid)', 'EXECUTE') as anon,
             has_function_privilege('public', 'app.billing_may_write(uuid)', 'EXECUTE') as pub
    `)
    expect(row!.auth).toBe(true)
    expect(row!.anon).toBe(false)
    expect(row!.pub).toBe(false)
  })

  it('leaves no SECURITY DEFINER write path ungated and unexplained', async () => {
    /*
     * The same derivation the migration performs, repeated as a test so the
     * list cannot drift: anything definer, callable by a signed-in user, that
     * writes a table, must either ask app.billing_require_write or appear in
     * this list with a reason beside it in 20261103100200.
     *
     * 20261103100200 CAN NEVER BE EDITED, so the reasons for anything added
     * since are written in the header of the migration that added it: the two
     * closure actions in 20261108100100, and the re-derivation of the whole
     * "ways out" group against closure in 20261110100500, and mfa_generate_recovery_codes in 20261112100100 (sign-in
     * security belongs to a person, not an agency, so billing state must never block it).
     * An entry whose reason
     * is in neither place has no reason, which is the thing this test exists to
     * make visible.
     */
    const exempt = [
      'billing_set_email',
      'notification_dismiss',
      'notification_mark_read',
      'notification_mark_all_read',
      'notification_snooze',
      'notification_preference_set',
      'revoke_team_invitation',
      'remove_team_member',
      'leave_organization',
      'change_team_member_role',
      'transfer_organization_ownership',
      'accept_team_invitation',
      'record_invitation_delivery',
      'create_organization',
      'organization_request_closure',
      'organization_restore',
      'mfa_generate_recovery_codes',
    ]
    const rows = await db.sql<{ proname: string }>(
      `
      select p.proname from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.prosecdef
        and has_function_privilege('authenticated', p.oid, 'EXECUTE')
        and pg_get_functiondef(p.oid) ~* '\\m(insert\\s+into|update|delete\\s+from)\\s+public\\.'
        and pg_get_functiondef(p.oid) not like '%billing_require_write%'
        and not (p.proname = any ($1::text[]))
      `,
      [exempt],
    )
    expect(rows.map((row) => row.proname)).toEqual([])
  })
})

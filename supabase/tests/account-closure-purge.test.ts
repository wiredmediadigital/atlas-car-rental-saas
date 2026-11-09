// @vitest-environment node
/**
 * The purge: the one irreversible thing on this branch.
 *
 * What these tests hold in place, in order of how badly it would hurt to lose it:
 *
 *   * a claim is exclusive and only succeeds for an agency that is due;
 *   * the storage keys are written down BEFORE any row is deleted;
 *   * no row naming the agency survives, in any table, except the billing and
 *     evidence records that must;
 *   * the organization row itself survives, as a tombstone with the legal name;
 *   * another agency is untouched;
 *   * the evidence record holds counts and never content.
 *
 * The harness is a single connection, so the race between a restore and a claim
 * cannot be run here. That one is held by construction: the claim takes the row
 * lock as its first statement, and a structural test below pins that order.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { TestDatabase, signUp } from './support/harness'

let db: TestDatabase
let seq = 0

const SECRET_NAME = 'Zephyrine Quillfeather'
const SECRET_EMAIL = 'zephyrine.quillfeather@private.test'

interface Agency {
  organizationId: string
  owner: string
  legalName: string | null
  name: string
}

interface Seeded extends Agency {
  customerId: string
  vehicleId: string
  rentalId: string
  expenseId: string
  voidedExpenseId: string
  agreementId: string
  connectionId: string
  keys: { bucket: string; key: string }[]
}

async function one<T>(query: string, params: unknown[] = []): Promise<T> {
  const [row] = await db.sql<T>(query, params)
  if (!row) throw new Error(`No row returned by: ${query}`)
  return row
}

async function newAgency(label: string, legalName: string | null): Promise<Agency> {
  seq += 1
  const name = `${label} ${seq}`
  const user = await signUp(db, {
    email: `owner${seq}@purge.test`,
    fullName: SECRET_NAME,
    organizationName: name,
    currency: 'EUR',
    timeZone: 'Europe/Paris',
  })
  if (!user.organizationId) throw new Error('provisioning failed')
  await db.sql(
    `update public.organizations
        set legal_name = $2, tax_identifier = 'FR123456789', email = $3, phone = '+33 1 23 45 67 89',
            website = 'https://agency.test', address_line1 = '1 Rue Privee', city = 'Paris',
            postal_code = '75001', region = 'IDF', country_code = 'FR',
            logo_path = $4
      where id = $1`,
    [user.organizationId, legalName, SECRET_EMAIL, `${user.organizationId}/logo.png`],
  )
  return { organizationId: user.organizationId, owner: user.userId, legalName, name }
}

/**
 * One row in every table the purge is meant to empty, so that "no row is left"
 * is a statement about every table and not about the ones that were easy to fill.
 */
async function seed(agency: Agency): Promise<Seeded> {
  const org = agency.organizationId
  const keys: { bucket: string; key: string }[] = []
  const at = (bucket: string, rest: string) => {
    const key = `${org}/${rest}`
    keys.push({ bucket, key })
    return key
  }

  const customer = await one<{ id: string }>(
    `insert into public.customers (organization_id, first_name, last_name, email)
     values ($1, 'Zephyrine', 'Quillfeather', $2) returning id`,
    [org, SECRET_EMAIL],
  )
  await db.sql(
    `insert into public.customer_documents
       (organization_id, customer_id, document_type, document_number, file_path, file_mime_type)
     values ($1, $2, 'passport', 'P-SECRET-1', $3, 'image/jpeg'),
            ($1, $2, 'national_id', 'N-SECRET-2', $4, 'image/jpeg')`,
    [
      org,
      customer.id,
      at('customer-documents', 'passport.jpg'),
      at('customer-documents', 'dl.jpg'),
    ],
  )

  const vehicle = await one<{ id: string }>(
    `insert into public.vehicles (organization_id, make, model, registration_plate, currency, daily_rate_minor)
     values ($1, 'Peugeot', '208', 'AB-123-CD', 'EUR', 5000) returning id`,
    [org],
  )
  await db.sql(
    `insert into public.vehicle_documents (organization_id, vehicle_id, document_type, file_path)
     values ($1, $2, 'insurance', $3)`,
    [org, vehicle.id, at('vehicle-documents', 'insurance.pdf')],
  )
  await db.sql(
    `insert into public.vehicle_images
       (organization_id, vehicle_id, storage_path, thumbnail_path, content_type, byte_size)
     values ($1, $2, $3, $4, 'image/jpeg', 1000)`,
    [org, vehicle.id, at('vehicle-photos', 'front.jpg'), at('vehicle-photos', 'front-thumb.jpg')],
  )

  const rental = await one<{ id: string }>(
    `insert into public.rentals
       (organization_id, vehicle_id, customer_id, starts_at, ends_at, currency, status)
     values ($1, $2, $3, now() - interval '2 days', now() + interval '2 days', 'EUR', 'active')
     returning id`,
    [org, vehicle.id, customer.id],
  )
  await db.sql(
    `insert into public.rental_line_items (organization_id, rental_id, description, amount_minor, currency)
     values ($1, $2, 'Extra driver', 1500, 'EUR')`,
    [org, rental.id],
  )
  await db.sql(
    `insert into public.payments (organization_id, rental_id, customer_id, amount_minor, currency)
     values ($1, $2, $3, 2500, 'EUR')`,
    [org, rental.id, customer.id],
  )
  await db.sql(
    `insert into public.rental_drivers (organization_id, rental_id, customer_id) values ($1, $2, $3)`,
    [org, rental.id, customer.id],
  )
  await db.sql(
    `insert into public.rental_condition_photos
       (organization_id, rental_id, phase, storage_path, content_type, byte_size)
     values ($1, $2, 'pickup', $3, 'image/jpeg', 1000)`,
    [org, rental.id, at('rental-documents', 'pickup.jpg')],
  )
  await db.sql(
    `insert into public.rental_contracts
       (organization_id, rental_id, version, contract_number, snapshot,
        renter_signature_path, agency_signature_path, pdf_path)
     values ($1, $2, 1, $3, '{}'::jsonb, $4, $5, $6)`,
    [
      org,
      rental.id,
      `C-${org.slice(0, 8)}`,
      at('rental-documents', 'renter.png'),
      at('rental-documents', 'agency.png'),
      at('rental-documents', 'contract.pdf'),
    ],
  )

  const category = await one<{ id: string }>(
    `select id from public.expense_categories where organization_id = $1 limit 1`,
    [org],
  )
  const vendor = await one<{ id: string }>(
    `insert into public.expense_vendors (organization_id, name) values ($1, 'Garage') returning id`,
    [org],
  )
  const expense = await one<{ id: string }>(
    `insert into public.expenses
       (organization_id, category_id, vendor_id, allocation, amount_minor, currency, incurred_on)
     values ($1, $2, $3, 'overhead', 1000, 'EUR', current_date) returning id`,
    [org, category.id, vendor.id],
  )
  const voided = await one<{ id: string }>(
    `insert into public.expenses
       (organization_id, category_id, allocation, amount_minor, currency, incurred_on)
     values ($1, $2, 'overhead', 2000, 'EUR', current_date) returning id`,
    [org, category.id],
  )
  await db.sql(
    `update public.expenses set status = 'voided', voided_at = now(), void_reason = 'test' where id = $1`,
    [voided.id],
  )
  await db.sql(
    `insert into public.expense_attachments
       (organization_id, expense_id, kind, storage_path, file_name, content_type, byte_size)
     values ($1, $2, 'receipt', $3, 'r.pdf', 'application/pdf', 100)`,
    [org, expense.id, at('expense-receipts', 'receipt.pdf')],
  )
  await db.sql(
    `insert into public.expense_change_events (organization_id, expense_id, changes)
     values ($1, $2, '{}'::jsonb)`,
    [org, expense.id],
  )

  const lender = await one<{ id: string }>(
    `insert into public.lenders (organization_id, name) values ($1, 'Bank') returning id`,
    [org],
  )
  const agreement = await one<{ id: string }>(
    `insert into public.financing_agreements
       (organization_id, vehicle_id, lender_id, mode, currency, installment_amount_minor,
        installments_count, first_payment_on, schedule_anchor_day, starts_on, agreement_status)
     values ($1, $2, $3, 'simple', 'EUR', 100000, 2, '2032-01-10'::date, 10,
             '2032-01-01'::date, 'active')
     returning id`,
    [org, vehicle.id, lender.id],
  )
  const [installments] = await db.sql<{ n: number }>(
    `select count(*)::int as n from public.financing_installments where agreement_id = $1`,
    [agreement.id],
  )
  if (!installments || installments.n === 0) {
    await db.sql(
      `insert into public.financing_installments
         (organization_id, agreement_id, sequence, due_on, expected_total_minor)
       values ($1, $2, 1, '2032-01-10', 100000)`,
      [org, agreement.id],
    )
  }
  await db.sql(
    `insert into public.financing_payments
       (organization_id, agreement_id, paid_on, currency, amount_minor,
        principal_minor, interest_minor, fees_minor, unallocated_minor)
     values ($1, $2, '2032-01-10', 'EUR', 50000, 50000, 0, 0, 0)`,
    [org, agreement.id],
  )
  await db.sql(
    `insert into public.financing_documents
       (organization_id, agreement_id, storage_path, file_name, content_type, byte_size)
     values ($1, $2, $3, 'a.pdf', 'application/pdf', 100)`,
    [org, agreement.id, at('financing-documents', 'agreement.pdf')],
  )
  await db.sql(
    `insert into public.financing_change_events (organization_id, agreement_id) values ($1, $2)`,
    [org, agreement.id],
  )

  const connection = await one<{ id: string }>(
    `insert into public.gps_provider_connections (organization_id, provider, label, base_url, created_by)
     values ($1, 'wialon', 'Wialon', 'https://hst-api.wialon.com', $2) returning id`,
    [org, agency.owner],
  )
  await db.sql(`select public.gps_store_credential($1, 'provider-token-secret')`, [connection.id])
  const unit = await one<{ id: string }>(
    `insert into public.gps_units (organization_id, connection_id, external_id, name)
     values ($1, $2, 'u-1', 'Unit 1') returning id`,
    [org, connection.id],
  )
  await db.sql(
    `insert into public.gps_positions (unit_id, organization_id, observed_at) values ($1, $2, now())`,
    [unit.id, org],
  )
  await db.sql(
    `insert into public.gps_unit_assignments (organization_id, vehicle_id, unit_id)
     values ($1, $2, $3)`,
    [org, vehicle.id, unit.id],
  )
  await db.sql(
    `insert into public.gps_sync_runs (organization_id, connection_id, started_at, outcome)
     values ($1, $2, now(), 'success')`,
    [org, connection.id],
  )
  await db.sql(`insert into public.gps_rate_limits (connection_id, action) values ($1, 'test')`, [
    connection.id,
  ])

  await db.sql(
    `insert into public.organization_invitations
       (organization_id, email, email_normalized, role, expires_at, token_digest)
     values ($1, 'invitee@private.test', 'invitee@private.test', 'staff',
             now() + interval '7 days', sha256(gen_random_uuid()::text::bytea))`,
    [org],
  )
  await db.sql(
    `insert into public.organization_team_events (organization_id, event) values ($1, 'invitation_created')`,
    [org],
  )
  const event = await one<{ id: string }>(
    `insert into public.notification_events (organization_id, kind, source_table, source_id)
     values ($1, 'financing_due', 'financing_installments', gen_random_uuid()) returning id`,
    [org],
  )
  await db.sql(
    `insert into public.notification_event_recipients (event_id, user_id) values ($1, $2)`,
    [event.id, agency.owner],
  )
  await db.sql(
    `insert into public.notification_states (organization_id, user_id, fingerprint)
     values ($1, $2, 'fp-1')`,
    [org, agency.owner],
  )
  await db.sql(
    `insert into public.notification_preferences (organization_id, user_id, category)
     values ($1, $2, 'financing')`,
    [org, agency.owner],
  )

  // Objects in Storage that no row points to: an upload whose row was never written.
  await db.sql(`insert into storage.objects (bucket_id, name) values ('customer-documents', $1)`, [
    at('customer-documents', 'orphan-upload.jpg'),
  ])
  for (const { bucket, key } of keys) {
    await db.sql(
      `insert into storage.objects (bucket_id, name) select $1, $2
        where not exists (select 1 from storage.objects where bucket_id = $1 and name = $2)`,
      [bucket, key],
    )
  }

  return {
    ...agency,
    customerId: customer.id,
    vehicleId: vehicle.id,
    rentalId: rental.id,
    expenseId: expense.id,
    voidedExpenseId: voided.id,
    agreementId: agreement.id,
    connectionId: connection.id,
    keys,
  }
}

/** A subscription record, so the retained billing tables have something to keep. */
async function seedBilling(orgId: string): Promise<void> {
  await db.sql(`select app.billing_report_platform_state(true, 'test', 'Stripe is configured.')`)
  await db.sql(`select app.billing_claim_customer($1, $2, 'test', 'billing@agency.test')`, [
    orgId,
    `cus_test_${orgId.slice(0, 8)}`,
  ])
}

const requested = (orgId: string, due: boolean) =>
  db.sql(
    `update public.organizations
        set closure_requested_at = now() - interval '31 days',
            closure_requested_by = owner_id_placeholder,
            closure_purge_after = ${due ? "now() - interval '1 day'" : "now() + interval '10 days'"}
      where id = $1`.replace(
      'owner_id_placeholder',
      `(select user_id from public.organization_members where organization_id = $1 and role = 'owner' limit 1)`,
    ),
    [orgId],
  )

const claim = async (orgId: string) =>
  (await one<{ ok: boolean }>(`select app.organization_claim_purge($1) as ok`, [orgId])).ok

/** Every table a row naming an organization can live in, other than views. */
async function tablesCarryingOrganizationId(): Promise<string[]> {
  const rows = await db.sql<{ t: string }>(
    `select c.relname as t
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       join pg_attribute a on a.attrelid = c.oid and a.attname = 'organization_id' and not a.attisdropped
      where n.nspname = 'public' and c.relkind in ('r', 'p')
      order by 1`,
  )
  return rows.map((r) => r.t)
}

async function rowsLeft(table: string, orgId: string): Promise<number> {
  const [row] = await db.sql<{ n: number }>(
    `select count(*)::int as n from public.${table} where organization_id = $1`,
    [orgId],
  )
  return Number(row!.n)
}

let a: Seeded
let b: Seeded
let counts: Record<string, number>
let purgeTables: string[]
let retainedTables: string[]

beforeAll(async () => {
  db = await TestDatabase.create()
  a = await seed(await newAgency('Alpha Rentals', 'Alpha Rentals SARL'))
  b = await seed(await newAgency('Bravo Rentals', 'Bravo Rentals SARL'))
  await seedBilling(a.organizationId)
  await seedBilling(b.organizationId)
}, 120_000)

afterAll(async () => {
  await db.close()
})

describe('claiming the purge', () => {
  it('claims an account that is due, and refuses to claim it twice', async () => {
    const early = await newAgency('Early Rentals', null)
    expect(await claim(early.organizationId)).toBe(false) // open

    await requested(early.organizationId, false)
    expect(await claim(early.organizationId)).toBe(false) // suspended, not yet due
    expect(await one(`select app.closure_state_of($1)::text as s`, [early.organizationId])).toEqual(
      { s: 'suspended' },
    )

    await requested(early.organizationId, true)
    expect(await claim(early.organizationId)).toBe(true)
    expect(await one(`select app.closure_state_of($1)::text as s`, [early.organizationId])).toEqual(
      { s: 'purging' },
    )
    expect(await claim(early.organizationId)).toBe(false) // already claimed
  })

  it('refuses to claim an agency that still has a live subscription', async () => {
    const paying = await newAgency('Paying Rentals', null)
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
    const id = paying.organizationId
    const apply = (status: string) =>
      db.sql(
        `select app.billing_apply_subscription(
           $1, $2, 'test', $3::public.stripe_subscription_status, 'price_test_standard',
           'EUR', 4900, 'month', 1, 1,
           now() - interval '5 days', now() + interval '25 days',
           false, null, null, null, null, null,
           now(), $4
         )`,
        [
          `sub_test_${id.slice(0, 8)}`,
          `cus_test_${id.slice(0, 8)}`,
          status,
          `evt_${status}_${id.slice(0, 8)}`,
        ],
      )
    await db.sql(`select app.billing_claim_customer($1, $2, 'test', 'billing@agency.test')`, [
      id,
      `cus_test_${id.slice(0, 8)}`,
    ])
    await apply('active')
    await requested(id, true)

    await db.expectRejection(
      () => db.sql(`select app.organization_claim_purge($1)`, [id]),
      /live subscription/i,
    )
    const [row] = await db.sql<{ p: Date | null }>(
      `select purge_started_at as p from public.organizations where id = $1`,
      [id],
    )
    expect(row!.p).toBeNull()

    await apply('canceled')
    expect(await claim(id)).toBe(true)
  })

  it('does not claim an agency that does not exist', async () => {
    expect(await claim('00000000-0000-4000-8000-000000000000')).toBe(false)
  })

  it('takes the row lock as its very first statement, before it reads purge_started_at', async () => {
    // The race between a restore and a claim cannot be run on one connection,
    // so the order is pinned here instead: lock, then look.
    const { def } = await one<{ def: string }>(
      `select pg_get_functiondef('app.organization_claim_purge(uuid)'::regprocedure) as def`,
    )
    const body = def.slice(def.toLowerCase().indexOf('\nbegin') + 1)
    const firstStatement = body.replace(/^BEGIN\s*(--[^\n]*\n\s*)*/i, '').trimStart()
    expect(firstStatement).toMatch(/^select[\s\S]*?from public\.organizations[\s\S]*?for update/i)
    const lock = body.search(/for update/i)
    const check = body.search(/purge_started_at is not null/i)
    expect(lock).toBeGreaterThan(-1)
    expect(lock).toBeLessThan(check)
  })

  it('refuses to purge an agency that has not been claimed', async () => {
    const unclaimed = await newAgency('Unclaimed Rentals', null)
    await requested(unclaimed.organizationId, true)
    await db.expectRejection(
      () => db.sql(`select app.organization_purge_data($1)`, [unclaimed.organizationId]),
      /not been claimed|purging/i,
    )
    expect(await rowsLeft('organization_members', unclaimed.organizationId)).toBeGreaterThan(0)
  })

  it('cannot be run by a browser role', async () => {
    for (const fn of [
      'app.organization_claim_purge(uuid)',
      'app.organization_collect_objects(uuid)',
      'app.organization_purge_data(uuid)',
    ]) {
      const [row] = await db.sql<{ a: boolean; b: boolean; c: boolean }>(
        `select has_function_privilege('authenticated', $1, 'EXECUTE') as a,
                has_function_privilege('anon', $1, 'EXECUTE') as b,
                has_function_privilege('service_role', $1, 'EXECUTE') as c`,
        [fn],
      )
      expect(row).toEqual({ a: false, b: false, c: true })
    }
  })
})

describe('purging an agency', () => {
  it('collects a storage key for every uploaded document', async () => {
    await requested(a.organizationId, true)
    expect(await claim(a.organizationId)).toBe(true)

    const total = await one<{ n: number }>(`select app.organization_collect_objects($1) as n`, [
      a.organizationId,
    ])
    const stored = await db.sql<{ bucket: string; storage_key: string }>(
      `select bucket, storage_key from public.account_closure_objects where organization_id = $1`,
      [a.organizationId],
    )

    // Every key the rows name, in the bucket it lives in.
    for (const { bucket, key } of a.keys) {
      expect(stored).toContainEqual({ bucket, storage_key: key })
    }
    // The logo, which lives on the organization row itself.
    expect(stored).toContainEqual({
      bucket: 'organization-logos',
      storage_key: `${a.organizationId}/logo.png`,
    })
    // And nothing that belongs to another agency.
    for (const row of stored) expect(row.storage_key.startsWith(`${a.organizationId}/`)).toBe(true)
    expect(Number(total.n)).toBe(stored.length)

    // Running it again changes nothing.
    await db.sql(`select app.organization_collect_objects($1)`, [a.organizationId])
    const again = await db.sql(
      `select 1 from public.account_closure_objects where organization_id = $1`,
      [a.organizationId],
    )
    expect(again.length).toBe(stored.length)
  })

  it('purges, and writes the objects down before it deletes the first row', async () => {
    // Throw away the collection above: purge_data must collect for itself.
    await db.sql(`delete from public.account_closure_objects where organization_id = $1`, [
      a.organizationId,
    ])
    const vaultBefore = await one<{ n: number }>(`select count(*)::int as n from vault.secrets`)
    expect(Number(vaultBefore.n)).toBeGreaterThan(0)

    const result = await one<{ counts: Record<string, number> }>(
      `select app.organization_purge_data($1) as counts`,
      [a.organizationId],
    )
    counts = result.counts

    const recorded = await one<{ n: number }>(
      `select count(*)::int as n from public.account_closure_objects where organization_id = $1`,
      [a.organizationId],
    )
    expect(Number(recorded.n)).toBeGreaterThanOrEqual(a.keys.length)
  })

  it('leaves no row in any table carrying this organization_id', async () => {
    const tables = await tablesCarryingOrganizationId()
    const retained = await db.sql<{ t: string[] }>(`select app.organization_retained_tables() as t`)
    retainedTables = retained[0]!.t
    const purged = await db.sql<{ t: string[] }>(`select app.organization_purge_tables() as t`)
    purgeTables = purged[0]!.t

    // Nothing carries the column without being either purged or knowingly kept.
    expect([...purgeTables, ...retainedTables].sort()).toEqual(tables)

    for (const table of purgeTables) {
      expect(await rowsLeft(table, a.organizationId), table).toBe(0)
    }
    // The tables that hang off a purged parent rather than carrying the column.
    const [rest] = await db.sql<{ n: number }>(
      `select (select count(*) from public.notification_event_recipients r
                where r.user_id = $1 and not exists (select 1 from public.notification_events e where e.id = r.event_id))::int
            + (select count(*) from public.gps_rate_limits where connection_id = $2)::int as n`,
      [a.owner, a.connectionId],
    )
    expect(Number(rest!.n)).toBe(0)
  })

  it('actually had a row in every table it claims to have emptied', () => {
    // Guards the guard: a table that was never seeded would pass the test above
    // for the wrong reason. The counts are what the purge really deleted.
    for (const table of purgeTables) {
      expect(
        counts[table],
        `${table} had nothing in it, so its emptiness proves nothing`,
      ).toBeGreaterThan(0)
    }
  })

  it('removes the gps provider credential from the vault, not just the row that points at it', async () => {
    const [left] = await db.sql<{ n: number }>(
      `select count(*)::int as n from vault.decrypted_secrets where decrypted_secret = 'provider-token-secret'`,
    )
    // Agency B still has its own.
    expect(Number(left!.n)).toBe(1)
    expect(counts['vault.secrets']).toBe(1)
  })

  it('leaves the organization row in place', async () => {
    const row = await one<{ id: string; closed_at: Date | null; purge_started_at: Date | null }>(
      `select id, closed_at, purge_started_at from public.organizations where id = $1`,
      [a.organizationId],
    )
    expect(row.id).toBe(a.organizationId)
    expect(row.closed_at).not.toBeNull()
    expect(row.purge_started_at).not.toBeNull()
    expect(await one(`select app.closure_state_of($1)::text as s`, [a.organizationId])).toEqual({
      s: 'closed',
    })
  })

  it('keeps billing_customers, billing_subscriptions, billing_events', async () => {
    const customers = await rowsLeft('billing_customers', a.organizationId)
    expect(customers).toBeGreaterThan(0)
    for (const table of ['billing_checkout_sessions', 'billing_subscriptions', 'billing_events']) {
      expect(retainedTables).toContain(table)
    }
    expect(retainedTables).toContain('billing_customers')
  })

  it('clears the descriptive fields but keeps the legal name', async () => {
    const row = await one<Record<string, unknown>>(
      `select * from public.organizations where id = $1`,
      [a.organizationId],
    )
    expect(row.legal_name).toBe('Alpha Rentals SARL')
    expect(row.name).not.toBe(a.name)
    expect(String(row.name)).toMatch(/closed/i)
    for (const column of [
      'tax_identifier',
      'email',
      'phone',
      'website',
      'address_line1',
      'address_line2',
      'city',
      'region',
      'postal_code',
      'country_code',
      'logo_path',
    ]) {
      expect(row[column], column).toBeNull()
    }
    // The closure record survives, so the row reads as what it is.
    expect(row.closure_requested_at).not.toBeNull()
    expect(row.closure_purge_after).not.toBeNull()
  })

  it('falls back to the display name when there is no legal name', async () => {
    const plain = await newAgency('Plain Rentals', null)
    await requested(plain.organizationId, true)
    await claim(plain.organizationId)
    await db.sql(`select app.organization_purge_data($1)`, [plain.organizationId])
    const row = await one<{ legal_name: string }>(
      `select legal_name from public.organizations where id = $1`,
      [plain.organizationId],
    )
    expect(row.legal_name).toBe(plain.name)
  })

  it('does not touch another agency', async () => {
    for (const table of purgeTables) {
      expect(await rowsLeft(table, b.organizationId), table).toBeGreaterThan(0)
    }
    const row = await one<{
      name: string
      legal_name: string
      email: string
      closed_at: Date | null
    }>(`select name, legal_name, email, closed_at from public.organizations where id = $1`, [
      b.organizationId,
    ])
    expect(row).toMatchObject({
      name: b.name,
      legal_name: 'Bravo Rentals SARL',
      email: SECRET_EMAIL,
    })
    expect(row.closed_at).toBeNull()
    const [objects] = await db.sql<{ n: number }>(
      `select count(*)::int as n from public.account_closure_objects where organization_id = $1`,
      [b.organizationId],
    )
    expect(Number(objects!.n)).toBe(0)
  })

  it('returns counts, and writes them to the evidence record', async () => {
    expect(counts.customers).toBe(1)
    expect(counts.vehicles).toBe(1)
    expect(counts.expenses).toBe(2)
    for (const value of Object.values(counts)) expect(Number.isInteger(value)).toBe(true)

    const event = await one<{
      organization_id: string
      organization_name: string
      requested_by: string | null
      requested_at: Date
      purged_at: Date | null
      table_counts: Record<string, number>
    }>(`select * from public.account_closure_events where organization_id = $1`, [a.organizationId])

    expect(event.organization_name).toBe('Alpha Rentals SARL')
    expect(event.requested_by).toBe(a.owner)
    expect(event.purged_at).not.toBeNull()
    expect(event.table_counts).toEqual(counts)
  })

  it('records counts and never content', async () => {
    const [row] = await db.sql<{ doc: string }>(
      `select e::text as doc from public.account_closure_events e where organization_id = $1`,
      [a.organizationId],
    )
    for (const secret of [
      SECRET_NAME,
      'Zephyrine',
      'Quillfeather',
      SECRET_EMAIL,
      'AB-123-CD',
      'P-SECRET-1',
      'FR123456789',
      'Rue Privee',
      'provider-token-secret',
    ]) {
      expect(row!.doc).not.toContain(secret)
    }
  })

  it('will not purge the same agency twice', async () => {
    await db.expectRejection(
      () => db.sql(`select app.organization_purge_data($1)`, [a.organizationId]),
      /purging|not been claimed/i,
    )
    const events = await db.sql(
      `select 1 from public.account_closure_events where organization_id = $1`,
      [a.organizationId],
    )
    expect(events.length).toBe(1)
  })

  it('refuses a restore once the purge has claimed the agency', async () => {
    await db.asUser(a.owner, (s) =>
      s.expectRejection(
        () => s.sql(`select public.organization_restore($1)`, [a.organizationId]),
        /purge of this agency has started|only an owner or an administrator/i,
      ),
    )
  })
})

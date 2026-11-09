// @vitest-environment node
/**
 * The bulk path: vehicles_import_batch imports a whole batch or nothing.
 *
 * Capacity is checked before any row is written, so the refusal is this
 * function's own message naming the free slots, not the per-vehicle trigger's.
 * Every refusal test asserts on the table, not only on the error.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { TestDatabase, addMember, signUp } from './support/harness'

let db: TestDatabase
let organizationId: string
let owner: string
let seq = 0
let plate = 0

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

async function subscribeStarter(): Promise<void> {
  const tag = organizationId.slice(0, 8)
  await db.sql(
    `select app.billing_apply_subscription(
       $1, $2, 'test', 'active'::public.stripe_subscription_status, $3,
       'EUR', 4900, 'month', 1, 1,
       now() - interval '5 days', now() + interval '25 days',
       false, null, null, null, null, null,
       now(), $4
     )`,
    [`sub_test_${tag}`, `cus_test_${tag}`, 'price_test_starter_monthly', `evt_${tag}`],
  )
}

function rows(count: number): Record<string, unknown>[] {
  return Array.from({ length: count }, () => {
    plate += 1
    return {
      make: 'Renault',
      model: 'Clio',
      model_year: 2022,
      registration_plate: `IMP-${plate}`,
      fuel_type: 'petrol',
      transmission: 'manual',
      seats: 5,
      odometer: 1200,
      daily_rate_minor: 4500,
      currency: 'EUR',
      status: 'available',
      next_service_on: '2027-01-15',
      notes: null,
    }
  })
}

async function seed(count: number): Promise<void> {
  for (const row of rows(count)) {
    await db.sql(
      `insert into public.vehicles (organization_id, make, model, registration_plate, currency)
       values ($1, $2, $3, $4, 'EUR')`,
      [organizationId, row.make, row.model, row.registration_plate],
    )
  }
}

async function importAs<T = unknown>(
  userId: string,
  orgId: string,
  batch: unknown[],
): Promise<T[]> {
  return db.asUser(userId, (session) =>
    session.sql<T>(`select * from public.vehicles_import_batch($1, $2::jsonb)`, [
      orgId,
      JSON.stringify(batch),
    ]),
  )
}

async function tableCount(): Promise<number> {
  const [row] = await db.sql<{ n: number }>(
    `select count(*)::int as n from public.vehicles where organization_id = $1`,
    [organizationId],
  )
  return row!.n
}

beforeAll(async () => {
  db = await TestDatabase.create()
  await db.sql(`select app.billing_report_platform_state(true, 'test', 'Stripe is configured.')`)
  await db.sql(`select app.billing_replace_catalogue($1::jsonb)`, [
    JSON.stringify([catalogueEntry('starter_monthly')]),
  ])
})

afterAll(async () => {
  await db.close()
})

beforeEach(async () => {
  seq += 1
  const account = await signUp(db, {
    email: `owner${seq}@import.test`,
    fullName: 'Owner One',
    organizationName: `Import ${seq}`,
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

describe('vehicles_import_batch', () => {
  it('imports a batch that exactly fills the remaining slots', async () => {
    await subscribeStarter()
    await seed(2)
    const imported = await importAs<{ registration_plate: string; created_by: string }>(
      owner,
      organizationId,
      rows(3),
    )
    expect(imported).toHaveLength(3)
    expect(imported[0]!.created_by).toBe(owner)
    expect(await tableCount()).toBe(5)
  })

  it('refuses a batch one row over, writing nothing', async () => {
    await subscribeStarter()
    await seed(2)
    await db.expectRejection(() => importAs(owner, organizationId, rows(4)), /room for 3 more/)
    expect(await tableCount()).toBe(2)
  })

  it('names the number of free slots in the refusal', async () => {
    await subscribeStarter()
    await seed(3)
    const message = await db.expectRejection(() => importAs(owner, organizationId, rows(40)))
    expect(message).toContain('This import has 40 vehicles but your plan has room for 2 more')
    expect(message).not.toContain('Your plan covers')
    expect(await tableCount()).toBe(3)
  })

  it('raises errcode 55000', async () => {
    await subscribeStarter()
    await seed(5)
    const code = await importAs(owner, organizationId, rows(1))
      .then(() => null)
      .catch((error: { code?: string }) => error.code)
    expect(code).toBe('55000')
    expect(await tableCount()).toBe(5)
  })

  it('imports any size when the agency has no limit', async () => {
    // No limit is the platform-unconfigured case: nothing is sold, so nothing is capped.
    await db.sql(`select app.billing_report_platform_state(false, 'test', 'Not configured.')`)
    try {
      const imported = await importAs(owner, organizationId, rows(40))
      expect(imported).toHaveLength(40)
      expect(await tableCount()).toBe(40)
    } finally {
      await db.sql(
        `select app.billing_report_platform_state(true, 'test', 'Stripe is configured.')`,
      )
    }
  })

  it('rolls the whole batch back when one row is invalid', async () => {
    await subscribeStarter()
    await seed(1)
    const batch = rows(3)
    batch[2] = { ...batch[2]!, make: '' }
    await db.expectRejection(
      () => importAs(owner, organizationId, batch),
      /violates check constraint/,
    )
    expect(await tableCount()).toBe(1)
  })

  it('refuses a member below manager, writing nothing', async () => {
    const staff = await signUp(db, {
      email: `staff${seq}@import.test`,
      fullName: 'Staff',
      organizationName: `Staff Own ${seq}`,
      currency: 'EUR',
      timeZone: 'Europe/Paris',
    })
    await addMember(db, organizationId, staff.userId, 'staff')
    await db.expectRejection(() => importAs(staff.userId, organizationId, rows(1)), /manager role/)
    expect(await tableCount()).toBe(0)
  })

  it('ignores id, organization_id, created_by and archived_at supplied in a row', async () => {
    await subscribeStarter()
    const other = await signUp(db, {
      email: `other${seq}@import.test`,
      fullName: 'Other',
      organizationName: `Other Org ${seq}`,
      currency: 'EUR',
      timeZone: 'Europe/Paris',
    })
    const forged = {
      ...rows(1)[0]!,
      id: '00000000-0000-0000-0000-000000000001',
      organization_id: other.organizationId,
      created_by: other.userId,
      archived_at: '2026-01-01T00:00:00Z',
    }
    const [row] = await importAs<{
      id: string
      organization_id: string
      created_by: string
      archived_at: string | null
    }>(owner, organizationId, [forged])
    expect(row!.id).not.toBe(forged.id)
    expect(row!.organization_id).toBe(organizationId)
    expect(row!.created_by).toBe(owner)
    expect(row!.archived_at).toBeNull()
  })

  it('refuses a caller who is not a member of the organization', async () => {
    const stranger = await signUp(db, {
      email: `stranger${seq}@import.test`,
      fullName: 'Stranger',
      organizationName: `Other ${seq}`,
      currency: 'EUR',
      timeZone: 'Europe/Paris',
    })
    await db.expectRejection(
      () => importAs(stranger.userId, organizationId, rows(1)),
      /manager role/,
    )
    expect(await tableCount()).toBe(0)
  })
})

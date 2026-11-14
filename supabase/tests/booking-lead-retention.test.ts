// @vitest-environment node
/**
 * How long a booking lead lives.
 *
 * Twelve months from creation for anything not converted, then it goes. A
 * converted lead stays at any age, because it is no longer an enquiry: it is
 * the provenance of a customer and a rental the agency has.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { TestDatabase, signUp } from './support/harness'

let db: TestDatabase
let organizationId: string
let ownerId: string
let vehicleId: string
let seq = 0

type LeadOptions = {
  ageMonths?: number
  ageDays?: number
  status?: 'new' | 'contacted' | 'declined' | 'lapsed' | 'converted'
}

async function seedLead({ ageMonths = 0, ageDays = 0, status = 'new' }: LeadOptions = {}) {
  const [row] = await db.sql<{ id: string }>(
    `insert into public.booking_leads
       (organization_id, vehicle_id, starts_at, ends_at, full_name, email,
        currency, daily_rate_minor, billable_days, quoted_total_minor, created_at)
     values ($1, $2, now() + interval '30 days', now() + interval '33 days',
             'Someone Asking', 'asking@example.test', 'EUR', 4500, 3, 13500,
             now() - make_interval(months => $3, days => $4))
     returning id`,
    [organizationId, vehicleId, ageMonths, ageDays],
  )
  if (status === 'converted') {
    // A converted lead names the records it became; the table refuses the
    // status without them.
    const [customer] = await db.sql<{ id: string }>(
      `insert into public.customers (organization_id, first_name, last_name)
       values ($1, 'Became', 'Customer') returning id`,
      [organizationId],
    )
    const [rental] = await db.sql<{ id: string }>(
      `insert into public.rentals
         (organization_id, vehicle_id, customer_id, starts_at, ends_at, currency, status)
       values ($1, $2, $3, now() + interval '30 days', now() + interval '33 days', 'EUR', 'reserved')
       returning id`,
      [organizationId, vehicleId, customer!.id],
    )
    await db.sql(
      `update public.booking_leads
          set status = 'converted', converted_customer_id = $2, converted_rental_id = $3
        where id = $1`,
      [row!.id, customer!.id, rental!.id],
    )
  } else if (status !== 'new') {
    await db.sql(`update public.booking_leads set status = $2 where id = $1`, [row!.id, status])
  }
  return row!.id
}

async function sweep(limit?: number): Promise<number> {
  const [row] = await db.asServiceRole(ownerId, (session) =>
    session.sql<{ removed: number }>(
      limit === undefined
        ? `select app.purge_expired_booking_leads() as removed`
        : `select app.purge_expired_booking_leads($1) as removed`,
      limit === undefined ? [] : [limit],
    ),
  )
  return Number(row!.removed)
}

async function surviving(): Promise<number> {
  const [row] = await db.sql<{ count: string }>(
    `select count(*)::text as count from public.booking_leads where organization_id = $1`,
    [organizationId],
  )
  return Number(row!.count)
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
    email: `owner${seq}@retention.test`,
    organizationName: `Retention ${seq}`,
    currency: 'EUR',
  })
  if (!owner.organizationId) throw new Error('provisioning failed')
  organizationId = owner.organizationId
  ownerId = owner.userId
  const [vehicle] = await db.sql<{ id: string }>(
    `insert into public.vehicles
       (organization_id, make, model, registration_plate, currency, daily_rate_minor)
     values ($1, 'Renault', 'Clio', $2, 'EUR', 4500) returning id`,
    [organizationId, `RET-${seq}`],
  )
  vehicleId = vehicle!.id
})

describe('what the sweep removes', () => {
  it('removes an unconverted lead older than twelve months', async () => {
    await seedLead({ ageMonths: 12, ageDays: 1 })
    expect(await sweep()).toBe(1)
    expect(await surviving()).toBe(0)
  })

  it('keeps an unconverted lead one day short of twelve months', async () => {
    await seedLead({ ageMonths: 12, ageDays: -1 })
    expect(await sweep()).toBe(0)
    expect(await surviving()).toBe(1)
  })

  it('keeps a converted lead of any age', async () => {
    await seedLead({ ageMonths: 48, status: 'converted' })
    expect(await sweep()).toBe(0)
    expect(await surviving()).toBe(1)
  })

  it('removes a lead that was worked but never converted', async () => {
    // contacted, declined and lapsed are all still an enquiry, and all still a
    // stranger's contact details.
    for (const status of ['contacted', 'declined', 'lapsed'] as const) {
      await seedLead({ ageMonths: 13, status })
    }
    expect(await sweep()).toBe(3)
    expect(await surviving()).toBe(0)
  })

  it('removes nothing when there is nothing old', async () => {
    await seedLead()
    expect(await sweep()).toBe(0)
    expect(await surviving()).toBe(1)
  })
})

describe('the batch', () => {
  it('stops at the limit and takes the oldest first', async () => {
    const oldest = await seedLead({ ageMonths: 36 })
    await seedLead({ ageMonths: 24 })
    await seedLead({ ageMonths: 13 })

    expect(await sweep(2)).toBe(2)
    expect(await surviving()).toBe(1)
    const [left] = await db.sql<{ id: string }>(
      `select id from public.booking_leads where organization_id = $1`,
      [organizationId],
    )
    expect(left!.id).not.toBe(oldest)

    // What it did not reach today it reaches tomorrow.
    expect(await sweep(2)).toBe(1)
    expect(await surviving()).toBe(0)
  })
})

describe('who may run it', () => {
  it('is unreachable by anon and by a signed-in member', async () => {
    for (const run of [
      () => db.asAnon((session) => session.sql(`select app.purge_expired_booking_leads()`)),
      () =>
        db.asUser(ownerId, (session) => session.sql(`select app.purge_expired_booking_leads()`)),
    ]) {
      await db.expectRejection(run, /permission denied/i)
    }
  })
})

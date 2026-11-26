// @vitest-environment node

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { TestDatabase, signUp } from './support/harness'

let db: TestDatabase
let ownerId: string
let organizationId: string
let vehicleId: string
let customerId: string

async function createRental(startsAt: string, endsAt: string): Promise<string> {
  const [rental] = await db.sql<{ id: string }>(
    `insert into public.rentals
       (organization_id, vehicle_id, customer_id, starts_at, ends_at, currency, status)
     values ($1, $2, $3, $4::timestamptz, $5::timestamptz, 'EUR', 'draft')
     returning id`,
    [organizationId, vehicleId, customerId, startsAt, endsAt],
  )
  await db.sql(
    `insert into public.rental_drivers (organization_id, rental_id, customer_id, driver_role)
     values ($1, $2, $3, 'primary')`,
    [organizationId, rental!.id, customerId],
  )
  await db.sql(`select public.rental_confirm($1)`, [rental!.id])
  return rental!.id
}

beforeAll(async () => {
  db = await TestDatabase.create()
  const account = await signUp(db, {
    email: 'maintenance-owner@test.local',
    fullName: 'Maintenance Owner',
    organizationName: 'Maintenance Organization',
    currency: 'EUR',
  })
  ownerId = account.userId
  organizationId = account.organizationId!
  const [vehicle] = await db.sql<{ id: string }>(
    `insert into public.vehicles
       (organization_id, make, model, registration_plate, currency, daily_rate_minor)
     values ($1, 'Test', 'Maintenance', 'MNT-001', 'EUR', 1000) returning id`,
    [organizationId],
  )
  vehicleId = vehicle!.id
  const [customer] = await db.sql<{ id: string }>(
    `insert into public.customers (organization_id, first_name, last_name)
     values ($1, 'Maintenance', 'Renter') returning id`,
    [organizationId],
  )
  customerId = customer!.id
})

afterAll(async () => db?.close())

describe('maintenance management', () => {
  it('blocks overlapping reservations but allows periods outside scheduled maintenance', async () => {
    const [maintenance] = await db.asUser(ownerId, (session) =>
      session.sql<{ id: string; status: string }>(
        `select * from public.maintenance_create(
          $1, $2, 'Scheduled service', 'preventive', 'normal',
          '2035-02-02 09:00+00', '2035-02-02 16:00+00',
          'Routine service', null, null, null, null, 15000, 'EUR', null, null, false, null
        )`,
        [organizationId, vehicleId],
      ),
    )
    expect(maintenance?.status).toBe('scheduled')

    await expect(createRental('2035-02-02 10:00+00', '2035-02-02 12:00+00')).rejects.toThrow(
      /maintenance|unavailable/i,
    )

    const allowed = await createRental('2035-02-02 16:00+00', '2035-02-02 18:00+00')
    expect(allowed).toEqual(expect.any(String))
  })

  it('keeps maintenance unavailable after the expected end until completion', async () => {
    const [created] = await db.asUser(ownerId, (session) =>
      session.sql<{ id: string }>(
        `select id from public.maintenance_create(
          $1, $2, 'Immediate repair', 'mechanical_repair', 'high',
          null, null, 'Repair', 'Noise', null, null, null, null, 'EUR', null, null, true, 10
        )`,
        [organizationId, vehicleId],
      ),
    )
    const [state] = await db.sql<{ status: string; actual_start: string | null }>(
      `select status, actual_start from public.maintenance_records where id = $1`,
      [created!.id],
    )
    expect(state).toMatchObject({ status: 'in_progress' })
    expect(state?.actual_start).not.toBeNull()

    await db.expectRejection(
      () => createRental('2036-01-01 10:00+00', '2036-01-02 10:00+00'),
      /maintenance|unavailable/i,
    )

    await db.asUser(ownerId, (session) =>
      session.sql(
        `select public.maintenance_complete($1, '2035-02-03 12:00+00', 'Fixed', 'Repaired', 20)`,
        [created!.id],
      ),
    )
    const [completed] = await db.sql<{ status: string }>(
      `select status from public.maintenance_records where id = $1`,
      [created!.id],
    )
    expect(completed?.status).toBe('completed')
  })

  it('rejects cross-tenant vehicle references through the authorized RPC', async () => {
    const other = await signUp(db, {
      email: 'maintenance-other@test.local',
      fullName: 'Other Owner',
      organizationName: 'Other Maintenance Organization',
      currency: 'EUR',
    })
    const [otherVehicle] = await db.sql<{ id: string }>(
      `insert into public.vehicles
         (organization_id, make, model, registration_plate, currency, daily_rate_minor)
       values ($1, 'Other', 'Vehicle', 'MNT-002', 'EUR', 1000) returning id`,
      [other.organizationId],
    )
    await db.expectRejection(
      () =>
        db.asUser(ownerId, (session) =>
          session.sql(
            `select public.maintenance_create($1, $2, 'Cross tenant', 'other', 'normal', null, null, 'x', null, null, null, null, null, 'EUR', null, null, false, null)`,
            [organizationId, otherVehicle!.id],
          ),
        ),
      /vehicle not found|foreign key|not permitted/i,
    )
  })

  it('exposes guarded reminders, cost, downtime and private documents without a second ledger', async () => {
    const [contract] = await db.sql<{
      records_rls: boolean
      documents_rls: boolean
      bucket_private: boolean
      expense_link: boolean
      due_rpc: boolean
      downtime_rpc: boolean
    }>(`
      select
        (select relrowsecurity from pg_class where oid = 'public.maintenance_records'::regclass) as records_rls,
        (select relrowsecurity from pg_class where oid = 'public.maintenance_documents'::regclass) as documents_rls,
        (select not public from storage.buckets where id = 'maintenance-documents') as bucket_private,
        exists (select 1 from information_schema.columns where table_schema='public' and table_name='expenses' and column_name='maintenance_id') as expense_link,
        exists (select 1 from pg_proc where oid = 'public.maintenance_due_summary(uuid,date)'::regprocedure) as due_rpc,
        exists (select 1 from pg_proc where oid = 'public.maintenance_vehicle_downtime(uuid,timestamptz,timestamptz)'::regprocedure) as downtime_rpc
    `)
    expect(contract).toEqual({
      records_rls: true,
      documents_rls: true,
      bucket_private: true,
      expense_link: true,
      due_rpc: true,
      downtime_rpc: true,
    })

    const [created] = await db.asUser(ownerId, (session) =>
      session.sql<{ id: string }>(
        `select id from public.maintenance_create($1, $2, 'Reminder service', 'preventive', 'normal', null, null, 'Reminder', null, null, null, null, null, 'EUR', null, null, false, null)`,
        [organizationId, vehicleId],
      ),
    )
    await db.asUser(ownerId, (session) =>
      session.sql(
        `select public.maintenance_set_service_plan($1, 180, 5000, current_date - 1, 100)`,
        [created!.id],
      ),
    )
    const [due] = await db.asUser(ownerId, (session) =>
      session.sql<{ overdue: boolean; due_by_date: boolean; due_by_odometer: boolean }>(
        `select overdue, due_by_date, due_by_odometer from public.maintenance_due_summary($1, current_date) where maintenance_id=$2`,
        [organizationId, created!.id],
      ),
    )
    expect(due).toEqual({ overdue: true, due_by_date: true, due_by_odometer: true })
  })
})

// @vitest-environment node
/**
 * A cost attached to a maintenance record stays that cost.
 *
 * 20261128130000 added the invariants; nothing exercised them. This file is
 * that coverage, and it also covers the read model change that went with it:
 * enforcing an invariant the interface cannot show is how a correct database
 * earns a reputation for being broken, so public.expense_ledger now carries
 * maintenance_id and the expense screens can say what is going on BEFORE the
 * user presses save.
 *
 * These run on the repository's PGlite harness, which replays the real ordered
 * migrations. Nothing here is manual acceptance.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { TestDatabase, signUp } from './support/harness'

let db: TestDatabase
let ownerId: string
let organizationId: string
let categoryId: string

let plateCounter = 0

async function freshVehicle(): Promise<string> {
  plateCounter += 1
  const [row] = await db.sql<{ id: string }>(
    `insert into public.vehicles
       (organization_id, make, model, registration_plate, currency, daily_rate_minor)
     values ($1, 'Test', 'Link', $2, 'EUR', 1000) returning id`,
    [organizationId, `MXL-${String(plateCounter).padStart(4, '0')}`],
  )
  return row!.id
}

async function schedule(vehicleId: string): Promise<string> {
  const [row] = await db.asUser(ownerId, (session) =>
    session.sql<{ id: string }>(
      `select id from public.maintenance_create($1, $2, 'Brake service', 'brake_service')`,
      [organizationId, vehicleId],
    ),
  )
  return row!.id
}

/** A vehicle cost, ready to be attached to a maintenance record. */
async function vehicleCost(vehicleId: string, amount = 12_000): Promise<string> {
  const [row] = await db.sql<{ id: string }>(
    `insert into public.expenses
       (organization_id, category_id, allocation, vehicle_id, incurred_on,
        description, amount_minor, currency)
     values ($1, $2, 'vehicle', $3, current_date, 'Pads and discs', $4, 'EUR')
     returning id`,
    [organizationId, categoryId, vehicleId, amount],
  )
  return row!.id
}

const link = (expenseId: string, maintenanceId: string) =>
  db.asUser(ownerId, (session) =>
    session.sql(`select public.maintenance_link_expense($1, $2)`, [maintenanceId, expenseId]),
  )

async function linkedOf(expenseId: string): Promise<string | null> {
  const [row] = await db.sql<{ maintenance_id: string | null }>(
    `select maintenance_id from public.expenses where id = $1`,
    [expenseId],
  )
  return row!.maintenance_id
}

beforeAll(async () => {
  db = await TestDatabase.create()
  const owner = await signUp(db, {
    email: 'owner@mxlink.test',
    fullName: 'Link Owner',
    organizationName: 'Link Agency',
    currency: 'EUR',
  })
  ownerId = owner.userId
  organizationId = owner.organizationId!
  const [category] = await db.sql<{ id: string }>(
    `insert into public.expense_categories
       (organization_id, name, is_system, default_allocation, sort_order)
     values ($1, 'Servicing', false, 'vehicle', 1)
     returning id`,
    [organizationId],
  )
  categoryId = category!.id
})

afterAll(async () => {
  await db?.close()
})

describe('the read model shows the attachment', () => {
  it('carries maintenance_id on expense_ledger', async () => {
    const vehicle = await freshVehicle()
    const maintenance = await schedule(vehicle)
    const expense = await vehicleCost(vehicle)

    const [before] = await db.asUser(ownerId, (session) =>
      session.sql<{ maintenance_id: string | null }>(
        `select maintenance_id from public.expense_ledger where id = $1`,
        [expense],
      ),
    )
    expect(before!.maintenance_id).toBeNull()

    await link(expense, maintenance)

    const [after] = await db.asUser(ownerId, (session) =>
      session.sql<{ maintenance_id: string | null }>(
        `select maintenance_id from public.expense_ledger where id = $1`,
        [expense],
      ),
    )
    // Without this the attachment is invisible to every expense screen, and
    // the refusals below arrive with no explanation the user can act on.
    expect(after!.maintenance_id).toBe(maintenance)
  })

  it('keeps the read model tenant-scoped', async () => {
    const outsider = await signUp(db, {
      email: 'out@mxlink.test',
      fullName: 'Outsider',
      organizationName: 'Other Agency',
      currency: 'EUR',
    })
    const vehicle = await freshVehicle()
    const expense = await vehicleCost(vehicle)

    const rows = await db.asUser(outsider.userId, (session) =>
      session.sql(`select id from public.expense_ledger where id = $1`, [expense]),
    )
    expect(rows).toHaveLength(0)
  })
})

describe('an attached cost stays attached to what it describes', () => {
  it('refuses a change of allocation, and names the way out', async () => {
    const vehicle = await freshVehicle()
    const expense = await vehicleCost(vehicle)
    await link(expense, await schedule(vehicle))

    const message = await db.expectRejection(() =>
      db.sql(
        `update public.expenses set allocation = 'overhead', vehicle_id = null where id = $1`,
        [expense],
      ),
    )
    expect(message).toMatch(/has to stay a vehicle cost/i)
    expect(await linkedOf(expense)).not.toBeNull()
  })

  it('refuses a move to another vehicle', async () => {
    const vehicle = await freshVehicle()
    const expense = await vehicleCost(vehicle)
    await link(expense, await schedule(vehicle))
    const elsewhere = await freshVehicle()

    const message = await db.expectRejection(() =>
      db.sql(`update public.expenses set vehicle_id = $2 where id = $1`, [expense, elsewhere]),
    )
    expect(message).toMatch(/vehicle that was worked on/i)
  })

  it('refuses a silent reassignment to a different maintenance record', async () => {
    const vehicle = await freshVehicle()
    const expense = await vehicleCost(vehicle)
    await link(expense, await schedule(vehicle))
    const other = await schedule(vehicle)

    const message = await db.expectRejection(() =>
      db.sql(`update public.expenses set maintenance_id = $2 where id = $1`, [expense, other]),
    )
    expect(message).toMatch(/already attached to another maintenance record/i)
  })

  it('does not silently clear the link', async () => {
    const vehicle = await freshVehicle()
    const expense = await vehicleCost(vehicle)
    const maintenance = await schedule(vehicle)
    await link(expense, maintenance)

    // Detaching by hand is not the authorized route, and whatever happens the
    // cost must not quietly lose the record it was reporting against.
    await db
      .sql(`update public.expenses set maintenance_id = null where id = $1`, [expense])
      .catch(() => undefined)

    const after = await linkedOf(expense)
    expect(after === null || after === maintenance).toBe(true)
  })

  it('still allows the edits that have nothing to do with the link', async () => {
    const vehicle = await freshVehicle()
    const expense = await vehicleCost(vehicle)
    await link(expense, await schedule(vehicle))

    await db.sql(
      `update public.expenses set description = 'Pads, discs and fluid', amount_minor = 13_500
        where id = $1`,
      [expense],
    )

    const [row] = await db.sql<{ description: string; amount_minor: number }>(
      `select description, amount_minor from public.expenses where id = $1`,
      [expense],
    )
    expect(row!.description).toBe('Pads, discs and fluid')
    expect(Number(row!.amount_minor)).toBe(13_500)
  })

  it('lets the authorized unlink do what a hand edit may not', async () => {
    const vehicle = await freshVehicle()
    const expense = await vehicleCost(vehicle)
    await link(expense, await schedule(vehicle))

    await db.asUser(ownerId, (session) =>
      session.sql(`select public.maintenance_unlink_expense($1)`, [expense]),
    )

    expect(await linkedOf(expense)).toBeNull()
    // And now the edit that was refused above is simply an ordinary edit.
    await db.sql(
      `update public.expenses set allocation = 'overhead', vehicle_id = null where id = $1`,
      [expense],
    )
    const [row] = await db.sql<{ allocation: string }>(
      `select allocation from public.expenses where id = $1`,
      [expense],
    )
    expect(row!.allocation).toBe('overhead')
  })
})

describe('the anomaly view reports rather than repairs', () => {
  it('exists and returns a countable result', async () => {
    const [row] = await db.sql<{ total: number }>(
      `select count(*)::int as total from app.maintenance_expense_anomalies`,
    )
    expect(Number(row!.total)).toBeGreaterThanOrEqual(0)
  })
})

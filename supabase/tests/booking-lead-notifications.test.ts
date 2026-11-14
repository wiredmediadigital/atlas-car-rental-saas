// @vitest-environment node
/**
 * The in-app notification an agency gets when a request arrives.
 *
 * The constraint that shapes this: mandatory two-factor authentication would be
 * undone for every lead if the renter's details were piped into whatever inbox
 * the agency happens to use. So the event says that a request arrived and names
 * the car; who asked is inside Pevvy, behind the second factor.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { TestDatabase, addMember, signUp } from './support/harness'

let db: TestDatabase
let organizationId: string
let ownerId: string
let adminId: string
let managerId: string
let staffId: string
let vehicleId: string
let seq = 0

const FROM = '2027-05-01T09:00:00Z'
const TO = '2027-05-04T09:00:00Z'

const RENTER = {
  name: 'Ada Lovelace',
  email: 'ada@example.test',
  phone: '+44 20 7946 0999',
  note: 'Please confirm the pick-up address.',
}

type EventRow = {
  id: string
  kind: string
  severity: string
  actor_user_id: string | null
  actor_label: string
  subject_label: string
  context: Record<string, unknown>
  source_table: string
  source_id: string
}

async function createLead(): Promise<string> {
  const [row] = await db.asServiceRole(ownerId, (session) =>
    session.sql<{ lead_id: string }>(
      `select lead_id from app.public_booking_create_lead($1, $2, $3, $4, $5, $6, $7, $8)`,
      [organizationId, vehicleId, FROM, TO, RENTER.name, RENTER.email, RENTER.phone, RENTER.note],
    ),
  )
  return row!.lead_id
}

async function events(): Promise<EventRow[]> {
  return db.sql<EventRow>(
    `select id, kind, severity, actor_user_id, actor_label, subject_label,
            context, source_table, source_id
       from public.notification_events
      where organization_id = $1 and kind = 'booking_lead_received'
      order by occurred_at`,
    [organizationId],
  )
}

async function recipientsOf(eventId: string): Promise<string[]> {
  const rows = await db.sql<{ user_id: string }>(
    `select user_id from public.notification_event_recipients where event_id = $1`,
    [eventId],
  )
  return rows.map((row) => row.user_id).sort()
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
    email: `owner${seq}@notify.test`,
    organizationName: `Notify ${seq}`,
    currency: 'EUR',
    timeZone: 'Europe/Paris',
  })
  if (!owner.organizationId) throw new Error('provisioning failed')
  organizationId = owner.organizationId
  ownerId = owner.userId

  const admin = await signUp(db, { email: `admin${seq}@notify.test` })
  const manager = await signUp(db, { email: `manager${seq}@notify.test` })
  const staff = await signUp(db, { email: `staff${seq}@notify.test` })
  adminId = admin.userId
  managerId = manager.userId
  staffId = staff.userId
  await addMember(db, organizationId, adminId, 'admin')
  await addMember(db, organizationId, managerId, 'manager')
  await addMember(db, organizationId, staffId, 'staff')

  await db.sql(`update public.organizations set public_booking_enabled = true where id = $1`, [
    organizationId,
  ])
  const [vehicle] = await db.sql<{ id: string }>(
    `insert into public.vehicles
       (organization_id, make, model, registration_plate, currency, daily_rate_minor,
        public_booking_enabled)
     values ($1, 'Peugeot', '208', $2, 'EUR', 3900, true) returning id`,
    [organizationId, `NTF-${seq}`],
  )
  vehicleId = vehicle!.id
})

describe('the event', () => {
  it('records one event per lead', async () => {
    const leadId = await createLead()
    const rows = await events()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      kind: 'booking_lead_received',
      source_table: 'booking_leads',
      source_id: leadId,
    })
  })

  it('records a second event for a second lead', async () => {
    await createLead()
    await createLead()
    expect(await events()).toHaveLength(2)
  })

  it('has no actor, because a stranger is not a user', async () => {
    await createLead()
    const [event] = await events()
    expect(event!.actor_user_id).toBeNull()
    expect(event!.actor_label).toBe('')
  })

  it('names the car, which is the agency own information', async () => {
    await createLead()
    const [event] = await events()
    expect(event!.subject_label).toBe('Peugeot 208')
  })
})

describe('who hears about it', () => {
  it('reaches owners and administrators only', async () => {
    await createLead()
    const [event] = await events()
    expect(await recipientsOf(event!.id)).toEqual([ownerId, adminId].sort())
  })

  it('does not reach a suspended member', async () => {
    await db.sql(
      `update public.organization_members set status = 'suspended'
        where organization_id = $1 and user_id = $2`,
      [organizationId, adminId],
    )
    await createLead()
    const [event] = await events()
    expect(await recipientsOf(event!.id)).toEqual([ownerId])
  })
})

describe('what the event may not carry', () => {
  it('carries no renter contact details', async () => {
    await createLead()
    const [event] = await events()
    const serialised = JSON.stringify(event)
    for (const secret of [RENTER.name, RENTER.email, RENTER.phone, RENTER.note]) {
      expect(serialised).not.toContain(secret)
    }
    for (const key of ['email', 'phone', 'full_name', 'name', 'note']) {
      expect(Object.keys(event!.context)).not.toContain(key)
    }
  })

  it('carries enough to render a line and open the lead', async () => {
    const leadId = await createLead()
    const [event] = await events()
    expect(event!.context).toMatchObject({ vehicle_id: vehicleId })
    expect(event!.source_id).toBe(leadId)
    expect(String(event!.context.reference)).toMatch(/^REQ-/)
  })
})

describe('a lead that staff record by hand', () => {
  it('notifies the same people', async () => {
    // The event hangs off the row, not off the public write path, so a lead
    // entered by a staff member reaches the same inboxes.
    const [row] = await db.asUser(staffId, (session) =>
      session.sql<{ id: string }>(
        `insert into public.booking_leads
           (organization_id, vehicle_id, starts_at, ends_at, full_name, email,
            currency, daily_rate_minor, billable_days, quoted_total_minor)
         values ($1, $2, $3, $4, 'Walk In', 'walkin@example.test', 'EUR', 3900, 3, 11700)
         returning id`,
        [organizationId, vehicleId, FROM, TO],
      ),
    )
    expect(row!.id).toBeTruthy()
    const [event] = await events()
    expect(await recipientsOf(event!.id)).toEqual([ownerId, adminId].sort())
  })
})

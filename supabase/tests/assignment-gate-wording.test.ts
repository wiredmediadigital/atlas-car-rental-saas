// @vitest-environment node
/**
 * The assignment feature gate is a per-organization check, not a session flag.
 *
 * This has already gone wrong once. `20261120100000` rewrites every function
 * mentioning the old `app.assignment_lifecycle_enabled` GUC into
 * `app.assignment_lifecycle_active(organization_id)`, in place, with a `do`
 * block -- so the rewritten form exists in no migration file. Two months later
 * `20261120220000` restated `rental_substitute_vehicle` and
 * `rental_reschedule` from their original text and silently put the session
 * flag back; `20261124100000` had to re-run the rewrite to undo it.
 *
 * A session flag nobody sets reads as "off", so the symptom is not an error.
 * It is a reservation that quietly stops opening its vehicle assignment row.
 * That is the kind of defect that is found by a maintenance test weeks later,
 * if at all.
 *
 * This asserts the property directly against the EFFECTIVE schema, so the next
 * migration that restates one of these functions from an older file fails here
 * rather than in production.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { TestDatabase } from './support/harness'

let db: TestDatabase

beforeAll(async () => {
  db = await TestDatabase.create()
}, 180_000)

afterAll(async () => {
  await db.close()
})

describe('the assignment lifecycle gate', () => {
  it('is not read from a session flag by any function', async () => {
    const stale = await db.sql<{ nspname: string; proname: string }>(
      `select n.nspname, p.proname
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname in ('public', 'app')
          and p.prokind = 'f'
          and pg_get_functiondef(p.oid) like '%app.assignment_lifecycle_enabled%'
          -- These two ARE the gate: they are allowed to read the setting.
          and p.proname not in ('assignment_lifecycle_active', 'assignment_feature_eligible')
        order by 1, 2`,
    )

    expect(
      stale.map((row) => `${row.nspname}.${row.proname}`),
      'these functions read the session flag instead of the per-organization gate',
    ).toEqual([])
  })

  it('is read per organization by the two functions that lost it before', async () => {
    const rows = await db.sql<{ proname: string; definition: string }>(
      `select p.proname, pg_get_functiondef(p.oid) as definition
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname in ('rental_substitute_vehicle', 'rental_reschedule')
        order by p.proname`,
    )

    expect(rows).toHaveLength(2)
    for (const row of rows) {
      expect(row.definition, row.proname).toMatch(/assignment_lifecycle_active\(/)
      expect(row.definition, row.proname).not.toMatch(/app\.assignment_lifecycle_enabled/)
    }
  })

  it('is read per organization by the pricing functions too', async () => {
    // rental_extend carries the gate and was redefined twice during the
    // financial work; rental_reprice does not need it and must not grow one.
    const [extend] = await db.sql<{ definition: string }>(
      `select pg_get_functiondef(p.oid) as definition
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'rental_extend'`,
    )

    expect(extend!.definition).toMatch(/assignment_lifecycle_active\(v_rental\.organization_id\)/)
    expect(extend!.definition).not.toMatch(/app\.assignment_lifecycle_enabled/)
  })
})

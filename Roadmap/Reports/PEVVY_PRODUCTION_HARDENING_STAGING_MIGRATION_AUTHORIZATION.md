# Pevvy — production hardening: staging migration authorization package

**Date:** 2026-11-27
**For:** owner authorization of hosted staging application.
**Status:** **NOT APPLIED.** Developed and tested locally only.
**Production:** not accessed, not linked. **NO-GO.**

Five migrations, grouped so that each is one coherent security or integrity change and
can be reasoned about on its own. They are ordered by dependency and must be applied in
filename order.

---

## Preflight — before applying anything

Run from the isolated worktree `E:\pevvy-maintenance-acceptance-20261125`.

```powershell
Set-Location 'E:\pevvy-maintenance-acceptance-20261125'

# 1. The project must be staging, and nothing else.
Get-Content 'supabase\.temp\project-ref'          # expect yeklucfthspvejlkffln

# 2. The ledger must be 148 local / 143 remote before application.
npx supabase migration list --linked

# 3. Every checksum must match the table below, exactly.
Get-ChildItem 'supabase\migrations\202611281*.sql' |
  ForEach-Object { '{0}  {1}' -f (Get-FileHash -Algorithm SHA256 $_.FullName).Hash.ToLower(), $_.Name }

# 4. The dry run must list exactly these five, and nothing else.
npx supabase db push --linked --dry-run
```

**If any of those four disagrees, stop and report it rather than continuing.**

---

## Preflight already performed, read-only — 2026-11-27

All four checks above were run against `yeklucfthspvejlkffln`, plus a full read-only data
inspection. **Nothing was written.** The full evidence is in
`PEVVY_PRODUCTION_HARDENING_HOSTED_PREFLIGHT.md`; the results that bear on authorization:

| Check | Result |
|---|---|
| Project identity | `yeklucfthspvejlkffln`, PostgreSQL **17.12**, `app` schema present |
| Hosted ledger | **143 applied**, latest `20261127100000` |
| Local ledger | **148** |
| Pending | exactly the five below, nothing else |
| Objects the migrations expect to find | **all present** |
| Objects the migrations create | **all correctly absent** — nothing half-applied |
| Amendment rows | **2**, both on `RNT-2026-00004`; history and live hire agree |
| Assignments released by migration 5 | **zero** |
| Maintenance expense anomalies | **zero** |
| Explicit activation rows to preserve | **zero** |

### Dry run

```
$ npx supabase db push --linked --dry-run
DRY RUN: migrations will *not* be pushed to the database.
Connecting to remote database...
Would push these migrations:
 • 20261128100000_rental_lifecycle_authorization.sql
 • 20261128110000_billing_authorization_matrix.sql
 • 20261128120000_amendment_evidence_one_to_one.sql
 • 20261128130000_maintenance_expense_integrity.sql
 • 20261128140000_assignment_activation_default_off.sql
{"upToDate":false,"dryRun":true,"migrations":[...5...],"seeds":[],"roles":[],
 "message":"Finished supabase db push."}
```

Exit code **0**. Exactly five migrations, **no seeds, no role changes**.

### Checksums as they stand now

Two migrations were amended on 2026-11-27 under the owner's instruction to amend the
unpublished set rather than chain corrective migrations. **Their earlier checksums are
superseded and must not be used.**

| File | SHA-256 | Bytes | Lines |
|---|---|---|---|
| `20261128100000_rental_lifecycle_authorization.sql` | `43c9b2e7dbeacb218da8a15b639e649f8fdbe2b110bbb2e7f7d4de7d9c744094` | 17,063 | 382 |
| `20261128110000_billing_authorization_matrix.sql` | `60830dfab601498230f1769438ffac0b050bfdb1299aeb832d5212051db9e57f` | 11,275 | 239 |
| `20261128120000_amendment_evidence_one_to_one.sql` | `8ead334c1f96d9a8001ba2a9552875bc46680308da3ca1f11a451e1d074d7ab4` | 13,198 | 282 |
| `20261128130000_maintenance_expense_integrity.sql` | `1defc28e664f859540316015f2769496b1e4e1d1cd9c4208dd415f0ffb881b47` | 12,461 | 283 |
| `20261128140000_assignment_activation_default_off.sql` | `59135446944eed8bfd955011621cc2af076a0413f3a5f5e9f880aed9bbee2134` | 11,130 | 262 |

**None of the 143 applied migrations was modified.**

---

## The five migrations

### 1. `20261128100000_rental_lifecycle_authorization.sql`

| | |
|---|---|
| SHA-256 | `43c9b2e7dbeacb218da8a15b639e649f8fdbe2b110bbb2e7f7d4de7d9c744094` |
| Size | 17,063 bytes / 382 lines |
| Changed | **yes, 2026-11-27** — section 3 added; the earlier checksum `36bcd48a…` is superseded |

**Objects.** Redefines `public.rental_confirm`, `rental_check_out`, `rental_check_in`,
`rental_complete`, `rental_cancel` as SECURITY DEFINER with tenant, role, billing and
fixed `search_path`; re-grants them to `authenticated, service_role` and revokes `anon`.
Creates `app.guard_rental_lifecycle_columns` and trigger
`rentals_guard_lifecycle_columns`.

**Security impact.** Closes the counterfeit check-out: a staff member could set `status`,
`picked_up_at` and the odometer directly, performing a legal transition while bypassing
availability, maintenance, driver-conflict and inspection validation. Billing parity is
exact — a restricted agency could not write `public.rentals` before and cannot now.

**Data impact.** None. No row is read or written.

**Also closes the duplicate return** (section 3, added 2026-11-27). `rental_check_in`
guarded on `status <> 'active'`, and recording a return does not change the status --
`rental_complete` does -- so an already-returned rental was still 'active' and could be
returned again, overwriting the first readings. A rental carrying a `returned_at` is now
refused a different return, and an identical retry is answered from the existing row
without mutating anything.

**Expected after.** Direct writes to any lifecycle or hand-over column are refused with
*"The … of a rental is set by the action that changes it, not by editing the record."*
`notes` stays editable. **Staff check-ins now advance the vehicle odometer**, which they
silently failed to do before. A second check-in with different readings is refused with
*"This rental has already been returned…"*; an identical retry succeeds and changes nothing.

**Consequence to decide on.** There is no authorized return-correction workflow in Pevvy,
and this does not add one. A mis-keyed return reading on a committed rental now has **no
route to correction**. Reported, not filled.

**Recovery.** Additive apart from five function bodies, each of which is recoverable by a
forward migration restoring the prior definition. Drop
`rentals_guard_lifecycle_columns` to undo the freeze.

---

### 2. `20261128110000_billing_authorization_matrix.sql`

| | |
|---|---|
| SHA-256 | `60830dfab601498230f1769438ffac0b050bfdb1299aeb832d5212051db9e57f` |
| Size | 11,275 bytes / 239 lines |

**Objects.** Adds `app.billing_require_write` to seven functions —
`maintenance_link_expense`, `maintenance_unlink_expense`, `maintenance_complete`,
`maintenance_cancel`, `maintenance_reschedule`, `maintenance_set_service_plan`,
`incident_resolve`. Creates table `app.billing_exempt_functions` and registers four
approved exemptions with reasons.

**Security impact.** Closes a demonstrated bypass: a billing-restricted agency could
create, start, complete and cancel maintenance through the RPCs while a direct table
insert was refused.

**Data impact.** Inserts four rows into a new table. No existing row is touched.

**Expected after.** A restricted agency can still record an accident, document it, report
a breakdown and take the car off the road; it cannot complete or cancel maintenance,
reschedule, set a service plan, resolve an incident, or attach and detach money.

**Recovery.** Remove the billing checks by a forward migration; drop the register table.

---

### 3. `20261128120000_amendment_evidence_one_to_one.sql`

| | |
|---|---|
| SHA-256 | `8ead334c1f96d9a8001ba2a9552875bc46680308da3ca1f11a451e1d074d7ab4` |
| Size | 13,198 bytes / 282 lines |

**Objects.** Adds `public.rental_line_items.revision_no` (default 0) and
`public.rental_pricing_amendments.line_revision_no`; creates
`app.bump_rental_line_item_revision` and trigger `rental_line_items_zz_revision`; a unique
partial index `rental_pricing_amendments_one_per_revision`; redefines
`app.record_rental_pricing_amendment` and
`app.require_rental_pricing_amendment_evidence`.

**Security impact.** Closes evidence reuse: an oscillating hire whose third restatement
had the same signature as its first was satisfied by the first record, leaving the history
inconsistent with the live hire.

**Data impact.** Two columns added with safe defaults. **Existing amendment rows get
`line_revision_no = NULL`**, which the unique index excludes and the evidence check does
not match.

> **Correction, 2026-11-27.** An earlier version of this package stated that staging holds
> **zero** amendment rows. **That was wrong.** The read-only preflight found **two**, both
> on `RNT-2026-00004` — the rental the owner exercised in Scenario 35 — written after the
> original figure was taken and never re-read. The figure is corrected here rather than
> quietly dropped: a data-impact statement that is wrong in the safe direction is still
> wrong.

Both rows will hold `NULL` in the new column. They **stay readable**, they cannot collide
with each other, and they **cannot satisfy evidence for a future restatement** — the check
asks for a row whose `line_revision_no` equals the line's revision, and `NULL` equals
nothing, including itself. A later restatement of that hire is refused until a fresh record
is written: a refusal, never a silent acceptance. All three properties are proven by test,
not asserted. See `PEVVY_PRODUCTION_HARDENING_HOSTED_PREFLIGHT.md` §3.

The history and the live hire currently **agree**: last recorded 19,600; live hire 19,600.

**Expected after.** Each restatement needs its own record naming its revision, and the
amounts must match what actually happened. Two concurrent repricings file one record, not
two, because the second moved nothing.

**Recovery.** Drop the index, the trigger and the two columns; restore the prior function
bodies by forward migration.

---

### 4. `20261128130000_maintenance_expense_integrity.sql`

| | |
|---|---|
| SHA-256 | `1defc28e664f859540316015f2769496b1e4e1d1cd9c4208dd415f0ffb881b47` |
| Size | 12,461 bytes / 283 lines |
| Changed | **yes, 2026-11-27** — section 4 added; the earlier checksum `71782326…` is superseded |

**Objects.** Creates `app.guard_maintenance_expense_link` and trigger
`expenses_guard_maintenance_link`; recreates `expenses_maintenance_fkey` with
`on delete set null (maintenance_id)`; creates view
`app.maintenance_expense_anomalies`; and — added 2026-11-27 — **appends
`maintenance_id` to `public.expense_ledger`**.

**Why the view changed.** The expense screens read `expense_ledger`, which did not select
`maintenance_id`, so the attachment was invisible to the interface by construction: a user
would have been refused by an invariant their screen could not show, with no route to the
unlink. The column is appended, which is all `create or replace view` permits and all that
is wanted — every existing consumer keeps the shape it reads today. `security_invoker` is
restated rather than assumed, because losing it would turn a tenant-scoped read model into
a leak. PostgreSQL **17.12** on staging satisfies the `server_version_num >= 150000` guard
on the foreign key form.

**Security impact.** None directly — cross-tenant protection was already sound and is
untouched. This is financial integrity: a linked cost can no longer drift off its vehicle
or its allocation through the ordinary expense edit screen.

**Data impact.** **No row is rewritten.** The foreign key is dropped and recreated, which
revalidates existing rows; any row that fails would stop the migration, and none does in
testing. Existing inconsistent links are **reported** through the view and a migration
**warning** with a count.

**Preflight already run, read-only: there are no anomalies.** Staging holds **2** costs
linked to maintenance, across 2 maintenance records, with **zero** invariant violations —
no missing maintenance record, no cross-tenant link, no non-vehicle allocation, no vehicle
mismatch. The migration's warning should therefore report **0**, and the foreign key
revalidation has nothing to trip over. See the hosted preflight report §5.

**Expected after.** Editing a linked expense to overhead, to another vehicle, or to a
rental is refused with a sentence naming the unlink step. New links to cancelled
maintenance are refused; costs attached before cancellation are kept.

**Recovery.** Drop the trigger and the view; restore the foreign key without the column
list.

---

### 5. `20261128140000_assignment_activation_default_off.sql`

| | |
|---|---|
| SHA-256 | `59135446944eed8bfd955011621cc2af076a0413f3a5f5e9f880aed9bbee2134` |
| Size | 11,130 bytes / 262 lines |

**The one with real data impact. Read this one twice.**

**Objects.** Redefines `app.assignment_lifecycle_active` (default false, no session flag);
creates `app.assignment_lifecycle_engaged(uuid, uuid)`; rewrites seven rental functions to
the rental-scoped predicate; releases stale assignments; redefines
`public.assignment_feature_eligibility`.

**Security impact.** Removes a caller-settable session GUC from an authorization decision
and restores the STG-02 default-off contract.

**Data impact — the only migration in this set that writes business rows.** It releases
open assignments **whose rental is already `completed` or `cancelled`**. Nothing on a
draft, reserved or active rental is touched: an `in_custody` row on an active rental is a
car in a customer's hands.

**Preflight, read-only, run before authorizing:**

```sql
-- How many rows this migration will release, and on what.
select r.status, count(*) as assignments
  from public.rental_vehicle_assignments a
  join public.rentals r on r.id = a.rental_id and r.organization_id = a.organization_id
 where a.state in ('planned','reserved','in_custody','swap_pending')
 group by r.status order by r.status;

-- Which organizations have an explicit activation row, and its value.
select organization_id, enabled from app.assignment_feature_activation order by 1;
```

The first query's `completed` and `cancelled` rows are exactly what will be released.
Anything under `active` or `reserved` is **left alone** and must remain so.

> **Preflight result, 2026-11-27: this migration will release nothing on staging.**
>
> Staging holds 14 assignments. Exactly **two** are open: one `planned` on a **draft**
> rental and one `in_custody` on an **active** rental. Neither is on a completed or
> cancelled rental, so **zero rows are released**. The four `released` rows on completed
> rentals are already terminal.
>
> The `in_custody` row is a car **currently in a customer's hands** on `RNT-2026-00004`. It
> must stay open, and it does.
>
> **Expect the notice to say `released 0 open assignment(s)`. If it says anything else,
> stop.**
>
> `app.assignment_feature_activation` holds **zero rows**, so there are no explicit
> activation settings to preserve — and equally, **every** agency on staging will stop
> opening new assignment rows once this is applied. That is the STG-02 contract the owner
> chose, and it is the intended outcome, but it is a change every tenant experiences rather
> than a no-op. The complete row set is in the hosted preflight report §4.

**Behavioural change for every agency without an activation row: the assignment lifecycle
stops opening new rows.** Existing open assignments continue to completion through
drainage. An explicitly enabled organization is unaffected.

**Recovery.** The function definitions are restorable by forward migration. **The released
assignments are not** — `released` is a terminal state and the migration does not record
the prior state per row. If that matters, capture the first preflight query's full row set
**before** applying, and keep it.

---

## Apply

Only after the preflight above, and only with owner authorization.

```powershell
Set-Location 'E:\pevvy-maintenance-acceptance-20261125'

npx supabase db push --linked

# Expect 148 local / 148 remote, zero drift, nothing pending.
npx supabase migration list --linked
```

Watch the output for two expected notices rather than errors:

- *"Maintenance expense integrity: N existing linked cost(s) would not satisfy the new
  invariants"* — a **warning**; the migration continues and nothing is rewritten.
- *"Assignment drainage: released N open assignment(s)…"* — a **notice**; N should equal
  the `completed` + `cancelled` total from the preflight query.

If either number is larger than the preflight predicted, stop and report before going
further.

---

## Post-application verification

Expected state, and what will be checked:

- ledger **148 / 148**, zero drift;
- all five applied statement sets identical to the approved files;
- `rentals_guard_lifecycle_columns` and `expenses_guard_maintenance_link` present and
  enabled; `rental_line_items_zz_revision` present;
- the five lifecycle functions SECURITY DEFINER with role and billing checks;
- the seven gated functions calling `app.billing_require_write`; the four exempt ones
  registered with reasons and still carrying their role checks;
- `app.assignment_lifecycle_active` reading no session setting, defaulting false;
- no open assignment remaining on a completed or cancelled rental, and **every** open
  assignment on an active rental still open;
- `rental_swap_vehicle` executable by no browser role;
- existing rentals, charges, payments and contracts readable and unchanged in count.

---

## What is not authorized by this package

- Applying these migrations to **production**.
- Deploying any frontend or Edge Function change that depends on them. The lint
  corrections in `RentalNewPage` and `IncidentNewPage` do **not** depend on these
  migrations and could ship independently, but are held with them for coherence.
- Deploying the five undeployed staging Edge Functions.
- Any correction to the existing inconsistent maintenance-expense links, which needs its
  own decision.

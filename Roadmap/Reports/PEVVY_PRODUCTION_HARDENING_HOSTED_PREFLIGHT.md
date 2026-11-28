# Pevvy — hosted staging read-only preflight

**Date:** 2026-11-27
**Project inspected:** `yeklucfthspvejlkffln` (authorized staging)
**Production project `ysnumxtzcgzyabrghxwq`:** not accessed, not connected to, not named in any
query.
**Nothing was applied. Nothing was written. No business record was mutated.**

---

## How this was run, and why it could not have written anything

A Node script read its own connection string from `.env.staging.local` so that no credential
reached a command line, a process list or a log. Before connecting it **refused** to run if the
string named production or failed to name staging. Everything then ran inside one transaction
opened with:

```sql
begin;
set transaction read only;
```

so PostgreSQL itself would have refused any write the script contained by mistake. The
transaction was rolled back at the end regardless of outcome.

No customer name, email or address was selected. Identifiers, states, counts and timestamps
only.

---

## 1. Identity — the right database

| | |
|---|---|
| Database | `postgres` |
| Server version | **PostgreSQL 17.12** (`server_version_num` 170012) |
| Connected as | `postgres` |
| `app` schema present | yes |
| Project reference in the connection string | `yeklucfthspvejlkffln` |
| Production reference anywhere in `.env.staging.local` | **none** |

`public.rentals` is owned by `postgres`, row level security is **enabled**, and it carries
**4** policies.

---

## 2. Migration ledger

| | |
|---|---|
| Applied on staging | **143** |
| Earliest | `20260813090000` |
| Latest | `20261127100000` |
| Local | **148** |
| Pending | the five `202611281*` migrations, and nothing else |

The five most recent applied versions are `20261127100000`, `20261126130000`, `20261126120000`,
`20261125130000`, `20261125120000`. **No unexpected pending migration**, and no version on
staging that is absent locally.

---

## 3. Amendment history — the package was wrong, and this corrects it

**The migration authorization package stated that staging holds zero amendment rows. It does
not.** The owner was right to challenge that against the Scenario 35 acceptance.

| | |
|---|---|
| `rental_pricing_amendments` rows | **2** |
| Organizations | 1 (`489f43f8-c607-4ed8-940d-e6b351e0d1e4`) |
| Rentals | 1 |
| Earliest | 2026-11-27 21:01:36 UTC |
| Latest | 2026-11-27 21:04:45 UTC |

Both rows belong to **`RNT-2026-00004`** — the rental the owner exercised in Scenario 35.

| | |
|---|---|
| Rental id | `17230269-ab2a-4dfc-baa7-6fdba10ba3be` |
| Reference | `RNT-2026-00004` |
| Status | `active` |
| Total | 23,520 USD minor |
| Amendments | 2 |

**The history and the live hire agree.** The last recorded `revised_amount_minor` is **19,600**
and the live hire line is **19,600**. No QA record was removed or replaced; the two rows are
the genuine product of the owner's own acceptance run, and they are the only amendment rows on
the project.

### Where the wrong figure came from

It was read before the owner performed Scenario 35, and never re-read. It is corrected in the
authorization package rather than quietly dropped, because a data-impact statement that is
wrong in the safe direction is still wrong, and the next one might not be.

### What happens to these two rows when `20261128120000` is applied

`rental_pricing_amendments.line_revision_no` **does not exist on staging yet** (confirmed: zero
matching columns in `information_schema`). The migration adds it, so **both existing rows will
hold `NULL`**.

Two claims follow, and both are proven by test rather than argued:

- **They stay readable.** The column is nullable and nothing filters on it.
  (`amendment rows written before the revision column existed › stays readable`)
- **They cannot satisfy evidence for a future restatement.** The evidence check asks for a row
  whose `line_revision_no` *equals* the line's revision, and `NULL` equals nothing — including
  itself. A later restatement of that hire is therefore **refused** until a fresh record is
  written. A refusal, never a silent acceptance.
  (`… › cannot satisfy the evidence requirement for a later restatement`)

The unique index excludes `NULL` revisions deliberately, so the two historical rows cannot block
each other or block a new one. Also tested.

---

## 4. Assignment drainage — nothing will be released

This is the migration with data impact, and on this project **the impact is nil**.

### Every assignment state on staging

| Assignment state | Rental status | Rows |
|---|---|---|
| `planned` | draft | 1 |
| `in_custody` | active | 1 |
| `released` | completed | 4 |
| `superseded_before_pickup` | active | 8 |
| **Total** | | **14** |

### The complete open row set

Two rows are open. Neither is released by the migration.

| Assignment id | Organization | Rental | Vehicle | State | Seq | Scheduled | Started | Ended | Blocks availability | Rental status | Expected after |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `6b388f7c-a75b-4386-ba13-3b93c8f17771` | `489f43f8-…1e0d1e4` | `a646e778-2751-4452-a629-67d97ae6a4f0` | `718edfbc-d60c-409a-b2a5-4a0cb37d2d73` | `planned` | 1 | 2026-11-28 14:00 → 2026-12-01 14:00 | — | — | false | **draft** | **left untouched** |
| `b0fe04e2-e2f1-45df-b39c-1e8d9d224a60` | `489f43f8-…1e0d1e4` | `17230269-ab2a-4dfc-baa7-6fdba10ba3be` | `40ac18c6-f936-4130-88bc-82440e05749e` | `in_custody` | 9 | 2026-11-26 14:00 → 2026-11-28 14:00 | 2026-11-28 02:02 | — | true | **active** | **left untouched** |

**Rows the migration would release: zero.** It releases open assignments only where the rental
is already `completed` or `cancelled`, and there are none. The four `released` rows on completed
rentals are already terminal.

The second row is a car **currently in a customer's hands** on `RNT-2026-00004`. It must stay
open, and it does. Its drainage path — being returned after activation is switched off — is the
one verified as scenario 10 of the independent concurrency run.

**Expected migration notice:** *"Assignment drainage: released 0 open assignment(s)…"*. **If it
reports any other number, stop.**

### Anomalies requiring owner review

**None.** Every assignment resolves to a rental; no orphans, no cross-tenant rows.

### Activation settings — the one behavioural change worth reading twice

`app.assignment_feature_activation` holds **zero rows**. No organization has ever been switched
on explicitly.

So after `20261128140000`, **every agency on staging stops opening new assignment rows**,
because default-off is restored and there is no explicit activation to preserve. That is the
STG-02 contract the owner chose, and it is the intended outcome — but it is a change every
tenant on the project will experience, not a no-op.

The existing open rows are unaffected and continue through drainage: the `in_custody` car can
still be returned, and the `planned` row on the draft rental is left alone.

There are no explicit activation settings to preserve, so none can be lost.

---

## 5. Maintenance expense anomalies — none

Run against the **existing** schema, not the new view, which does not exist on staging yet.

| | |
|---|---|
| Costs linked to maintenance | **2** |
| Distinct maintenance records | 2 |
| Maintenance record missing | 0 |
| Cross-tenant links | 0 |
| Allocation not `vehicle` | 0 |
| Vehicle mismatch | 0 |
| **Total invariant violations** | **0** |

Every linked cost already satisfies the invariants `20261128130000` introduces. The migration's
anomaly warning should therefore report **0**, and the foreign key revalidation has nothing to
trip over.

**No financial record was repaired, and none needed repair.**

---

## 6. Migration compatibility

| Requirement | Found | Verdict |
|---|---|---|
| PostgreSQL ≥ 15 for the `on delete set null (column)` form | **17.12** | satisfied |
| `public.rental_confirm` / `check_out` / `check_in` / `complete` / `cancel` | all present | the lifecycle rewrite has its targets |
| `app.billing_require_write`, `app.has_min_role` | present | the guard it inserts will resolve |
| `app.transition_rental_assignment` | present | drainage path intact |
| `app.assignment_lifecycle_active`, `app.assignment_feature_activation` | present | the activation rewrite has its targets |
| `public.rental_pricing_amendments` | present | |
| `public.rental_line_items.revision_no` | **absent** | added by `20261128120000`, as expected |
| `rental_pricing_amendments_one_per_revision` | **absent** | added by `20261128120000`, as expected |
| `public.expense_ledger` | present, **38 columns, no `maintenance_id`** | the column is appended by `20261128130000` |
| `expenses_maintenance_fkey` | present | recreated with the column list |
| `rentals_guard_lifecycle_columns` | **absent** | created by `20261128100000`, as expected |
| `expenses_guard_maintenance_link` | **absent** | created by `20261128130000`, as expected |
| `public.rentals` owner | `postgres` | the lifecycle guard's owner exemption resolves correctly |
| RLS on `public.rentals` | enabled, 4 policies | unchanged by this work |

Every object the five migrations expect to **find** is present. Every object they **create** is
correctly absent. Nothing is half-applied.

---

## 7. Scale of the project

| Table | Rows |
|---|---|
| organizations | 2 |
| rentals | 5 |
| rental_line_items | 11 |
| rental_contracts | 5 |
| payments | 8 |
| expenses | 3 |
| maintenance_records | 8 |
| rental_vehicle_assignments | 14 |

A small acceptance dataset, which is what makes the complete row sets above practical to print
in full rather than summarise.

---

## 8. What this preflight does not establish

- **It is a snapshot.** Any acceptance activity after 2026-11-27 21:08 UTC changes these
  numbers, and the assignment and amendment figures in particular should be re-read immediately
  before applying.
- **It did not test the migrations against hosted data.** It confirmed the objects and the row
  sets they will act on. The migrations themselves have only ever run against a local replay.
- **It says nothing about hosted PostgREST, Edge Functions or auth configuration.**
- **No write of any kind was attempted**, so nothing here demonstrates that the migrations will
  apply cleanly — only that the preconditions they depend on hold.

---

## 9. Re-read immediately before authorization — 2026-11-28 02:5x UTC

Repeated in full, read-only, as the instruction requires. **The baseline has moved, and
the change is reported rather than absorbed.**

| Item | First read (21:08) | Re-read | Change |
|---|---|---|---|
| Hosted ledger | 143 | **143** | none |
| PostgreSQL | 17.12 | **17.12** | none |
| Amendment rows | 2 | **3** | **+1** |
| Rentals carrying amendments | 1 (`RNT-2026-00004`) | **1** (same) | none |
| `RNT-2026-00004` total | 23,520 | **35,280** | **+11,760** |
| Last recorded amendment | 19,600 | **29,400** | **+9,800** |
| History agrees with live hire | yes | **yes** | none |
| `line_revision_no` column | absent | **absent** | none |
| Assignments, total | 14 | **14** | none |
| Open assignments | 2 | **2** (same two ids) | none |
| Assignments the migration releases | 0 | **0** | none |
| Explicit activation rows | 0 | **0** | none |
| Maintenance expense links | 2 | **2** | none |
| Maintenance expense anomalies | 0 | **0** | none |
| Payments | 8 | **9** | **+1** |

### What changed, and what it means

**Continued owner acceptance activity on `RNT-2026-00004`**: one further pricing amendment
at 2026-11-28 02:09:06 UTC and one further payment. Nothing else on the project moved.

This is benign, and it is mildly reassuring: the amendment path is being exercised on
hosted staging and **the recorded history still agrees with the live hire** — last recorded
29,400, live hire 29,400.

### What it changes about the authorization

**Nothing material, and one number.**

- `20261128120000` will now set `line_revision_no = NULL` on **three** rows rather than two.
  The three properties proven by test hold for three rows exactly as for two: readable, not
  colliding with each other, and unable to satisfy evidence for a future restatement.
- The drainage figure is unchanged: **zero rows released**. Both open assignments are still
  the same two ids, still on a draft and an active rental.
- Anomalies: still **zero**.

**If further acceptance happens before the migrations are applied, the amendment count will
move again.** That is expected and harmless. The figures that must not move are the drainage
count and the anomaly count, and the application notices should be checked against **0** and
**0** whatever the amendment total is by then.

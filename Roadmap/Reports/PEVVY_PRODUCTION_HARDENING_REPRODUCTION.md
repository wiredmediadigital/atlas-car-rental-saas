# Pevvy — production hardening: reproduction report

**Date:** 2026-11-27
**Scope:** the ten items in §3 of the roadmap completion instruction, reproduced before
any correction is written, as that section requires.
**Nothing was corrected.** No migration, source file or existing test was changed. The
working tree is clean at `5634555`.

Reproductions ran locally — PGlite for schema behaviour, a throwaway PostgreSQL container
for genuine concurrency. **Hosted staging was not touched and production was not
accessed.**

---

## Summary

| # | Item | Verdict | Severity |
|---|---|---|---|
| 1 | Direct rental lifecycle mutation | **CONFIRMED** | High |
| 2 | Checkout and return timestamps | **CONFIRMED** (same root cause as 1) | High |
| 3 | Billing entitlement for privileged RPCs | **CONFIRMED — live bypass** | High |
| 4 | One-to-one amendment evidence | **CONFIRMED** | Medium |
| 5 | Maintenance expense association | **PARTLY CONFIRMED** — tenant half not real, integrity half real | Medium |
| 6 | Independent PostgreSQL concurrency | **PASSED — 8/8 on real PostgreSQL** | None (gate closed) |
| 7 | Existing database test failures | **THREE ARE STALE TESTS, ONE IS ITEM 3** | High (via item 3) |
| 8 | Existing lint and verification failures | **CONFIRMED**, pre-existing, narrow | Low |
| 9 | STG-02 assignment activation | **OWNER DECISION** — the default silently inverted | High |
| 10 | Staging Edge Function readiness | **NO SECURITY DEFECT FOUND**; the gap is a hosted-state record | Low |

Two findings materially change the picture that was carried into this instruction, and
both are corrections to earlier reporting rather than new discoveries:

- **The "four baseline database failures" are not four defects.** Three are tests still
  asserting contracts the migration history has superseded or deliberately withdrawn. One
  is a genuine live bypass, and it is the same thing as item 3.
- **The assignment activation default inverted on 2026-11-24 and nobody recorded it.** An
  organization with no activation row is now **enabled**, where the STG-02 contract says
  it must be disabled. That is item 9, and it is an owner decision, not a bug to fix
  quietly.

---

## 1 and 2 — Direct rental lifecycle and hand-over mutation

**CONFIRMED. High.** One root cause, so they are answered together.

`app.guard_rental_pricing_inputs` (added 2026-11-27) froze the *pricing* inputs but
deliberately left `status`, `picked_up_at`, `returned_at` and `original_ends_at` writable,
because the RPCs that write them — `rental_confirm`, `rental_check_out`,
`rental_check_in`, `rental_complete`, `rental_cancel` — are SECURITY INVOKER and would
have broken. That was the right call for those columns and the wrong place to stop.

**Reproduced.** As an ordinary staff member, through RLS:

```sql
update public.rentals
   set status = 'active', picked_up_at = now(), pickup_odometer = 12345,
       pickup_fuel_percent = 90
 where id = <a reserved rental>;
```

succeeded. Result: `{"status":"active","picked_up_at":"2026-11-27T21:31:25Z","pickup_odometer":12345}`
— a **counterfeit check-out**. The same for a return on an active rental:
`{"returned_at":"…","return_odometer":99999}`.

**The precise shape of the defect matters.** The status machine is *not* broken. The
transition guard refuses every illegal move:

| Transition | Result |
|---|---|
| draft → active | refused — *A draft can only be confirmed or cancelled.* |
| draft → completed | refused — same |
| reserved → completed | refused — *A reservation can only be checked out or cancelled.* |
| active → draft | refused |
| completed → active | refused — *A completed rental cannot change status again.* |
| cancelled → reserved | refused |
| **reserved → cancelled** | **allowed** |

So a direct write cannot reach an *illegal state*. What it bypasses is everything the RPC
does **around** the transition: vehicle availability revalidation, maintenance conflict
checks, driver conflict prevention, assignment row synchronisation, odometer and fuel
capture, and the inspection record. A rental can be moved to `active` with no assignment
row, no inspection, and a vehicle that is in the workshop.

`original_ends_at` is writable at any point, by anyone with staff and a billing
entitlement — confirmed by setting it to `2020-01-01` on an active rental. It is the
record of what the booking originally was, and it is the one field the extension history
leans on outside `rental_pricing_amendments`.

**Minimum correction.** Extend `app.guard_rental_pricing_inputs` so that, for a non-owner
writer, the four lifecycle columns may change **only in the transitions the lifecycle
allows, and only alongside the status change that justifies them** — or, more simply and
more in keeping with the existing architecture, make the five lifecycle RPCs SECURITY
DEFINER (as the pricing ones already are) and freeze the four columns outright against
direct writes.

The second is cleaner and matches what was already done for `rental_extend` and
`rental_reprice`, but it is a larger change: five functions, each needing explicit tenant,
role and billing checks moved inside, exactly as was done in `20261126130000`. It is also
the change the architecture is already heading towards.

**Not in scope here**, per §3's instruction to reproduce first.

---

## 3 — Billing entitlement for privileged RPCs

**CONFIRMED, and it is a live bypass rather than a structural lint. High.**

Eleven `public` SECURITY DEFINER functions are executable by `authenticated`, write tenant
data, call neither `app.billing_require_write` nor `app.billing_may_write`, and are not on
the documented exempt list:

`maintenance_link_expense`, `maintenance_unlink_expense`, `maintenance_create`,
`maintenance_start`, `maintenance_complete`, `maintenance_cancel`,
`maintenance_reschedule`, `maintenance_set_service_plan`, `incident_create`,
`incident_update`, `incident_resolve`.

**The bypass was demonstrated, not inferred.** In a database with an agency driven to a
restricted billing state, a direct `insert into public.maintenance_records` as the owner
is refused — *permission denied for table maintenance_records* — while the same agency can
still create, start, complete and cancel maintenance through the RPCs. The read-only state
the billing architecture promises is therefore not read-only.

This is the same thing as baseline failure 4 in item 7. It is one defect counted twice.

**Minimum correction.** Add `perform app.billing_require_write(<org>)` to each function
that should be gated, after its existing tenant and role checks — the same one-line
addition `20261126130000` made to `rental_extend` and `rental_reprice`.

**Owner decision, and it is a real one.** Not all eleven obviously belong behind a billing
gate, and the project has already accepted the opposite argument once:
`vehicle_take_off_road` is deliberately exempt, because taking an unroadworthy car off the
road is a safety obligation that only ever makes a fleet smaller.

`incident_create` (an accident that has already happened) and `maintenance_create` (a
breakdown) have that same shape — refusing to let an agency record a crash because its
card expired is arguably worse than allowing it. `maintenance_complete` and
`vehicle_return_to_service` are the counter-case, because they put a car **back on hire**,
and the schema already gates the latter for exactly that reason.

**The owner should decide which of the eleven are gated and which are exempt with a
written reason.** Every exemption needs to be on the exempt list, so the test stops
reporting it.

---

## 4 — One-to-one financial amendment evidence

**CONFIRMED. Medium**, because reaching it needs privileges a browser does not have.

The deferred evidence constraint matches a mutation's **signature** — rental, organization,
charge line, previous and revised amount, and the quantity, unit-rate and tax-treatment
changes. It does not consume the record it matches, so two mutations with identical
signatures can be satisfied by one amendment.

**Reproduced.** One transaction, three restatements of the hire, two recorded:

```
10000 -> 20000   recorded
20000 -> 10000   recorded
10000 -> 20000   NOT recorded   <- matched the first amendment's signature
```

It committed. Final hire **20000**; recorded history `["10000->20000", "20000->10000"]`.

**The history is not merely incomplete — it is internally inconsistent.** Read back, the
last recorded revised amount is 10000 while the live hire is 20000. Anyone reconciling the
two would conclude the contract says one thing and the record another, which is the exact
failure mode the amendment table exists to prevent.

**Control:** a single unrecorded restatement with a *novel* signature is still refused —
*The hire on a committed rental was restated without recording what changed.* The guard
works; it is the uniqueness that is missing.

**Reachability.** The caller must already be inside an owner-owned SECURITY DEFINER
function; every other writer is refused outright by the charge integrity guard. No
existing function oscillates. This is a latent integrity hole, not an open door.

**Minimum correction.** Give each amendment a claim rather than a signature. The smallest
version: a unique index on `(line_item_id, recorded_in_xact, previous_amount_minor,
revised_amount_minor)` prevents two identical records, and the trigger counts the
qualifying mutations it has seen in this transaction against the amendments present — or,
simpler and sufficient, record the hire line's `xmin` or a per-mutation sequence on the
amendment so that one record can satisfy exactly one mutation.

---

## 5 — Maintenance expense association integrity

**PARTLY CONFIRMED. Medium.** The two halves resolve differently, and the half that was
reported is the half that is not real.

### The tenant boundary is sound — three independent defences

- **The RPC:** Agency A linking A's expense to B's maintenance record is refused
  *"Maintenance record not found."* (the role check runs against the **record's**
  organization, not the caller's). The reverse is refused *"Expense must be a vehicle
  expense for the same vehicle."*
- **The schema:** `expenses_maintenance_fkey` is composite and tenant-scoped —
  `FOREIGN KEY (maintenance_id, organization_id) REFERENCES maintenance_records(id, organization_id)`
  — so a direct PostgREST update pointing an expense at another tenant's record is refused
  with a foreign key violation, even though `authenticated` does hold UPDATE on `expenses`.
- **`expenses_freeze_columns`** freezes `organization_id`, so the expense cannot be walked
  into the other tenant first.

Cross-tenant unlink is equally refused, and account closure is correct: `expenses` is
purged before `maintenance_records`, and a full claim-and-purge of an agency holding a
linked expense completed cleanly with zero rows left in either table.

### The integrity invariants are advisory, and that is real

`maintenance_link_expense` enforces two things at link time — the expense must be a
**vehicle** expense, and its vehicle must be the maintenance record's vehicle. **Nothing
re-checks them afterwards.** There is no CHECK, no trigger and no foreign key covering
`vehicle_id`; the RPC is the only enforcement point.

Meanwhile `src/features/expenses` has no awareness of `maintenance_id` at all, and
`updateExpense` writes `allocation`, `vehicle_id` and `rental_id` while leaving
`maintenance_id` untouched. So **the product's own edit screen breaks the invariant**:

| Edit, made as an ordinary manager on the Expense detail page | Result |
|---|---|
| allocation → `overhead` (vehicle cleared) | succeeded; `maintenance_id` survives |
| vehicle → a different vehicle | succeeded; `maintenance_id` survives |
| allocation → `rental` | succeeded; `maintenance_id` survives |

Afterwards the maintenance record reported `maintenance_actual_cost = 15000` composed
entirely of one agency-overhead cost, one cost belonging to a different vehicle, and one
belonging to a rental — and the detail page still lists all three.

**Three smaller findings.** Linking is permitted on a **cancelled** maintenance record, so
work that never happened can accumulate a cost. An already-linked expense can be moved to
a second record with no complaint — only the UI picker filters `maintenance_id is null`.
And `expenses_maintenance_fkey`'s `ON DELETE SET NULL` has no column list, so it would null
`organization_id` too and fail its NOT NULL constraint; that is latent rather than live,
because `authenticated` holds only SELECT on `maintenance_records`, but the declared delete
action cannot fire as written.

Voided expenses are properly protected.

**Minimum correction.** A trigger on `expenses` that refuses to leave `maintenance_id` set
when `allocation` stops being `vehicle` or `vehicle_id` stops matching the record's
vehicle — or clears it, which is the gentler option and matches what the desk means.
Separately, give the `ON DELETE SET NULL` an explicit `(maintenance_id)` column list.

---

## 6 — Independent PostgreSQL concurrency verification

**PASSED — 8 of 8 checks, on genuinely concurrent sessions against real PostgreSQL.**
This closes a gate that has been open since the driver-availability work.

PGlite is a single connection, so the local suite could only ever establish these
properties sequentially — which is exactly why this gate existed. The verification
replayed all 143 migrations plus the Supabase role doubles into a throwaway
**PostgreSQL 17** container and drove two independent connections at once. **Hosted
staging was not used**, so there is no QA residue to clean up and no tenant record at
risk.

### Concurrent repricing of one rental

Both sessions committed. **Two amendments recorded for two operations** — the chain
`100 → 15000` then `15000 → 15000`, with the live hire at 15000. The second session
waited on the first's `select … for update`, recomputed from the committed state, and
recorded against it. **No lost update, and the chain is consistent with the live hire.**

### Concurrent extension of one rental

A was **refused** — *"An extension must end after the current return date."* — because B
had already committed and moved the date. One commit, **one** amendment,
`extension_count = 1`, and the last recorded revised amount (20000) equals the live hire.
The row lock serialised them rather than letting both apply to a stale read.

### Concurrent confirmation of two overlapping hires on one vehicle

**One committed, one refused** by the exclusion constraint `rentals_no_vehicle_overlap`;
one of the two rentals is reserved and the other is still a draft. Double-booking
prevention holds under genuine concurrency, not merely under sequential test conditions.

### One small finding, reported rather than filed away

The concurrent repricing recorded a **no-op amendment**: `15000 → 15000`, difference zero.
The second session did the honest thing — it recomputed and found nothing to change — but
`rental_reprice` records unconditionally, so the history now carries a row saying nothing
happened.

That is noise rather than corruption, and it is strictly better than the alternative of
not recording. It is worth a line in whichever correction touches
`record_rental_pricing_amendment`: skip the record when `changes` is empty **and** the
amount is unchanged. Not urgent, and not a defect.

---

## 7 — Existing database test failures

**Three of the four are not product defects.** This corrects how they have been reported
throughout this work package, including by me.

| # | Test | Verdict |
|---|---|---|
| 1 | `assignment-feature-activation` — defaults missing activation to disabled | **Stale test.** It asserts the `20261120100000` contract. The effective definition comes from `20261124100000` and **inverted the default**. See item 9. |
| 2 | `assignment-lifecycle-operations` — repeated active swaps | **Stale test.** Calls `public.rental_swap_vehicle`, revoked from every role by `20261124120000`; effective ACL is `postgres=X/postgres`. |
| 3 | `assignment-lifecycle-operations` — fails closed for unauthorized swaps | **Stale test, and it is passing in substance.** The swap *does* fail closed; the test fails only because the matcher expects `/consent\|authorization/i` and the actual message is the permission-denied text. |
| 4 | `billing-restricted-access` — no ungated SECURITY DEFINER write path | **Genuine defect.** This is item 3. |

`Roadmap/Handoff/DATABASE_MIGRATION_STATE.md` states that withdrawn vehicle-swap
migrations must not be revived, which corroborates 2 and 3.

**Minimum correction.** Amend test 1 to the released contract **after** the owner settles
item 9 — not before, because the test is currently the only artefact in the repository
still asserting the opposite default, and that disagreement is the finding. Retire tests 2
and 3, which exercise a deliberately withdrawn RPC. Fix 4 by fixing item 3.

**Do not** change `app.assignment_lifecycle_active` to make test 1 pass. That would
silently re-disable the assignment lifecycle for every organization without an activation
row.

---

## 8 — Existing lint and verification failures

**CONFIRMED, and narrow. Low.**

`npm run lint`: **3 errors, 14 warnings**, all pre-existing and all in files untouched by
this work package.

- **3 errors**, all `react-hooks/set-state-in-effect`: `IncidentNewPage.tsx` lines 66 and
  71, `RentalNewPage.tsx` line 265. Each calls `setState` synchronously inside an effect,
  which triggers a cascading render. Blamed to 2026-11-25, before this work package began.
- **14 warnings**: 13 are `react-refresh/only-export-components` — a file exporting both a
  component and a constant, which affects hot-reload during development and nothing in
  production. One is *"Compilation Skipped: Use of incompatible library"* in
  `InviteDialog.tsx`, meaning the React compiler declined to optimise that file.

`npm run typecheck` and `prettier --check` are clean.

**Minimum correction.** The three errors are the only ones worth acting on, and each is a
local refactor to derive the value during render or move the effect's work into the event
that causes it. None is a security or correctness issue.

---

## 9 — STG-02 assignment activation configuration

**OWNER DECISION REQUIRED. High**, because the current behaviour is the opposite of the
written contract and nothing in the repository records the change.

`app.assignment_lifecycle_active`'s effective definition is **not** the one in
`20261120100000`. It was last redefined by `20261124100000_standard_vehicle_swap_release.sql`,
which **inverted the default**:

```sql
coalesce(current_setting('app.assignment_lifecycle_enabled', true), 'on') = 'on'
  and coalesce((select a.enabled from app.assignment_feature_activation a …), true)
```

A missing activation row now means **enabled**. `20261120100000` says, in its own words,
that it "defines the contract only", "does not enable any organization", and that "missing
rows mean disabled". The table comment was rewritten at the same time from "activation
state" to "safety state". No migration seeds a row, and the only writer is
`set_assignment_feature_enabled`, which needs admin plus a verified second factor. So the
column's `default false` is dead letter on the read path.

**Verified behaviourally**, not read from a file: a fresh organization returns
`{enabled: true, can_view_history: true, can_swap: true}`; inserting `enabled = false`
returns all three false.

`can_swap: true` is itself misleading — `20261124120000` revoked `rental_swap_vehicle` from
every role, so the capability it advertises cannot be called by anyone.

Twelve functions consult this gate, including `rental_confirm`, `rental_check_out` and
`rental_check_in`, which open, transition and release assignment rows when it is active.

### The decision, plainly

**Does an agency that has never been asked get the assignment lifecycle, or must it be
switched on for them one at a time?**

| | Option A — restore STG-02: default **off** | Option B — ratify the current behaviour: default **on** |
|---|---|---|
| Activation | Opt-in, per agency, admin + second factor, audited | Automatic |
| Failing test 1 | Passes with no change | Must be amended to the new contract |
| Security review claim "default-off and server-authoritative" | Becomes true again | Must be rewritten |
| Risk | Every organization running on the implicit default since 2026-11-24 **stops** writing assignment rows the moment it lands. Any rental already out with a customer leaves an open `in_custody` row that blocks that vehicle over that window **permanently**, and a later confirm fails with a raw exclusion-constraint error | None of that |
| Required alongside | A one-time closure of stranded `in_custody` / `swap_pending` rows whose rental is already completed or cancelled | Nothing |

In either case the correction is **one new forward-dated migration**, never an edit to
`20261124100000`, and it should drop the `current_setting(…, 'on')` fallback so the switch
cannot be set from a browser session at all.

---

## 10 — Staging Edge Function security and functional readiness

**No security defect found. Low.** The gate has two halves and they resolve differently.

**The deployment gap is a record about hosted state**, which local analysis cannot verify
and which was out of scope for remote commands here. What can be checked holds:
`supabase/functions/` contains exactly nine function directories beside `_shared` and
`tests`, and the gate record names the six as `account-closure`,
`account-closure-notice`, `gps-provider`, `mfa-reset`, `public-booking` and
`team-invitations`, leaving `billing`, `billing-webhook` and `pricing` deployed.

**The implied security concern is not confirmed.** Every entrypoint and shared module was
read. There are no unauthenticated writes, no missing tenant checks, no secret echoed in a
response, **no raw SQL anywhere** in `supabase/functions/` — every database call is a
parameterised PostgREST call or an `.rpc()` — and no service-role path reachable without
authorization.

`public-booking`, the one holding the service role with `anon` granted nothing, was
scrutinised hardest and is sound: the service role never leaves `index.ts`.
`billing-webhook` verifies a constant-time HMAC-SHA256 Stripe signature with a 300-second
tolerance and fails closed with no secret. `pricing` projects fields explicitly, exposing
no Stripe identifier or key.

**No correction required.** Deployment of the six remains a release activity, gated as it
already is.

---

## What this report does not do

It corrects nothing. §3 asks for reproduction before correction, and that boundary is
kept: no migration, source file or existing test was modified, and the working tree is
clean.

Two items are **owner decisions and should be settled before the corrections are written**,
because the corrections differ depending on the answer: which of the eleven RPCs are
billing-gated (item 3), and the assignment activation default (item 9). Item 7's test 1
cannot be amended until item 9 is answered.

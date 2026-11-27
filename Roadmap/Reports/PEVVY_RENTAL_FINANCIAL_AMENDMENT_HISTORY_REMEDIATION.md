# Pevvy — Rental financial amendment history and lifecycle integrity

*Remediation report. Covers the financial amendment history remediation and the
financial and lifecycle integrity closure that followed it, both 2026-11-27.*

**Work package 4, outstanding requirement.** Branch
`fix/maintenance-manual-acceptance-20261125`, worktree
`E:\pevvy-maintenance-acceptance-20261125`. Staging project `yeklucfthspvejlkffln`.

**APPLIED TO STAGING on 2026-11-27 by the owner, and verified.** Ledger 143 local /
143 remote, zero drift. The applied statements are identical to the approved file across
all 30 statements. Full verification evidence is in
`PEVVY_RENTAL_FINANCIAL_ADJUSTMENTS_DEPLOYMENT_CLOSURE.md`; **production was not
touched.**
**Production remains NO-GO.** Nothing here is manual acceptance; the owner's pass is
scenario 35 in `PEVVY_RENTAL_FINANCIAL_ADJUSTMENTS_ACCEPTANCE.md`.

---

## 1. Baseline, verified rather than assumed

| | Expected | Found |
|---|---|---|
| Staging release | `aa94dc3` | `aa94dc3` — `origin/staging` and local HEAD agree |
| `origin/main` | untouched | `31383a9` |
| Applied migration | `20261126130000` | present, ledger **142 local / 142 remote, zero drift** |
| Its checksum | `ee503f77…4f5e` | `ee503f7790b09692c8546a6435c5acd5ff0231400087fb6f801725637a574f5e` |
| Project ref | `yeklucfthspvejlkffln` | `supabase/.temp/project-ref` agrees |
| Working tree | clean | clean |

**One figure in the stated baseline was wrong, and it was mine.** The closure
authorization says "Three unpublished implementation commits". There are **two**:
`e350322` and `f414616`. The number came from my own closing summary of the previous
turn and was carried forward in good faith. Every other baseline figure verified exactly
as stated.

The three prerequisite documents exist and carry the previous evidence:
`PEVVY_RENTAL_FINANCIAL_ADJUSTMENTS_IMPLEMENTATION.md` (25,806 bytes),
`PEVVY_RENTAL_FINANCIAL_ADJUSTMENTS_ACCEPTANCE.md` (7,329 bytes),
`PEVVY_RENTAL_FINANCIAL_ADJUSTMENTS_PROMPT.md` (29,380 bytes).

They live in the **tracked** `Roadmap/` on this branch rather than in the primary
checkout's untracked `Roadmap/`, so they travel with the branch and the deployment.
Copies are mirrored into the primary checkout at the paths the authorization names; §8
below records both sets.

---

## 2. The defect, and why it could not be fixed with contracts

A confirmed reservation that was repriced before any contract had been issued lost its
previous hire amount outright. Where a contract existed, the superseded version preserved
it; where none did, nothing did.

The obvious fix — issue a contract — was investigated and rejected on evidence, not
taste. `public.rental_issue_contract` is not a snapshot utility:

- it **supersedes every live version** of the contract irreversibly (`status` →
  `superseded`, `superseded_at` set), and there is no DELETE grant and an immutability
  trigger, so a client cannot undo it;
- the new row surfaces in `rental_board` and `rental_schedule` as a document **awaiting
  signature and PDF**, which is a lie to the desk;
- it permanently flips `app.rental_is_finalized`, because the mere existence of any
  `rental_contracts` row makes it true;
- afterwards, rescheduling refuses unless the caller passes `p_amend_contract`.

There is also **no reusable snapshot builder**. The pricing jsonb is constructed inline
inside `rental_issue_contract` and is reachable only by inserting a contract row — one
`'pricing'` key in the entire schema, at `20260815100100_rental_contracts.sql:917`.

The deeper problem is that contract issuance is a **manual act**. Any design routing
history through it leaves history depending on whether somebody pressed a button, which
is not a property a financial record can have.

---

## 3. What was built

### 3.1 `public.rental_pricing_amendments`

One row per authorized restatement of a finalized base hire, shaped after
`public.expense_change_events` — this schema's existing answer to "what changed, from
what, to what, by whom and when", and the only append-only tenant-scoped history table
in it.

The two hire amounts are real columns because they are what the screen reads and what
anybody asking about the record is asking about. `difference_minor` is a stored generated
column so every reader gets the same sign. Everything else that moved — dates, duration,
quantity, day rate, tax treatment, contract total — lives in `changes jsonb` in the
`{from, to}` shape the precedent uses, carrying **only the keys that actually moved**.

`contract_version` records the issued version in force, where one was. It is a join back
to the existing contract architecture, never a requirement.

### 3.2 Nobody can write it

```sql
revoke all on table public.rental_pricing_amendments from anon, authenticated;
grant select on table public.rental_pricing_amendments to authenticated;
```

There is **no insert, update or delete grant for any browser role**, exactly as
`expense_change_events` does it. Unauthorized creation, modification and deletion are
refused because the privilege does not exist — not because a policy declines. A policy
can be loosened by a later migration without anyone noticing; a missing grant cannot be
used at all. One `select` policy, `app.is_org_member(organization_id)`, matching the
charge lines the history describes.

`app.record_rental_pricing_amendment` is SECURITY DEFINER with `search_path = ''` and is
revoked from `public`, `anon` and `authenticated`. It takes whole rows — rental and hire
line, before and after — so a column added to either is carried without changing the
signature.

### 3.3 The evidence requirement

A **deferred constraint trigger** on `rental_line_items` refuses to commit a finalized
hire whose money moved unless an amendment row was written in the same transaction,
identified by `pg_current_xact_id()`.

Deferral is the whole reason it works. The pricing functions update the line and record
the amendment immediately afterwards; an immediate check would fire between the two and
refuse every legitimate amendment. Deferring to commit asks the only question that
matters — *by the time this transaction finished, was there a record?* — so a future
pricing path that forgets **cannot commit**, which is what §8 requires.

It is deliberately **not** folded into `app.guard_rental_line_item_integrity`. That guard
is the accepted base-hire protection from `20261126130000` and is left byte-for-byte
alone.

### 3.4 The two pricing paths record what they did

An independent inspection of every function that can touch a `base_rental` line found
exactly three, and only two restate it in place:

| Path | Touches the hire | Records |
|---|---|---|
| `public.rental_reprice` | UPDATEs it (or INSERTs the first) | yes, when finalized |
| `public.rental_extend` | UPDATEs it (or INSERTs the first) | yes, always — both its states are finalized |
| `app.settle_cancelled_rental` | only INSERTs mirror reversals | n/a — never updates |

`rental_check_in`, `rental_check_out`, `rental_complete`, `rental_confirm`,
`rental_swap_vehicle`, `rental_reschedule` and `rental_substitute_vehicle` write no
charge line of any kind. There is **no early-return financial adjustment** in this schema
to cover.

Both functions were restated from their **effective** definitions, and the assignment
gate is reproduced word for word:

```sql
if v_rental.status = 'reserved'
   and app.assignment_lifecycle_active(v_rental.organization_id) then
```

`20261120100000` rewrites every function mentioning the old session GUC, in place, via a
`do` block. Restating the original wording silently reverts the feature to a flag nobody
sets. Signatures, membership, role, billing, state rules, arithmetic and refusals are
otherwise unchanged.

A draft reprice records nothing, which is the existing business rule and §7's explicit
instruction.

### 3.5 One thing that had been thrown away

`rental_extend` accepted `p_charge_description` and discarded it — the body literally
ended `perform p_charge_description;`. It is the reason the desk already types, so it is
now the reason the record keeps. No signature change, nothing new to pass.

### 3.6 Account closure

`app.organization_purge_tables()` is explicit, and its own comment warns that a table
added without being listed there **stops the purge before it deletes anything**. The new
table is listed immediately before `rental_line_items`, since it references both that and
`rentals`. The list was restated from the effective definition in `20261125130000`, which
is five tables newer than the original.

### 3.7 The evidence requirement, tightened — a real gap, found by asking

The owner asked whether an earlier amendment, or an unrelated one in the same
transaction, could satisfy the requirement for a *subsequent* unrecorded pricing change.
It could. The check matched only on rental and transaction:

```sql
where a.rental_id = new.rental_id
  and a.recorded_in_xact = pg_current_xact_id()
```

So one amendment row vouched for every hire restatement in that transaction. A function
that recorded its first change and then quietly made a second committed happily. This was
**proved with a failing test before it was fixed** — a transaction that recorded one
amendment and then restated the hire again was accepted.

The evidence now has to describe the mutation it is offered for: same rental, same
agency, same charge line, and the same before and after on every field that qualifies a
mutation — amount, quantity, unit rate and tax treatment. `changes` carries only the keys
that moved, so a key's absence is itself a claim that the field did not change, and the
mutation has to agree with that too.

This is exactly the list §3 of the authorization enumerates, and each item is now a
test: correct rental association, correct organization association, correct original
charge association, and previous and revised amounts matching the actual mutation.

One further change fell out of it. `amended_at` defaulted to `now()`, which is the
transaction timestamp, so two amendments recorded in one transaction shared it exactly
and could not be ordered. The order of a financial history is part of what it says, so
it now defaults to `clock_timestamp()` — the wall clock when the row was written.

### 3.8 The assignment gate — the reported defect is not confirmed

My previous report named `public.rental_substitute_vehicle` and
`public.rental_reschedule` as carrying obsolete session-GUC wording. **That was wrong,
and I am correcting it rather than acting on it.**

The wording is genuinely present in migration `20261120220000`, which does run after the
`20261120100000` rewrite. What I missed is that
`20261124100000_standard_vehicle_swap_release.sql` **re-runs the rewrite block** and
corrects both functions. The finding came from reading migration files; it does not
survive contact with the effective schema.

Queried against the schema after all 143 migrations:

- **No** function in `public` or `app` contains `app.assignment_lifecycle_enabled`,
  excluding the two that *are* the gate.
- Both `rental_substitute_vehicle` and `rental_reschedule` contain
  `assignment_lifecycle_active`.

No correction was made, because none was needed, and making one would have been churn
against working code. What was added instead is
`supabase/tests/assignment-gate-wording.test.ts` — three tests asserting the property
directly against the effective schema. The property has already been lost once and
silently restored once; a test is what stops the third time. A session flag nobody sets
reads as "off", so the symptom is not an error — it is a reservation that quietly stops
opening its vehicle assignment row.

### 3.9 The pricing inputs, which were genuinely exposed

The charge lines have been protected since `20261126130000`. The figures those charges
are computed *from* were not. `rentals_update` asks for a role and a billing entitlement
and says nothing about the state of the rental.

Probed directly, as a staff member, against a **completed** rental, these all succeeded:

| Column | What a direct PATCH could do |
|---|---|
| `ends_at` | move the return date of a finished hire |
| `billable_days` | set the days charged to 99 |
| `daily_rate_minor` | set the day rate to 1 |
| `tax_rate_bps` | set the tax rate to zero |
| `deposit_minor` | rewrite the deposit |
| `currency` | change EUR to USD |
| `customer_id` | move the hire to a different customer |
| `picked_up_at`, `returned_at`, odometers | erase the hand-over record |

Only `status` (its own transition guard), `vehicle_id` (the pointer guard) and
`reference` (already frozen) refused.

This is broader than the report that prompted it — currency, tax rate and customer were
not in the original finding. It does not by itself move money, since the charge lines
still say what was charged; that is precisely what makes it worth closing, because it
desynchronises the booking from the contract silently, and the screen that compares them
only looks while the rental is a draft or a reservation.

**`app.guard_rental_pricing_inputs`** refuses a direct change to `starts_at`, `ends_at`,
`billable_days`, `daily_rate_minor`, `tax_rate_bps`, `currency`, `deposit_minor`,
`customer_id` and `vehicle_id` once the rental is past draft, and additionally freezes
the hand-over record — collection and return times, odometers and fuel readings — once
the rental is completed or cancelled.

`notes` stays editable. Freezing it would be the kind of over-correction that gets a
protection switched off.

### 3.10 Why the owner exemption is safe here, which had to be checked

The same discriminator as the charge guard — `current_user` against the table owner, with
the trigger SECURITY INVOKER so `current_user` names the real writer.

Reusing it required checking something that turned out to matter a great deal. Only five
rental functions are SECURITY DEFINER: `rental_extend`, `rental_reprice`,
`rental_reschedule`, `rental_substitute_vehicle` and `rental_swap_vehicle`. Each takes
the rental row `for update` and checks tenant membership, the staff role and
`app.billing_require_write` before writing.

**Every other lifecycle RPC is SECURITY INVOKER** — `rental_confirm`,
`rental_check_out`, `rental_check_in`, `rental_complete`, `rental_cancel` all run as the
caller. An owner-only exemption would have broken all of them.

It does not, because of what they actually write. Checked function by function against
the effective definitions:

| Function | Columns of `rentals` it writes |
|---|---|
| `rental_confirm` | `status`, `original_ends_at` |
| `rental_check_out` | `status`, `picked_up_at` |
| `rental_check_in` | `returned_at` |
| `rental_complete` | `status` |
| `rental_cancel` | `status` |
| `rental_move_to_account`, `rental_set_cancellation_fee`, `rental_record_payment`, `rental_issue_contract` | none |

None of those columns is frozen while the rental is in a state those functions run in.
`original_ends_at` is deliberately left editable for that reason. The hand-over columns
are frozen only in the terminal states, which is after check-out and check-in have
finished with them.

There is no early-return financial adjustment to preserve: `rental_check_in` writes
`returned_at` and nothing else.

The purge is exempt through the same `app.rental_charges_purge_exempt` helper the charge
guard uses, so a closing agency can still take its records apart.

---

## 4. Final migration dossier

| | |
|---|---|
| **Filename** | `supabase/migrations/20261127100000_rental_pricing_amendment_history.sql` |
| **SHA-256** | `d0d9ca39487486c1cb7e492364a7a7e28bcf4e4f317c4dcc70234ee74b553890` |
| **Size** | 798 lines / 35,823 bytes |
| **Status** | **Applied to staging 2026-11-27. Not applied to production.** |
| **Ledger** | **143 local, 143 remote, zero drift.** Nothing pending. |
| **Worktree** | `E:\pevvy-maintenance-acceptance-20261125` |

The earlier dossier gave `27b8f62d…` at 621 lines. That checksum is superseded: the
closure work tightened the evidence requirement and added the pricing-input guard inside
the same unpublished migration, as §8 of the authorization directs. No previously applied
migration was touched, and no second migration file was created.

**Purpose.** Preserve the previous financial position whenever an authorized operation
restates a finalized base hire, independently of contract issuance — and stop a direct
client write from changing the figures that hire is priced from, or the hand-over record
of a finished rental.

### 4.1 What it creates

| Object | Kind |
|---|---|
| `public.rental_amendment_kind` | enum (`reprice`, `extension`) |
| `public.rental_pricing_amendments` | table, 3 indexes, 2 composite FKs, 1 check, 1 generated column |
| `rental_pricing_amendments_select` | policy — `app.is_org_member`, select only |
| `app.record_rental_pricing_amendment` | SECURITY DEFINER, revoked from `public`, `anon`, `authenticated` |
| `app.require_rental_pricing_amendment_evidence` | SECURITY DEFINER, revoked |
| `rental_line_items_amendment_evidence` | **deferred** constraint trigger on `rental_line_items` |
| `app.guard_rental_pricing_inputs` | **SECURITY INVOKER**, revoked |
| `rentals_guard_pricing_inputs` | BEFORE UPDATE trigger on `rentals` |

### 4.2 What it redefines

`public.rental_extend`, `public.rental_reprice`, `app.organization_purge_tables`.
Public RPC signatures unchanged.

### 4.3 What it deliberately leaves alone

`app.guard_rental_line_item_integrity`, `app.settle_cancelled_rental`,
`app.post_settlement_reversal`, `public.rental_reverse_charge`, every contract function,
`rental_substitute_vehicle`, `rental_reschedule`, and all of `20261126130000`.

### 4.4 Financial amendment history enforcement

The pricing operation records the amendment in the same transaction as the pricing
change. A deferred constraint trigger then refuses, **at commit**, to let a finalized
hire's money move unless an amendment row exists in that transaction whose rental,
organization, charge line, previous amount, revised amount, quantity change, unit-rate
change and tax-treatment change all match what actually happened.

Deferral is essential rather than incidental: the function updates the line and records
immediately afterwards, so an immediate check would fire between the two and refuse every
legitimate amendment.

### 4.5 Deferred constraint trigger verification

| Requirement (§3) | How it is enforced | Test |
|---|---|---|
| Multiple amendments within one transaction | signature match per mutation | refuses a second restatement riding on the first's record; accepts two genuinely recorded ones |
| Consecutive amendments across transactions | `pg_current_xact_id()` differs | refuses an amendment left by an earlier transaction |
| Correct rental association | `a.rental_id = new.rental_id` | refuses an amendment recorded against another rental |
| Correct organization association | `a.organization_id = new.organization_id` | covered by the above plus cross-tenant tests |
| Correct original charge association | `a.line_item_id = new.id` | signature tests |
| Amounts match the actual mutation | `previous`/`revised` compared to `old`/`new` | refuses when the recorded figure differs from the one written |
| Rollback removes both | one transaction | a deliberate failure after a valid amendment leaves neither |
| Unauthorized callers cannot manufacture history | no insert grant for any browser role | direct insert refused to staff and to owners |
| Concurrent operations cannot satisfy each other | per-transaction id, plus `for update` on the rental | see the limitation in §8 — **sequential, not concurrent** |

### 4.6 Rental pricing input and lifecycle date protection

`app.guard_rental_pricing_inputs`, a BEFORE UPDATE trigger on `public.rentals`:

- exempts the table owner, which is how the five SECURITY DEFINER pricing and scheduling
  functions keep working;
- exempts a draft, because editing one is how a booking is built;
- exempts an agency being purged;
- otherwise refuses a change to `starts_at`, `ends_at`, `billable_days`,
  `daily_rate_minor`, `tax_rate_bps`, `currency`, `deposit_minor`, `customer_id` or
  `vehicle_id`;
- and, once the rental is **completed or cancelled**, also refuses a change to
  `picked_up_at`, `returned_at`, `pickup_odometer`, `return_odometer`,
  `pickup_fuel_percent` or `return_fuel_percent`.

It is SECURITY INVOKER on purpose. As a definer it would run as its own owner whoever
wrote the row, and `current_user` would be a constant that said nothing — the same
mistake that made the first version of the charge guard pass vacuously.

### 4.7 Assignment logic

**No change was made, because the reported defect does not exist in the effective
schema.** See §3.8. A regression test was added instead.

### 4.8 Authorization boundaries

`rental_extend` and `rental_reprice` keep membership, `app.has_min_role(…, 'staff')`,
`app.billing_require_write`, their state rules, `search_path = public, extensions,
pg_temp`, `anon` revoked and `authenticated` granted explicitly. All three internal
functions added here are revoked from `public`, `anon` and `authenticated`. No
client-settable session flag is used as a security boundary anywhere in this migration.

The owner exemption is not broad and was not taken on trust: every SECURITY DEFINER
rental function was enumerated and every SECURITY INVOKER lifecycle RPC was checked
column by column (§3.10).

### 4.9 Compatibility

Additive. No column dropped, no data rewritten, no existing migration modified. Existing
rentals remain readable and operational; one with no amendments shows an empty history,
which is accurate. No historical record is manufactured and no previous pricing is
inferred from balances or payments.

### 4.10 Account closure

`rental_pricing_amendments` is listed in `app.organization_purge_tables()` immediately
before `rental_line_items`, which it references. The purge suite's two checks — that
every table carrying `organization_id` is either purged or knowingly retained, and that
each purged table *actually had a row in it* — both pass, with the fixture seeding the
new table. The pricing-input guard exempts a purging agency.

### 4.11 Can anything still bypass these protections?

Required by §9, answered plainly.

**From a browser, through PostgREST: no path is known to remain.** Charge lines cannot be
inserted, updated or deleted against a finalized rental except as an authorized reversal;
the hire cannot be restated at all; the pricing inputs and the finished hand-over record
are refused; `rental_pricing_amendments` has no write privilege of any kind. `notes` and
other non-financial metadata remain editable, deliberately.

**Three residual paths exist, all requiring privileges a browser does not have:**

1. **The `service_role` key** bypasses row-level security entirely. It is held only by
   Edge Functions. This is pre-existing and architectural, not introduced here.
2. **Any owner-owned SECURITY DEFINER function** inherits the trigger exemptions by
   construction. The five that exist are enumerated and checked. A *future* one would
   inherit the exemption unexamined — which is why this is recorded as an architecture
   decision rather than left to memory. For the hire specifically the exposure is now
   narrower: such a function must also record a matching amendment to commit.
3. **Direct database access** as `postgres`. Outside the application's threat model.

**One residual gap inside the evidence check, stated precisely.** The check matches a
mutation's signature. If a single transaction moved the hire 100 → 200 → 100 → 200 and
recorded only the first change, the third mutation's signature would match the first
amendment. This requires the caller to already be inside an owner-owned SECURITY DEFINER
function — any other writer is refused outright by the charge guard — and no such
function performs oscillating restatements. Closing it exactly would need a per-mutation
claim rather than a signature match. It is recorded rather than fixed.

### 4.12 Ledger, commands and rollback

Ledger before application: **143 local, 142 remote**, one pending. Verified by
`npx supabase migration list --linked` and a read-only `--dry-run`, which reported
exactly `20261127100000_rental_pricing_amendment_history.sql`.

PowerShell, from the isolated worktree, **after owner authorization only**:

```powershell
Set-Location 'E:\pevvy-maintenance-acceptance-20261125'

# 1. Confirm the project and the checksum before anything else.
Get-Content 'supabase\.temp\project-ref'            # expect yeklucfthspvejlkffln
(Get-FileHash -Algorithm SHA256 `
  'supabase\migrations\20261127100000_rental_pricing_amendment_history.sql').Hash.ToLower()
# expect d0d9ca39487486c1cb7e492364a7a7e28bcf4e4f317c4dcc70234ee74b553890

# 2. Ledger and dry run.
npx supabase migration list --linked                # expect 143 local / 142 remote
npx supabase db push --linked --dry-run             # expect exactly one pending

# 3. Apply.
npx supabase db push --linked

# 4. Confirm.
npx supabase migration list --linked                # expect 143 / 143, zero drift
```

**Rollback.** Additive; nothing is dropped or rewritten, so applying it cannot lose data.
There is **no down migration**. Reverting needs a new forward migration that drops the
constraint trigger before the table, drops the two `rentals` and `rental_line_items`
triggers, restores `app.organization_purge_tables()` without the new table, and decides
what to do with amendment rows already recorded. Until it is applied, reverting is
deleting one unpublished file.

---

## 5. Tests

### 5.1 New

`supabase/tests/rental-pricing-amendments.test.ts` — **26 tests, all passing.** They
cover the authorization items (§14.1–20) that belong in the database:

reprice before contract issuance preserves the previous amount (the regression test for
the reported 1 → 15,000 case); it records without issuing a contract; operator, hire line
and currency are named; only what moved is recorded; reprice after issuance records the
amendment and leaves version 1's snapshot byte-identical with still exactly one version;
extension records previous and revised hire, dates and duration; the discarded
description becomes the reason; three consecutive extensions form a chain
(15,000 → 20,000 → 25,000 → 30,000) rather than unrelated snapshots; a refused reprice and
a refused extension record nothing and leave the hire untouched; direct insert, update and
delete are refused to staff **and to owners**; cross-tenant history is invisible while
visible to its own agency; the privileged recorder is unreachable by `anon` and
`authenticated`; a restated hire that recorded nothing is refused **even to the table
owner**; a draft hire is left alone; a description-only edit needs no evidence; draft
repricing, finalized-charge protection, manager reversals, totals and cancellation
settlement all still work.

`src/features/rentals/components/amendment-history.test.tsx` — **12 tests, all passing**
(§14.21–23): empty state, previous amount kept visible beside the revised one, signed
difference both ways, extension distinguished from reprice, contract version shown only
when there was one, every amendment listed, a failed read reported instead of claiming
no history, a skeleton rather than an empty state while loading, and the record stacking
at phone width.

### 5.2 Existing fixtures that had to change

Two fixtures staged state by writing the hire line directly as superuser, which the new
evidence requirement correctly refuses:

- `cancellation-fee.test.ts` — `chargeIt` was a bare `UPDATE`. It now does what
  `rental_reprice` does: move the line and record the amendment in the same transaction.
  Every assertion is unchanged; only the staging changed. **28 passing.**
- `account-closure-purge.test.ts` — the new table carries `organization_id`, so the purge
  must empty it, and the suite's second check insists a table it claims to have emptied
  **actually had a row in it**. The fixture now seeds one. **23 passing.**

Both changes are to how the tests arrange the world, not to what they assert.

### 5.3 Full suite

Reported in §6 below with the baseline failures separated.

---

## 6. Test results

**Full suite: 4,198 tests across 203 files. 4,194 pass. 4 fail, and all four are the
same pre-existing failures as before any of this work.**

| | Tests | Failures |
|---|---|---|
| Authorization baseline (as stated) | 4,123 | 4 |
| After the amendment history remediation | 4,166 | 4 |
| **After this closure** | **4,198** | **4** |

Seventy-five tests added across the two pieces of work, and **no new failure at any
point**.

| File | Test | Why it is pre-existing |
|---|---|---|
| `assignment-feature-activation` | defaults missing activation to disabled and keeps the decision tenant-scoped | STG-02 assignment-activation default, an open release gate |
| `assignment-lifecycle-operations` | supports repeated active swaps with idempotent operation keys and preserved inspections | Withdrawn vehicle-swap architecture |
| `assignment-lifecycle-operations` | fails closed for unauthorized and cross-tenant active swaps | Withdrawn vehicle-swap architecture |
| `billing-restricted-access` | leaves no SECURITY DEFINER write path ungated and unexplained | The eleven incident and maintenance write RPCs that do not call `app.billing_require_write`, an open release gate |

The billing failure was re-read after this work. It still names exactly the same eleven
incident and maintenance functions. **Neither pricing function, nor
`app.record_rental_pricing_amendment`, nor `app.guard_rental_pricing_inputs` appears in
it** — the direct evidence that none of the new privileged code opened an ungated write
path.

### Focused results

| Suite | Result |
|---|---|
| `rental-pricing-amendments` | **32 passed** (26 + 6 added by the closure) |
| `rental-lifecycle-integrity` (new) | **23 passed** |
| `assignment-gate-wording` (new) | **3 passed** |
| `amendment-history` (frontend) | 12 passed |
| `rental-charge-integrity` | 59 passed — the financial security tests, preserved in full |
| `permission-matrix` | 65 passed |
| `cancellation-fee` | 28 passed |
| `account-closure-purge` | 23 passed |

### §7 coverage

Every item the authorization lists, and where it is proven:

| Required | Where |
|---|---|
| Completed rental dates — direct change rejected | `rental-lifecycle-integrity` |
| Cancelled rental dates — direct change rejected | `rental-lifecycle-integrity` |
| Finalized pricing inputs — unauthorized change rejected | 7 parameterised cases |
| Draft editing still works | `rental-lifecycle-integrity` |
| Rescheduling still works | `rental-lifecycle-integrity` |
| Pre-checkout substitution still works | `rental-lifecycle-integrity` |
| Extension still works | both suites, including the amendment it records |
| Repricing still works | both suites |
| Early return still works | check-in asserted in the checkout/return/complete test |
| Checkout and return still work | `rental-lifecycle-integrity` |
| Cancellation still works | `rental-lifecycle-integrity` and `cancellation-fee` |
| Vehicle availability still enforced | substitution after collection refused; `maintenance-acceptance` unchanged |
| Driver conflict still enforced | confirmation requires a primary driver; driver suites unchanged |
| Cross-tenant mutations rejected | both suites |
| Billing-restricted mutations rejected | `billing-restricted-access` (its definer gate is the known baseline) |
| Amendment history remains accurate | `rental-pricing-amendments`, 32 tests |
| Issued contracts unchanged | snapshot compared byte-for-byte after a reprice |
| Charge integrity still enforced | `rental-charge-integrity`, 59 tests |
| Organization closure still works | `account-closure-purge`, 23 tests |

### Other checks

Typecheck (`tsc -b --noEmit`) clean. Prettier clean. ESLint: **3 errors and 14 warnings,
all pre-existing** in `RentalNewPage.tsx` and `IncidentNewPage.tsx`, neither touched.

---

## 7. Delivery evidence

Thirteen deliverables, committed in the tracked worktree. The twelve documents are
**mirrored byte-identically** into the primary checkout at the paths the authorization
names. The migration is deliberately **not** mirrored: it belongs to the branch, and the
primary checkout must not acquire an unapplied migration.

| File | Bytes | Modified | SHA-256 | Mirrored | Status |
|---|---|---|---|---|---|
| `PEVVY_RENTAL_FINANCIAL_AMENDMENT_HISTORY_REMEDIATION.md` | 39,617 | 2026-11-27 13:24:24 | `0a3192fff64aa888...` | identical | COMPLETE |
| `PEVVY_RENTAL_FINANCIAL_ADJUSTMENTS_IMPLEMENTATION.md` | 27,256 | 2026-11-27 12:30:59 | `6414d38836366b8e...` | identical | COMPLETE |
| `PEVVY_RENTAL_FINANCIAL_ADJUSTMENTS_ACCEPTANCE.md` | 13,146 | 2026-11-27 13:14:03 | `b6d8a16853765dd1...` | identical | COMPLETE |
| `PEVVY_RENTAL_FINANCIAL_LIFECYCLE_INTEGRITY_CLOSURE_PROMPT.md` | 10,136 | 2026-11-27 13:10:59 | `f6a88ef1d0c872f7...` | identical | COMPLETE |
| `PEVVY_RENTAL_FINANCIAL_AMENDMENT_HISTORY_REMEDIATION_PROMPT.md` | 16,199 | 2026-11-27 11:50:03 | `d03757b50f0c66d6...` | identical | COMPLETE |
| `PEVVY_RENTAL_FINANCIAL_ADJUSTMENTS_PROMPT.md` | 29,380 | 2026-11-27 11:06:49 | `37aa45741d41c8d2...` | identical | COMPLETE |
| `ARCHITECTURE_DECISIONS.md` | 15,678 | 2026-11-27 13:14:24 | `73c846badad324d2...` | identical | COMPLETE |
| `CHANGELOG.md` | 18,754 | 2026-11-27 13:15:16 | `994317fa2ba17933...` | identical | COMPLETE |
| `FEATURE_TRACKER.md` | 8,270 | 2026-11-27 13:15:16 | `aae779ebe2c5e2fb...` | identical | COMPLETE |
| `MASTER_ROADMAP.md` | 11,845 | 2026-11-27 13:15:16 | `a098cd9391bf4d77...` | identical | COMPLETE |
| `PRODUCTION_RELEASE_CHECKLIST.md` | 12,094 | 2026-11-27 13:15:16 | `5899de36aeb4866c...` | identical | COMPLETE |
| `PRODUCTION_RELEASE_MANIFEST.md` | 16,915 | 2026-11-27 13:15:16 | `82798fa25183872f...` | identical | COMPLETE |
| `20261127100000_rental_pricing_amendment_history.sql` | 35,823 | 2026-11-27 13:07:33 | `d0d9ca39487486c1...` | branch only | COMPLETE |

Absolute paths, worktree:

```
E:\pevvy-maintenance-acceptance-20261125\Roadmap\Reports\PEVVY_RENTAL_FINANCIAL_AMENDMENT_HISTORY_REMEDIATION.md
E:\pevvy-maintenance-acceptance-20261125\Roadmap\Reports\PEVVY_RENTAL_FINANCIAL_ADJUSTMENTS_IMPLEMENTATION.md
E:\pevvy-maintenance-acceptance-20261125\Roadmap\Reports\PEVVY_RENTAL_FINANCIAL_ADJUSTMENTS_ACCEPTANCE.md
E:\pevvy-maintenance-acceptance-20261125\Roadmap\Prompts\PEVVY_RENTAL_FINANCIAL_LIFECYCLE_INTEGRITY_CLOSURE_PROMPT.md
E:\pevvy-maintenance-acceptance-20261125\Roadmap\Prompts\PEVVY_RENTAL_FINANCIAL_AMENDMENT_HISTORY_REMEDIATION_PROMPT.md
E:\pevvy-maintenance-acceptance-20261125\Roadmap\Prompts\PEVVY_RENTAL_FINANCIAL_ADJUSTMENTS_PROMPT.md
E:\pevvy-maintenance-acceptance-20261125\Roadmap\RoadMapFiles\ARCHITECTURE_DECISIONS.md
E:\pevvy-maintenance-acceptance-20261125\Roadmap\RoadMapFiles\CHANGELOG.md
E:\pevvy-maintenance-acceptance-20261125\Roadmap\RoadMapFiles\FEATURE_TRACKER.md
E:\pevvy-maintenance-acceptance-20261125\Roadmap\RoadMapFiles\MASTER_ROADMAP.md
E:\pevvy-maintenance-acceptance-20261125\Roadmap\RoadMapFiles\PRODUCTION_RELEASE_CHECKLIST.md
E:\pevvy-maintenance-acceptance-20261125\Roadmap\RoadMapFiles\PRODUCTION_RELEASE_MANIFEST.md
E:\pevvy-maintenance-acceptance-20261125\supabase\migrations\20261127100000_rental_pricing_amendment_history.sql
```

Absolute paths, primary checkout (documents only):

```
E:\pevvy-car-rental-saas-main\Roadmap\Reports\PEVVY_RENTAL_FINANCIAL_AMENDMENT_HISTORY_REMEDIATION.md
E:\pevvy-car-rental-saas-main\Roadmap\Reports\PEVVY_RENTAL_FINANCIAL_ADJUSTMENTS_IMPLEMENTATION.md
E:\pevvy-car-rental-saas-main\Roadmap\Reports\PEVVY_RENTAL_FINANCIAL_ADJUSTMENTS_ACCEPTANCE.md
E:\pevvy-car-rental-saas-main\Roadmap\Prompts\PEVVY_RENTAL_FINANCIAL_LIFECYCLE_INTEGRITY_CLOSURE_PROMPT.md
E:\pevvy-car-rental-saas-main\Roadmap\Prompts\PEVVY_RENTAL_FINANCIAL_AMENDMENT_HISTORY_REMEDIATION_PROMPT.md
E:\pevvy-car-rental-saas-main\Roadmap\Prompts\PEVVY_RENTAL_FINANCIAL_ADJUSTMENTS_PROMPT.md
E:\pevvy-car-rental-saas-main\Roadmap\RoadMapFiles\ARCHITECTURE_DECISIONS.md
E:\pevvy-car-rental-saas-main\Roadmap\RoadMapFiles\CHANGELOG.md
E:\pevvy-car-rental-saas-main\Roadmap\RoadMapFiles\FEATURE_TRACKER.md
E:\pevvy-car-rental-saas-main\Roadmap\RoadMapFiles\MASTER_ROADMAP.md
E:\pevvy-car-rental-saas-main\Roadmap\RoadMapFiles\PRODUCTION_RELEASE_CHECKLIST.md
E:\pevvy-car-rental-saas-main\Roadmap\RoadMapFiles\PRODUCTION_RELEASE_MANIFEST.md
```

**No deliverable is incomplete.** Every file exists, is non-empty, and carries the
evidence its section describes. The migration's checksum above is the one to apply; the
earlier `27b8f62d...` is superseded.

---
## 8. Remaining material limitations

**This remediation's own limit.** History begins at this migration. No record is
manufactured for amendments made before it, per §15 of the earlier authorization, so an
existing rental repriced last week shows an empty history — which is accurate, not a gap
being hidden.

**Concurrency: sequential, not concurrent.** Stated plainly because the authorization
asks for the distinction. The database tests run on PGlite, a single connection, so
genuinely simultaneous operations cannot be executed. What is proven, and by what:

- each amendment shares a transaction with its pricing change — a deliberate failure
  after a valid amendment leaves neither;
- both pricing functions take the rental row `select … for update` before anything moves,
  so two amendments to one rental serialise;
- `pg_current_xact_id()` cannot be shared between transactions, so one transaction's
  record cannot vouch for another's change — asserted directly;
- three consecutive amendments form a chain, each one's previous amount being the one
  before it, which is the property that breaks first if a read were stale.

Genuine concurrent execution against hosted Postgres remains a release gate, where it
already sits for driver availability.

**One residual gap inside the evidence check.** The check matches a mutation's signature.
A single transaction that moved the hire 100 → 200 → 100 → 200 while recording only the
first change would have its third mutation matched by the first amendment. This requires
the caller to already be inside an owner-owned SECURITY DEFINER function — any other
writer is refused outright — and no such function performs oscillating restatements.
Closing it exactly needs a per-mutation claim rather than a signature match. Recorded,
not fixed.

**Still true, and not introduced here:**

1. `service_role` bypasses row-level security entirely. Held only by Edge Functions.
2. Any owner-owned SECURITY DEFINER function inherits the trigger exemptions on both
   `rental_line_items` and `rentals` by construction. The exemption is per-role, not
   per-function. The five that exist are enumerated and checked; a future one must be
   reviewed, which is why it is an architecture decision rather than a note.
3. `app.guard_rental_line_item_integrity` is defined twice inside `20261126130000`; only
   the second is effective. Harmless, confusing to the next reader.

**Corrected rather than carried forward:** my previous report listed the assignment-gate
session-GUC wording as a live defect in `rental_substitute_vehicle` and
`rental_reschedule`. It is not — `20261124100000` corrects it, and the effective schema
is clean. See §3.8.

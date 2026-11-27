# Pevvy — Rental financial amendment history: remediation report

**Work package 4, outstanding requirement.** Branch
`fix/maintenance-manual-acceptance-20261125`, worktree
`E:\pevvy-maintenance-acceptance-20261125`. Staging project `yeklucfthspvejlkffln`.

**Migration created and tested locally. NOT applied to any hosted database.**
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

---

## 4. Migration dossier (§17)

| | |
|---|---|
| **Filename** | `supabase/migrations/20261127100000_rental_pricing_amendment_history.sql` |
| **SHA-256** | `27b8f62d7ee1f7dfcb9ec6b3aaaedd8bf1e0de1f59414787261c3142d5ee7308` |
| **Size** | 621 lines / 26,305 bytes |
| **Status** | **Created and tested locally. NOT applied to staging or production.** |
| **Ledger** | 143 local, **142 remote**. Exactly one pending. |
| **Worktree** | `E:\pevvy-maintenance-acceptance-20261125` |

**Purpose.** Preserve the previous financial position whenever an authorized operation
restates a finalized base hire, independently of whether a contract was ever issued.

**Creates** — type `public.rental_amendment_kind` (`reprice`, `extension`); table
`public.rental_pricing_amendments` with three indexes, two composite foreign keys and one
check; policy `rental_pricing_amendments_select`; functions
`app.record_rental_pricing_amendment` and
`app.require_rental_pricing_amendment_evidence`; constraint trigger
`rental_line_items_amendment_evidence`.

**Redefines** — `public.rental_extend`, `public.rental_reprice`,
`app.organization_purge_tables`. Public RPC signatures unchanged.

**Leaves alone** — `app.guard_rental_line_item_integrity`, `app.settle_cancelled_rental`,
`app.post_settlement_reversal`, `public.rental_reverse_charge`, every contract function,
and all of `20261126130000`.

**Authorization boundaries.** `rental_extend` and `rental_reprice` keep membership,
`app.has_min_role(…, 'staff')`, `app.billing_require_write`, their state rules, a fixed
`search_path = public, extensions, pg_temp`, `anon` revoked and `authenticated` granted
explicitly. Both internal functions are revoked from `public`, `anon` and `authenticated`.
No client-settable session flag is used as an authorization boundary anywhere.

**Compatibility.** Additive. Existing rentals remain readable and operational; a rental
with no amendments shows an empty history, which is the truth about it. No historical
record is manufactured for changes made before this migration, and no previous pricing is
inferred from balances or payments.

**Rollback.** No column is dropped and no data rewritten. There is **no down migration**:
reverting needs a new forward one that also decides what to do with amendment rows
already recorded, and would have to drop the constraint trigger before the table.

**Apply commands** (from `E:\pevvy-maintenance-acceptance-20261125`, after owner
authorization only):

```
npx supabase migration list --linked      # expect 143 local / 142 remote
npx supabase db push --linked --dry-run   # expect exactly one pending
npx supabase db push --linked
npx supabase migration list --linked      # expect 143 / 143, zero drift
```

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

**Full suite: 4,166 tests across 201 files. 4,162 pass. 4 fail, and all four are the
same pre-existing failures as before this work.**

Against the baseline the authorization states (4,123 passed, four baseline failures),
this adds **39 tests** — 26 database, 12 frontend, and one more from the existing suites
— and introduces **no new failure**.

| File | Test | Why it is pre-existing |
|---|---|---|
| `assignment-feature-activation` | defaults missing activation to disabled and keeps the decision tenant-scoped | STG-02 assignment-activation default, an open release gate |
| `assignment-lifecycle-operations` | supports repeated active swaps with idempotent operation keys and preserved inspections | Withdrawn vehicle-swap architecture |
| `assignment-lifecycle-operations` | fails closed for unauthorized and cross-tenant active swaps | Withdrawn vehicle-swap architecture |
| `billing-restricted-access` | leaves no SECURITY DEFINER write path ungated and unexplained | The eleven incident and maintenance write RPCs that do not call `app.billing_require_write`, an open release gate |

The billing failure was re-read in full after this migration. It still names exactly
eleven functions — `maintenance_link_expense`, `incident_create`, `incident_update`,
`incident_resolve`, `maintenance_reschedule`, `maintenance_create`, `maintenance_start`,
`maintenance_cancel`, `maintenance_unlink_expense`, `maintenance_set_service_plan`,
`maintenance_complete`. **Neither `rental_extend` nor `rental_reprice` appears**, and
neither does `app.record_rental_pricing_amendment`. That is the direct evidence that
redefining the two pricing functions, and adding a privileged recorder, opened no ungated
write path.

### Focused results

| Suite | Result |
|---|---|
| `rental-pricing-amendments` (new) | **26 passed** |
| `amendment-history` (new, frontend) | **12 passed** |
| `rental-charge-integrity` | **59 passed** — the financial security tests, preserved in full |
| `cancellation-fee` | 28 passed (fixture restaged) |
| `account-closure-purge` | 23 passed (fixture seeded) |
| `rental-reprice` | 19 passed |
| `permission-matrix` | 65 passed |

### Other checks

Typecheck (`tsc -b --noEmit`) clean. Prettier clean. ESLint: **3 errors and 14 warnings,
all pre-existing** in `RentalNewPage.tsx` and `IncidentNewPage.tsx`, neither touched by
this work. One error was briefly introduced here — a redundant type assertion in the new
frontend test — and removed; the count is back to the baseline three.

---

## 7. Remaining material limitations

**This remediation's own limit.** History begins now. No record is manufactured for
amendments made before this migration, per §15, so an existing rental that was repriced
last week shows an empty history — which is accurate, not a gap being hidden.

**Concurrency, honestly stated.** The database tests run on PGlite, which is a single
connection, so genuinely simultaneous amendments cannot be executed there.

What *is* proven, and by what mechanism:

- **No partial financial change, and no orphan history.** The amendment and the pricing
  change are one transaction. Tests assert that a refused reprice and a refused extension
  each leave the hire untouched and record nothing.
- **No lost history under concurrency.** Both pricing functions take
  `select … for update` on the rental before anything moves, so two amendments to the
  same rental serialise rather than interleave. Three consecutive extensions are asserted
  to form a chain — 15,000 → 20,000 → 25,000 → 30,000 — each row's previous amount being
  the one before it, which is the property that breaks first if a read were stale.
- **No duplicate history from retries.** A retried *transaction* either commits once,
  recording once, or rolls back, recording nothing; history cannot duplicate
  independently of the pricing change it belongs to. A caller who genuinely performs two
  extensions gets two amendments, because that is two amendments. Note that
  `rental_extend` has never been idempotent — it carries no operation key — so a
  double-submitted extension extends twice, as it did before this work.

True concurrent execution against hosted Postgres remains on the release checklist, where
it already sits for driver availability.

**Found during inspection, pre-existing, out of scope — reported rather than fixed:**

1. `public.rental_substitute_vehicle` and `public.rental_reschedule` carry the
   **pre-`20261120100000` session-GUC wording** (`current_setting('app.assignment_lifecycle_enabled', true) = 'on'`),
   so the in-place rewrite has already been reverted for those two. This is the exact
   trap the architecture decision warns about, and it has already bitten.
2. The pricing **inputs** are not protected the way the charge line now is. `rentals_update`
   has no state test and the freeze trigger does not cover `starts_at`, `ends_at`,
   `billable_days` or `daily_rate_minor`, so a direct PostgREST PATCH can change all four
   on a completed rental. That does not by itself move money — the charge lines are
   protected — but it desynchronises the booking from what was charged.
3. `app.guard_rental_line_item_integrity` is defined **twice inside `20261126130000`**;
   only the second is effective. Harmless today, confusing to the next reader.
4. The guard's exemption remains **per-role, not per-function**: any owner-owned SECURITY
   DEFINER function inherits it. Already recorded in `ARCHITECTURE_DECISIONS.md`; the new
   deferred constraint narrows it for the hire specifically, since such a function must
   now also record an amendment to commit.

None of these is introduced by this migration.

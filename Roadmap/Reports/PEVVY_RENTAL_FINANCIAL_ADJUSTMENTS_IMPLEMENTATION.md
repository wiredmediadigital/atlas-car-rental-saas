# Pevvy — Rental Financial Adjustments: implementation report

**Work package 4.** Branch `fix/maintenance-manual-acceptance-20261125`, worktree
`E:\pevvy-maintenance-acceptance-20261125`. Staging project `yeklucfthspvejlkffln`.
**Production remains NO-GO.** Nothing in this report is manual acceptance; the owner's
acceptance pass is scenario 30 onward in
`PEVVY_RENTAL_FINANCIAL_ADJUSTMENTS_ACCEPTANCE.md`.

This was commissioned as an enhancement and verification assignment, not as a new
financial system, and that is what it is. No parallel adjustment ledger, payment ledger,
pricing engine, tax engine or customer credit system was built. The Charges / Money /
Agency costs architecture is unchanged, and every figure on the new screen is read from
the values the database already maintains.

---

## 1. What was found, and why the scope grew

The brief asked me to **investigate** the delete action on original rental charge lines
and explicitly not to assume it was unsafe. The investigation found that it was.

`removeCharge` was a direct `DELETE` on `rental_line_items` through PostgREST. Its only
backend control was the RLS policy `rental_line_items_delete`, which required a staff role
and a billing entitlement — and said nothing about the state of the rental. A staff member
could therefore delete a charge after the reservation was confirmed, after the contract
was issued, after the customer had paid, and after the rental was completed. The
lifecycle gate existed, but only in the browser, in the condition
`rental.status !== 'completed' && rental.status !== 'cancelled'` on the page.

Deleting a charge is unrecoverable and leaves no trace: the line is gone, the trigger
recalculates the rental totals, and nothing records that it ever existed.

The owner accepted this as a material financial integrity defect and authorized its
correction inside this work package. That is what migration `20261126130000` does.

---

## 2. Migration dossier

| | |
|---|---|
| **File** | `supabase/migrations/20261126130000_rental_charge_integrity.sql` |
| **SHA-256** | `ee503f7790b09692c8546a6435c5acd5ff0231400087fb6f801725637a574f5e` |
| **Size** | 1,087 lines / 47,450 bytes |
| **Hosted staging** | **Applied.** Ledger 142 local / 142 remote, zero drift |

### 2.1 The application discrepancy, recorded

The authorization expected 141 remote / 142 local before application, with the owner
performing the application and supplying the terminal output. When the pre-application
check ran, staging already reported **142 / 142**. I did not apply it.

Because a ledger row proves only that a row was inserted, the applied content was compared
against the approved file: the 46 statements recorded in
`supabase_migrations.schema_migrations` are character-identical to the approved file once
the 46 statement separators the CLI strips are accounted for (34,370 against 34,416
normalised characters — a difference of exactly 46). What is applied to staging **is** the
approved migration.

### 2.2 What it changes

New: `app.rental_is_finalized`, `app.rental_charges_purge_exempt`,
`app.guard_rental_line_item_integrity`, `app.post_settlement_reversal`,
`public.rental_reverse_charge`; columns `reverses_line_item_id` and `reversal_reason`;
unique index `rental_line_items_one_reversal`; constraints
`rental_line_items_tenant_key` and `rental_line_items_reversal_shape`; a composite foreign
key `(reverses_line_item_id, organization_id)` `ON DELETE RESTRICT`.

Amended: policy `rental_line_items_insert`; functions `app.recalculate_rental_totals`,
`app.settle_cancelled_rental`, `public.rental_extend`, `public.rental_reprice`; trigger
`rental_line_items_integrity`. Public RPC signatures are unchanged.

### 2.3 How the base hire is protected

The hire was the hard case, and the first version of this migration got it wrong. Pricing
and extension legitimately restate the base hire line, so an exemption was carved for
`kind = 'base_rental'`. The owner correctly identified that exemption as a material gap:
it left the largest figure on the contract as the one a direct `UPDATE` could still
rewrite.

The exemption is gone. The discriminator is now **who is writing**, not what is being
written. A SECURITY DEFINER function owned by the table owner runs with `current_user` set
to that owner; a PostgREST request runs as `authenticated`, and a signed-in role cannot
become the owner. The guard compares the two and stands aside only for the owner.

This required making the guard itself **SECURITY INVOKER**. As a definer it ran as its own
owner no matter who wrote the row, so `current_user` inside it was a constant that said
nothing — the first attempt failed exactly this way, and every protection test passed
vacuously until that was found.

A client-settable session flag was considered and rejected: `set_config` is callable by
anyone, so a GUC the trigger trusts is a GUC an attacker sets first.

Adding a **second** hire line is refused too. The pricing functions read "the earliest
`base_rental` line", so an operator able to post another could restate the hire by
addition rather than by edit. Creating the *first* one is still allowed, because lead
conversion builds the rental before its charge.

### 2.4 Privileged RPC authorization boundaries

`public.rental_extend` and `public.rental_reprice` are now SECURITY DEFINER, which removes
row-level security from them, so every gate RLS used to apply on their behalf is now
inside them: tenant membership, `app.has_min_role(organization_id, 'staff')`,
`app.billing_require_write(organization_id)`, their existing rental-state rules, a fixed
`search_path = public, extensions, pg_temp`, `anon` revoked and `authenticated` granted
explicitly rather than through PUBLIC. A cross-tenant call is refused as "not found"
rather than "not yours", because confirming that an id is real is itself a disclosure.

### 2.5 Financial history preservation

Nothing is deleted or rewritten. A correction is a mirrored line carrying the operator,
the timestamp and the reason, with one-reversal-per-charge enforced by a unique index and
the mirror shape enforced by the trigger. Cancellation settlement posts reversals instead
of erasing the hire, and the pricing outcome is unchanged.

### 2.6 Recovery and rollback

The migration is additive: no column is dropped and no data is rewritten. There is no down
migration — reverting requires a new forward migration, which would itself have to decide
what to do with reversal lines already posted.

---

## 3. Hosted staging verification

Two verifications were run against `yeklucfthspvejlkffln`, both read-only in effect. The
behavioural one creates its fixtures inside a transaction that is always rolled back; a
count taken afterwards confirmed no QA user, organization, subscription, vehicle, customer,
rental or charge line persisted, and that the existing record counts were unchanged.

**Catalog verification — 39 checks, all passing.** Trigger present and enabled, firing
after `rental_line_items_freeze_columns`; guard is SECURITY INVOKER and reads no `app.*`
GUC; both RPCs definer with a fixed `search_path`, `has_min_role` and
`billing_require_write` in their bodies; `anon` cannot execute either; columns,
constraints, foreign key (`ON DELETE RESTRICT`) and unique index all present; the insert
policy gates reversals on `manager`; the delete policy carries no state condition that
would hide a row instead of refusing it.

**Behavioural verification — 30 checks, all passing.** Verbatim refusals from the live
schema:

- `update … set amount_minor = 1` on a committed hire → *"This charge is part of a
  committed rental. Its amount and tax treatment cannot be changed; post a reversal
  instead."*
- the same for `is_taxable`.
- `delete` of a finalized charge, of the hire, and of a reversal line → *"This charge is
  part of a committed rental and cannot be deleted. Reverse it instead."*
- a replacement hire line → *"The hire on a committed rental is changed by repricing or an
  extension, not by adding another hire line."*
- an ordinary extra on a committed rental → still allowed.
- staff posting a reversal → refused by row-level security. A manager succeeds: the
  mirror is −10,000 against +10,000, the reason and the operator are recorded, the
  original row survives, the money moves (€390.00 → €270.00), and a second reversal of the
  same charge is refused as *"That charge has already been reversed."*
- `rental_reprice` on a draft and on a confirmed reservation whose hire is otherwise
  frozen → both succeed; on a completed rental → *"Only a draft or a confirmed reservation
  can be repriced."*
- `rental_extend` bills the extension (15,000 → 25,000).
- `anon` calling `rental_reprice` → *permission denied for function rental_reprice*.
- `rental_cancel` settles by reversal: `base_rental:18000 base_rental:-18000(rev)
  cancellation_fee:5000`, total 5,000, original hire line still present.
- `app.settle_cancelled_rental` called directly by a signed-in staff member → refused by
  row-level security. It is SECURITY INVOKER, so it is not a way around anything.

### 3.1 The delete policy, and why a refusal is not a hidden row

An early version of this work put the rental-state condition into the RLS delete policy.
Nine tests then "passed" while the delete succeeded, because **a row a policy hides is not
refused — it is invisible**, and `DELETE` affecting zero rows reports success. The
condition was moved into the `BEFORE DELETE` trigger, which raises.

The same trap caught the hosted probe: its first run reported four protections as having
*succeeded* when the real cause was that the QA organization had no billing entitlement,
so every policy hid its rows and every write silently matched nothing. A probe that
asserts a refusal must prove the refusal, not the absence of an error.

---

## 4. Financial amendment history — a partial answer

The brief asked how the existing contract versioning architecture preserves the previous
base hire when an **authorized** extension or repricing restates it, and asked that this
be distinguished from protection against unauthorized mutation. The answer is not
uniformly yes, and the deficiency is recorded here rather than papered over.

**Where a contract exists, history is preserved properly.** `rental_contracts.snapshot`
freezes every charge line — kind, description, quantity, unit amount, amount, tax
treatment — and versions are superseded, never replaced. Verified on staging: a rental
with contract version 1 at `amount_minor: 15000` was extended through `rental_extend`; the
live line moved to 25,000 while version 1 still read 15,000, and issuing version 2 left
version 1 in place with `superseded_at` set and both versions retained.

**The gap.** A confirmed reservation with **no contract yet issued** can be repriced, and
the previous hire is then unrecoverable. Verified on staging: the hire moved from 1 to
15,000 with zero contract versions in existence and no superseded snapshot to recover the
earlier figure from.

Since reservation is a finalization boundary, **the acceptance requirement covering
preservation of authorized amendment history is not declared complete.**

**Minimum correction**, using the existing mechanism and not a new ledger: have repricing
or extension of a non-draft rental issue a superseding contract version — or write an
equivalent snapshot row — before it restates the hire. That is a schema change and is out
of scope here; it requires its own authorization.

---

## 5. Frontend

### 5.1 Four tabs

`Overview`, `Financials`, `Inspections`, `Documents`, following the tab strip the accepted
Maintenance dashboard already uses, down to the roles and the underline. **There is no
Activity tab**, as directed, and no new activity table, event store or audit subsystem was
created to populate one.

No tab is empty: Inspections carries the hand-over record — the odometer, fuel and
condition readings taken at check-out and check-in — together with the existing condition
photographs, which is what a vehicle inspection is in this product. Documents carries the
existing contract versions.

The open tab lives in the address bar (`?tab=financials`), so a link to a disputed charge
opens on the charge. An unrecognised value falls back to Overview.

### 5.2 Authoritative financial overview

`FinancialOverview` sits directly below the reference and status badges and reports six
figures: rental total, payments received, outstanding, customer credit, deposit held and
agency costs.

**Nothing on it is computed in the browser.** Five figures are read from the rental row
(`total_minor`, `amount_paid_minor`, `balance_due_minor`, `deposit_held_minor`) and the
sixth from the existing rental expense summary. The only transformation is splitting the
signed `balance_due_minor` into the two things it means: positive is outstanding, negative
is customer credit. That is presentation of a sign, not arithmetic — and showing a
negative "outstanding" would read to a renter as being chased for a refund.

The deposit is shown apart and never folded into the total. Agency costs are shown
separately from what the customer pays and only to staff with `expenses.view`; a failed
read says so rather than reporting zero.

### 5.3 Reversal and correction interface

`ChargesPanel` replaces the inline charge list. A reversed charge is shown **struck
through and still present**, with the reversal beneath it carrying its reason, its
timestamp and the net effect on the contract. The original never disappears, because a
customer asking "what was I charged, and what did you give back?" is asking about two
numbers.

The reversal dialog shows the charge, the mirrored amount and the net effect before
anything is posted, and requires a reason. A refusal from the database — a permission
error, a duplicate reversal — is shown in the dialog rather than swallowed.

**Destructive actions on finalized charges are gone.** Delete is offered only while the
rental is a draft, where nothing has been agreed and the database still permits it. Past
that point the only correction is a reversal.

### 5.4 Authorization

A new permission `rentals.reverse_charge` is set to `manager`, mirroring the database rule
in `rental_line_items_insert`. It is deliberately **not** `staff`, even though staff may
add charges and delete them from a draft — reversal authority was not granted to every
staff member merely because the existing DELETE policy permitted staff deletion. Staff see
a sentence explaining that a manager posts corrections, rather than a button that fails.

### 5.5 Preserved

Charges, Money and Agency costs are the same sections with the same components. Payments,
voiding, deposits, refunds, keep-on-account, the cancellation fee, contract issuing and
versions, condition photographs, hand-over, extension, substitution, repricing and the
base-charge mismatch warning are all unchanged. `QuoteSummary` keeps its public shape for
the new-rental screen; its totals block was extracted as `QuoteTotals` so the two screens
cannot drift on what tax is called.

---

## 6. Changes by category

**Retained unchanged** — all 18 listed existing capabilities; the Charges / Money / Agency
costs architecture; `QuoteSummary` for `RentalNewPage`; every public RPC signature.

**Verified** — the contract snapshot preserves charge lines across authorized amendments;
the settlement helper is SECURITY INVOKER and not a back door; `anon` cannot reach the
pricing RPCs; cancellation keeps its pricing outcome.

**Corrected** — the destructive delete on finalized charges; the base hire exemption; the
assignment lifecycle gate that redefining `rental_extend` had silently reverted; the
`caution-300` class in the first draft of `ChargesPanel`, which names no token and would
have generated no CSS.

**New** — reversal mechanism and RPC; `ChargesPanel`, `FinancialOverview`, `RentalTabs`,
`QuoteTotals`; `rentals.reverse_charge`; 59 database security tests; 22 frontend tests.

**Presentation only** — the four tabs; the overview strip; the Maintenance downtime caption
correction carried in commit `7664645`.

**Deferred** — the Activity tab (no rental-specific activity functionality exists, and none
was to be built for it); preservation of amendment history for a reservation repriced
before any contract is issued (section 4), which needs its own migration and authorization.

---

## 7. Test results

**Full suite: 4,127 tests across 199 files. 4,123 pass. 4 fail, and all four are
pre-existing.**

The first full run reported five failures. One of them was mine: the permission-matrix
test requires every declared interface permission to be mapped to the database policy that
enforces it, and `rentals.reverse_charge` was unmapped. It is now mapped to the INSERT
policy on `rental_line_items`, which is the policy that actually gates a reversal — the
assertion pins down the manager clause specifically, so loosening it would fail the test
rather than quietly letting staff post corrections. That file passes: 65 of 65.

### The four pre-existing failures

Recorded as pre-existing. They are not new, and they are not resolved.

| File | Test | Why it is pre-existing |
|---|---|---|
| `assignment-feature-activation` | defaults missing activation to disabled and keeps the decision tenant-scoped | The STG-02 assignment-activation default decision, already an open release gate |
| `assignment-lifecycle-operations` | supports repeated active swaps with idempotent operation keys and preserved inspections | Withdrawn vehicle-swap architecture |
| `assignment-lifecycle-operations` | fails closed for unauthorized and cross-tenant active swaps | Withdrawn vehicle-swap architecture |
| `billing-restricted-access` | leaves no SECURITY DEFINER write path ungated and unexplained | The eleven incident and maintenance write RPCs that do not call `app.billing_require_write`, already an open release gate |

Each was verified earlier against a tree with the migration removed. The billing failure
was re-read in full after this work: it names exactly eleven functions —
`maintenance_link_expense`, `incident_create`, `incident_update`, `incident_resolve`,
`maintenance_reschedule`, `maintenance_create`, `maintenance_start`, `maintenance_cancel`,
`maintenance_unlink_expense`, `maintenance_set_service_plan`, `maintenance_complete`.
**Neither `rental_extend` nor `rental_reprice` appears in it**, which is the direct
evidence that making them SECURITY DEFINER did not open an ungated write path.

### Focused regression

| Suite | Result |
|---|---|
| `rental-charge-integrity` | **59 passed** — the financial security tests, preserved in full |
| `cancellation-fee` | 28 passed |
| `rental-reprice` | 19 passed |
| `analytics-security` | 13 passed — the definer allow-list |
| `permission-matrix` | 65 passed |
| Rental and authorization frontend | 132 passed |
| `charges-panel` (new) | 11 passed |
| `financial-overview` and `RentalTabs` (new) | 11 passed |

Accepted workflows were exercised by the full run and are unaffected: maintenance
acceptance, incident, driver availability and rental lifecycle suites all pass.

### Other checks

Typecheck (`tsc -b --noEmit`) clean. Prettier clean. ESLint: **3 errors and 14 warnings,
all pre-existing** — `react-hooks/set-state-in-effect` in `RentalNewPage.tsx` and
`IncidentNewPage.tsx`, both files untouched by this work package and blamed to 2026-11-25,
before it began. No new lint problem was introduced.

---

---

## 8. Responsive implementation

Every breakpoint decision in the new components, and what each one does:

| Element | Mobile (<640) | sm (≥640) | lg (≥1024) | xl (≥1280) |
|---|---|---|---|---|
| Financial overview strip | 2 columns | 3 columns | 3 columns | 6 columns, one row |
| Tab strip | scrolls sideways, full-bleed | inside the content gutter | — | — |
| Overview tab | stacked | stacked | two columns | — |
| Inspections tab | stacked | stacked | `22rem` panel beside the photographs | — |
| Documents tab | full width | full width | capped at `max-w-2xl` | — |
| Reversal dialog buttons | stacked, confirm on top | side by side, right-aligned | — | — |
| Charge rows | `min-w-0` + `truncate`; amount `shrink-0` | — | — | — |

The tab strip scrolls rather than wrapping because four tabs do not fit at 390 px and a
second row of tabs reads as a second kind of thing. Its `-mx-4 … sm:mx-0 sm:px-0` exactly
cancels the shell's `px-4` gutter, so the underline reaches the screen edge without making
the element wider than its container — no page-level horizontal scroll.

The primary rental actions stay in the page header on every tab, so confirming, checking
out, recording a return, extending and cancelling are never more than one reach away
regardless of which tab is open or how narrow the screen is.

### What was verified, and what was not

**Verified statically, against the CSS the staging build actually shipped.** Every class
in the new components resolves to a real rule in `dist-staging/assets/index-*.css`,
including the arbitrary `lg:grid-cols-[22rem_1fr]` track and `grid-cols-6` inside the
`min-width:80rem` query. This check is how the first draft's `border-caution-300` was
caught: Tailwind v4 generates nothing for a class naming a token that does not exist, so
that border would simply not have rendered. The token set has `caution-200`, and that is
what ships.

**Not verified visually.** No screenshots were captured. Pevvy requires a verified second
factor for every user, and this session has no staging sign-in, so the authenticated
Rental Details screen cannot be reached in a browser from here. A harness page
reproducing the markup against the shipped CSS was prepared and then deliberately not
used, because browser emulation of hand-copied markup is weaker evidence than it looks —
it proves my transcription renders, not that the application does.

Visual confirmation at the four widths is therefore **scenario 34 of the owner's
acceptance pass**, which walks desktop, iPad portrait, iPad landscape and mobile
explicitly. That is physical-device or real-browser verification by the person who can
sign in, and it is the only kind of responsive evidence this work package claims.

---

## 9. Staging deployment

| | |
|---|---|
| Branch | `fix/maintenance-manual-acceptance-20261125` |
| Worktree | `E:\pevvy-maintenance-acceptance-20261125` |
| Published | `bc4139a..497e6fb` → `origin/staging`, **fast-forward, no force** |
| `origin/main` | **unchanged** at `31383a9` |
| Remote | `github.com/wiredmediadigital/atlas-car-rental-saas` — the user's own repository, not the original |
| Local guarded build | 199 files, SHA-256 `ea3c41b0e06fc2f1538447e8dfe47cee9329f1a253dfab18ce5aab6e693f4875` |
| Deployed manifest | `9a8ba920…` → `c9f211de05c8658562039aba7cb7c0696137b2a091ce6576d4a22987dd36144b`, 199 files, `projectRef: yeklucfthspvejlkffln` |

Four commits were published, including `7664645` — the Maintenance downtime caption
correction that had been held back since 2026-11-26 to travel with the next authorized
deployment rather than justify one of its own.

The build was blocked twice before it ran, both times correctly. It refused
`.env.local`, which names the **production** project, and it refused the legacy JWT anon
key because the guard requires a `sb_publishable_` browser key. The staging publishable
key was taken from the Supabase CLI and never written to a file or printed.

### Deployed content verification

A hash proves a build changed; it does not prove which commit was built. The deployed site
was therefore crawled and checked by content: **172 asset files fetched, 170 of 170 `.js`
served as JavaScript, 10 of 10 checks passing.**

- All **16 release-unique strings** present, including *"Reverse this charge"*, *"Post the
  reversal"*, *"Customer credit"*, *"Net effect on this contract"*, *"Rental sections"*,
  the staff sentence *"corrected by posting a reversal, which a manager does"*, and
  *"Actual downtime is temporarily unavailable"* — so the reversal interface, the overview
  strip, the tabs and the held caption correction are all genuinely live.
- All **4 accepted-release probes** still present, so nothing accepted was displaced.
- The staging project ref is in the bundle; the **production ref is absent**.
- No secret key value and no `service_role` JWT anywhere.

One correction to the method, recorded because it would otherwise look like a finding that
was waved away: the first pass reported `sb_secret_` and `service_role` as present. Both
are literal strings inside supabase-js's key-type check and Pevvy's own environment guard
— the code that exists to *detect* a secret key and refuse it. A substring test reports
the guard as the leak it prevents. The check now matches key **values**, and they are
absent.

---

## 10. Remaining material security limitations

`app.rental_is_finalized` and `app.rental_charges_purge_exempt` are SECURITY DEFINER and
executable by `authenticated`. This is structural rather than accidental: the guard had to
become SECURITY INVOKER to identify the writer, so the helpers it calls must be callable
by that writer. Neither mutates anything; each returns a boolean about a rental id the
caller must already possess. No tenant data is disclosed. Recorded as accepted residual
exposure in `ARCHITECTURE_DECISIONS.md`.

More generally, any owner-owned SECURITY DEFINER function that can write
`rental_line_items` now inherits the guard's exemption by virtue of its ownership. That is
the cost of using ownership as the discriminator, and it is why such functions are
declared part of the trusted financial mutation boundary and must be reviewed explicitly.

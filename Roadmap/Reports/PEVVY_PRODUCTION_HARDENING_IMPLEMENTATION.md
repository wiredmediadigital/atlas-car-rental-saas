# Pevvy — production hardening: implementation report

**Date:** 2026-11-27
**Worktree:** `E:\pevvy-maintenance-acceptance-20261125` (isolated)
**Starting baseline:** `origin/staging` `5634555`, `origin/main` `31383a9`, 143
migrations, clean tree. The reproduction report's own commit `a673521` sat one ahead of
`origin/staging` and unpushed; this work continues from it.

**Five migrations created and tested locally. NONE applied to any hosted database.**
**Production was not accessed. Production remains NO-GO.**

Reproduction evidence is preserved unchanged in
`PEVVY_PRODUCTION_HARDENING_REPRODUCTION.md`. This report says what was done about it.

---

## 1. What was corrected, and what was not

| # | Item | Outcome |
|---|---|---|
| 1 | Direct rental lifecycle mutation | **Corrected** — `20261128100000` |
| 2 | Checkout and return timestamps | **Corrected** — same migration, same root cause |
| 3 | Billing entitlement for privileged RPCs | **Corrected** — `20261128110000` |
| 4 | One-to-one amendment evidence | **Corrected** — `20261128120000` |
| 5 | Maintenance expense association | **Corrected** — `20261128130000` |
| 6 | Independent PostgreSQL concurrency | **Re-verified** after hardening — §8 |
| 7 | Baseline database failures | **All four resolved** — §7 |
| 8 | Lint and verification | **Three errors resolved; zero remain** — §9 |
| 9 | STG-02 assignment activation | **Corrected to default-OFF** — `20261128140000` |
| 10 | Edge Function readiness | **No code change.** Hosted inventory reconciled — §10 |

---

## 2. Rental lifecycle authorization — `20261128100000`

**SHA-256** `36bcd48a259b6f59c3e048f31c77319ccda93bd1155d57b76412e929e3fc9fbf`,
277 lines / 12,171 bytes.

The status machine was never the weakness and is untouched: it refused every illegal
transition before this work and still does. What a direct write bypassed was everything
the RPC does *around* a legal transition — availability revalidation, maintenance
restrictions, driver conflict prevention, assignment synchronisation, odometer and fuel
capture, the inspection record.

Two halves that only work together:

1. **`rental_confirm`, `rental_check_out`, `rental_check_in`, `rental_complete` and
   `rental_cancel` become SECURITY DEFINER**, each carrying the tenant membership, staff
   role and `app.billing_require_write` checks that row-level security used to apply on
   their behalf — the shape `20261126130000` gave the pricing functions. Billing parity
   is exact: a restricted agency could not write `public.rentals` before and cannot now.
2. **`app.guard_rental_lifecycle_columns`** freezes `status`, `confirmed_at`,
   `cancelled_at`, `cancellation_reason`, `picked_up_at`, `returned_at`, both odometers,
   both fuel readings, both condition notes, `original_ends_at` and `extension_count`
   against every writer that is not the table owner — in **every** state, draft included,
   because confirming a draft by hand skips the primary-driver check.

`notes` stays editable. A protection that stops the desk recording what a customer said
on the phone is a protection that gets switched off.

### The rewrite was derived, then verified

The five functions were rewritten from their **live definitions**, not from migration
files. `20261120100000` and `20261124100000` rewrite bodies in place, so several
effective definitions exist in no file; `20261120220000` restated two functions from
their original text and silently reverted the per-organization assignment gate.

A `replace` that does not match returns its input unchanged and `execute` then recreates
the function exactly as it was — a failed conversion is indistinguishable from a
successful one. So the migration **verifies itself against the catalog** and raises if
any of the five lacks SECURITY DEFINER, a role check, a billing check, or has reverted to
the session flag. That guard fired during development, on `maintenance_complete`, and is
how the anchor problem in §4 was found rather than shipped.

### A pre-existing bug this removes as a side effect

`rental_check_in` does `update public.vehicles set odometer = greatest(odometer, …)`, but
`vehicles_update` requires **manager**. Run as the caller, a **staff** check-in matched
zero rows and said nothing — the fleet's mileage never advanced. The same "a row a policy
hides is not refused, it is invisible" trap as the charge deletion. As SECURITY DEFINER it
now works, and a test asserts it.

This surfaced as two lifecycle tests failing because a later check-out was correctly
refused at a lower reading. The fixtures were written against the broken behaviour and
were corrected; the migration was not.

---

## 3. Billing authorization matrix — `20261128110000`

**SHA-256** `60830dfab601498230f1769438ffac0b050bfdb1299aeb832d5212051db9e57f`,
239 lines / 11,275 bytes.

The owner's decision, implemented.

### Gated — `app.billing_require_write` after the tenant and role test

| Function | Why |
|---|---|
| `maintenance_link_expense` | attaches money to a record |
| `maintenance_unlink_expense` | detaches money from a record |
| `maintenance_complete` | **puts the car back on hire** |
| `maintenance_cancel` | **removes a safety restriction** |
| `maintenance_reschedule` | ordinary commercial planning |
| `maintenance_set_service_plan` | ordinary commercial planning |
| `incident_resolve` | closes the record of a safety event |

### Exempt — narrowly, and registered with a reason

| Function | Why, and what it cannot do |
|---|---|
| `incident_create` | Records an accident that already happened. No money; cannot touch a vehicle's status |
| `incident_update` | Documents that accident. **Already refuses `p_status = 'resolved'`**, so it is not a path around the gated `incident_resolve`. No money |
| `maintenance_create` | Reports a breakdown. `estimated_cost_minor` is a figure on the record; no expense row is created |
| `maintenance_start` | Takes the car **off** the road. Strictly safety-positive: it can only make a fleet smaller |

None can return a vehicle to service, remove a restriction, move money, change tenant
association or bypass a role check — each keeps its existing `app.has_min_role` test, and
the migration raises if any lost it.

The exemptions live in **`app.billing_exempt_functions`**, a table with a reason and an
approval date per row, not an array in a test file. The structural billing test now reads
that table: **an exemption that is not registered is not an exemption**, and the test goes
on reporting the function. `vehicle_take_off_road` keeps its existing exemption;
`vehicle_return_to_service` keeps its billing gate.

**The limitation, stated rather than buried.** `incident_update` cannot distinguish
"documenting a crash" from "tidying up an old incident's insurance reference" — both are
the same call with the same effects. The exemption is accepted because *neither* moves
money, changes availability, or closes the incident.

### How the gate was inserted

Anchoring on a literal refusal line matched four functions and failed loudly on the
fifth: `maintenance_complete` was reshaped into a multi-line block by `20261126120000`,
and the errcode spacing differs across the family. The anchor is now the **role check
itself**, matched non-greedily so the billing check lands immediately after its
`end if;` — which also means the billing state is only ever asked about an agency the
caller already belongs to. The migration verifies all seven afterwards.

---

## 4. One-to-one amendment evidence — `20261128120000`

**SHA-256** `8ead334c1f96d9a8001ba2a9552875bc46680308da3ca1f11a451e1d074d7ab4`,
282 lines / 13,198 bytes.

A signature is not a claim. Matching rental, charge line and amounts let two mutations
with the same shape share one record:

```
10000 -> 20000   recorded
20000 -> 10000   recorded
10000 -> 20000   NOT recorded — and it committed
```

The history did not merely under-record; it became **internally inconsistent**, saying
10000 while the live hire stood at 20000.

**The mechanism is a per-mutation identity, as §6 requires.** Every charge line carries
`revision_no`, bumped by `app.bump_rental_line_item_revision` on each mutation that moves
money or changes the tax treatment — and only then, so renaming a line is not a revision.
An amendment records `line_revision_no`, and a unique partial index on
`(line_item_id, line_revision_no)` allows exactly one record per revision.

Deliberately **not** a transaction id, a timestamp, an amount signature, `xmin`, or a
unique index over previous and revised amounts. Each of those is a fingerprint two
genuinely different mutations can share; identical transitions are legitimate and stay
recordable — `100 → 200` twice is two amendments at two revisions.

**Both questions are asked.** The revision makes the record unique; the field comparison
makes it *true*. A revision match alone would accept a record claiming the hire went to
12345 when it went to 20000 — unique, and wrong. Keeping both is why the last recorded
amount can be relied on to equal the live hire, and a test asserts exactly that.

**No-op suppression is narrow.** A record is skipped only when `changes` is empty *and*
the amount is unchanged — which is what two concurrent repricings produce. A date-only
amendment still records, because `changes` carries the dates and a zero-value adjustment
that moved a date is a real financial event.

---

## 5. Maintenance expense integrity — `20261128130000`

**SHA-256** `71782326dafee8bd971bf0b0a9c242e7ed2f81b406a3da84fda0b3268a7288f5`,
209 lines / 9,068 bytes.

Cross-tenant protection was already sound — blocked by the RPC, by the composite
tenant-scoped foreign key, and by `expenses_freeze_columns` — and is preserved untouched.
What was advisory were the link invariants, which nothing re-checked after the RPC
returned, while the expense edit screen had no awareness of `maintenance_id` at all.

`app.guard_maintenance_expense_link` holds a linked expense to: same agency, allocated to
a vehicle, the maintenance record's vehicle, and no new attachment to **cancelled** work.
It **refuses rather than clearing** `maintenance_id` — silently detaching a cost from the
work it belongs to is the same class of quiet financial edit this release exists to stop.
Reassignment needs an explicit unlink first.

Costs attached *before* a cancellation are kept. A tow that was already paid for is still
a real cost.

`expenses_maintenance_fkey` now names its column: `on delete set null (maintenance_id)`.
It previously had no column list, so it would have nulled `organization_id` too and failed
its NOT NULL constraint — a declared action that could never fire. Guarded on
`server_version_num >= 150000`.

**Existing records are reported, never rewritten.** `app.maintenance_expense_anomalies`
lists linked costs the new invariants would refuse, and the migration raises a **warning**
with the count rather than failing. What an already-inconsistent financial record should
have said is the owner's decision.

---

## 6. STG-02 assignment activation — `20261128140000`

**SHA-256** `59135446944eed8bfd955011621cc2af076a0413f3a5f5e9f880aed9bbee2134`,
262 lines / 11,130 bytes.

The owner's decision: restore default-OFF. `20261124100000` had inverted it with
`coalesce(…, true)` and nothing recorded the change.

Three things change together:

1. **`app.assignment_lifecycle_active` defaults to false** and no longer reads
   `current_setting('app.assignment_lifecycle_enabled', …)`. A caller-settable GUC has no
   business inside an authorization decision, and that one defaulted to `'on'`.
2. **`app.assignment_lifecycle_engaged(rental, organization)`** is new, and is the whole
   safety mechanism. Activation governs **opening** a new assignment; drainage governs
   **continuing** one that already exists.
3. **`assignment_feature_eligibility`** reports `can_swap` as a literal `false` in every
   state, and `can_view_history` from the staff role rather than from activation.

### Why drainage was necessary

Twelve functions consult the gate; three release assignments. Switching the gate off while
a car is out with a customer would leave the `in_custody` row open forever, and
`rental_vehicle_assignments_no_overlap` would then block that vehicle over that window
**permanently** — surfacing much later as a raw constraint error on an unrelated booking.

Seven rental functions were rewritten to ask the rental-scoped question. `rental_confirm`
and `rental_substitute_vehicle` open assignments as well as transitioning them and are
included deliberately: with activation off and nothing open, `engaged` is false and no row
is created; with a legacy row open, it is true and that row finishes its lifecycle.

### The one-time reconciliation

Open assignments are released **only** where the rental is already `completed` or
`cancelled` — nothing will ever release them otherwise and each blocks its vehicle for
good. Anything on a draft, reserved or active rental is left exactly as it is: an
`in_custody` row on an active rental is a car genuinely in a customer's hands, and marking
it returned would be a lie that also frees the vehicle for someone else to book.

Nothing is closed merely because its organization has no activation record, and no
explicitly enabled organization's state is overwritten.

The withdrawal is asserted: the migration raises if `rental_swap_vehicle` is ever
executable by a browser role again.

---

## 7. The four baseline failures, resolved

Not four defects. Three were tests asserting contracts the migration history had
superseded or withdrawn; one was a genuine bypass.

| # | Test | Resolution |
|---|---|---|
| 1 | `assignment-feature-activation` — defaults missing activation to disabled | **Schema corrected** to the STG-02 contract. The test now asserts the restored default *and* the revised capability reporting (`can_view_history: true`, `can_swap: false`), plus a new behavioural check that a fresh agency opens no assignment row |
| 2 | `assignment-lifecycle-operations` — repeated active swaps | **Replaced, not deleted.** Now asserts the withdrawal: every browser role is refused, no role holds EXECUTE, and the history earlier swaps left behind is still readable |
| 3 | `assignment-lifecycle-operations` — fails closed for unauthorized swaps | Same; it was already failing closed, and only the matcher disagreed |
| 4 | `billing-restricted-access` — ungated SECURITY DEFINER write path | **Fixed by §3**, not weakened. The test now reads the exemption register |

The suite's `enabled()` helper used the session GUC. Since the GUC is gone from the
decision, it now switches the feature on the way the product does — a row in
`app.assignment_feature_activation`.

---

## 8. Concurrency

Reported separately in `PEVVY_PRODUCTION_HARDENING_REGRESSION_VERIFICATION.md`, with each
of the ten scenarios and its own assertions listed individually. The earlier 8/8 evidence
is preserved there as well.

---

## 9. Lint and verification

**Three `react-hooks/set-state-in-effect` errors resolved; zero errors remain.**

All three were "sync async data into state" effects, which cascade a render. Each is now
derived during render, with an explicit `undefined` meaning "the desk has not chosen":

- `RentalNewPage` — the renter is offered as primary driver when available;
  `primaryDriverChoice` of `null` means they chose nobody.
- `IncidentNewPage` — the vehicle defaults from the rental context, and the hire defaults
  to the one the vehicle is currently out on. `rentalTouched` disappears: an undefined
  choice *is* "not touched".

Both pages had **no automated coverage** before or after, which is stated plainly rather
than glossed: they are verified by typecheck, lint, Prettier and the guarded build, and
the behaviour is worth a look during the next acceptance pass.

**14 warnings remain, and are justified.** Thirteen are
`react-refresh/only-export-components` — a file exporting a component and a constant,
which affects hot-reload in development and nothing in production; splitting thirteen
files to silence it is exactly the broad unrelated refactoring §10 rules out. One is
*"Compilation Skipped: Use of incompatible library"* in `InviteDialog.tsx`, where the
React compiler declines to optimise a file; it is a missed optimisation, not a defect.

---

## 10. Edge Function readiness

**No code change. The source review found no defect and none was manufactured.**

The hosted staging inventory was read with an authorized read-only command. **The gate
record is stale.**

| Function | Hosted staging | `verify_jwt` | Notes |
|---|---|---|---|
| `billing` | **ACTIVE** v5 | true | |
| `billing-webhook` | **ACTIVE** v2 | false | Stripe signature, constant-time, fails closed with no secret |
| `pricing` | **ACTIVE** v5 | false | Public by design; explicit field projection |
| `team-invitations` | **ACTIVE** v1 | false | Public by design, but rejects any request without a live user session itself. Matches the owner's confirmation that Resend delivery and staff onboarding work |
| `account-closure` | not deployed | false | |
| `account-closure-notice` | not deployed | false | |
| `gps-provider` | not deployed | — | |
| `mfa-reset` | not deployed | true | |
| `public-booking` | not deployed | false | **The public booking page does not work on staging** |

**Four of nine are deployed, not three.** The release gate records "six of nine not
deployed"; it is five. Every hosted `verify_jwt` matches `supabase/config.toml`.

No secret value was read or printed, no production credential was touched, no function was
redeployed, and no destructive closure schedule was activated.

**Remaining requirements**, recorded rather than resolved: the five undeployed functions
need deployment before their features work on staging — `public-booking` most visibly,
since the public booking page is simply absent. Each will need its secrets present in the
hosted project, and `account-closure` needs end-to-end acceptance that deliberately does
**not** exercise a destructive purge against real data.

---

## 11. Remaining limitations

- **`incident_update` cannot distinguish safety documentation from administrative
  tidying.** Accepted on the ground that neither moves money, changes availability or
  closes the incident. Registered with that reason.
- **Existing inconsistent maintenance-expense links are reported, not repaired.**
  `app.maintenance_expense_anomalies` lists them; the correction needs owner approval.
- **The two new-rental and new-incident pages have no automated coverage.** The lint
  corrections there are verified by typecheck, lint and build only.
- **Amendment history still begins at `20261127100000`.** Nothing is reconstructed.
- **`service_role` bypasses row-level security entirely**, as it always has, and
  owner-owned SECURITY DEFINER functions inherit the trigger exemptions by construction.
  Both are pre-existing and recorded in the architecture decisions.
- **Five Edge Functions remain undeployed on staging.**

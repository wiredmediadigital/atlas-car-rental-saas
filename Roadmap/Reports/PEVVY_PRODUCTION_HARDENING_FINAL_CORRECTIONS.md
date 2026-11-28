# Pevvy — production hardening: final corrections

**Date:** 2026-11-27
**Scope:** the targeted corrections and verifications the owner asked for after reviewing the
hardening package. The wider hardening scope was not reopened.
**Nothing applied. Nothing deployed. Production not accessed.**

---

## Summary

| § | Item | Outcome |
|---|---|---|
| 3 | Duplicate rental check-in | **Confirmed defect, corrected.** A return is now recorded once |
| 4 | Amendment revision interaction | **No defect.** Verified by test; one suspicion investigated and disproved |
| 5 | `incident_update` limitation | **All six conditions verified behaviourally** |
| 6 | Maintenance expense editing | **Gap found and closed.** The interface could not see the link it was being refused by |
| 7 | Hosted read-only preflight | Separate report. **One published figure was wrong and is corrected** |
| 8 | Fresh guarded staging build | **Blocked — one credential missing.** Named below, nothing worked around |
| 9 | Regression | See §9 |
| 10 | Edge Functions | Inventory recorded. Nothing deployed |

---

## 3. A return is recorded once

### The defect, reproduced before it was corrected

`rental_check_in` guarded on `status <> 'active'`. Recording a return **does not change the
status** — `rental_complete` does. So a rental that had already been returned was still
`active`, still passed the guard, and was returned again:

- a new `returned_at`, odometer, fuel reading and condition note overwriting the first;
- a second write to the vehicle's odometer;
- a second assignment release attempt;
- a second inspection record.

The row lock was never the problem. `select … for update` serialises the two calls correctly,
so the second runs on the committed result of the first. The problem was what the second call
then found acceptable.

### The correction

Under the lock the function already holds, and anchored on the billing check that section 1 of
the same migration inserts — a deterministic anchor rather than a guess at a body other
migrations have rewritten in place:

- a rental carrying a `returned_at` is **refused** a return with different information;
- an **identical retry is answered from the existing row without mutating anything** — no
  second odometer write, no second assignment transition, no second inspection record, no
  duplicate operational or financial side effect;
- the guard carries its own `status = 'active'` condition, so a completed or cancelled rental
  still falls through to the existing status refusal and is **never** answered idempotently.

The migration verifies its own rewrite against the catalog and fails if the guard did not go in,
for the same reason section 1 does: a replace that silently does not match recreates the
function unchanged, and a function that looks guarded while carrying none is worse than one that
was never converted.

Applied to the **unpublished** `20261128100000_rental_lifecycle_authorization.sql` rather than
as a new corrective migration, as §11 directs.

### What this deliberately does not do, and the decision it leaves you

**There is no authorized return-correction workflow in Pevvy, and this does not add one.**

The return columns are frozen by `rentals_guard_lifecycle_columns` against every writer that is
not the table owner, and no RPC restates them. Before this change, repeating the check-in was
the only way to fix a mis-keyed odometer — which is precisely the undocumented correction
mechanism the instruction says must not exist.

So the gap is real and it is now closed in both directions: the wrong value cannot be written
twice, and the right value cannot replace it either. **A mis-keyed return reading on a committed
rental currently has no route to correction.** That is reported, not filled: inventing a
correction subsystem is explicitly out of scope. It needs an owner decision.

### Tests

Eight, in `supabase/tests/rental-lifecycle-integrity.test.ts`:

| Case | Asserted |
|---|---|
| First check-in succeeds | `returned_at`, odometer, fuel and notes all recorded |
| Sequential duplicate cannot overwrite | refused; all four fields unchanged |
| The refusal names the recorded return | matches "already been returned" and "stands" |
| Identical retry does not mutate | `returned_at` unchanged **and the vehicle's `odometer_updated_at` unchanged** |
| Vehicle odometer remains correct | still the first return's reading after a refused second |
| Rental completion remains functional | completes after the refused second return |
| Completed rental refuses with the status message | not the return message, and never idempotent |
| Finalized protections still enforced | direct write to `return_odometer` still refused |

PGlite is one connection and cannot run the two calls concurrently. It does not need to: the row
lock already serialises them, so the second call always runs on the committed result of the
first, which is exactly the sequential case. The genuinely concurrent version stays in the
independent PostgreSQL verification as scenario 4, now asserting the business requirement rather
than recording the limitation.

### One behaviour found while verifying this, worth knowing

The idempotent path compares the caller's `p_returned_at` with the stored `returned_at`
when the caller supplies one. PostgreSQL stores microseconds — an observed value was
`…:28.914786+00` — and a client that parses `timestamptz` into a JavaScript `Date` keeps
only milliseconds. So a caller that reads the stored return time back and **echoes it** into
a retry is **refused**, by 786 microseconds, rather than answered idempotently.

This is not a defect and is not corrected:

- a genuine client retry repeats the **original** request, so it sends the same
  `p_returned_at` the first call sent — `null` in the ordinary case, which takes the
  idempotent path and succeeds;
- the instruction permits an identical retry to be *either* safely rejected or treated as an
  idempotent success. Both are permitted outcomes;
- what matters is that **nothing mutates**, and nothing does, on either path.

The concurrency scenario asserts both outcomes explicitly rather than only the convenient
one, so the distinction stays visible if the comparison is ever loosened.

---

## 4. Financial amendment revisions — investigated, no defect

### The suspicion, stated plainly because it was mine

`app.bump_rental_line_item_revision` advances `revision_no` only when amount, quantity, unit
price or taxability moves — deliberately, so the counter does not drift on a description edit
and start demanding records of changes that never happened.

`rental_pricing_amendments_one_per_revision` is unique on `(line_item_id, line_revision_no)`.

So a *date-only* amendment, which by definition shares a revision with the one before it, looked
like it must collide on the second one. That would have been a real defect.

### Why it is not reachable

Only two callers record amendments: `rental_reprice` and `rental_extend`.

- **`rental_extend` always moves billable days**, so it always moves the line's quantity, so it
  always advances the revision. A zero-charge extension is not a date-only amendment at the line
  level.
- **`rental_reprice`** recomputes the money; when nothing moves it records nothing at all.
- **`rental_reschedule`**, the genuinely date-only operation, is a pre-commitment operation on a
  reservation and **records no amendment at all**.

Every recorded amendment therefore moves the line and advances the revision, so two amendments
can never share one. The collision is unreachable.

**The latent fragility is worth writing down:** if a future caller recorded an amendment without
moving the line, it would collide. The index is the thing that would stop it, loudly, at the
moment of the write — which is the correct failure. Nothing was changed.

### Two of my own tests were wrong, and are corrected

Reproducing before correcting found the mistakes in the tests, not the product:

- *"a financial amendment followed by a date-only one"* asserted the revision would hold still
  across a zero-charge extension. It does not, because the billable days move. Replaced with a
  test that uses `rental_reschedule`, the genuinely date-only operation, and asserts it touches
  neither the revision nor the history.
- *"files nothing for a repricing that moves nothing"* assumed the **first** repricing also
  moves nothing. It does not: a hand-entered hire is recomputed from the rate card, which is a
  real financial event. Rewritten to assert that the **second** repricing files nothing.

### Tests

In `supabase/tests/rental-pricing-amendments.test.ts`, covering every case §4 lists:

- two successive zero-charge extensions, both recorded;
- a date-only reschedule after a financial amendment, touching neither revision nor history;
- four zero-value amendments in a row, all four surviving;
- three repeated financial transitions, revision advancing exactly once each;
- a second repricing that moves nothing filing nothing;
- missing evidence; invalid evidence; evidence reuse.

### The deadlock objection, answered

The independent concurrency run reaches the evidence refusal through a PostgreSQL **deadlock**,
which proves the restatement did not land but **not** that the evidence requirement is what
stopped it. The owner was right that this is insufficient.

Two deterministic tests now reach the enforcement mechanism itself, on one connection, with no
contention at all:

- **missing evidence** — a bare restatement of a committed hire, refused with *"restated without
  recording what changed"*, the hire unchanged;
- **invalid evidence** — a record **is** filed for that line and that revision, and it claims
  the hire went somewhere it did not. Still refused. **Unique is not the same as true**, and
  that is the assertion that says so.

The concurrency coverage is preserved unchanged alongside them.

---

## 5. The `incident_update` limitation stays inside its bounds

The owner accepted the documented limitation on six conditions. Each is driven against a
genuinely billing-restricted agency through `db.asUser`, so the role ladder and the billing gate
apply exactly as they would to a request arriving at PostgREST. An exemption nobody exercises is
an exemption nobody has checked.

| # | Condition | How it is held | Verified |
|---|---|---|---|
| 1 | Cannot resolve or close through an alternative path | `p_status = 'resolved'` raises *"Use incident_resolve"*; the `incident_status` enum holds only `open, in_progress, resolved`, so there is no second door | yes — including an assertion on the enum itself, which fails if a `closed` value is ever added |
| 2 | Cannot remove a vehicle safety restriction | `incident_update` writes only `public.incidents`; the only triggers on it are reference generation and `updated_at` | yes — vehicle taken off the road stays off across an update |
| 3 | Cannot return a vehicle to service | same | yes — still off the road, and `vehicle_return_to_service` still refuses on billing |
| 4 | Cannot mutate financial records | no financial column exists on `incidents` | yes — expense, line item and payment counts unchanged across an update |
| 5 | Cannot change tenant associations | `organization_id`, `vehicle_id`, `rental_id`, `customer_id` are not parameters | yes — all four unchanged; the test fails if a parameter is ever added |
| 6 | Does not bypass role checks | `app.has_min_role(…, 'staff')` | yes — another agency is told the incident does not exist; a staff member still cannot reach resolve |

`vehicle_take_off_road` remains exempt, as required, and a test asserts a restricted agency can
still take a car off the road.

Billing was not redesigned. No Stripe configuration was touched.

---

## 6. Maintenance expense editing — the gap was upstream of the interface

### What was found

The delivery report listed no changed expense frontend source. The reason was worse than an
oversight:

- `public.expense_ledger`, which **every** expense list and the detail page reads, **did not
  select `maintenance_id`**;
- consequently the expense screens carried no maintenance field at all — not a label, not a
  badge, not a link;
- and `23514` has a generic fallback in `toAppError`, so all four carefully worded database
  refusals would have been replaced with *"Some of the values entered are not valid. Check the
  highlighted fields."*

So a user editing an attached cost would have been refused by an invariant the interface could
not show, with a message that did not mention maintenance, on a screen with no route to the
unlink. **Enforcing an invariant the interface cannot explain is how a correct database earns a
reputation for being broken.**

Worth noting plainly: `20261128130000` shipped these invariants with **no test coverage at all**.
That is now also corrected.

### The minimum correction, and nothing more

1. **`maintenance_id` appended to `public.expense_ledger`** (in the unpublished
   `20261128130000`). Appended, which is all `create or replace view` permits and all that is
   wanted — every existing consumer keeps the shape it reads today. `security_invoker` is
   restated rather than assumed, because losing it would silently turn a tenant-scoped read
   model into a leak.
2. **Five message patterns in `src/lib/supabase/errors.ts`**, so each refusal reaches the desk
   as written, naming the unlink step.
3. **A badge and one notice on `ExpenseDetailPage`**: the cost is attached, the amount, date,
   description, category and receipt can still be edited, what it is allocated to cannot, and a
   link to the maintenance record where the authorized unlink already lives.

The unlink itself was **not** moved, duplicated or reimplemented. No new expense subsystem.

### Against the owner's checklist

| Requirement | State |
|---|---|
| A linked expense's maintenance association is identifiable | **now yes** — badge, notice and link; previously invisible |
| Incompatible allocation or vehicle changes are refused | yes — at the database, tested |
| The refusal is clearly communicated | **now yes** — previously replaced by a generic sentence |
| The user can locate the authorized unlink | **now yes** — linked from the notice |
| Legitimate expense edits remain available | yes — amount, date, description still editable, tested |
| Silent reassignment remains prohibited | yes — tested |

### Tests

`supabase/tests/maintenance-expense-integrity.test.ts` — nine, new, where there were none:
the read model carries the link and stays tenant-scoped; allocation change refused; vehicle move
refused; silent reassignment refused; the link is not silently cleared; unrelated edits still
work; the authorized unlink does what a hand edit may not; the anomaly view is queryable.

`src/lib/supabase/errors.test.ts` — six, asserting each refusal survives the mapping and that an
unrelated check violation still falls back.

---

## 8. The fresh guarded staging build is blocked on one credential

**It was not run, and nothing was worked around to run it.**

`scripts/staging-build-guard.mjs` validates the **process environment only** — staging Vite mode
reads no `.env` file. The one value missing on this machine is the staging browser publishable
key.

An attempt to read it from the Supabase CLI was **denied by the environment's own permission
controls**, which is the correct outcome for a credential fetch. It was not retried by another
route.

The only browser credentials present locally are in `.env.local` and they point at
**production** (`ysnumxtzcgzyabrghxwq`). They were **not used**, and the guard would reject them
outright as `production-reference-in-browser-config`.

### Exactly what is required

| Variable | Required value | Source |
|---|---|---|
| `VITE_SUPABASE_URL` | exactly `https://yeklucfthspvejlkffln.supabase.co` | known; the guard compares the parsed href |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | a string beginning `sb_publishable_` followed by at least one character | **MISSING — this is the only thing needed** |
| `VITE_SUPABASE_ANON_KEY` | must be **unset** | the guard rejects `legacy-key-conflict` if present |
| `PEVVY_STAGING_BUILD_INTENT` | `approved-local-build` | set by the build script itself |

No other `VITE_SUPABASE_*` variable may exist, no `VITE_` value may contain the production
reference, `sb_secret_`, or a `service_role` JWT.

It is a **browser** key — the value shipped to every visitor — not a secret. It is found in the
Supabase dashboard for `yeklucfthspvejlkffln` under **Project Settings → API keys →
publishable**.

### What will be recorded the moment it is supplied

Source commit, project reference, artifact file count, the complete manifest SHA-256, the build
exit code, a production-reference scan of every built file, and a secret-exposure scan.

### The standing artifact, and its honest status

`dist-staging/staging-build-manifest.json` records project ref `yeklucfthspvejlkffln`, **199
files**, SHA-256 `be240a5b44a0af9c8c9e4e6c1fe8d018a46f7db59979f3e08e560d736c24e228`, and **no
build input was newer than it at the time it was verified**.

**It is now stale.** The corrections above changed `ExpenseDetailPage.tsx`, `errors.ts`,
`database.ts`, `IncidentNewPage.tsx`, `RentalNewPage.tsx` and added `selection-defaults.ts`. The
owner is right that it is not a substitute for a fresh build, and it is not offered as one.

---

## 10. Edge Function readiness

Recorded as verified: **four deployed, five undeployed**. Nothing was deployed, redeployed or
activated under this instruction.

| Deployed and ACTIVE | Undeployed |
|---|---|
| `billing` | `mfa-reset` |
| `billing-webhook` | `public-booking` |
| `pricing` | `gps-provider` |
| `team-invitations` | `account-closure` |
| | `account-closure-notice` |

Their security, configuration and functional acceptance requirements are preserved and unchanged.
No destructive account-closure schedule was activated.

**On Work Package 5:** no dependency of Security Deposit Management on any of the five has been
identified, so their absence is **not** recorded as an automatic blocker. That is a statement
about what was looked for, not a guarantee: WP5 has no specification yet, and the question should
be asked again against its actual design.

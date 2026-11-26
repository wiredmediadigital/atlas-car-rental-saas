# PEVVY — MAINTENANCE REMEDIATION STAGING RELEASE CLOSURE

**Date:** 2026-11-26
**Worktree:** `E:\pevvy-maintenance-acceptance-20261125`
**Branch:** `fix/maintenance-manual-acceptance-20261125`
**Final source commit (code):** `4772e242e6d3b5fb004387776645de4a7a4a62cf`
**Branch head:** `27e9486` — this report. Later commits on this branch, if any, are documentation only.
**Staging baseline:** `977e32eb3447af2ec886cb512e8a9f06212b4259`
**Authorized staging project:** `yeklucfthspvejlkffln` (Pevvy-Staging)
**Production project `ysnumxtzcgzyabrghxwq`:** not linked, not contacted, not deployed to.

---

## 1. Executive result

The focused release safety review found **five defects in the work that went beyond
the original maintenance requirements** — the part of the branch nobody had reviewed.
Four needed code and are fixed. One of them would have taken the product down on
staging the moment the migration landed.

The release is **ready for the owner-executed migration gate**. Nothing has been
pushed and nothing has been applied.

| Item | State |
|---|---|
| Focused safety review (5 dimensions, 41 agents, adversarial verification) | complete |
| Corrections from the review | 4 applied, committed, tested |
| CSV import hazard (§3) | corrected |
| Final source commit | `4772e24` — working tree clean |
| Migration dry run | **passes** — exactly one migration, no seeds, no roles |
| Migration applied to staging | **NO — owner gate, commands in §7** |
| Staging ledger | 139 applied / 140 local / 1 pending / **zero drift** |
| Guarded build | **PASSES** — 196 files, SHA-256 `c09c4524…`, reproduced byte-identical |
| Staging push to `origin/staging` | **NOT DONE** — deliberately ordered after the migration |
| Hostinger publication | not yet — before/after evidence and check procedure in §10 |
| Manual acceptance | **not performed.** Owner baseline 11/11/4 stands unchanged |
| Production | **NO-GO** |

**Correction to the prompt's premise.** §2 names `51e904e` as the current final
commit. The branch head was already `87e4e7f` (the report commit that followed it).
The implementation and automated validation described in the prior report were
preserved in full; `51e904e` was not reverted to.

---

## 2. Focused release safety review

Five independent reviewers, one per dimension, each required to cite file and line.
Every finding was then attacked by three adversarial verifiers under different lenses
— *is the mechanism real*, *was it already true at the baseline*, *does it reach a
user* — and killed unless at least two failed to refute it.

**12 findings raised → 5 survived → 7 refuted.** The seven refuted are listed in §2.6
so they are not re-raised later as if they were open.

### 2.1 The one that would have broken staging — missing EXECUTE grant (CRITICAL, fixed)

`app.maintenance_restriction_range` is the shared definition created by this migration
and read by availability, the rental guard and the conflict listing. It was created
**with no EXECUTE grant.**

`public.vehicles_available_between` is SECURITY INVOKER (`prosecdef = false`, verified)
and calls that helper from its body, so **the signed-in caller's own privileges
decide**. Migration `20260821100500_app_schema_privileges.sql:61-66` had already
removed the PUBLIC default for schema `app`, including
`alter default privileges in schema app revoke execute on functions from public`. On
the hosted database a function created in `app` therefore lands reachable by nobody.

The consequence: the vehicle picker and the availability search would raise
`permission denied for function maintenance_restriction_range` for **every signed-in
member**. No rental could be created anywhere in the product.

**Why the test suite did not catch it, and why I did not simply trust the suite.**
Two reviewers asserted the defect; a third replayed the migrations and read the
catalogue, finding `authenticated=X` present and declaring it refuted. I settled it
myself rather than take either side, by querying `pg_default_acl` directly on the
harness:

```
pg_default_acl rows:  public/r, public/S, public/f   ← no row for schema app
app.maintenance_restriction_range proacl:
    postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres
public.vehicles_available_between prosecdef = false
```

**There is no `pg_default_acl` row for schema `app` in the harness.** PGlite does not
carry that migration's `ALTER DEFAULT PRIVILEGES` across, so functions created in `app`
there still receive the built-in PUBLIC grant, section 12 snapshots that as "the role
could execute it", and grants it back. The harness rescues the function; the hosted
database would not. The passing tests were an artefact of the harness, not evidence.

This is the exact shape of divergence that makes local green meaningless, and it is
worth recording as a standing hazard: **an `app` function reached from invoker context
must carry its own explicit grant, because the harness cannot fail when it is missing.**

**Fix:** explicit `revoke … from public, anon` and
`grant execute … to authenticated, service_role`, matching the pattern every other
invoker-reachable `app` helper already follows (`20261103100000:243`, `20261113100300:108`,
`20261117110000:438`, `20261120100000:74`). A post-apply verification query is in §7
because this is the one thing the local suite structurally cannot confirm.

### 2.2 Account closure swept nothing it had just learned to collect (CRITICAL, fixed)

Section 11 taught `app.organization_collect_objects` about three new buckets —
`maintenance-documents`, `incident-photos`, `incident-documents`. The sweeper that
actually deletes from Storage filters every candidate through `STORAGE_BUCKETS`
(`supabase/functions/_shared/account-closure.ts:70`), whose own comment reads
*"exactly the ones the collector fills"*. This branch made that comment false and
touched no file under `supabase/functions/`.

Consequences, all real and all bad:

1. Rows for those buckets are never sweepable, so `sweepStorage` returns
   `complete: true` and `finishOrganization` returns `'closed'` — **an agency reported
   purged while every incident photo and service invoice remains readable in Storage.**
   That is precisely the failure the migration's own comment claims to fix.
2. The rows are never marked `deleted_at`, so `listClosedWithPendingWork` returns that
   agency on **every subsequent run for ever**. With `PAGE = 500`, one agency holding
   500+ stuck keys starves every other closed agency's sweep.
3. `needsAttention` goes permanently true with the message *"ledger rows name keys
   outside this agency"* — sending an operator to investigate cross-tenant key leakage
   that never happened.

Nothing compared the two lists: the migration's own tripwire
`app.organization_purge_lists_agree` compares **tables, not buckets**.

**Fix:** three buckets added to `STORAGE_BUCKETS`, plus **the comparison test that did
not exist** — `account-closure-purge.test.ts` now asserts every bucket the collector
writes appears in the sweeper's allowlist. Confirmed it fails without the fix.

The Edge Function source is corrected; **it is not deployed**, per §3. `account-closure`
is not among the three functions deployed to staging, so this path is not live there.

### 2.3 `off_road_by` could make an account undeletable (MEDIUM, fixed)

`off_road_by uuid references auth.users(id)` carried no delete rule — NO ACTION. Every
other actor column in the fleet schema is ON DELETE SET NULL
(`20260813090300_fleet.sql:60, 121, 199`), and `20260821100100_actor_deletion.sql:9-12`
states the rule: *"a product that cannot delete an account cannot honour an erasure
request"*.

Failure path: a manager in agencies A and B takes a car off the road in B, then leaves
B. Agency A closes. The purge reaches `removeAuthUsers`, B's vehicle row still
references the uid, the foreign key raises 23503, and **the closure fails with the
account surviving the erasure it promised** — unrecoverable without manual database work.

**Fix:** `on delete set null`. Who applied a restriction is useful, never load-bearing.

### 2.4 Section 10 was not as narrow as it said (MEDIUM, disclosed and covered)

`app.sync_rental_assignment_schedule` has **two** callers, not one: `rental_reschedule`
*and* `rental_extend` (`20261118110000:135` and `:79`). The section's comment named only
rescheduling and asserted *"This does exactly that"*. Extending a reserved rental
changes behaviour too.

**I did not artificially narrow it, and that is a judgement the owner should see.**
§3 says retain the narrow correction. Narrowing it here would mean deliberately
preserving the identical bug in the sibling path: a member could move a booking but not
lengthen it, for a reason they could never discover. It is one defect in two doorways.
The assignment row opened on the extend path carries reason `initial` because that is
what it records — the original booking nobody wrote down — not the extension.

**Action:** behaviour kept, comment corrected to state both callers, and a new test
covers the extend path. If the owner prefers it narrowed, that is a one-line change.

### 2.5 Section 12's header described an exposure that never existed (LOW, fixed)

The comment claimed `anon` could reach private `app` functions until 2026-11-25.
`20260821100500` had already closed that in August and explicitly records the opposite.
A maintainer reading it would treat a non-existent exposure as a shipped incident.

Also latent: `revoke all on function` over every row of `pg_proc` would abort the deploy
with *"is a procedure, not a function"* the day somebody adds a procedure to the schema.

**Fix:** header rewritten to say what the block actually is — a backstop that is a
near-no-op on hosted and genuinely load-bearing in the harness — and the loops now use
`ROUTINE` with `prokind in ('f','p')`, so a future procedure cannot break the deploy.

### 2.6 Refuted — recorded so they are not re-raised

| Claim | Why it fell |
|---|---|
| Section 12 re-issues PUBLIC inheritance as permanent grants on 11 SECURITY DEFINER helpers | Snapshot/restore is privilege-preserving; never grants more than was held |
| Section 12 leaves the mechanism open for the next migration | The mechanism was already closed in August |
| Self-heal opens the assignment on the wrong vehicle | Points at the vehicle the rental already carries |
| Self-heal can create a second open assignment | Guarded by the existing state checks |
| Migration removes the deployed frontend's only way to restrict a vehicle | Maintenance records already restricted availability at the baseline |
| `guard_vehicle_status` disagrees with `maintenance_restriction_range` | The two serve different questions; no reachable disagreement |
| An unrelated assignment change is bundled in | It is the documented §14 correction, now also disclosed for `rental_extend` |

### 2.7 Account closure — the §3 checklist, verified

| Requirement | Result |
|---|---|
| Follows the existing authorization model | **Pass.** No new caller, no lesser role; same claim/purge/sweep path |
| Respects retention requirements | **Pass.** No change to the 30-day `dueForPurge` delay or notices |
| Preserves financial and audit records | **Pass.** No financial or audit table added to the purge list |
| Deletes only the target organization's records and objects | **Pass.** All four tables carry `organization_id`; the test asserts every collected key is prefixed with the agency id |
| **Does not delete merely because a subscription expires** | **Pass.** Closure is gated on an explicit owner request plus the 30-day delay. Billing state is not a trigger anywhere in the path |
| No actual closure executed against staging | **Confirmed.** None run |
| No account closure Edge Function deployed | **Confirmed.** Not deployed; it is not among the three live functions |

### 2.8 Private app schema — the §3 checklist, verified

Authenticated and service-role operations are preserved: the block records effective
privilege first and grants back exactly that, never more. RLS policies that call `app.*`
keep their grants. **Public booking is unaffected** — the whole public surface is one
Edge Function holding the service role, and `anon` is granted nothing before or after.
Billing keeps its privileges; `app.billing_require_write` is untouched. Least privilege
is retained, not widened.

One point the review sharpened and §2.1 acts on: this block **must not be the only
thing standing between a member and the vehicle picker**. An invoker-reachable helper
states its own grant.

### 2.9 CSV vehicle import (§3) — corrected

The report said legacy Status values are ignored and imported vehicles get the default
status. That was true, and it was a hazard. The column was still *understood* but inert:
a row reading `Servicing` or `Off the road` **validated cleanly and the vehicle arrived
available for anybody to book.** The spreadsheet said the car was in the workshop and
Pevvy said it was for hire — exactly what §3 asks to prevent.

Importing genuinely cannot apply a restriction: that comes from a maintenance record or
the off-road action, each carrying a reason, an author and a date a cell does not have.

**Fix, inside the existing import validation — no separate architecture.** A status word
meaning *not available for hire* now stops the row with an operator-facing message:

> "Servicing" says this vehicle is not available for hire, and importing cannot take a
> vehicle off the road. Clear the Status cell to import it, then schedule its maintenance
> or take it off the road in Pevvy.

An in-service word still imports and still assigns nothing. An unrecognised word is
still refused. 48/48 vehicle tests pass.

---

## 3. The three assignment lifecycle failures — production release gates

Required by §3. Each verified by targeted run, not inferred. **None is caused, worsened
or fixed by the pending migration.**

### Gate A — activation defaults to enabled, contradicting the STG-02 contract

*`assignment-feature-activation.test.ts:35` — "defaults missing activation to disabled
and keeps the decision tenant-scoped".*
`assignment_feature_eligibility` returns `{enabled: true, can_view_history: true,
can_swap: true}` where the contract requires all three false.

**Cause:** `20261124100000_standard_vehicle_swap_release.sql:16-25` made the GUC default
`'on'` and a missing activation row coalesce to `true`. The withdrawal migration
`20261124120000` revoked the swap RPC's grants but **did not revert this default**.

**Real operational impact — a backend change that only ever surfaces as failures.**
Nothing new appears in the product: no page or component calls
`useAssignmentFeatureEligibility`, `useRentalAssignmentHistory` or `useSwapActiveVehicle`
— the hooks exist and nothing uses them, so `can_swap: true` is returned to a caller that
does not exist. What *does* change is that the assignment lifecycle is **on by default for
every organization never explicitly disabled**. Member sessions write assignment rows;
service-role confirmations do not, because the gate requires `is_org_member`. The
consequences a user can hit are failures, not features: the *"Current rental assignment
not found."* error (which section 10 fixes) and the overlap/pointer guards rejecting a
lifecycle operation. After section 4, `vehicles_available_between` reads rentals and
maintenance only and never reads assignments, so **the assignment rows are a parallel
ledger with no read surface in the application.**

**Gate:** production must not ship with activation defaulting on while the STG-02
contract says off. Either revert the default or amend the contract — a decision, not a bug fix.

### Gate B — stale pre-withdrawal swap contract

*`assignment-lifecycle-operations.test.ts:109` — "supports repeated active swaps…".*
Throws `permission denied for function rental_swap_vehicle` (42501) before any assertion runs.

**Cause:** `20261124120000` revokes execute from public, anon, authenticated and
service_role. The test is a pre-withdrawal contract never updated on this branch.

**Real operational impact: registry/governance only, no user-visible impact.** The
failure *is* the withdrawal working. No role can execute the RPC, no page renders a swap
control, and the only wrapper is reachable through a hook no component uses.

### Gate C — same revoke, assertion on the wrong layer

*`assignment-lifecycle-operations.test.ts:162` — "fails closed for unauthorized and
cross-tenant active swaps".* The call **is** rejected; the message is
`permission denied for function rental_swap_vehicle` rather than matching
`/consent|authorization/i`.

**Real operational impact: registry/governance only.** The property under test is intact
and in fact **stronger** — the caller never reaches the function body. **This must not be
represented as a security regression.**

### Governance gap found while verifying these

`supabase/tests/withdraw-active-swap.test.ts` — the replacement test named in the
withdrawal report — **does not exist on this branch.** It lives on
`fix/staging-billing-recovery-20261123`. So on the branch being released **nothing
asserts that the swap stays withdrawn**: a future re-grant would be caught by nothing,
and Gates B and C would start passing and look like a pass. Recommend porting that test
before production.

---

## 4. Billing authorization — policy recorded, not implemented

Per §4, the eleven incident and maintenance authorization paths are **unchanged**. No
Stripe, pricing, billing function or payment change. Recorded for a separate focused
correction:

**Principle:** a billing-restricted agency keeps read access and everything needed to
keep people safe. It loses commercial expansion.

| Keep available when restricted (safety) | Keep restricted (commercial) |
|---|---|
| Reporting an incident | Routine maintenance scheduling |
| Taking an unsafe vehicle off the road | Preventive service plan configuration |
| Starting necessary safety maintenance | Expense mutations |
| Documenting or resolving existing incidents and maintenance | New reservations and checkout |

Current state preserved exactly: `vehicle_take_off_road` keeps its **safety exception**
(taking an unroadworthy car off the road only ever makes a fleet smaller);
`vehicle_return_to_service` and `vehicle_resolve_legacy_maintenance` keep **billing
enforcement**.

The eleven currently ungated: `maintenance_create`, `maintenance_start`,
`maintenance_complete`, `maintenance_cancel`, `maintenance_reschedule`,
`maintenance_set_service_plan`, `maintenance_link_expense`, `maintenance_unlink_expense`,
`incident_create`, `incident_update`, `incident_resolve`.

`billing-restricted-access.test.ts > leaves no SECURITY DEFINER write path ungated and
unexplained` **remains red and remains an explicitly documented production release gate.**

---

## 5. Corrections made in this closure

| # | Severity | Correction | Files |
|---|---|---|---|
| 1 | — | CSV import holds back a row claiming the vehicle is off the road | `src/features/vehicles/csv.ts`, `vehicles.test.ts` |
| 2 | CRITICAL | Explicit EXECUTE grant on `app.maintenance_restriction_range` | migration §3 |
| 3 | CRITICAL | Three buckets added to the sweeper, plus the comparison test | `_shared/account-closure.ts`, `account-closure-purge.test.ts` |
| 4 | MEDIUM | `off_road_by` → `ON DELETE SET NULL` | migration §1 |
| 5 | MEDIUM | `rental_extend` disclosed and covered | migration §10, `maintenance-acceptance.test.ts` |
| 6 | LOW | Section 12 header corrected; `ROUTINE` + `prokind` guard | migration §12 |

Two commits: `2734ade` (import) and `4772e24` (review corrections).

---

## 6. Validation

Focused tests only, per §5 — the full suite was **not** re-run.

| Suite | Result |
|---|---|
| `vehicles.test.ts` (frontend) | **48/48 pass** |
| `maintenance-acceptance.test.ts` | **22/22 pass** (20 + extend path + grant assertion) |
| `account-closure-purge.test.ts`, `account-closure-runner.test.ts` | **pass**, including the new bucket tripwire |
| Governance + availability + tenancy (10 files) | **339/339 pass** |
| Closure, assignment, availability, booking (12 files) | 177/181 — **the 4 known pre-existing failures, no others** |
| `format:check` | clean |
| `eslint`, `tsc -b --noEmit` | clean |

The four failures are exactly the documented set: Gates A, B, C and the billing
registry. **No new failure was introduced.**

---

## 7. Staging migration — OWNER GATE

The previous `npx supabase db push` was refused by this environment's safety classifier.
That restriction is respected: **it was not retried and not circumvented.** Everything
read-only was completed.

- **Dry run: PASSES.** Re-run after the corrections.
  `{"upToDate":false,"dryRun":true,"migrations":["20261125130000_maintenance_acceptance_remediation.sql"],"seeds":[],"roles":[]}`
- **Ledger verified independently:** 139 applied remotely, 140 on the branch, **exactly one
  pending**, nothing applied that is absent from the branch — **zero drift**.
- **Link confirmed:** `supabase/.temp/linked-project.json` → `{"ref":"yeklucfthspvejlkffln","name":"Pevvy-Staging"}`. Not production.
- **Applied: NO.** Staging is unchanged.

### Owner-run commands (PowerShell)

```powershell
# 1. The verified worktree
Set-Location 'E:\pevvy-maintenance-acceptance-20261125'

git rev-parse --abbrev-ref HEAD    # fix/maintenance-manual-acceptance-20261125
git status --porcelain             # expect no output
git log --oneline -1               # the branch head

# The reviewed code must be in what you are about to push. Prints nothing if so.
git merge-base --is-ancestor 4772e242e6d3b5fb004387776645de4a7a4a62cf HEAD; if ($LASTEXITCODE -ne 0) { 'STOP: reviewed code is not in HEAD' }

# 2. Link the authorized staging project
#    (already linked and verified; run it if the link is ever lost)
npx supabase link --project-ref yeklucfthspvejlkffln

# 3. Confirm the target is staging, never production
Get-Content supabase\.temp\linked-project.json
#    expect "ref":"yeklucfthspvejlkffln","name":"Pevvy-Staging"

# 4. Ledger before — 139 applied, one pending
npx supabase migration list --project-ref yeklucfthspvejlkffln

# 5. Dry run — must list exactly one migration
npx supabase db push --project-ref yeklucfthspvejlkffln --dry-run

# 6. Apply the single corrective migration
npx supabase db push --project-ref yeklucfthspvejlkffln

# 7. Ledger after — 20261125130000 now applied, nothing pending
npx supabase migration list --project-ref yeklucfthspvejlkffln
```

### Post-apply check that the local suite structurally cannot do

The §2.1 grant is the one thing the harness cannot fail on. Run this in the **staging**
SQL editor after the push and confirm it returns `true`:

```sql
select has_function_privilege(
  'authenticated',
  'app.maintenance_restriction_range(public.maintenance_status, timestamptz, timestamptz, timestamptz)',
  'EXECUTE');
```

If it returns `false`, **stop** — the vehicle picker and availability search are down
for every member, and the frontend must not be published.

**Tell me when the push has run and I will verify the ledger independently and continue
to the frontend deployment.**

---

## 8. Backward compatibility — verified, with one transitional effect

Applying the migration ahead of the frontend is **safe for reads and for ordinary edits**,
and the new frontend is **unpublishable until the migration lands**.

- **No drops or renames.** Three `add column if not exists`, three `drop trigger if exists`.
  Nothing removed.
- **`vehicle_fleet` columns are strictly appended** — compared name-by-name against the
  baseline. Safe for the deployed `select('*')` reads.
- **Every PostgREST RPC parameter name matches**, so no old call 404s.
- **Ordinary vehicle edits keep working.** The deployed edit form sends `status` on every
  save, and the guard returns early when the value is unchanged.
- **The deployed Vehicle Details status dropdown will stop working** between apply and
  publish, failing with a permission error. That control is the one being deliberately
  removed, so this is the intended end state arriving early — **but it argues for keeping
  the window short.** Publish the frontend promptly after the migration.
- **Restriction capability is not lost in the window:** maintenance records already
  restricted availability at the baseline.
- **The new frontend requires the migration:** `vehicle_take_off_road`,
  `vehicle_return_to_service` and `vehicle_resolve_legacy_maintenance` would 404 (PGRST202)
  without it.

---

## 9. Guarded build — PASSES

This was the previous closure's blocker. It is resolved.

```
Staging artifact verified: 196 files; SHA-256
c09c4524d0929f265ef4e657ff605c4425dd9923f7166cca0acba98747a7b406
```

- Built with `npm run build` → `dist-staging`, mode `staging`.
- `VITE_SUPABASE_URL = https://yeklucfthspvejlkffln.supabase.co`.
- The browser publishable key was read from the **authorized staging project** and held
  only in the process environment for the build. **No env file was copied, no key was
  written to disk, committed, or printed.** The only local `VITE_SUPABASE_PUBLISHABLE_KEY`
  on this machine targets **production** and was correctly not used — the guard would have
  rejected it on two counts.
- **Guard validation was not bypassed.** It verified: staging reference present, expected
  publishable key present, **no production reference**, no `sb_secret_`, no privileged JWT,
  no unexpected publishable key.
- **Reproducible:** rebuilt after the final commit and produced the byte-identical SHA.
- `dist-staging/` is gitignored; the working tree stayed clean.

---

## 10. Staging push and Hostinger — not done, with the evidence to verify it

**Push status: NOT DONE.** `origin/staging` is still `977e32eb3447…`, unchanged.
Deliberately ordered after the migration, because the frontend reads columns and calls
RPCs the migration creates.

When the migration is confirmed, publication is a normal fast-forward:
`977e32e` is an ancestor of `4772e24`, so `git push origin HEAD:staging` fast-forwards
with no force and no history rewrite.

**Hostinger evidence — the live staging site before deployment** (`quantum-lavenderblush-buffalo-97.hostingersite.com`):

```
GET /                             → 200
GET /staging-build-manifest.json  → 200
  { "buildMode": "staging", "projectRef": "yeklucfthspvejlkffln",
    "contentSha256": "f722d3d19a84ca8a48a8ea881eef6d58aee37b7c232335064162b496063237fe",
    "fileCount": 192 }
```

**HTTP 200 will not be treated as deployment success.** The published manifest gives an
objective check instead. After Hostinger rebuilds, deployment is confirmed only when:

1. `contentSha256` **differs from** `f722d3d19a84…` (a new build was genuinely published);
2. `fileCount` is **196**, not 192;
3. the published bundle contains the corrected strings — probe for
   `not available for hire` (the new import refusal) and `Return to service`, neither of
   which exists in the deployed build.

Until all three hold, the frontend is not deployed regardless of what Git or a 200 says.

---

## 11. Manual acceptance checklist — 26 scenarios

**Status: NOT ACCEPTED. The owner baseline of 11 passed / 11 failed / 4 pending stands
unchanged.** Automated coverage is not acceptance and is not recorded as such. Nothing
below may be marked accepted until the owner confirms it on hosted staging.

### Previously PASSED — 11 (re-confirm no regression)

| # | Scenario | Confirmed |
|---|---|---|
| 1 | Fleet status synchronization | ☐ |
| 2 | Active-maintenance presentation | ☐ |
| 3 | Standalone "In maintenance" removed from Vehicle Details | ☐ |
| 4 | Early-start confirmation | ☐ |
| 5 | Early-start cancellation | ☐ |
| 6 | Actual maintenance timestamps | ☐ |
| 7 | Completion restores eligible availability | ☐ |
| 8 | Multiple restrictions | ☐ |
| 9 | Independent off-road restrictions | ☐ |
| 10 | Optional incident association | ☐ |
| 11 | Automatic Fleet / Vehicle Details refresh | ☐ |

> The register's prose enumerates ten distinct items against a stated count of eleven;
> "early-start confirmation and cancellation" is split above as the most likely reading.
> **Please confirm the split** — no scenario has been invented to reach the count.

### Previously FAILED — 11 (the remediation targets)

| # | Scenario | Confirmed |
|---|---|---|
| 12 | Future scheduled availability | ☐ |
| 13 | Overlapping reservation prevention | ☐ |
| 14 | Immediate restriction after early start | ☐ |
| 15 | Overdue checkout restriction | ☐ |
| 16 | Incident-to-maintenance creation and prepopulation | ☐ |
| 17 | Related maintenance on Incident Details | ☐ |
| 18 | Incident-resolution lifecycle independence | ☐ |
| 19 | Preventive servicing interface | ☐ |
| 20 | Downtime presentation | ☐ |
| 21 | Supporting documents | ☐ |
| 22 | **Standard rental regression** — priority zero | ☐ |

### Previously PENDING — 4

| # | Scenario | Confirmed |
|---|---|---|
| 23 | Legacy restriction resolution | ☐ |
| 24 | Incident resolution warning | ☐ |
| 25 | Maintenance completion independence | ☐ |
| 26 | Expense integration | ☐ |

### Additionally worth checking after this closure

- ☐ Vehicle Details no longer offers an Operational status dropdown
- ☐ Edit Vehicle no longer offers the legacy Status dropdown
- ☐ Maintenance Details links to the specific related incident, not a generic link
- ☐ **CSV import of a row whose Status says `Servicing` or `Off the road` is refused with
  a message, and the vehicle does not arrive bookable** (new in this closure)
- ☐ Reported examples re-checked: MNT-2026-00009, INC-2026-00002, DEMO-004,
  DEMO-003 (Hyundai Elantra), DEMO-019 (Ford Mustang), DEMO-001 (Toyota Corolla)

---

## 12. Remaining production gates

| # | Gate | State |
|---|---|---|
| 1 | Owner manual acceptance of all 26 scenarios on hosted staging | **open** |
| 2 | Gate A — assignment activation defaults on, contradicting the STG-02 contract | **open — decision required** |
| 3 | Gate B — stale pre-withdrawal swap contract test | open — governance only |
| 4 | Gate C — stale assertion on the fail-closed error string | open — governance only; **not a security regression** |
| 5 | Billing: eleven ungated incident/maintenance SECURITY DEFINER writes | **open — policy recorded in §4, correction deferred** |
| 6 | `withdraw-active-swap.test.ts` absent from this branch — nothing asserts the swap stays withdrawn | **open — newly found** |
| 7 | Hosted public booking blocked — `public-booking` Edge Function not deployed | open |
| 8 | Six of nine Edge Functions not deployed to staging (`account-closure`, `account-closure-notice`, `gps-provider`, `mfa-reset`, `public-booking`, `team-invitations`) | open |
| 9 | Hostinger deployment attribution for the release commit | open |
| 10 | Staging migration applied | **blocked on §7 owner gate** |
| 11 | Staging frontend published and verified by manifest SHA | blocked on gate 10 |

**Production remains NO-GO.**

---

## 13. Restrictions honoured

- Production not accessed, not linked, not deployed to. Only `yeklucfthspvejlkffln` was contacted.
- The refused `db push` was **not retried and not circumvented**.
- No account closure executed against any staging organization.
- **No Edge Function deployed** — not account closure, not public booking, not any other.
- No Stripe, subscription pricing, billing function or payment change.
- No force push, no history rewrite, nothing pushed at all.
- No credential extracted to disk, committed or printed. No env file copied between worktrees.
- Guarded environment validation not bypassed; production configuration not substituted.
- Vehicle swapping not reactivated; no new assignment architecture.
- Full database and frontend suites not re-run; only focused tests.
- Rental Financial Adjustments not begun.
- **No scenario marked manually accepted.**

---

*Automated validation and read-only verification only. Nothing in this report constitutes
manual acceptance, staging deployment or production approval.*

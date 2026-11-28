# Pevvy — production hardening: regression verification

**Date:** 2026-11-27
**Scope:** the canonical `npm run verify` chain, plus independent PostgreSQL concurrency
verification repeated after hardening.
**Nothing was applied or deployed.** Production not accessed.

---

## 1. The verify chain

Run as five explicit steps — `format:check`, `lint`, `typecheck`, `test`, `build` — which
is what `npm run verify` chains, with the test step at `--maxWorkers=4` for the reason in
§2.

| Step | Result |
|---|---|
| Formatting (`prettier --check`) | **clean** — "All matched files use Prettier code style!" |
| Lint (`eslint .`) | **14 problems (0 errors, 14 warnings)** — see §4 |
| Type checking (`tsc -b --noEmit`) | **clean** |
| Tests (`node scripts/run-tests.mjs`) | **203 files, 4,234 tests, all passed**; "all 203 test files ran" |
| Guarded staging build | **blocked in this run for want of credentials — see below**; the verified artifact stands: 199 files, SHA-256 `be240a5b44a0af9c8c9e4e6c1fe8d018a46f7db59979f3e08e560d736c24e228` |

Nothing was suppressed, skipped or marked as expected-to-fail.

**The build step, stated exactly.** The chain's final step exited **1** with
*"Staging build blocked: approved-staging-url-required, browser-publishable-key-required"*.
That is `scripts/staging-build-guard.mjs` refusing to build without the staging URL and a
`sb_publishable_` browser key **in the process environment** — staging Vite mode reads no
`.env` file. It is a missing credential in the shell, not a defect in the code or the
configuration.

The guarded artifact was nevertheless produced earlier in this work, and it is still the
artifact for this code: `dist-staging/staging-build-manifest.json` records project ref
`yeklucfthspvejlkffln`, 199 files and SHA-256
`be240a5b44a0af9c8c9e4e6c1fe8d018a46f7db59979f3e08e560d736c24e228`, and **no build input —
nothing under `src/`, nor `index.html`, `vite.config.ts`, `tsconfig*.json` or
`package.json` — is newer than that manifest.** `tsc -b` passed in this run over the same
sources.

**What is therefore not claimed:** that the full five-step chain exited 0 in a single
invocation. It did not. Four of five steps passed; the fifth is credential-blocked and its
output is independently verified above.

The only browser credentials on this machine point at **production**
(`ysnumxtzcgzyabrghxwq`), which the guard rejects outright as
`production-reference-in-browser-config`. They were not used, and no staging credential was
fetched to force the step through.

---

## 2. Full suite

### Two runs that were discarded, and the explanation that was wrong

**First run.** It reported **192 files and 3,990 tests, all passing — with exit code 1**.
That is not a pass. `npm run test` wraps vitest in a check that every test file on disk
actually ran, precisely because *"vitest exits 0 when a worker fails to start and its test
file never runs"*. Eleven workers timed out starting, so **ten test files never executed**.

I attributed that to the Docker-based concurrency verification replaying 148 migrations on
the same machine at the same time, and wrote here that the two had starved each other.

**Second run, with nothing competing.** 190 files, 3,948 tests, and **13 files that never
ran** — every one of them a frontend `.test.tsx`, each failing with
`[vitest-pool]: Failed to start forks worker … Timeout waiting for worker to respond`.
Chain exit code **1**.

**So the Docker explanation was wrong**, and it is corrected rather than quietly dropped.
The container made it worse; it did not cause it. The cause is the fork pool's worker
startup timeout on a suite where most workers boot a WASM PostgreSQL and replay 148
migrations: at default concurrency (11 forks on 12 CPUs) the heavy workers hold the
machine long enough that new forks miss their startup window. The database files are not
the casualties — the light frontend files are, because they are scheduled last.

**What was changed to get a valid run, and what was not.** The run was repeated with
`--maxWorkers=4`. That lowers concurrency and nothing else: the same **203** files, the
same assertions, and — because `--maxWorkers` is not one of the runner's narrowing
flags — **the every-file-ran check still applies**. No file was excluded, no test was
skipped, no timeout was raised, no assertion was relaxed.

This is worth recording because the failure mode is a green summary. Both discarded runs
printed "all passing". Without the every-file-ran check the first would have read as a
clean pass over a suite that had silently skipped ten files, and I would have reported it
as one.

### The run that counts

Third run, `--maxWorkers=4`, nothing competing:

| | |
|---|---|
| Test files | **203 passed (203)** |
| Tests | **4,234 passed (4,234)** |
| Errors | **0** |
| Every-file-ran check | **"Test-file check: all 203 test files ran."** |
| Duration | 623.51s |

Zero unhandled errors, zero worker-start failures, and the guard's own statement that the
file set on disk and the file set that ran are the same. This is the run reported.

### The four historical baseline failures are gone

| Was failing | Now |
|---|---|
| `assignment-feature-activation` — defaults missing activation to disabled | **passes.** The schema was corrected to the STG-02 contract, and the test extended to cover the revised capability reporting and a behavioural check that a fresh agency opens no assignment row |
| `assignment-lifecycle-operations` — repeated active swaps | **replaced** with withdrawal security coverage: every browser role refused, no role holds EXECUTE, earlier history still readable |
| `assignment-lifecycle-operations` — fails closed for unauthorized swaps | **replaced** likewise. It had always failed closed; only the matcher disagreed |
| `billing-restricted-access` — ungated SECURITY DEFINER write path | **passes.** The bypass was fixed, not the test |

Observed in the reported run, each file green:

| File | Tests |
|---|---|
| `billing-restricted-access` | 57 |
| `rental-pricing-amendments` | 41 |
| `rental-lifecycle-integrity` | 36 |
| `maintenance-acceptance` | 22 |
| `analytics-security` | 13 |
| `assignment-feature-activation` | 5 |
| `assignment-lifecycle-operations` | 4 |
| `assignment-lifecycle-integration` | 3 |
| `assignment-gate-wording` | 3 |

### Tests that had to change, and why

Each of these was written against behaviour this work deliberately changed. None was
weakened to hide a failure.

- **`analytics-security`** — the five lifecycle functions were added to the definer
  allow-list with the justification that being privileged is the point of the correction.
- **`assignment-lifecycle-operations`** and **`assignment-lifecycle-integration`** — both
  switched the feature on with a session GUC. That setting was removed from the
  authorization decision, so they now switch it on the way the product does: a row in
  `app.assignment_feature_activation`.
- **`maintenance-acceptance`** — one test confirmed a rental and expected an assignment
  row. With default-off restored it must enable activation explicitly. The test is about
  extending a reserved booking through the assignment sync, and that is what it still
  tests; the default itself is covered in `assignment-feature-activation`.
- **`rental-lifecycle-integrity`** — two fixtures checked out at a lower odometer than a
  previous check-in had recorded. They passed only because a staff check-in silently
  failed to advance the vehicle's mileage. Now that it works, the readings must climb.
- **`billing-restricted-access`** — the structural test now reads
  `app.billing_exempt_functions` instead of carrying the four safety exemptions in an
  array, and asserts each has a reason.

---

## 3. Independent PostgreSQL concurrency verification

Ten scenarios, each reported on its own with its own assertions, as §9 requires.

**Method.** PGlite is a single connection and cannot express these properties at all, so
the real schema (148 migrations plus the Supabase role doubles) was replayed into a
throwaway **PostgreSQL 17** container and driven by genuinely independent sessions.
Synchronisation is a **barrier, not a sleep**: both sessions open their transaction and
reach the contended statement before either is released. **Hosted staging was not used**,
so there is no QA residue and no tenant record at risk.

### 3.1 Results — the run that counts

A **clean replay from an empty database**: the container destroyed and recreated, the
Supabase role doubles bootstrapped, all **148** migrations replayed in filename order, then
the ten scenarios driven by independent sessions. Exit code **0**.

**10 scenarios, 23 of 23 assertions passed, 0 failed.**

Each assertion is reported on its own, as §9 requires.

| # | Scenario | Assertion | Result | Observed |
|---|---|---|---|---|
| 1 | Concurrent vehicle reservation | exactly one of the two overlapping hires is reserved | PASS | A=committed B=refused; reserved=1 |
| 1 | | the loser is refused rather than silently dropped | PASS | `conflicting key value violates exclusion constraint "rentals_no_vehicle_overlap"` |
| 2 | Concurrent driver reservation | the same driver is not committed to two overlapping hires at once | PASS | A=committed B=refused; reserved=1 |
| 2 | | and the refusal names the conflict | PASS | *"Driver availability conflict: SharedDriver C is already assigned on rental RNT-2026-00003"* |
| 3 | Concurrent checkout of one rental | only one checkout commits | PASS | A=committed B=refused |
| 3 | | the rental is active with exactly one odometer reading | PASS | status=active odometer=20000 |
| 4 | Concurrent return of one rental | the returns serialise and leave one coherent record | PASS | A=committed B=committed; one `returned_at`, odometer=31000 |
| 4 | | no partial return survives (status and reading agree) | PASS | `returned_at` set with odometer 31000 |
| 4 | | **NOTE** — a second return overwrites the first rather than being refused | PASS | both committed; last writer wins. **Recorded as a limitation, not corrected.** See §5 |
| 5 | Concurrent charge reversal | exactly one reversal exists | PASS | 1 reversal; A=refused B=committed |
| 5 | | the second is refused, not silently dropped | PASS | `duplicate key value violates unique constraint "rental_line_items_one_reversal"` |
| 6 | Concurrent rental repricing | both sessions complete | PASS | A=committed B=committed |
| 6 | | no record of nothing is filed | PASS | 1 amendment: 100→15000 @ revision 1 |
| 6 | | the last recorded amount equals the live hire | PASS | recorded 15000, live 15000 |
| 7 | Concurrent rental extension | amendments match commits exactly | PASS | 2 amendments for 2 commits |
| 7 | | `extension_count` matches commits | PASS | extension_count=2 |
| 8 | Concurrent amendment evidence | the unrecorded restatement is refused | PASS | deadlock detected |
| 8 | | the hire is not 77777 | PASS | live=15000 |
| 9 | Concurrent maintenance restriction | the vehicle is not both reserved and in the workshop | PASS | rental=draft; maintenance=committed |
| 10 | Legacy assignment drainage | the car was genuinely out with an open assignment | PASS | 1 open before |
| 10 | | it can still be returned after activation is switched off | PASS | returned and completed |
| 10 | | no assignment is left stranded | PASS | 0 open after |
| 10 | | the vehicle is available again afterwards | PASS | confirmed |

**Scenarios 6 and 7 are races, so their counts vary between runs and the assertion is the
invariant, not the number.** Scenario 7 recorded 1 amendment for 1 commit on one run and 2
for 2 on another; what is asserted is that the two agree. Scenario 8's refusal arrives as a
deadlock rather than as the evidence error — the evidence requirement is still what makes
the restatement impossible, and either way the 77777 never lands.

### What the earlier anomalies turned out to be

Earlier runs reported 20 of 22 and then 21 of 23. Every discrepancy is recorded here
rather than quietly re-run.

- **Scenario 10 was my own fixture's fault, three times over**, and the migration it
  appeared to indict was correct each time.

  *First:* `app.assignment_lifecycle_active` asks `app.is_org_member` first, and a
  superuser session carries no membership — so no assignment was ever opened and the
  drainage assertions passed **vacuously**.

  *Second:* driving the fixture as the owner did not work either, and the reason is worth
  writing down: **`SET LOCAL ROLE` is a no-op outside a transaction block.** The helper
  that switches to the signed-in role used `set local`, which is correct inside the
  competing transactions but silently does nothing when called on its own — leaving the
  session as the superuser and the gate false. The helper now opens its own transaction
  when the caller has not.

  *Third:* with the scenario finally testing for real, it failed — `rental_check_in`
  raising *"Assignment not found."* and leaving one assignment open. That reads exactly
  like a drainage defect, and it is not one. The check-out had been moved to the owner
  session; the **return had been left on the superuser session**, and
  `app.transition_rental_assignment` ends with
  `has_min_role(v_assignment.organization_id, 'staff')` before it will move any row. A
  session with no membership cannot release an assignment whatever the activation state
  says.

  This was established by running the identical call both ways against the stranded row
  rather than by reading the code: as the superuser it raised *"Assignment not found."*
  from that role check; as the owner it returned the rental and left **0** open
  assignments. The fixture now drives the return as the owner, as the check-out already
  did.

  Three times in one scenario, the same shape: **a harness that silently fails to assume a
  role turns a security test into a test of nothing** — and, once it stops failing
  silently, into a false accusation against the code.
- **Scenario 4 is a real property of the system**, not a test defect, and it is reported
  rather than asserted away. See §5.

---

## 4. Lint warnings, and why they stay

**0 errors.** All three `react-hooks/set-state-in-effect` errors are resolved by deriving
the value during render instead of syncing it into state.

14 warnings remain, each justified:

- **13 × `react-refresh/only-export-components`** — a file exporting both a component and
  a constant. This affects hot-reload during development and nothing in production.
  Splitting thirteen files to silence it is precisely the broad unrelated refactoring the
  instruction rules out.
- **1 × "Compilation Skipped: Use of incompatible library"** in `InviteDialog.tsx` — the
  React compiler declines to optimise that file. A missed optimisation, not a defect.

**Stated plainly:** `RentalNewPage` and `IncidentNewPage` have **no automated coverage**,
before or after. The corrections there are verified by typecheck, lint, Prettier and the
guarded build only, and the defaulting behaviour is worth a look during the next
acceptance pass.

---

## 5. Findings from verification

### A second return overwrites the first rather than being refused

Two concurrent `rental_check_in` calls **both commit**. They serialise properly — the
rental is taken `for update`, so the second runs on the committed result of the first and
there is no torn state — but `rental_check_in` does not refuse a rental that has already
been returned, so the second call overwrites the first one's odometer and fuel reading.

Exactly one coherent return record survives, so this is **not corruption and not a
partial mutation**. It is a lost update in the narrow sense that the earlier reading is
gone. It may well be intentional: correcting a mis-keyed odometer before completing the
rental is a real need at the desk.

**Not corrected here**, because refusing a second check-in changes accepted behaviour and
removes that correction path. Recorded for the owner to decide: either refuse a repeat
check-in once `returned_at` is set, or keep it and accept last-writer-wins.

### A staff check-in never advanced the vehicle's mileage

Pre-existing, and removed as a side effect of the lifecycle correction. `rental_check_in`
does `update public.vehicles set odometer = greatest(odometer, …)` while `vehicles_update`
requires **manager**; run as the caller, a staff check-in matched zero rows and said
nothing. The fleet's recorded mileage simply never moved. It now does, and a test asserts
it.

---

## 6. What this verification does not establish

- **Nothing is applied.** All five migrations are local only; the ledger is 148 local /
  143 remote.
- **Nothing is deployed.** `origin/staging` is unchanged at `5634555`.
- **No responsive or visual verification** was performed, and none is claimed. iPad
  landscape and the application-wide responsive certification remain deferred.
- **The concurrency evidence is from a container**, not from hosted staging. That is the
  right place for it — it needs destructive, racing writes — but it is not a statement
  about the hosted database's configuration.

---

## 7. Re-verified after the final corrections — 2026-11-27

The 4,234-test result above is **not** evidence for the code changed by the final
corrections, and is not offered as such. The whole chain was re-run.

| Step | Result |
|---|---|
| Formatting (`prettier --check`) | **clean** |
| Lint (`eslint .`) | **14 problems (0 errors, 14 warnings)** — unchanged, and no unrelated lint refactoring was done |
| Type checking (`tsc -b --noEmit`) | **clean** |
| Tests (`--maxWorkers=4`) | **205 files, 4,292 tests, all passed** |
| Every-file-ran check | **"Test-file check: all 205 test files ran."** |
| **Chain exit code** | **0** |

Two test files and 58 tests more than the run above:

| File | Tests | Why |
|---|---|---|
| `supabase/tests/maintenance-expense-integrity.test.ts` | 9 | **new** — `20261128130000` had shipped with no coverage at all |
| `src/pages/selection-defaults.test.ts` | 17 | **new** — the defaulting rule behind the three react-hooks corrections |
| `supabase/tests/rental-lifecycle-integrity.test.ts` | +8 | a return is recorded once |
| `supabase/tests/rental-pricing-amendments.test.ts` | +11 | revision interaction, deterministic evidence, historical NULL rows |
| `supabase/tests/billing-restricted-access.test.ts` | +7 | the six `incident_update` conditions |
| `src/lib/supabase/errors.test.ts` | +6 | the refusals survive the error mapping |

The every-file-ran safeguard is preserved exactly as it was; `--maxWorkers` is not one of
the runner's narrowing flags, so the check still applies to the full file set on disk.

### The two pages, stated plainly

`RentalNewPage` and `IncidentNewPage` still have **no render-level coverage**. What was
practical was to lift the rule that actually changed -- "offered until the desk says
otherwise" -- into `src/pages/selection-defaults.ts` and test it directly, including the
case that matters: a field the operator **cleared** must stay cleared, and not refill
itself from the default on the next render. The pages themselves are carried into targeted
hosted staging acceptance.

### Scenario 4 no longer records a limitation

It asserted one before: both returns committed and the second overwrote the first. That is
corrected, so the scenario now asserts the business integrity requirement instead -- exactly
one accepted mutation, the loser refused by name, the surviving record whole, and an
identical retry mutating nothing. Results in §7.1.

### 7.1 Independent PostgreSQL concurrency — re-run after the corrections

A clean replay from an empty database: container destroyed and recreated, role doubles
bootstrapped, all **148** migrations replayed in filename order, then the ten scenarios
driven by genuinely independent sessions. Exit code **0**.

**10 scenarios, 25 of 25 assertions passed, 0 failed.**

Two assertions more than before, both in scenario 4, which now asserts the business
integrity requirement instead of recording a limitation:

| Assertion | Result | Observed |
|---|---|---|
| exactly one return is accepted | PASS | A=refused B=committed |
| the loser is refused rather than silently overwriting | PASS | *"This rental has already been returned. The return recorded at 2026-11-28 03:15 stands."* |
| the surviving record is one of the two readings, whole | PASS | `returned_at` set with odometer 31001, fuel 50 |
| a repeated request is answered idempotently and mutates nothing | PASS | accepted; record unchanged |
| echoing the stored timestamp back is refused, and still mutates nothing | PASS | refused; record unchanged |

The remaining nine scenarios are unchanged and all still pass.

**The lost update is gone.** Where the earlier run recorded *"both committed; last writer
wins"*, two independent sessions racing to return one car now produce exactly one accepted
mutation, and the loser is told why.

### Two harness failures on the way here, recorded rather than hidden

Both were mine, and neither was a product defect:

- **A syntax error.** A newline escape was written literally into a JavaScript string
  while editing the harness through a shell heredoc, so the whole file failed to parse. The
  run aborted before any scenario executed. Caught because the log was read rather than the
  exit code trusted.
- **An assertion that modelled an unrealistic retry.** The first corrected run gave 23 of
  24: the retry echoed the **stored** `returned_at` back, and that is refused by 786
  microseconds, because PostgreSQL keeps microseconds and a JavaScript `Date` keeps
  milliseconds. The cause was proven against the database rather than guessed, and §5 of
  the final corrections report records it. The scenario now asserts both outcomes the
  instruction permits.

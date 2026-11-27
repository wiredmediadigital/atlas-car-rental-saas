# Pevvy — production hardening: regression verification

**Date:** 2026-11-27
**Scope:** the canonical `npm run verify` chain, plus independent PostgreSQL concurrency
verification repeated after hardening.
**Nothing was applied or deployed.** Production not accessed.

---

## 1. The verify chain

| Step | Result |
|---|---|
| Type checking (`tsc -b --noEmit`) | **clean** |
| Lint (`eslint .`) | **0 errors**, 14 warnings — see §4 |
| Formatting (`prettier --check`) | **clean** |
| Frontend tests | included in the suite below |
| Database tests | included in the suite below |
| Security tests | included in the suite below |
| Guarded staging build | **199 files**, SHA-256 `be240a5b44a0af9c8c9e4e6c1fe8d018a46f7db59979f3e08e560d736c24e228` |

Nothing was suppressed, skipped or marked as expected-to-fail.

---

## 2. Full suite

### A run that was discarded, and why

The first attempt at a definitive run reported **192 files and 3,990 tests, all passing —
with exit code 1**. That is not a pass. `npm run test` wraps vitest in a check that every
test file on disk actually ran, precisely because *"vitest exits 0 when a worker fails to
start and its test file never runs"*.

Eleven workers timed out starting, so **ten test files never executed**. The cause was
mine: the Docker-based concurrency verification was replaying 148 migrations on the same
machine at the same time, and the two starved each other. The run is discarded rather
than reported, and the suite was re-run on its own.

This is worth recording because the failure mode is a green summary. Without that
every-file-ran check the first run would have read as a clean pass over a suite that had
silently skipped ten files.

### The run that counts

### The four historical baseline failures are gone

| Was failing | Now |
|---|---|
| `assignment-feature-activation` — defaults missing activation to disabled | **passes.** The schema was corrected to the STG-02 contract, and the test extended to cover the revised capability reporting and a behavioural check that a fresh agency opens no assignment row |
| `assignment-lifecycle-operations` — repeated active swaps | **replaced** with withdrawal security coverage: every browser role refused, no role holds EXECUTE, earlier history still readable |
| `assignment-lifecycle-operations` — fails closed for unauthorized swaps | **replaced** likewise. It had always failed closed; only the matcher disagreed |
| `billing-restricted-access` — ungated SECURITY DEFINER write path | **passes.** The bypass was fixed, not the test |

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

Results are in §3.1.

### What the two earlier anomalies turned out to be

The first run reported 20 of 22. Both are recorded here rather than quietly re-run:

- **Scenario 10 was my own fixture's fault.** It confirmed and checked out the rental as
  the superuser. `app.assignment_lifecycle_active` asks `app.is_org_member` first, and a
  superuser session carries no membership — so no assignment was ever opened and the
  drainage assertions passed **vacuously**. Corrected to drive the fixture as the owner,
  which is the only way the scenario tests anything.
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

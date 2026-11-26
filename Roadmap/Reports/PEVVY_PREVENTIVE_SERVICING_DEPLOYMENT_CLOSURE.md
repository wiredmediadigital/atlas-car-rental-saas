# Pevvy — preventive servicing deployment closure

**Date:** 2026-11-26
**Worktree:** `E:\pevvy-maintenance-acceptance-20261125`
**Project:** Pevvy-Staging `yeklucfthspvejlkffln` (confirmed against `supabase/.temp/project-ref`)
**Prompt archived at:** `Roadmap/Prompts/PEVVY_PREVENTIVE_SERVICING_DEPLOYMENT_CLOSURE_PROMPT.md`
**Published commit:** `dd01c82c2e1da56edcb143c9186d9b6f3feae323`

All nine authorized items are complete. One source change was required — the fleet
CSV export. Everything else was verification. No migration was created, no production
system was accessed, and nothing has been marked accepted.

---

## 1. Migration ledger — verified independently

Read from the hosted project with `npx supabase migration list --linked`, then counted
mechanically rather than by eye, because a 141-row list is exactly the kind of thing a
person confirms by glancing at the last line.

| Check | Result |
|---|---|
| Ledger entries | **141** |
| Present both locally and remotely | **141** |
| Local only (unapplied) | **0** |
| Remote only (not in the repository) | **0** |
| Entries where local and remote differ | **0** |
| `20261126120000` applied | **true** |
| Last entry | `20261126120000`, 2026-11-26 12:00:00 |

**141 local / 141 applied / zero drift.** The ledger moved 140 → 141 exactly as expected
and nothing else moved with it.

---

## 2. Hosted function permissions — verified on the database, not in the file

The grants are written in the migration, but a migration file is a statement of intent.
What follows was read back from the live project with `npx supabase db dump --linked
--schema public` (read-only, 741 KB of actual hosted schema).

`public.maintenance_fleet_downtime(uuid, timestamptz, timestamptz)`

```
REVOKE ALL ... FROM PUBLIC;
GRANT ALL ... TO "authenticated";
GRANT ALL ... TO "service_role";
```

`public.maintenance_complete(uuid, timestamptz, text, text, integer)` — identical shape.

**`anon` appears in neither.** Both are `SECURITY DEFINER` with
`SET search_path TO 'public', 'pg_temp'`, and the downtime function carries
`app.is_org_member(p_organization_id)` inside its `WHERE` clause, so tenant scoping is
enforced by the function body and not by the caller.

The hosted `maintenance_complete` body was also confirmed to contain the advancement
itself — `v_next_on`, `v_next_odo`, `v_reading := coalesce(completion_odometer,
start_odometer)` and the guarded early return when no interval is set. The deployed
function is the reviewed one, not an older definition with a matching name.

---

## 3. Dashboard downtime — operational

Three separate things had to be true, and each was checked on its own.

**The function is exposed by PostgREST.** A stale schema cache would leave the tile dead
with the grants perfectly correct, so this was probed live rather than assumed:

| Call | Result |
|---|---|
| `POST /rest/v1/rpc/maintenance_fleet_downtime` as `anon` | **HTTP 401, `42501 permission denied for function`** |
| A function PostgREST cannot resolve, for contrast | HTTP 404, `PGRST202 ... not found in the schema cache` |

`42501` is the decisive outcome. PostgREST resolved the name *and the named argument
signature*, handed the call to Postgres, and Postgres refused the anonymous role. A
missing or unexposed function produces the second shape, not the first.

**The frontend sends that exact signature.** `fetchFleetDowntime` posts
`p_organization_id`, `p_from`, `p_to` — the three names the probe resolved.

**The failure path that produced "Unavailable" is gone.** The tile reads
`isDowntimeUnavailable={downtime.isError}`. Before the migration the RPC 404'd, so the
query errored and the tile said so. The function now exists and is granted to
`authenticated`, so a signed-in manager's call returns an integer.

**What this does not prove:** nobody signed in. This session holds no staging user
credentials and TOTP is mandatory, so the last step — a real manager seeing a real
number — is part of scenario 28 below and is yours to perform.

---

## 4. Fleet CSV export — corrected

This was the one open decision from the previous report, and the only code change here.

### What was wrong

The `Next service` column printed `vehicles.next_service_on`, the pre-Maintenance
column. Nothing writes that column any more: Edit Vehicle no longer carries the field,
and the write key was removed from the payload before the field was removed from the
form. So the export was publishing a frozen value into a file people keep and act on,
while the product itself had stopped believing it.

### The three rules, as approved

| Situation | `Next service` holds |
|---|---|
| A service plan is configured with a date | **the plan's date** |
| A plan is configured on distance only | **blank** |
| No plan exists for the vehicle at all | **the legacy date** |

The middle row is the one that matters. Such a vehicle *is* planned — it is due at a
reading — but it is not due on a *day*. Falling back there would print a specific,
plausible, wrong date, indistinguishable in the spreadsheet from a real one. A blank
cell is honest; a wrong date is not.

The test for "a plan exists" is the **record**, not the date. Testing the date instead
would send precisely the mileage-only case down the legacy branch — the one failure the
rule exists to prevent.

### How it reads the plan

Through `evaluateVehicleServicing`, the same call Vehicle Details makes, so the file and
the screen cannot disagree about the same car on the same day. The export did not get a
second notion of what "next service" means.

### The contract is unchanged

The column keeps its name and its position (immediately after `Registration expires`),
and the file still has **33 columns** in the same order. A rename would break every
spreadsheet, filter and pivot already built on an earlier export, for no gain: it is the
same fact it always was, and only its source changed. A test asserts the name, the
position and the column count.

### Two details worth stating

`VehicleExportRow.service_next_on` is **required, not optional**. An optional field would
let a caller that forgot to resolve fall silently back to the frozen column — which is
the exact failure this change exists to end. The type now refuses to build the file
until the question has been answered.

The plans are fetched **in parallel with the fleet and paged**. `fetchServicePlans` pages
past PostgREST's `max_rows = 1000` ceiling, so an agency with a large fleet does not
quietly have everything after the first page reported as unplanned — the same truncation
class that was found and fixed in the dashboard money figures last round.

### One consequence, stated plainly

`VehiclesPage` now imports the maintenance API, which builds its Supabase client at
module scope — so importing the page requires a configured environment. This is a
pre-existing pattern that `VehicleDetailPage` already inherits through the Service and
maintenance card, and it surfaced as an import-time failure in `VehiclesPage.test.tsx`,
which now mocks that module. Reworking the maintenance API's client acquisition would
have been an architecture change inside accepted code, which the brief excludes.

---

## 5. Tests — focused, not repeated wholesale

| Suite | Result |
|---|---|
| `src/features/vehicles/` (9 files, incl. export, import, service-date preservation) | **124 passed** |
| `src/features/maintenance/`, `src/pages/maintenance/`, `src/lib/compliance/` | **91 passed** |
| `supabase/tests/service-plan-advancement.test.ts` | included below |
| `supabase/tests/analytics-security.test.ts` (SECURITY DEFINER allow-list) | included below |
| `supabase/tests/maintenance-acceptance.test.ts` (the 22 existing scenarios) | included below |
| — the three database suites together | **47 passed** |
| `npm run typecheck` | **clean** |
| `eslint` on the four changed files | **clean** |
| `prettier --check` on the four changed files | **clean** |

Seven new tests cover the export rules specifically: the column name and position, the
plan date winning, the mileage-only blank, the legacy fallback, one vehicle's plan not
leaking onto another, a cancelled record not counting as a plan, and a blank rather than
the word `null`.

The tests go **through the resolver** rather than hand-building a resolved row, so they
exercise the path the product runs. A fixture that set `service_next_on` directly would
still pass if the resolver were deleted.

The full repository suite was not re-run, as instructed.

---

## 6. Guarded staging build

```
Staging artifact verified: 199 files; SHA-256
09ef62a85d3e6ce782403d4c96241b540b47320d1d987fe21be9216609b09d96
```

The previous release built to **198** files. A file count that moves by one without
explanation is the kind of detail that gets waved through, so it was investigated rather
than assumed benign: the previous commit was rebuilt from the same tree.

- Previous commit rebuilds to **198 files, `f5e07fe48e3a17c0…`** — **byte-identical to
  the hash recorded in the previous report.** The build is deterministic.
- The single added file is **`assets/api-*.js`**: the maintenance API, which the
  bundler now emits as a shared chunk because the Vehicles page reaches it.

The working tree was then restored and rebuilt, reproducing `09ef62a8…`/199 exactly.

The artifact was scanned directly: **no production project reference, no secret key.**

---

## 7. Publication

```
0f4fc5e..dd01c82  HEAD -> staging
```

- Fast-forward confirmed before pushing (`git merge-base --is-ancestor` returned 0).
- **No force, no history rewrite.**
- Pushed to the owner's repository, `wiredmediadigital/atlas-car-rental-saas`.
- **`origin/main` is untouched at `31383a97eb8e000f9189913b255af4da22bf3a26`**, before
  and after.

---

## 8. Deployed frontend — verified by content

The host serves HTTP 200 for unknown paths, so a status code proves nothing. 173 real
asset files were crawled and read.

| Check | Result |
|---|---|
| Manifest | `9a8ba920…`/198 → **`e4c586445ed429e7986c344e5d10d17328938eaaf2e10a8d3836785be2a1f698`/199** |
| Project reference in manifest | `yeklucfthspvejlkffln` |
| `.js` files served as JavaScript | **171 of 171** |
| Production project references | **0** |
| Leaked secret keys | **0** |
| Eight strings unique to the previous release | **all 8 still present** |

**Proving the CSV correction itself shipped needed a different method.** This release
adds no new user-visible string — the column already existed and deliberately kept its
name — so there was nothing new to grep for. The proof is structural instead:

```
SERVICE-PLAN QUERY found in : /assets/api-BQMQHwAN.js
VehiclesPage chunk          : /assets/VehiclesPage-DtEG1KgG.js
VehiclesPage reaches it     : YES
```

The deployed `VehiclesPage` chunk now reaches the chunk containing the service-plan
query literal. Before this commit it did not — that reachability is what created the
199th file. **RESULT: PASS.**

The deployed hash differs from the locally guarded one, as it has every time: Hostinger
rebuilds from source rather than publishing the reviewed artifact. The file count
matches at 199.

---

## 9. Acceptance register

| | |
|---|---|
| Passed | **26** |
| Failed | **1** — scenario 19, Preventive servicing |
| Untested | **0** |

**Unchanged.** The 26 accepted scenarios were not reopened; nothing in this package
touched them, and the 22 automated maintenance acceptance tests still pass unmodified.
The owner's historical 11 passed / 11 failed / 4 pending baseline stands and is not
superseded by any automated result here.

Scenario 19 remains **failed** until you verify it yourself. Dashboard acceptance is
recorded separately as **scenario 28**. Neither is marked accepted.

### Scenario 19 — Preventive servicing

Use **Kia Forte, DEMO-004**, odometer 54,375 km.

1. Open the vehicle's maintenance record → **Preventive servicing**. Enter a next
   service date, a next service mileage, and repeat intervals of **180** days and
   **5,000**. Press **Save service plan**.
2. Confirm a green **Service plan saved** message appears **and** that the read-back
   panel above the form now shows those four values. The panel is the confirmation; the
   toast is not.
3. Reload the page. The values must still be there.
4. Clear one box and save. It must refuse with a message under that field, in red, and
   must **not** report success.
5. Open **Vehicles → Kia Forte**. The **Service and maintenance** card must show the
   same date, mileage and intervals, with a status badge. Confirm **Compliance** no
   longer has a Next service row.
6. Open **Edit vehicle**. Confirm there is **no** Next service due field. Change
   something trivial and save, then return to the card: **the service plan must be
   unchanged.** This is the data-loss check.
7. Set the date to yesterday and confirm the status reads **Overdue** on both the record
   and the vehicle card, and that the vehicle is **still rentable** — a reminder must
   not take a car off the road.
8. Complete the maintenance. Because the plan recurs on distance, you will be asked for
   a completion odometer; enter **55,200** and set the completion date to **2026-12-10**.
9. Confirm the plan has advanced to **2027-06-08** and **60,200**, on both the record and
   the vehicle card, and that the form boxes show the new values rather than the old.

### Scenario 28 — Maintenance Management dashboard

1. Open **Maintenance**. Confirm eight summary figures and that the reporting period is
   named on screen.
2. Confirm **Actual downtime** shows a duration, **not** "Unavailable". This is the
   check that the migration took effect — it is the one figure that needed it.
3. Step the period back and forward; the period-based figures must change and the state
   counts must not.
4. On **Maintenance records**, use the search and the status, vehicle, category and
   priority filters, and page through.
5. On **Preventive servicing**, confirm vehicles with **no** plan are listed too, with
   **Configure**; a car nobody has planned a service for is the most actionable row on
   the page.
6. Confirm a status shown here matches the same vehicle's status on Vehicle Details.
7. Use **Schedule** from a due row and confirm the vehicle is prepopulated. Confirm that
   a service becoming due did **not** create a maintenance record by itself.

---

## 10. Restrictions — all observed

| Restriction | Status |
|---|---|
| No additional architecture changes | Observed. One deliberate refusal is recorded in §4. |
| No additional migrations | **None created.** `supabase/migrations/` is unchanged. |
| No full test suite repetition | Observed; focused suites only. |
| No unrelated corrections | Observed. |
| No production access or deployment | **Production `ysnumxtzcgzyabrghxwq` was not linked, queried or deployed to.** |
| No force push | Observed; fast-forward verified in advance. |
| Rental Financial Adjustments not begun | Not started. |
| Production hardening backlog preserved | Carried forward unchanged below. |

---

## 11. Outstanding — carried forward, not resolved here

- **Owner manual acceptance of scenarios 19 and 28.** Nothing is accepted.
- `npm run lint` is red on this baseline with **12 pre-existing errors** in
  `incidents/api.ts`, `IncidentNewPage.tsx` and `RentalNewPage.tsx`. Untouched: they are
  outside this package. The four changed files lint clean.
- **Six of nine Edge Functions remain undeployed** on staging (`account-closure`,
  `account-closure-notice`, `gps-provider`, `mfa-reset`, `public-booking`,
  `team-invitations`). Pre-existing; needs its own approval.
- The deployed artifact hash is still **not reproducible by the deploying party** — the
  host rebuilds from source.
- Independent concurrency verification outstanding; PGlite cannot provide two
  independent hosted transactions.
- Assignment activation defaulting ON against the STG-02 contract — owner decision.
- Whether eleven incident and maintenance write RPCs should call
  `app.billing_require_write` — owner decision.

**Production release: NO-GO.**

---

## 12. Rollback

Previous staging tip `0f4fc5e7ce2bd7003f4aa8fea124361933a45b0a`, previously deployed
artifact `9a8ba920d0cbbee1a1c332b8a36e36998d68019652add28f9a34b776005de424`/198 files.

Frontend-only. The migration is applied and is **not** reversed by a frontend rollback;
it adds a function and replaces another with a compatible signature, so the previous
frontend runs against it unchanged.

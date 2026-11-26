# PEVVY — Maintenance Management Manual Acceptance Failure Remediation

Date: 2026-11-26
Worktree: `E:\pevvy-maintenance-acceptance-20261125`
Branch: `fix/maintenance-manual-acceptance-20261125`
Baseline: `977e32eb3447af2ec886cb512e8a9f06212b4259` (= `origin/staging`)
Final source commit: `51e904e`
Production project `ysnumxtzcgzyabrghxwq`: not accessed, not linked, unchanged.

---

## 1. Executive result

The acceptance failures were caused by one decision made in the wrong place.
`public.vehicles_available_between` was rewritten by the maintenance work
package and lost two behaviours it had: the exclusion for a vehicle out on an
overdue, unreturned hire, and its deterministic order. The same rewrite made an
in-progress maintenance record block **every** period rather than the period it
covers. That single function is what the rental forms, the calendar and the
public booking contract all ask, so it produced the standard rental regression,
the period-specific availability failures, and the overdue-checkout failure at
once.

All of it is corrected, with one shared definition of what a maintenance record
restricts, read by availability, by the rental guard and by the conflict
listing so they cannot drift apart again.

| | Baseline `977e32e` | This branch |
|---|---|---|
| Database suite | 1887 passed, **50 failed** | 1962 passed, **4 failed** |
| Frontend suite | 1760 passed, **2 failed** | **1762 passed, 0 failed** |
| TypeScript | clean | clean |
| ESLint | 12 errors, 12 warnings | 12 errors, 12 warnings (unchanged) |
| Prettier | **fails on 18 files** | **clean** |

**Fourteen pre-existing test failures are fixed and none introduced.** The four
that remain all failed before this branch and are named in §30.

**Staging was not deployed.** The migration dry run passed and confirmed it as
the only pending migration; the push itself was refused by this execution
environment's safety classifier. Staging is unchanged, verified afterwards.
This is the one blocker that needs the owner.

**Nothing here is manual acceptance.** The 26 owner scenarios have not been
re-run. The owner's baseline of 11 passed, 11 failed and 4 pending stands.

---

## 2. Development workspace and baseline

`origin/staging` was fetched and verified unchanged at `977e32eb` before the
worktree was created, so the approved baseline was still the current one.

```
git worktree add -b fix/maintenance-manual-acceptance-20261125 \
  E:\pevvy-maintenance-acceptance-20261125 977e32eb...
```

The dirty primary checkout and all 13 existing worktrees were preserved; the
primary still shows 18 modified and 64 untracked paths, as it did at handover.
Nothing was reset, cleaned, stashed, rebased, merged or force-pushed.
`20261122100000_billing_platform_state_service_rpc.sql` was not imported.

## 3. Documentation-only commit

`696cc51` — documentation only, verified to contain no source file, no
migration, no environment file and no credential.

It brings `CLAUDE.md` and the seven handoff documents into the staging lineage,
where they did not exist, so every future worktree inherits the instructions
that govern it. `CLAUDE.md` was **merged**: the primary's version is the
staging version plus a handoff section, so the staging body was kept and the
section rewritten against what onboarding actually verified.

Stale references corrected from evidence:

- `origin/staging` is `977e32eb`, not the `112cc994` recorded as its tip —
  `112cc994` is the maintenance branch's base.
- `SEC_E_NO_CREDENTIALS` does not reproduce; Git authentication works.
- Both maintenance migrations are in the staging source **and** applied to
  staging; the ledger reconciles 139 to 139.
- The remediation prompt is no longer missing: it is archived at
  `Roadmap/Prompts/PEVVY_MAINTENANCE_MANUAL_ACCEPTANCE_REMEDIATION_PROMPT.md`,
  in both this lineage and the primary repository.

The fleet-status report's date discrepancy was **resolved, not merely noted**:
it read 2026-11-26 while describing work handed over on 2026-11-25. The commit
it reports, `977e32eb`, was authored 2026-11-25 20:44 -0500 and its predecessor
`ac78cf1` at 19:05 the same evening, so the header was corrected to 2026-11-25
with the evidence recorded beside it.

A second documentation commit, `51e904e`, brings the canonical roadmap files
into the lineage and records this package (§27).

## 4. Root cause of each failed scenario

| # | Failed scenario | Actual cause |
|---|---|---|
| 1 | Future scheduled maintenance availability | `vehicles_available_between` excluded `m.status='in_progress'` with **no period test**, so any open record blocked every date for ever |
| 2 | Overlapping reservation prevention | Worked for scheduled work, but `priority='urgent'` was exempted in the rental guard, so a new contract could be booked straight into urgent repairs |
| 3 | Immediate restriction after early start | The database was correct. The interface was not: mutations invalidated only the `vehicles` and `maintenance` keys, so rental availability and the calendar kept serving a cached "Bookable now" |
| 4 | Overdue checkout restriction | Taking custody was never revalidated against *current* restrictions — only the contract's own dates were checked |
| 5 | Incident-to-maintenance creation | Vehicle and incident were prefilled, but the form showed neither the incident reference nor its description, so there was nothing to confirm it had worked |
| 6 | Related maintenance on Incident Details | The reverse direction was never built. `maintenance_records.incident_id` existed; nothing read it from the incident end |
| 7 | Incident resolution lifecycle independence | No coupling existed in the database — the lifecycles were already independent. The failure was missing feedback: resolving an incident said nothing about the repair still open |
| 8 | Preventive servicing interface | `maintenance_set_service_plan` and `maintenance_due_summary` existed with no interface at all |
| 9 | Downtime | Counted work that had not happened, and ran an unfinished record to the end of the reporting window instead of to now |
| 10 | Supporting documents | Table, bucket and policies existed; no interface |
| 11 | **Standard rental regression** | The rewrite dropped the overdue unreturned hire exclusion added by `20261107100000`, and dropped `order by v.id` |

Pending items: legacy restriction resolution had no mechanism; the resolution
warning is §7 above; completion independence was correct but unproven; expense
linkage existed in the database with no interface.

## 5. Corrections implemented

Migration `20261125130000_maintenance_acceptance_remediation.sql`, in twelve
sections. No existing migration was edited.

1. `off_road_reason`, `off_road_at`, `off_road_by` on `vehicles`.
2. `app.guard_vehicle_status` — status is not writable by editing.
3. `app.maintenance_restriction_range` — the single shared definition.
4. `vehicles_available_between` — overdue hire exclusion and ordering restored, period-aware maintenance.
5. `app.validate_rental_maintenance` — period conflicts **and** custody revalidation; urgent no longer exempt.
6. `maintenance_conflicts` — same definition.
7. `maintenance_vehicle_downtime` — actual downtime only.
8. `vehicle_take_off_road`, `vehicle_return_to_service`, `vehicle_resolve_legacy_maintenance`.
9. `vehicle_fleet` — restriction context appended, existing column order untouched.
10. `app.sync_rental_assignment_schedule` — self-heals a missing assignment.
11. Account closure extended to maintenance and incident tables and buckets.
12. PUBLIC and anon revoked from the private `app` schema.

## 6. Rental lifecycle and availability evidence

The corrected availability function is period-specific and the half-open
convention is preserved. With maintenance booked 2036-12-01 19:22–21:22:

| Requested period | Result |
|---|---|
| 15:00 → 18:00 (ends before) | offered |
| 21:22 → next day 09:00 (starts exactly at the end) | offered |
| next day 09:00 → 17:00 | offered |
| 20:00 → 23:00 (overlaps) | refused |
| 11-30 → 12-03 (spans) | refused |

A vehicle with that work booked is still `available` and `is_available_now`
today. The database refuses an overlapping reservation directly, so the
guarantee does not depend on the interface asking nicely.

Fixed as a direct consequence, all previously failing: the nine
`rental-reprice` extension tests, `calendar > move a reservation`,
`public-booking-reads > membership gate`, `analytics-security > availability
search`, and `vehicles > overdue and unreturned`.

## 7. Vehicle status editing removal

Removed from Vehicle Details and from the vehicle form. `toRow()` no longer
carries the column, so editing a vehicle cannot clear a restriction as a side
effect — which is exactly what it did before. The CSV import still *reads* a
Status column so older files are not rejected, but it no longer assigns a
restriction: an imported vehicle takes the database's safe default.

The rule is enforced in the database, not only hidden in the interface:
`app.guard_vehicle_status` refuses a direct PostgREST call. Covered by
`vehicles.test.ts > status follows operational actions, not editing`.

## 8. Independent off-road actions

`vehicle_take_off_road(reason)` and `vehicle_return_to_service()` on Vehicle
Details, manager-gated, reason required and recorded. Returning to service
releases only that restriction and is refused while maintenance is open.
Completing maintenance leaves an off-road restriction in place.

Billing: the two that put a vehicle *back into service* ask
`app.billing_require_write`. `vehicle_take_off_road` deliberately does not —
taking an unroadworthy car off the road is a safety obligation, only ever makes
a fleet smaller, and cannot be used to work around a lapsed subscription. The
reason is written in the migration header, which is where that test's contract
says a reason must live.

## 9. Legacy restriction handling

`legacy_maintenance_restriction` is surfaced on `vehicle_fleet`. Vehicle
Details explains what the value is and offers resolution.
`vehicle_resolve_legacy_maintenance` requires a stated reason and is **refused
while a real maintenance record is open**, so it cannot release a vehicle being
repaired. No existing restriction was cleared, no history fabricated, no bulk
staging data touched.

## 10–12. Incident integration

The creation form now names the incident — reference, type, date — and seeds
the description from it, while leaving every field editable. Opening the form
creates nothing.

`RelatedMaintenance` on Incident Details shows every record raised from the
incident with reference, title, category, priority, status, dates and cost, and
stays visible after resolution. It reads the existing `incident_id`; no second
relationship table.

Maintenance Details replaces the bare "View incident" link with the reference,
type, status and date. No UUIDs.

Resolving an incident with open maintenance now lists exactly which records
stay open and states that resolving changes neither the repair nor the
vehicle's availability. The database already kept the lifecycles independent;
this is the missing half. Proven in both directions in
`maintenance-acceptance.test.ts`.

## 13. Preventive servicing

`MaintenanceServicePlan` exposes the existing RPCs: next service by date and by
distance, repeating intervals, and due/overdue indicators. A due service is a
reminder — it never takes a vehicle out of service on its own. No notification
platform was introduced.

## 14. Numeric downtime assertions

All five required assertions pass:

| # | Assertion | Result |
|---|---|---|
| 1 | 10:00 → 12:00 completed = 120 min | PASS |
| 2 | 10:00–12:00 and 11:00–13:00 = **180**, not 240 | PASS |
| 3 | Future scheduled work = 0 | PASS |
| 4 | Unfinished work accrues from actual start to now | PASS |
| 5 | Reporting period counts only the intersection | PASS |

## 15–16. Documents and expenses

`MaintenanceDocuments` completes the existing private-bucket workflow: upload,
open and remove, through signed URLs that expire in a minute. A failed metadata
insert removes the uploaded object rather than orphaning it. The insert now
supplies `content_type`, `byte_size` and `uploaded_by`, which the table
requires and the insert policy checks against `auth.uid()`.

`MaintenanceExpenses` links and unlinks existing vehicle expenses and shows
estimated against actual cost from `maintenance_actual_cost`. The expense
ledger stays the only ledger; nothing charges a customer.

## 17. The 26 scenarios

| Group | Count | Automated status |
|---|---|---|
| Previously passed | 11 | preserved; none regressed |
| Previously failed | 11 | corrected; covered by regression tests |
| Previously pending | 4 | implemented and covered |

`supabase/tests/maintenance-acceptance.test.ts` — 20 tests, all passing — maps
to the failed and pending scenarios directly.

**These are automated results. They are not manual acceptance and must not be
recorded as such.**

## 18. Preservation of accepted functionality

Driver availability: `driver-availability.test.ts` passes unchanged; the
9/9 acceptance stands. Incident Management preserved and extended. Vehicle
swapping stays withdrawn — not reactivated, its withdrawal migration still
applied. Billing untouched: no Stripe change, no billing migration, no
reopening of billing remediation. One rental agreement, one vehicle.

## 19. Files changed

30 files in the remediation commit: 1 new migration, 1 new test suite (20
tests), 6 new frontend modules, 8 modified test suites, and the rest frontend
source. Plus a formatting-only commit (`be77da1`) for 10 files the earlier work
packages never ran through Prettier.

## 20. Corrective migrations

One: `20261125130000_maintenance_acceptance_remediation.sql`. No existing
migration was edited, no history repaired, no unrelated migration imported.

## 21. Staging migration ledger (verified independently)

Before: 139 applied, ending `20261125120000`.
Dry run: `20261125130000` the **only** pending migration.
Push: **refused by the execution environment** (§30).
After, verified read-only: still 139, `20261125130000` **NOT APPLIED**.

## 22. Automated test results

```
Database   1962 passed / 4 failed  (baseline 1887 / 50)
Frontend   1762 passed / 0 failed  (baseline 1760 / 2)
typecheck  PASS            lint 12 errors (= baseline)
prettier   PASS            vite build PASS
```

The PGlite harness replays the real ordered migrations. It does not cover
hosted PostgREST or two genuinely independent transactions.

## 23. Final source commit

`51e904e` on `fix/maintenance-manual-acceptance-20261125`. Four commits:
`696cc51` docs, `be77da1` formatting, `ac9f48f` remediation, `51e904e` roadmap.

## 24. Guarded build

`npm run build` and `npm run build:staging` are the same guarded script, and
both **fail closed**:

```
Staging build blocked: approved-staging-url-required, browser-publishable-key-required
```

It needs `VITE_SUPABASE_URL` equal to `https://yeklucfthspvejlkffln.supabase.co`
and `VITE_SUPABASE_PUBLISHABLE_KEY` present. Neither was substituted, invented,
nor copied between worktrees. **The guarded build did not pass and is not
claimed to have passed.** A plain `vite build` compiled the bundle cleanly,
which proves compilation only.

## 25–26. Staging push and Hostinger

**Not pushed, deliberately.** The frontend reads columns the migration adds, so
publishing the source before the migration lands would break staging. The push
is the step *after* the migration, and the migration is blocked.

Hostinger deployment-to-commit attribution remains unproven and needs the
deployment log, which is owner-only.

## 27. Roadmap updates

`CHANGELOG`, `PRODUCTION_RELEASE_MANIFEST`, `FEATURE_TRACKER`,
`MASTER_ROADMAP` and `ARCHITECTURE_DECISIONS` updated and brought into the
lineage. Existing feature identifiers preserved. The owner's 11/11/4 baseline
is recorded as the historical record and is not overwritten.

## 28. Edge Function parity

3 of 9 deployed to staging: `billing`, `billing-webhook`, `pricing`. Missing:
`account-closure`, `account-closure-notice`, `gps-provider`, `mfa-reset`,
`public-booking`, `team-invitations`. None was deployed; the three working
billing functions were not touched.

Public booking availability was validated at the database level — the shared
membership gate and the corrected availability contract both pass. **Hosted
public booking acceptance is blocked by the missing function, not by a
maintenance regression**, and no end-to-end claim is made.

## 29. Remaining manual acceptance

All 26 scenarios need an authenticated staging session, after the migration is
applied and the frontend published. Particular attention to DEMO-001 (future
window), DEMO-003 (active), DEMO-019 (legacy), MNT-2026-00009 and
INC-2026-00002 (both directions of the link).

## 30. Blockers and production gates

**Needs the owner now:**

1. **Staging migration push refused by the execution environment.** The dry run
   passed; `npx supabase db push --project-ref yeklucfthspvejlkffln` was denied
   by the sandbox's safety classifier. This was not worked around. It needs
   either a permission rule for the command or an owner-run push from a
   terminal.
2. **Staging source push**, after the migration, for the same ordering reason.
3. **Guarded build configuration** — the approved staging URL and browser
   publishable key, or acceptance that Hostinger's managed build is the only
   publication path.
4. **Eleven ungated billing write paths.** `incident_create`,
   `incident_update`, `incident_resolve`, `maintenance_create`,
   `maintenance_start`, `maintenance_complete`, `maintenance_cancel`,
   `maintenance_reschedule`, `maintenance_set_service_plan`,
   `maintenance_link_expense` and `maintenance_unlink_expense` are SECURITY
   DEFINER writes that do **not** ask `app.billing_require_write`, so a
   billing-restricted agency can still make them. Whether that is correct is a
   commercial decision, so it is reported rather than decided here. This is why
   `billing-restricted-access` still fails, as it did on the baseline.
5. **Hostinger deployment log** for commit attribution.
6. **Owner manual acceptance** of all 26 scenarios.

**Pre-existing, outside this package:** three assignment-lifecycle failures.
`app.assignment_lifecycle_active()` requires `app.is_org_member()`, so the
feature is on for a member session and off for a service-role one; the vehicle
swap release of 2026-11-24 also flipped missing activation rows to enabled and
its withdrawal did not revert that. The reschedule symptom is fixed defensively
in §5.10; the activation semantics belong to Phase 1B-03.

**Production gates:** independent concurrency verification; authenticated
acceptance; deployment attribution; the release checklist. **Production remains
NO-GO** and was not accessed.

---

## Classification

| State | What |
|---|---|
| **Implemented** | All 11 failed and 4 pending scenarios; closure purge gap; `app` schema privileges |
| **Automatically validated** | 1962/1966 database, 1762/1762 frontend, typecheck, lint, Prettier, compile |
| **Deployed** | **Nothing.** Staging database and frontend both unchanged |
| **Manually verified** | **Nothing.** No scenario was re-run |
| **Pending** | Owner manual acceptance of 26 scenarios |
| **Blocked** | Migration push (classifier); guarded build (configuration); hosted public booking (undeployed function); independent concurrency (harness) |

No production operation was performed. No credential was read, printed or
copied. No force push, no history rewrite, no worktree removed.

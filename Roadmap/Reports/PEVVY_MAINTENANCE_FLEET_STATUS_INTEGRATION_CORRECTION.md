# PEVVY Maintenance / Fleet Status Integration Correction

Date: 2026-11-25  
> Header date corrected 2026-11-26. It read 2026-11-26 while describing
> work handed over on 2026-11-25. The commit it reports, `977e32eb`, was
> authored 2026-11-25 20:44 -0500, and its predecessor `ac78cf1` at 19:05
> the same evening, so 2026-11-25 is the date the work was actually done.  
Staging project: `yeklucfthspvejlkffln`  
Production project: `ysnumxtzcgzyabrghxwq` — not accessed or modified  
Staging URL: https://quantum-lavenderblush-buffalo-97.hostingersite.com

## Executive result

The observed status inconsistency was corrected in the isolated maintenance
worktree. Maintenance records now participate in the authoritative
`vehicle_fleet` effective status projection. Active maintenance displays as
maintenance and is not bookable; future maintenance remains available outside
its window while showing upcoming context. The legacy manual maintenance
toggle is no longer offered and direct attempts to start/clear maintenance
through the vehicle status path are guarded.

The corrective migration was applied to staging and source was pushed normally.
The public Hostinger entrypoint now returns HTTP 200 and its served JavaScript
contains Maintenance and Incident Management markers, no production project
reference, and no withdrawn vehicle-swap markers. Authenticated browser
acceptance and exact Hostinger-to-commit attribution remain pending.

## Root cause

`vehicle_fleet` previously calculated effective status from the legacy vehicle
status enum and rental custody only. It did not read active or scheduled
maintenance records, so backend availability rejection could coexist with
Fleet and Vehicle Details showing Available / Bookable now. The Vehicle
Details operational dropdown also exposed `maintenance` as a manual status,
creating a second lifecycle path.

## Corrections implemented

- Added `20261125120000_maintenance_fleet_status_integration.sql`.
- Extended `vehicle_fleet` without changing existing column order, appending
  active/upcoming maintenance context and maintenance-overdue state.
- Effective status now accounts for archival, legacy operational restrictions,
  active rental custody, reservations, active/due maintenance, and upcoming
  maintenance context.
- Added `vehicles_maintenance_status_guard` to prevent direct maintenance
  start/clear bypasses; Maintenance Management remains the lifecycle authority.
- Fleet table/card context displays maintenance references and upcoming service.
- Vehicle Details displays active/upcoming maintenance, actual status context,
  expected completion, and links to Maintenance Details.
- Removed the standalone `In maintenance` option from Vehicle Details; the
  independent unavailable/off-road path remains available.
- Added early-start confirmation before starting future scheduled maintenance.
- Maintenance Details now shows scheduled, actual start, actual completion,
  expected completion, overdue state, and incident link context.
- Added Incident Details → Create maintenance, preserving optional incident
  association and same-vehicle validation.
- Maintenance lifecycle mutations invalidate maintenance and vehicle query
  trees so Fleet and Vehicle Details refresh together.

## Operational behavior

- Future scheduled maintenance does not make a vehicle unavailable outside its
  window; overlapping reservations remain blocked by the existing availability
  enforcement.
- Explicit early start immediately activates the restriction after confirmation.
- In-progress maintenance remains restrictive after expected completion and is
  marked overdue; it is not auto-completed or auto-released.
- Completion releases only that maintenance record. Other maintenance,
  off-road status, legacy restrictions, rental custody, and other operational
  restrictions remain authoritative.
- No rental is cancelled, completed, returned, substituted, or modified.
- Urgent maintenance remains an explicit exception path with conflict visibility;
  it does not mutate rental custody or customer charges.

## Validation

PGlite, using the existing ordered migration harness:

```text
node node_modules\\vitest\\vitest.mjs run supabase/tests/maintenance-management.test.ts supabase/tests/driver-availability.test.ts supabase/tests/incident-management.test.ts supabase/tests/rentals.test.ts src/features/vehicles/components/vehicle-components.test.tsx --pool=threads --maxWorkers=1 --configLoader=runner
PASS — 5 files, 105 tests
```

This validates migration application, maintenance lifecycle, fleet projection
compatibility, tenant isolation, RLS contracts, incidents, rentals, driver
availability, and vehicle UI components. PGlite does not prove independent
concurrent hosted transactions; that remains a production release requirement.

TypeScript no-emit checks for app, node, and test projects: PASS. Focused
ESLint for changed maintenance, fleet, vehicle, incident and routing files:
PASS. Git diff validation: PASS.

Numeric downtime logic remains in `maintenance_vehicle_downtime`, which clips
intervals and merges overlap before summing minutes. The existing maintenance
contract test validates reminder/RLS surfaces; a dedicated staged numeric
downtime assertion and authenticated manual acceptance remain pending.

## Staging database

Existing migration `20261125110000_maintenance_management.sql` remained applied.
The corrective dry run reported exactly one pending migration:

```text
20261125120000_maintenance_fleet_status_integration.sql
```

Application succeeded with `supabase db push --project-ref yeklucfthspvejlkffln`.
The apply response identified `20261125120000` as applied. A subsequent
standalone `supabase migration list` was blocked by the local CLI telemetry
file permission (`C:\Users\Oni\.supabase\telemetry.json.tmp...`), so the
post-apply ledger read is recorded as **UNVERIFIED**, not claimed as an
independent pass. The pre-apply ledger confirmed Incident Management and
Driver Availability migrations were already applied. No staging records were
modified and no production operation occurred.

## Source and frontend deployment

- Worktree: `E:\pevvy-maintenance-20261125`
- Branch: `feat/maintenance-management-20261125`
- Final commit: `977e32eb3447af2ec886cb512e8a9f06212b4259`
- Push: normal fast-forward `ac78cf1..977e32e` to `origin/staging`
- Production reference in served entrypoint: absent
- Withdrawn swap markers in served entrypoint: absent
- Hostinger HTTP status: 200
- Latest observed entrypoint: `assets/index-D7BWP9QL.js`
- Hostinger deployment identifier: unavailable

Local `npm run build:staging` remains blocked because the managed execution
environment does not inherit the approved staging browser URL and publishable
key. No production configuration or credential was substituted. Hostinger's
managed build may therefore differ from local guarded-build evidence and must
be confirmed in its deployment log.

## Manual acceptance checklist

Pending authenticated staging-owner verification:

1. DEMO-003 active maintenance shows In maintenance, no Bookable now, and links to the active record.
2. DEMO-019 completed maintenance preserves any valid legacy/off-road restriction until explicitly resolved.
3. DEMO-001 future maintenance remains available before its window; overlapping reservation is blocked.
4. Starting DEMO-001 early prompts, preserves scheduled dates, records actual start, and immediately restricts checkout.
5. Overdue in-progress maintenance remains restricted and visibly overdue.
6. Completing one of multiple records does not release the vehicle while another restriction remains.
7. Incident Details → Create maintenance pre-populates vehicle/incident; optional standalone maintenance still works.
8. Related maintenance is visible from the maintenance record and incident relationship remains independent of incident resolution.
9. Actual downtime and overlapping downtime totals are verified numerically.
10. Authorized maintenance document upload/download and cross-tenant denial are verified.

## Final classification

- Corrective implementation: **IMPLEMENTED**
- Automated validation: **PASS**
- Staging database correction: **DEPLOYED / PASS**
- Git staging push: **PASS**
- Hostinger publication: **PUBLISHED HTTP 200 / commit attribution UNVERIFIED**
- Authenticated manual acceptance: **PENDING**
- Independent concurrency verification: **BLOCKED / production gate**
- Production deployment: **NO-GO**

Driver Availability remains owner-accepted at 9/9 manual tests, with independent
concurrency still pending. Rental Financial Adjustments remains the next work
package and was not started.

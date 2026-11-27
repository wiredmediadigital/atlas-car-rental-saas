# Feature tracker

| Feature | Status | Evidence |
|---|---|---|
| Maintenance Management | Corrective integration implemented; migrations applied; live entrypoint published and authenticated acceptance pending | `977e32e`, `20261125120000_maintenance_fleet_status_integration.sql` |
| Driver availability | Manual acceptance 9/9 PASS; independent concurrency outstanding | Prior staging evidence |
| Incident Management | Preserved | Staging baseline |
| Billing | Preserved | Base `112cc994` |
| Rental Financial Adjustments | Next planned package | Not implemented here |

Roadmap identifiers P3-05 (maintenance work orders), P3-06 (repair expenses),
and P3-07 (vehicle downtime) are implemented locally and database-validated;
manual staging acceptance remains open. P0-02 and P0-04 remain gated by their
existing production-readiness requirements.

The approved architecture now derives maintenance-related effective vehicle
status from maintenance records and operational restrictions, not a standalone
manual maintenance toggle. Incident Details provides the primary Create
maintenance workflow; incident association remains optional.

## Maintenance acceptance remediation — 2026-11-26

| Feature | Status | Evidence |
|---|---|---|
| Maintenance Management | Acceptance failures remediated in source; staging deployment blocked; owner acceptance not re-run | `ac9f48f`, `20261125130000_maintenance_acceptance_remediation.sql` |
| Standard rental lifecycle | Availability regression corrected; 14 previously failing tests now pass | `supabase/tests/maintenance-acceptance.test.ts` |
| Vehicle operational status | No longer editable; restrictions applied and released by named actions | `app.guard_vehicle_status` |
| Account closure | Extended to maintenance and incident tables and their three private buckets | `supabase/tests/account-closure-purge.test.ts` |
| Driver availability | Manual acceptance 9/9 preserved; independent concurrency outstanding | Unchanged by this package |
| Incident Management | Reverse relationship, resolution warning and lifecycle independence completed | `RelatedMaintenance.tsx` |
| Billing | Preserved; eleven ungated write RPCs reported, not changed | Owner decision outstanding |
| Rental Financial Adjustments | Not started | Next package |

The owner's acceptance baseline of 11 passed, 11 failed and 4 pending is the
historical record and is not superseded by any automated result here.

## Maintenance Management — 2026-11-26

| Field | Value |
|---|---|
| Status | Deployed to staging; **awaiting owner manual acceptance** |
| Staging commit | `caf6cd1452ed1060e010ebdd1f30daf737f364eb` |
| Migration | `20261125130000_maintenance_acceptance_remediation.sql`, applied |
| Automated coverage | `supabase/tests/maintenance-acceptance.test.ts`, 22 tests |
| Acceptance baseline | 11 passed / 11 failed / 4 pending — **unchanged, not re-run** |
| Production | NO-GO |

Related: incident/maintenance integration, vehicle restriction actions
(`vehicle_take_off_road`, `vehicle_return_to_service`,
`vehicle_resolve_legacy_maintenance`), preventive servicing, maintenance documents and
expense links, and the CSV import restriction safeguard.

## Preventive servicing deployment closure — 2026-11-26

| Area | State | Evidence |
|---|---|---|
| Preventive servicing | Correction deployed to staging; **scenario 19 awaiting owner acceptance** | `dd01c82`, `20261126120000_maintenance_service_plan_advancement.sql` applied |
| Maintenance dashboard | Deployed; downtime tile operational; **scenario 28 awaiting owner acceptance** | `maintenance_fleet_downtime` live, `42501` probe |
| Fleet CSV export | `Next service` column now reads the authoritative plan; contract unchanged, 33 columns | `src/features/vehicles/export.ts`, 7 new tests |
| Migration ledger | 141 local / 141 applied / zero drift | `supabase migration list --linked` |
| Rental Financial Adjustments | Not started | Next package |

| Field | Value |
|---|---|
| Status | Deployed to staging; **awaiting owner manual acceptance** |
| Staging commit | `dd01c82c2e1da56edcb143c9186d9b6f3feae323` |
| Deployed artifact | `e4c58644…`, 199 files, verified by content |
| Acceptance register | 26 passed / 1 failed / 0 untested — **unchanged, not re-run** |
| Production | NO-GO |

The owner's acceptance baseline of 11 passed, 11 failed and 4 pending remains the
historical record and is not superseded by any automated result here.

## Maintenance Management — FUNCTIONALLY ACCEPTED, CLOSED (2026-11-26)

| Field | Value |
|---|---|
| Status | **FUNCTIONALLY ACCEPTED — CLOSED** |
| Owner final acceptance | **28 scenarios / 28 passed / 0 failed / 0 pending**, no observations |
| Last two confirmed | Scenario 19 preventive servicing; scenario 28 dashboard |
| Accepted staging commit | `131ac9a0fbb8f82787c0a17079d042c7c5bb37d0` |
| Migrations | through `20261126120000`, 141 applied, zero drift |
| Scope | **Frozen** — not reopened without an identified regression |
| Production | **NO-GO** — functional acceptance is not deployment authorization |

| Area | State | Evidence |
|---|---|---|
| Authoritative service plan architecture | Accepted | `src/lib/compliance/service.ts`, `maintenance_set_service_plan` |
| Maintenance Management dashboard | Accepted | scenario 28 PASS |
| Maintenance expense integration | Accepted | preserved through the servicing work |
| Fleet availability integration | Accepted | `app.maintenance_restriction_range` |
| Incident Management dashboard | **Next package** | design reference: the accepted Maintenance dashboard |
| Rental Financial Adjustments | Not started | after owner acceptance of the Incident dashboard |

The owner's interim 11 passed / 11 failed / 4 pending baseline is superseded by this final
acceptance and is preserved as history in `Handoff/KNOWN_ISSUES_AND_ACCEPTANCE.md`.

## Incident Management dashboard — 2026-11-26

| Field | Value |
|---|---|
| Status | Deployed to staging; **scenario 29 awaiting owner acceptance** |
| Staging commit | `b163cc63d3375d4e606e152d5a1e48cabb21fb7a` |
| Deployed artifact | `ff41ee11…`, 199 files, verified by content |
| Migration | **none** — frontend only |
| Accepted incident functionality | **not reopened** |
| Production | NO-GO |

| Area | State | Evidence |
|---|---|---|
| Incident dashboard summary | Six figures, period vs current state distinguished | `src/features/incidents/dashboard.ts` |
| Incident records table | Eight columns, business identifiers, responsive | `IncidentTable.tsx` |
| Search and filtering | Reference, vehicle, rental, customer, free text; seven filters; All time | `IncidentToolbar.tsx` |
| Maintenance integration | Counts per incident, outstanding flagged, lifecycles independent | `fetchIncidentMaintenanceLinks` |
| Tenant isolation | Proved in both directions for both new reads | `supabase/tests/incident-dashboard.test.ts` |
| Rental Financial Adjustments | **Not started** — after owner acceptance of scenario 29 | — |

## Incident Management — FUNCTIONALLY ACCEPTED, CLOSED (2026-11-26)

| Field | Value |
|---|---|
| Status | **FUNCTIONALLY ACCEPTED — CLOSED** |
| Owner result | **Scenario 29 PASS**, 13/13 verification items, no observations |
| Accepted staging commit | `b163cc63d3375d4e606e152d5a1e48cabb21fb7a` |
| Deployed artifact | `ff41ee11…`, 199 files, verified by content |
| Migration | **none** — frontend only |
| Scope | **Frozen** — not reopened without an identified regression |
| Production | **NO-GO** — functional acceptance is not deployment authorization |

| Area | State |
|---|---|
| Maintenance Management | ACCEPTED — CLOSED, 28/28, frozen |
| Incident Management incl. dashboard | ACCEPTED — CLOSED, scenario 29 at 13/13, frozen |
| Driver availability / conflict prevention | Accepted 9/9; independent concurrency still a gate |
| Rental Financial Adjustments | **Not started; no work package supplied yet** |

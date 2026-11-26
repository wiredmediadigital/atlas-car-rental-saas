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

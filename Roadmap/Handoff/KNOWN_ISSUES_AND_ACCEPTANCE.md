# Known issues and acceptance

## Owner acceptance

Driver availability: **9/9 scenarios passed**. Preserve it; independent concurrent-session evidence remains a release gate.

Maintenance Management: **FUNCTIONALLY ACCEPTED — CLOSED (2026-11-26).** Owner final
manual acceptance: **28 scenarios, 28 passed, 0 failed, 0 pending, no owner observations.**
Scenario 19 (preventive servicing) and scenario 28 (Maintenance Management dashboard) were
the last two confirmed, both PASS.

Accepted as functionality: the authoritative service plan architecture, the Maintenance
Management dashboard, maintenance expense integration, and fleet availability integration.

**Functional acceptance is not production deployment authorization.** Maintenance
Management remains **production NO-GO** and every gate in
`RoadMapFiles/PRODUCTION_RELEASE_CHECKLIST.md` stands unchanged. Scope is frozen: do not
reopen Maintenance Management for enhancements, architectural changes or further testing
unless an actual regression is identified.

### Superseded interim result, preserved

Retained as the historical record. Superseded by the 28/28 final acceptance above; it must
not be quoted as the current state.

> Maintenance Management: **NO-GO for production**. Owner result: 26 scenarios, 11 passed, 11 failed, 4 pending.

Passed: fleet status synchronization; active-maintenance presentation; removal of standalone In maintenance from Vehicle Details; early-start confirmation and cancellation; actual timestamps; completion restoring eligible availability; multiple restrictions; independent off-road restrictions; optional incident association; and automatic Fleet/Vehicle Details refresh.

Failed: future scheduled availability; overlapping reservation prevention; immediate restriction after early start; overdue checkout restriction; incident-to-maintenance creation and prepopulation; related maintenance on Incident Details; incident-resolution lifecycle independence; preventive servicing interface; downtime presentation; supporting documents; and standard rental regression.

Pending: legacy restriction resolution; incident resolution warning; maintenance completion independence; expense integration.

Additional defects: Vehicle Details has an Operational status dropdown; Edit Vehicle has the legacy Status dropdown; Maintenance Details has a generic View incident link; Incident Details lacks related maintenance records. Relevant examples: MNT-2026-00009, INC-2026-00002, and DEMO-004.

The prior automated result of **105 passed** is recorded in reports, but it does not establish manual acceptance. Do not infer root causes without evidence.

Every failure, pending item and additional defect listed above was subsequently remediated
and then confirmed by the owner in the 28/28 final acceptance. They are kept here because
the path to acceptance is part of the record, not because any of them is still open.

## Release interpretation

Local tests are not hosted acceptance. A staging migration is not frontend publication. HTTP 200 is not authenticated acceptance. Production remains NO-GO until defects, deployment attribution, authenticated acceptance, independent concurrency where required, and the release checklist are closed.

Relevant evidence: `Roadmap/Reports/PEVVY_MAINTENANCE_MANAGEMENT_DEPLOYMENT_CLOSURE.md`, `PEVVY_MAINTENANCE_FLEET_STATUS_INTEGRATION_CORRECTION.md`, `PEVVY_DRIVER_AVAILABILITY_DEPLOYMENT_CLOSURE.md`, and `PEVVY_INCIDENT_MANAGEMENT_UI_CORRECTIONS.md`.

Final acceptance evidence: `Roadmap/Reports/PEVVY_MAINTENANCE_MANAGEMENT_FINAL_ACCEPTANCE.md`,
with the two closing deployments in `PEVVY_PREVENTIVE_SERVICING_FINAL_CORRECTION.md` and
`PEVVY_PREVENTIVE_SERVICING_DEPLOYMENT_CLOSURE.md`.

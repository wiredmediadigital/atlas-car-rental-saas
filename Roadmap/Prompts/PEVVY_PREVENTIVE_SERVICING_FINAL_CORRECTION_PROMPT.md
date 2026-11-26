# PEVVY — PREVENTIVE SERVICING INTEGRATION AND FINAL ACCEPTANCE CORRECTION

> Archived verbatim on 2026-11-26, including the Maintenance Management Dashboard
> addendum. The result is recorded in
> `Roadmap/Reports/PEVVY_PREVENTIVE_SERVICING_FINAL_CORRECTION.md`.

## 1. Objective

Maintenance Management has achieved 26 of 27 owner acceptance scenarios.

The only failed scenario is:

19 — Preventive servicing.

All other maintenance, rental, incident and expense workflows are accepted.

Correct preventive servicing without reopening previously accepted functionality.

## 2. Owner-reported issues

The owner configured date-based and mileage-based service plans but reported:

- Clicking Save service plan produces no visible confirmation.
- Saved service information is not visible elsewhere.
- Upcoming and overdue service indicators are missing.
- Next-service information is not reflected in Vehicle Details.
- Edit Vehicle still contains a separate Next service due field.
- Vehicle Details displays Next service under Compliance with No date recorded.

Example vehicle:

Kia Forte — DEMO-004

Current odometer: 54,375 km.

Investigate whether the service plan is actually persisted, whether the mutation fails silently, whether the saved plan is not retrieved, or whether the existing interfaces read different data sources.

Do not assume the root cause.

## 3. Approved architectural direction

Maintenance Management must be the authoritative source of preventive servicing requirements.

Reuse the existing service plan tables, RPCs, queries and maintenance architecture.

Do not introduce a second service reminder system.

There must not be two independently editable next-service dates.

## 4. Correct Save service plan

Ensure the existing service plan form:

- Correctly loads an existing saved plan.
- Supports date-based servicing.
- Supports mileage-based servicing.
- Supports both thresholds together.
- Supports recurring day intervals.
- Supports recurring mileage intervals.
- Validates dates, mileage and intervals.
- Shows a saving state.
- Prevents duplicate submissions.
- Displays meaningful validation or backend errors.
- Displays explicit success confirmation.
- Retains saved values after successful submission.
- Reloads saved values after browser refresh.
- Refreshes all affected service information.

Do not display a success message unless persistence succeeds.

## 5. Remove duplicate vehicle service editing

Remove Next service due from the general Edit Vehicle form.

Inspect Add Vehicle and other general vehicle forms for equivalent duplicate controls.

Retain insurance, inspection, registration, odometer and other existing vehicle fields.

General vehicle editing must not overwrite or clear the authoritative service plan.

Inspect the existing legacy next-service date field and its consumers.

Preserve existing service dates.

Where a legacy date exists without an authoritative service plan, implement a compatible transition or fallback using the existing architecture.

Do not silently discard existing dates.

Do not overwrite a configured service plan with a conflicting legacy date.

Document how conflicting existing values are handled.

## 6. Vehicle Details integration

Remove Next service from the Compliance section.

Retain insurance, technical inspection, registration and road tax in Compliance.

Add a Service and Maintenance card using existing Pevvy components.

Display:

- Current odometer.
- Next service date.
- Next service mileage.
- Days remaining or overdue.
- Distance remaining or overdue.
- Recurring service intervals.
- Current service status.
- Manage service plan action.

The Manage service plan action must open the existing preventive servicing interface for the selected vehicle.

Display an informative empty state when no plan is configured.

Do not create a second editing form.

## 7. Service status

Calculate service status from the authoritative saved plan and current vehicle odometer.

Support:

- Not configured.
- Up to date.
- Due soon.
- Due.
- Overdue.

When both date and mileage thresholds exist, the first threshold reached determines the service requirement.

Use existing warning thresholds if already established.

Otherwise use default warning thresholds of:

- 30 days.
- 500 km.

Centralize status calculation so Maintenance Management and Vehicle Details cannot disagree.

Respect existing organization timezone and distance unit conventions.

## 8. Maintenance Management visibility

Expose upcoming and overdue service requirements within the existing Maintenance Management interface.

Use existing list, filter and summary components where appropriate.

Operators must be able to identify:

- Vehicle.
- Service requirement.
- Next service date.
- Next service mileage.
- Current service status.

Do not create a separate navigation module.

Do not introduce an external notification platform.

## 9. Recurring service calculation

Inspect the existing maintenance completion and service plan advancement behaviour.

When qualifying preventive maintenance is completed, calculate the next service thresholds from the applicable actual completion date and verified service odometer.

Example:

- Completion date: December 10, 2026.
- Service odometer: 55,200 km.
- Recurring interval: 180 days.
- Recurring mileage: 5,000 km.

Expected:

- Next service date: June 8, 2027.
- Next service mileage: 60,200 km.

Use existing service category and completion relationships.

Unrelated maintenance must not reset the service plan.

Repeated completion requests must not advance the plan twice.

Do not invent a service odometer if it was not recorded.

Use the existing odometer workflow or require an appropriate verified reading where necessary.

## 10. Preserve operational independence

Preventive servicing reminders are informational.

A due or overdue service reminder must not automatically:

- Take a vehicle off the road.
- Change maintenance status.
- Cancel a rental.
- Block rental availability.
- Complete maintenance.
- Resolve an incident.
- Create an expense.

Actual maintenance and existing authorized operational restrictions continue controlling vehicle availability.

Preserve all previously accepted rental and maintenance behaviours.

## 11. Focused validation

Verify:

1. Saving a date-only service plan.
2. Saving a mileage-only service plan.
3. Saving a combined service plan.
4. Recurring interval persistence.
5. Success and failure feedback.
6. Saved values surviving browser refresh.
7. Vehicle Details reflecting the saved plan.
8. Upcoming service indicators.
9. Overdue service indicators.
10. Date and mileage threshold boundaries.
11. First-threshold servicing logic.
12. Qualifying maintenance advancing the service plan.
13. Unrelated maintenance not advancing the plan.
14. Repeated completion not advancing the plan twice.
15. Legacy service date preservation.
16. General vehicle editing not clearing service information.
17. Tenant isolation and authorization.
18. Rental availability remaining unaffected by reminders alone.

Run focused regression tests, TypeScript and changed-file lint validation.

Do not repeat the entire repository test suite.

## 12. Staging deployment

Use the latest verified origin/staging baseline.

Last owner-reported staging commit:

0766e82

Verify the actual remote reference before implementation.

Preserve the existing maintenance expense enhancement.

The staging migration ledger previously reconciled at 140 migrations.

Prefer existing backend capabilities.

Create a corrective migration only if genuinely necessary.

Do not rewrite applied migrations.

If a migration is required, validate it and use the established owner-execution procedure where database deployment restrictions remain.

Use the existing guarded staging build and normal fast-forward staging deployment.

Verify the corrected frontend assets are live.

No production access or deployment.

## 13. Acceptance register

Record:

- 26 passed.
- 1 failed.
- 0 untested.

Scenario 19 remains failed until the owner manually verifies the correction.

Do not reopen the other 26 accepted scenarios without evidence of a regression.

Preserve the separate production hardening backlog.

Do not begin Rental Financial Adjustments.

## 14. Final report

Save to:

E:\pevvy-car-rental-saas-main\Roadmap\Reports\PEVVY_PREVENTIVE_SERVICING_FINAL_CORRECTION.md

Archive this prompt to:

E:\pevvy-car-rental-saas-main\Roadmap\Prompts\PEVVY_PREVENTIVE_SERVICING_FINAL_CORRECTION_PROMPT.md

Report:

- Actual root cause.
- Service plan persistence evidence.
- Authoritative service data source.
- Legacy date handling.
- Vehicle Details integration.
- Recurring service calculation.
- Focused test results.
- Migration requirements.
- Final source commit.
- Staging deployment evidence.
- Remaining manual acceptance steps.

Complete implementation and staging deployment in one execution wherever possible.

Do not return an assessment-only report or introduce unrelated architectural changes.

# ADDENDUM — MAINTENANCE MANAGEMENT DASHBOARD

Include this enhancement within the current Preventive Servicing final correction work package.

The existing Maintenance page is a basic list of maintenance records with no operational dashboard, search, filtering or fleet-wide preventive servicing visibility.

## 1. Enhance the existing Maintenance page

Retain the existing navigation route and Schedule maintenance action.

Add operational summary cards for:

- Scheduled maintenance.
- In-progress maintenance.
- Completed maintenance.
- Service due soon.
- Service overdue.
- Unique vehicles currently in maintenance.
- Actual maintenance expenditure for the selected period.
- Actual maintenance downtime for the selected period.

Use actual tenant-scoped data.

Reuse existing expense aggregation and downtime calculation mechanisms.

Do not double-count expenses, vehicles or overlapping downtime.

Summary cards should apply relevant filters where appropriate.

Clearly identify the reporting period.

## 2. Maintenance records tab

Replace the current basic records list with the existing Pevvy table and filtering components.

Include:

- Maintenance reference.
- Vehicle name and identifier.
- Description.
- Category.
- Priority.
- Scheduled date.
- Expected completion.
- Actual cost.
- Status.
- Relevant actions.

Support search, status, vehicle, category, priority and date filters.

Reuse existing pagination conventions.

Preserve existing maintenance detail navigation and lifecycle actions.

## 3. Preventive servicing tab

Add a second tab within the existing Maintenance page.

Display fleet-wide preventive servicing information, including vehicles without configured service plans.

Include:

- Vehicle name and identifier.
- Current odometer.
- Next service date.
- Next service mileage.
- Days remaining or overdue.
- Distance remaining or overdue.
- Service status.

Provide appropriate actions:

- Configure service plan.
- Edit service plan.
- View vehicle.
- Schedule maintenance.

Reuse the authoritative service plan form and status calculation specified in the main correction prompt.

Do not introduce another service plan editor or data source.

When scheduling maintenance from a service requirement, prepopulate the vehicle and relevant preventive maintenance context.

Do not automatically create maintenance records merely because a service becomes due.

## 4. Integration

Vehicle Details must display the same authoritative service information as the Maintenance dashboard.

Remove the duplicate Next service due editing field from general vehicle forms, as specified in the main correction prompt.

Preserve existing legacy service dates.

Ensure saved service plans and maintenance changes refresh affected dashboard metrics and Vehicle Details.

## 5. Restrictions

- No separate navigation module.
- No duplicate maintenance architecture.
- No new reporting engine.
- No unnecessary database migration.
- No automatic rental restrictions from service reminders alone.
- No changes to accepted expense, incident or rental workflows.
- No production access or deployment.
- No unrelated feature implementation.

Use existing Pevvy design components and responsive layout conventions.

Include focused dashboard and service plan integration tests.

Complete this enhancement as part of the current Preventive Servicing correction, using the same report and staging deployment process.

Update the final report to include dashboard implementation, metric definitions, filtering, service plan persistence and manual acceptance instructions.

Preserve the existing 26 accepted scenarios. Record dashboard acceptance as scenario 28, separate from scenario 19 — Preventive servicing.

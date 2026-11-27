# PEVVY — INCIDENT MANAGEMENT DASHBOARD ENHANCEMENT

> Archived verbatim on 2026-11-26. The report answering it is
> `Roadmap/Reports/PEVVY_INCIDENT_MANAGEMENT_DASHBOARD_ENHANCEMENT.md`.

## 1. Objective

Enhance the existing Incidents page to match the design, structure and operational usability of the newly implemented Maintenance Management dashboard.

Incident Management functionality has already been accepted by the owner.

This work package is a dashboard and presentation enhancement, not a redesign of the existing incident architecture.

## 2. Design consistency

Use the existing Maintenance dashboard as the primary design reference.

Reuse its established:

- Page layout and spacing.
- Summary cards.
- Typography.
- Status indicators.
- Table components.
- Search controls.
- Filter drawer.
- Date navigation.
- Pagination.
- Loading and empty states.
- Responsive layout conventions.

Retain the existing Incidents navigation route and Report incident action.

Do not introduce a separate navigation module.

## 3. Dashboard summary cards

Implement six summary cards:

1. Total incidents.
2. Open incidents.
3. Resolved incidents.
4. Unique vehicles affected by open incidents.
5. Rental-related incidents.
6. Incidents with outstanding maintenance.

Use actual tenant-scoped data.

Clearly distinguish reporting-period metrics from current operational metrics.

Open incidents and outstanding maintenance must remain discoverable regardless of the original incident date.

Count distinct vehicles and incidents where appropriate.

Do not double-count incidents with multiple maintenance records.

Summary cards should apply corresponding filters.

Do not calculate fleet-wide totals from a partially loaded or paginated dataset.

## 4. Incident records table

Replace the existing basic list with a structured table.

Include:

- Incident reference.
- Vehicle name and identifier.
- Incident type.
- Associated rental reference.
- Associated customer.
- Responsibility.
- Incident date.
- Related maintenance summary.
- Incident status.
- Relevant authorized actions.

Use readable business identifiers instead of UUIDs.

Preserve existing Incident Details navigation.

Use responsive column presentation consistent with other Pevvy tables.

## 5. Search and filtering

Support:

- Incident reference.
- Vehicle name and plate.
- Rental reference.
- Customer name.
- Incident type.
- Incident status.
- Responsibility.
- Incident date range.
- Outstanding maintenance.

Reuse the Maintenance dashboard filter drawer and date navigation components where appropriate.

Provide an All time option or equivalent means of discovering historical unresolved incidents.

Provide clear filter reset functionality.

## 6. Maintenance integration

Use the existing incident-to-maintenance association.

Display related maintenance counts and indicate whether outstanding maintenance exists.

Support navigation to the associated maintenance records through existing routes.

Preserve the independent incident and maintenance lifecycles.

A resolved incident may still have scheduled or in-progress maintenance.

Do not automatically reopen incidents, complete maintenance or change vehicle availability.

## 7. Preserve accepted functionality

Do not change existing:

- Incident reporting.
- Incident editing.
- Incident resolution.
- Incident resolution warnings.
- Rental and customer association.
- Vehicle-first incident creation.
- Supporting documents and photographs.
- Insurance information.
- Towing information.
- Responsibility tracking.
- Maintenance creation from incidents.
- Related maintenance visibility.
- Tenant isolation and authorization.

## 8. Data and performance

Reuse existing queries, RPCs and database relationships.

Avoid unnecessary per-record requests.

Ensure dashboard totals are accurate across the complete applicable dataset.

Handle loading, query failures and empty datasets explicitly.

Do not display zero totals when the underlying query has failed.

Refresh affected dashboard information after incident creation, editing, resolution or related maintenance changes.

Prefer a frontend-only implementation.

Do not introduce a database migration without identifying a genuine backend limitation and obtaining owner authorization.

## 9. Scope restrictions

- No incident lifecycle redesign.
- No additional incident statuses.
- No insurance claims processing.
- No customer damage charges.
- No duplicate financial ledger.
- No automatic liability determination.
- No automatic vehicle availability changes.
- No billing changes.
- No production access or deployment.
- No unrelated feature development.

## 10. Validation

Run focused tests covering:

- Accurate dashboard counts.
- Distinct affected vehicle counts.
- Outstanding maintenance counts.
- Multiple maintenance records associated with one incident.
- Resolved incidents with outstanding maintenance.
- Historical unresolved incident visibility.
- Search and filtering.
- Date navigation.
- Tenant isolation.
- Existing incident detail navigation.
- Dashboard refresh after incident resolution.
- Preservation of accepted incident workflows.

Run TypeScript, changed-file ESLint and formatting validation.

Do not repeat the entire repository test suite unless a shared dependency change requires it.

## 11. Staging deployment

Complete any outstanding preventive servicing deployment closure first.

Use the latest verified origin/staging baseline.

Preserve all Maintenance dashboard and preventive servicing changes.

Perform the guarded staging build.

Publish through the established normal fast-forward staging deployment process.

Verify actual deployed frontend assets by content.

Do not force push.

## 12. Acceptance

Add a separate Incident Management dashboard acceptance scenario.

Do not reopen previously accepted incident functionality without evidence of regression.

Do not mark the dashboard manually accepted until the owner confirms it.

Preserve the outstanding production readiness gates.

## 13. Report

Save the implementation report to:

E:\pevvy-car-rental-saas-main\Roadmap\Reports\PEVVY_INCIDENT_MANAGEMENT_DASHBOARD_ENHANCEMENT.md

Archive this prompt to:

E:\pevvy-car-rental-saas-main\Roadmap\Prompts\PEVVY_INCIDENT_MANAGEMENT_DASHBOARD_ENHANCEMENT_PROMPT.md

Include implementation details, metric definitions, test results, source commits, staging deployment evidence and concise manual acceptance instructions.

Complete implementation and staging deployment in one execution wherever possible.

# PEVVY — INCIDENT MANAGEMENT UI AND WORKFLOW CORRECTIONS

## 1. Objective

Correct the usability and presentation issues identified during manual staging acceptance of Incident Management.

Incident creation is working. However, the incident detail page displays internal database UUIDs instead of meaningful vehicle and rental information.

The incident creation workflow also needs to be improved to automatically identify the selected vehicle's current rental, where applicable.

Implement these corrections using the existing Pevvy architecture, database relationships, security controls and design conventions.

Do not redesign the Incident Management module or introduce unnecessary architecture.

## 2. Repository and environment

Primary repository:

`E:\pevvy-car-rental-saas-main`

Use the latest `origin/staging` branch as the implementation baseline.

Previously deployed integration commit:

`83892f266959d18f8679311f765352a94831c7ba`

Authorized staging Supabase project:

`yeklucfthspvejlkffln`

Protected production Supabase project:

`ysnumxtzcgzyabrghxwq`

Staging frontend:

`https://quantum-lavenderblush-buffalo-97.hostingersite.com`

Use an isolated worktree for implementation. Preserve unrelated changes in the primary repository.

## 3. Product design decision

An incident belongs primarily to a vehicle.

A rental agreement provides additional context but is not required to record an incident.

A vehicle may experience an incident:

- While checked out to a customer.
- While parked in the rental agency's lot.
- While undergoing maintenance.
- While being moved by an employee.
- Before being checked out.
- After being returned by a customer.
- During an inspection.

The system must support all these scenarios without requiring a rental agreement.

Vehicle selection is mandatory. Rental association is optional.

## 4. Vehicle-first incident creation workflow

Update the existing Report Incident page.

### 4.1 Vehicle selection

The vehicle dropdown must display meaningful vehicle information:

- Registration plate.
- Make.
- Model.
- Model year, where available.

Example:

`DEMO-009 — Mazda Mazda3`

Reuse the existing fleet data and tenant-scoped vehicle queries.

Do not expose internal vehicle UUIDs in user-facing labels.

### 4.2 Automatic rental association

When the operator selects a vehicle:

1. Determine whether the vehicle is currently checked out under an active rental agreement.
2. If an active rental exists, automatically populate the Related rental field.
3. Retrieve and display the associated customer.
4. Allow the operator to remove the rental association by selecting No rental.
5. If no active checked-out rental exists, default to No rental.
6. Allow the operator to manually select a relevant historical rental associated with the selected vehicle.
7. Exclude rental agreements associated with unrelated vehicles.

Use the authoritative rental lifecycle and existing vehicle relationships to determine whether a vehicle is currently checked out.

Do not rely exclusively on the vehicle status label.

A reserved or future rental must not automatically populate the Related rental field.

### 4.3 Vehicle selection changes

When the operator changes the selected vehicle:

- Clear the previous rental association.
- Clear the previous customer information.
- Retrieve rental agreements associated with the newly selected vehicle.
- Automatically select its current checked-out rental, if applicable.
- Otherwise, default to No rental.

Prevent stale query responses from restoring rental or customer information belonging to a previously selected vehicle.

Do not overwrite an operator's explicit No rental selection during ordinary query refreshes.

### 4.4 Related rental dropdown

The Related rental dropdown must include:

- No rental.
- The currently checked-out rental, where applicable.
- Relevant historical rentals associated with the selected vehicle.

Display meaningful rental information:

- Rental reference number.
- Customer name.
- Rental status.

Example:

`RNT-2026-00002 — Mary Jane — Active`

Use existing rental status terminology and formatting.

If the existing interface permits selecting a rental before selecting a vehicle, automatically populate the associated vehicle and customer.

However, vehicle-first selection remains the primary workflow.

### 4.5 Customer information

When a rental is associated with an incident:

- Automatically derive the customer from the selected rental.
- Display the customer's name.
- Do not require manual customer selection.
- Prevent association with an unrelated customer.

When No rental is selected:

- Clear rental-derived customer information.
- Allow incident creation without a customer.

Preserve existing backend customer derivation and relationship validation.

### 4.6 Multiple active rentals

Under normal circumstances, a vehicle should not have multiple simultaneous checked-out rentals.

If inconsistent historical or test data results in multiple active rental matches:

- Do not arbitrarily select one.
- Allow the operator to select the appropriate rental.
- Preserve existing rental availability and integrity protections.

Do not introduce a separate reconciliation workflow for this exceptional condition.

## 5. Replace internal UUIDs with human-readable references

Inspect the existing implementation, including:

- `src/features/incidents/api.ts`
- `src/features/incidents/queries.ts`
- `src/pages/incidents/IncidentsPage.tsx`
- `src/pages/incidents/IncidentNewPage.tsx`
- `src/pages/incidents/IncidentDetailPage.tsx`

Also inspect existing vehicle, rental, customer and operator query patterns.

Replace raw UUIDs wherever they appear in the Incident Management user interface.

### Vehicle

Display:

- Registration plate.
- Make.
- Model.

Example:

`DEMO-009 — Mazda Mazda3`

### Rental

Display the rental reference number.

Example:

`RNT-2026-00002`

### Customer

Display the customer's existing display name.

### Reported by

Display the reporting operator's name using existing user profile or organization membership data.

### Resolved by

Display the resolving operator's name when applicable.

### Navigation

Make the related vehicle and rental references clickable.

Use existing application routes and authorization controls.

Do not create duplicate vehicle or rental detail pages.

If a related record is unavailable or inaccessible, display an appropriate human-readable fallback rather than its internal UUID.

Retain UUIDs internally for database relationships, queries and navigation parameters.

## 6. Incident detail page improvements

Improve the existing incident detail page using the current Pevvy design language.

Display the following information clearly.

### Incident header

- Incident reference number.
- Incident type.
- Incident date and time.
- Current incident status.

Example:

`INC-2026-00001`

`Breakdown — November 25, 2026`

### Related records

- Vehicle registration, make and model.
- Related rental reference, where applicable.
- Associated customer, where applicable.
- Reported by.
- Responsibility.

### Incident information

- Description.
- Location.
- Occurrence date and time.

### Towing information

Display separately:

- Towing provider.
- Towing reference.

### Insurance information

Display separately:

- Insurance provider.
- Insurance claim reference.

### Supporting files

Preserve existing functionality for:

- Photograph uploads.
- Document uploads.
- Attachment listing.
- Authorized viewing and downloading.
- Attachment deletion where permitted by existing roles.

### Resolution information

For resolved incidents, display:

- Resolution notes.
- Resolution date and time.
- Resolving operator.

Use appropriate placeholders such as Not recorded, No related rental or Not applicable for optional information.

Do not display raw UUIDs, undefined values or internal enum values.

## 7. Incident status and formatting

Use properly formatted human-readable labels throughout Incident Management.

### Incident types

- Breakdown
- Accident
- Vehicle damage
- Theft
- Other

### Incident statuses

- Open
- In progress
- Resolved

### Responsibility

- Customer
- Rental agency
- Third party
- Undetermined

Preserve existing database enum values and backend contracts.

Apply display formatting in the frontend rather than changing stored values unnecessarily.

Use existing Pevvy status badge and date/time formatting conventions.

## 8. Incident editing and lifecycle

Verify that the existing incident update functionality is accessible through the user interface.

Where controls are missing, expose the existing supported functionality:

- Edit incident details.
- Update responsibility.
- Update towing information.
- Update insurance information.
- Mark an incident as In progress.
- Resolve an incident with resolution notes.

Reuse existing incident update and resolution RPCs.

Do not introduce new incident statuses, approval workflows or reopening functionality.

Preserve existing resolution rules and operator attribution.

## 9. Incident list improvements

Review the existing Incident Management listing page.

Ensure it displays meaningful operational information, including:

- Incident reference.
- Incident type.
- Vehicle registration, make and model.
- Related rental reference, where applicable.
- Incident date.
- Status.
- Responsibility.

Preserve existing search, filtering, pagination and sorting functionality where implemented.

Ensure search supports meaningful references, including:

- Incident reference number.
- Vehicle registration plate.
- Rental reference number.

Reuse existing query patterns and avoid introducing unnecessary database requests for each individual incident row.

## 10. Preserve the existing operational workflow

Incident Management is an operational recording and tracking feature.

Creating, editing or resolving an incident must not automatically:

- Complete a rental.
- Cancel a rental.
- Extend a rental.
- Create a replacement rental.
- Swap a vehicle.
- Change vehicle availability.
- Change vehicle status.
- Create maintenance work orders.
- Create customer charges.
- Issue refunds.
- Apply discounts.
- Modify payments.
- Settle insurance claims.

These actions remain operator-controlled through the existing Pevvy functionality.

For a breakdown during an active rental, the operator can:

1. Record the incident.
2. Complete the existing rental when appropriate.
3. Record the reason and relevant condition information.
4. Create a separate rental agreement for another vehicle.
5. Apply an appropriate discount using existing functionality.
6. Manage the affected vehicle through existing fleet controls.

Do not reintroduce the withdrawn active vehicle-swap architecture.

## 11. Fleet Management exclusion

The existing Vehicle Edit page was provided during manual acceptance as a separate reference showing the available vehicle information.

It is not part of the reported Incident Management defect.

Do not modify:

- Vehicle Edit page.
- Fleet Management forms.
- Vehicle creation workflow.
- Vehicle status controls.
- Vehicle availability rules.
- Vehicle compliance fields.
- Vehicle pricing.
- Public booking configuration.
- Vehicle odometer validation.

Reuse existing vehicle information within Incident Management only.

Do not introduce changes to the vehicle database structure solely to display vehicle information in Incident Management.

## 12. Security and data integrity

Preserve all existing tenant-isolation controls.

Ensure:

- Vehicles belong to the authenticated organization.
- Related rentals belong to the authenticated organization.
- Selected rentals are associated with the selected vehicle under the supported rental relationship.
- Customers are derived from authorized rental records.
- Operator names are retrieved through authorized organization-scoped access.
- Cross-tenant vehicle, rental, customer and incident access is denied.
- Existing role-based create, update and resolution permissions remain enforced.
- Private attachment storage remains protected.
- Signed attachment downloads remain authorized.

Do not bypass RLS.

Do not expose service-role credentials to the frontend.

Do not broaden database permissions solely to resolve presentation defects.

Prefer frontend and existing query-layer corrections.

Introduce a database migration only if a demonstrated technical requirement makes it unavoidable. Document the requirement and use a narrowly scoped correction.

## 13. Acceptance scenarios

Implement and validate the following scenarios.

### Scenario 1 — Breakdown during an active rental

- Select a currently checked-out vehicle.
- Verify the active rental is automatically populated.
- Verify the associated customer is displayed.
- Record a breakdown incident.
- Confirm the incident detail page displays meaningful vehicle, rental and customer information.

### Scenario 2 — Vehicle damaged in the rental lot

- Select an available vehicle.
- Verify Related rental defaults to No rental.
- Record a vehicle damage incident.
- Confirm incident creation succeeds without a rental or customer.

### Scenario 3 — Reserved vehicle

- Select a vehicle associated with a future or reserved rental but not currently checked out.
- Verify the future rental is not automatically selected.
- Confirm standalone incident creation is supported.

### Scenario 4 — Incident unrelated to an active rental

- Select a currently checked-out vehicle.
- Verify its rental is automatically populated.
- Manually select No rental.
- Verify the customer information is cleared.
- Confirm the incident can be saved without a rental association.

### Scenario 5 — Historical rental association

- Select a vehicle with previous rental agreements.
- Select an appropriate historical rental.
- Verify the correct customer is displayed.
- Record the incident successfully.

### Scenario 6 — Vehicle selection changes

- Select a vehicle with an active rental.
- Select a different vehicle.
- Verify the previous rental and customer information are cleared.
- Verify the newly selected vehicle's rental context is retrieved correctly.

### Scenario 7 — Invalid relationship

- Attempt to associate an incident with a rental belonging to another vehicle.
- Verify the UI prevents the invalid selection.
- Verify the backend independently rejects the invalid relationship.

### Scenario 8 — Incident presentation

- Open an existing incident.
- Verify vehicle, rental, customer and operator names are displayed correctly.
- Verify no raw UUIDs appear in the user interface.
- Verify vehicle and rental navigation links work.

### Scenario 9 — Supporting evidence

- Upload a photograph.
- Upload a document.
- Verify authorized viewing and downloading.
- Verify unauthorized cross-tenant access is denied.

### Scenario 10 — Incident lifecycle

- Create an incident.
- Edit its details.
- Mark it as In progress.
- Resolve it with resolution notes.
- Verify resolution timestamp and operator attribution.

### Scenario 11 — Existing functionality

Verify that the corrections do not affect:

- Standard rental creation.
- Vehicle checkout.
- Vehicle return.
- Rental completion.
- Fleet Management.
- Vehicle availability.
- Existing payments and discounts.
- SaaS subscription billing.

## 14. Implementation and validation

Execute the corrections directly.

Do not return another architecture proposal or implementation plan.

Use the latest remote staging branch as the baseline and create an isolated correction worktree.

Reuse the existing validated dependency environment where appropriate.

Run:

- Focused Incident Management tests.
- Focused vehicle and rental relationship tests.
- Relevant authorization and tenant-isolation tests.
- TypeScript validation.
- Guarded staging frontend build.

Add focused tests for the newly introduced vehicle-first selection behaviour.

Do not repeatedly execute the entire repository regression suite unless the actual changes justify it.

Correct demonstrated defects before deployment.

Distinguish automated test results from manual browser acceptance.

## 15. Staging deployment

The owner authorizes deployment of these Incident Management corrections to staging.

Use the existing GitHub-connected Hostinger deployment workflow.

The deployment branch is:

`origin/staging`

Execute:

1. Fetch the latest remote staging branch.
2. Integrate only the reviewed Incident Management corrections.
3. Preserve existing staging functionality and previous release changes.
4. Run the guarded staging frontend build.
5. Verify the build targets Supabase project `yeklucfthspvejlkffln`.
6. Verify the production project reference is absent.
7. Push the validated candidate using a normal fast-forward push.
8. Verify Hostinger publishes the updated frontend.
9. Verify the live frontend assets correspond to the new deployment.

Do not claim successful deployment solely because the Git push succeeded.

If Hostinger has not published the new commit, report deployment as pending and identify the exact remaining owner action.

## 16. Restrictions

- No production deployment or production database changes.
- No force pushes.
- No remote history rewrites.
- No unrelated migrations.
- No Stripe configuration changes.
- No SaaS billing changes.
- No Fleet Management redesign.
- No vehicle-swap functionality.
- No new maintenance module.
- No accounting architecture.
- No additional feature activation controls.
- No destructive test-data cleanup.
- No unnecessary repository-wide audits.

All existing staging rental and incident records are test data. Preserve them unless a narrowly scoped cleanup is explicitly authorized.

Do not spend additional development time redesigning legacy vehicle-swap records.

## 17. Roadmap and documentation

Update the existing roadmap and feature tracker to reflect:

- Incident Management usability corrections.
- Vehicle-first incident reporting.
- Optional rental association.
- Human-readable related record references.
- Validation results.
- Staging deployment status.
- Remaining manual acceptance requirements.

Do not mark Incident Management as fully accepted until the required acceptance scenarios have passed.

Do not begin Maintenance Management during this execution.

Archive this prompt to:

`E:\pevvy-car-rental-saas-main\Roadmap\Prompts\PEVVY_INCIDENT_MANAGEMENT_UI_CORRECTIONS_PROMPT.md`

## 18. Final implementation report

Save one consolidated report to:

`E:\pevvy-car-rental-saas-main\Roadmap\Reports\PEVVY_INCIDENT_MANAGEMENT_UI_CORRECTIONS.md`

Include:

1. Root cause of the UUID presentation defect.
2. Files changed.
3. Vehicle-first workflow implementation.
4. Automatic rental and customer association behaviour.
5. Standalone incident support.
6. Incident list and detail improvements.
7. Security and tenant-isolation validation.
8. Automated test results.
9. TypeScript and build results.
10. Database changes, if any.
11. Git commit and staging push results.
12. Hostinger deployment verification.
13. Remaining manual browser acceptance tasks.
14. Roadmap and feature tracker status.
15. Any genuine blockers.

Clearly distinguish implemented, tested, deployed and manually verified functionality.

Execute the implementation, validation and staging deployment now.

Do not return another planning document.
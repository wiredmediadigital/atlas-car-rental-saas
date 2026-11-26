# PEVVY — MAINTENANCE EXPENSE WORKFLOW ENHANCEMENT

> Archived verbatim on 2026-11-26. Owner instruction to add a Create expense action
> inside the Costs section of Maintenance Details. The result is recorded in
> `Roadmap/Reports/PEVVY_MAINTENANCE_EXPENSE_WORKFLOW_ENHANCEMENT.md`.

The owner has confirmed that the existing maintenance expense association works correctly when a vehicle expense is created first.

This is a usability enhancement, not a confirmed backend defect.

## Requirements

1. Add a Create expense action directly within the Costs section of Maintenance Details.
2. Reuse the existing expense creation form and expense ledger.
3. Automatically populate the associated vehicle, maintenance reference, relevant description and appropriate expense category.
4. Automatically associate the newly created expense with the maintenance record after successful creation.
5. Retain the existing Link existing expense functionality.
6. When no eligible expenses exist, display an informative empty state instead of silently hiding the workflow.
7. Support expense creation and association after maintenance completion.
8. Automatically refresh actual maintenance costs and associated expenses.
9. Prevent duplicate expenses and duplicate associations.
10. Preserve existing financial permissions, tenant isolation and audit controls.

## Restrictions

- No duplicate expense ledger.
- No unnecessary database migration.
- No accounting architecture redesign.
- No customer charges.
- No maintenance lifecycle changes.
- No vehicle availability changes.
- No billing changes.
- No production access.
- Do not reopen previously accepted functionality.

## Execution

Use the latest origin/staging baseline.

Implement the enhancement, run focused regression tests and TypeScript validation, perform the guarded staging build and publish through the established staging deployment process.

Verify the corrected frontend is live.

## Report

Save to:

E:\pevvy-car-rental-saas-main\Roadmap\Reports\PEVVY_MAINTENANCE_EXPENSE_WORKFLOW_ENHANCEMENT.md

Archive the prompt to:

E:\pevvy-car-rental-saas-main\Roadmap\Prompts\PEVVY_MAINTENANCE_EXPENSE_WORKFLOW_ENHANCEMENT_PROMPT.md

Complete implementation and staging deployment in one execution.

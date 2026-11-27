# PEVVY — WORK PACKAGE 4: FINAL FINANCIAL AMENDMENT HISTORY REMEDIATION

*Owner authorization, received 2026-11-27. Archived verbatim.*

## 1. Objective

Complete the outstanding financial amendment history requirement identified during the Rental Financial Adjustments implementation.

Work Package 4 has been implemented and deployed to staging but is not yet functionally accepted.

The remaining material defect is that an authorized repricing of a confirmed reservation before contract issuance can overwrite the previous base hire amount without preserving its financial history.

Resolve this deficiency using the existing rental financial architecture and snapshot mechanisms.

Do not introduce a parallel financial ledger or a general rental activity subsystem.

## 2. Established implementation baseline

Preserve the existing deployed implementation:

- Staging release: aa94dc3.
- Applied migration: 20261126130000_rental_charge_integrity.sql.
- Approved migration checksum: ee503f7790b09692c8546a6435c5acd5ff0231400087fb6f801725637a574f5e.
- Migration ledger: 142 local and 142 remote.
- Automated tests: 4,123 passed, four established baseline failures.
- Four approved Rental Details tabs: Overview, Financials, Inspections and Documents.
- Manager-authorized charge reversals.
- Finalized charge deletion and modification protection.
- Protected rental extension and repricing RPCs.
- Auditable cancellation settlement.
- Existing contract versioning.
- Responsive desktop, tablet and mobile implementation.
- Previously accepted Maintenance downtime caption correction.

Verify the actual current repository and staging state before proceeding.

Do not assume the reported baseline remains unchanged.

## 3. Mandatory documentation prerequisite

Before modifying application code, verify that the following files exist and contain the previous implementation evidence:

E:\pevvy-car-rental-saas-main\Roadmap\Reports\PEVVY_RENTAL_FINANCIAL_ADJUSTMENTS_IMPLEMENTATION.md

E:\pevvy-car-rental-saas-main\Roadmap\Reports\PEVVY_RENTAL_FINANCIAL_ADJUSTMENTS_ACCEPTANCE.md

E:\pevvy-car-rental-saas-main\Roadmap\Prompts\PEVVY_RENTAL_FINANCIAL_ADJUSTMENTS_PROMPT.md

If any required file is missing, complete it before proceeding.

Archive this remediation prompt in:

E:\pevvy-car-rental-saas-main\Roadmap\Prompts\PEVVY_RENTAL_FINANCIAL_AMENDMENT_HISTORY_REMEDIATION_PROMPT.md

## 4. Confirmed defect

The previous implementation report established that:

- Where an issued contract exists, the original contract version preserves the previous rental amount.
- An authorized rental extension can update the live hire amount without modifying the historical issued contract.
- Where a confirmed reservation has no issued contract, authorized repricing can overwrite the previous hire amount without preserving its previous value.

The reported example changed the base hire amount from 1 minor currency unit to 15,000 minor currency units, with no historical contract versions available.

Reservation is an approved financial finalization boundary.

Therefore, financial amendment history must not depend on whether a contract has already been issued.

## 5. Inspect existing snapshot architecture

Inspect the effective database schema and existing mechanisms for:

- Rental pricing snapshots.
- Rental amendments.
- Contract snapshots.
- Contract versioning.
- Rental extension history.
- Early return adjustments.
- Rental repricing.
- Financial statement generation.
- Existing pricing metadata.

Identify the smallest existing mechanism capable of preserving authorized financial changes independently of contract issuance.

Reuse existing storage structures and snapshot utilities wherever appropriate.

Do not create artificial issued contracts simply to preserve financial history.

Do not create unnecessary document versions or generate PDFs for internal financial snapshots.

## 6. Required financial history behaviour

For every authorized operation that restates a finalized base hire amount, preserve sufficient information to reconstruct the previous and revised financial position.

Where applicable, preserve:

- Organization identifier.
- Rental identifier.
- Original hire charge identifier.
- Previous rental dates and duration.
- Revised rental dates and duration.
- Previous quantity and unit rate.
- Revised quantity and unit rate.
- Previous hire amount.
- Revised hire amount.
- Applicable currency.
- Previous and revised tax treatment.
- Previous and revised financial totals.
- Amendment type.
- Amendment reason.
- Authenticated operator.
- Amendment timestamp.
- Existing contract version association, where applicable.

Reuse existing authoritative fields and metadata.

Do not duplicate information unnecessarily.

Capture the previous financial state before it is overwritten.

Preserve the relationship between the previous and revised states.

## 7. Operations covered

Inspect all existing authorized paths that can restate finalized base hire charges, including:

- Rental repricing.
- Rental extension.
- Early return financial adjustment, where supported.
- Existing pre-checkout rental amendment workflows.
- Existing upgrade-related pricing changes.
- Other authorized pricing operations identified during inspection.

Apply the correction consistently to relevant operations.

Do not modify unrelated workflows.

Draft rental pricing changes do not require finalized financial amendment history unless existing business rules already require it.

## 8. Atomicity and concurrency

Financial history creation and the associated pricing mutation must occur within the same database transaction.

A failed pricing operation must not leave behind a successful amendment record.

A successful finalized pricing operation must not commit without its required historical evidence.

Ensure:

- Appropriate rental locking.
- Consistent previous-state capture.
- No duplicate history from retries.
- No lost history during concurrent amendments.
- No partial financial changes.
- Preservation of existing vehicle and driver availability validation.

Do not rely on a separate frontend API call to create the historical record.

## 9. Security requirements

Preserve the existing financial integrity migration protections.

Ensure financial amendment history is:

- Tenant isolated.
- Protected against unauthorized modification.
- Protected against unauthorized deletion.
- Created only through authorized operations.
- Associated with the authenticated operator.
- Accessible only to appropriately authorized users.
- Compatible with existing billing entitlement enforcement.

Preserve existing role requirements for rental extensions and repricing.

Do not broaden financial permissions.

Do not use client-settable session flags as authorization boundaries.

Review any privileged internal function for execution grants, tenant validation, role validation, billing enforcement and safe search paths.

Preserve authorized account closure and purge compatibility.

## 10. Contract preservation

Existing issued contracts must remain immutable historical documents.

Do not modify existing issued contract PDFs, signatures or stored financial snapshots.

Do not change the existing contract issuance workflow.

Where a financial amendment occurs after contract issuance, preserve the existing supersession and versioning behaviour.

Where a financial amendment occurs before contract issuance, preserve the financial amendment history without manufacturing an issued contract.

## 11. Rental Details presentation

Expose the preserved financial amendment history through the existing Financials tab where appropriate.

Use a compact, read-only financial amendment history section or an existing suitable financial history component.

Display sufficient information for authorized operators to understand:

- What changed.
- Previous amount.
- Revised amount.
- Financial difference.
- Amendment type.
- Reason.
- Date.
- Operator.

Do not create an Activity tab.

Do not duplicate the existing Charges or Money sections.

Do not introduce a general-purpose rental event system.

Keep the interface consistent with Pevvy's existing design system.

## 12. Responsive design

Any new financial history presentation must support:

- Desktop.
- Laptop.
- iPad portrait.
- iPad landscape.
- Mobile.

Use responsive tables or stacked records as appropriate.

Prevent page-level horizontal overflow.

Preserve readable monetary amounts and touch-friendly controls.

Do not require a separate mobile application.

Do not claim physical-device or authenticated browser verification unless it was actually performed.

Where authenticated browser access is unavailable, record the limitation and provide precise owner verification instructions.

## 13. Migration discipline

The existing migration 20261126130000_rental_charge_integrity.sql has already been applied to staging.

Do not modify it.

If the remediation requires database changes, create one new minimal forward migration using the next appropriate migration timestamp.

Before redefining existing functions, inspect their effective definitions after all preceding migrations.

Pay particular attention to the function-rewriting behaviour introduced by migration 20261120100000.

Do not inadvertently restore obsolete assignment session-flag logic.

Preserve the previously implemented base hire protection and cancellation settlement security boundaries.

Authorize migration development and local testing only.

Hosted migration application requires separate owner authorization.

Do not apply the migration independently.

Do not deploy frontend functionality that depends on an unapplied migration.

## 14. Required automated tests

Add focused tests covering:

1. Confirmed reservation repriced before contract issuance preserves its previous hire amount.
2. Confirmed reservation repriced after contract issuance preserves financial history and existing contract versions.
3. Rental extension preserves previous and revised pricing information.
4. Multiple consecutive amendments retain their individual history.
5. Failed repricing does not create committed amendment history.
6. Failed extension does not create committed amendment history.
7. Concurrent amendments do not overwrite historical information.
8. Unauthorized direct creation of amendment history is rejected.
9. Unauthorized history modification is rejected.
10. Unauthorized history deletion is rejected.
11. Cross-tenant history access is rejected.
12. Billing-restricted financial mutations remain rejected.
13. Existing draft repricing remains functional.
14. Existing cancellation settlement remains functional.
15. Existing charge reversals remain functional.
16. Existing finalized charge protection remains enforced.
17. Existing financial totals and payment balances remain accurate.
18. Existing issued contract documents remain unchanged.
19. Authorized account closure remains functional.
20. Existing driver and vehicle availability checks remain enforced.
21. Financial history presentation renders correctly.
22. Empty financial history states render correctly.
23. Responsive financial history layouts preserve access to all relevant information.

Preserve the existing 59 financial security tests.

Run relevant database and frontend regression suites.

Distinguish existing baseline failures from newly introduced failures.

## 15. Historical data compatibility

Do not manufacture historical records for financial changes that occurred before this correction.

Existing rentals must remain readable and operational.

Where historical amendment information is unavailable, communicate that limitation accurately.

Do not infer previous pricing values from current balances or unrelated payments.

Do not perform retrospective financial adjustments.

## 16. Scope restrictions

This remediation is limited to the outstanding financial amendment history deficiency.

Do not begin:

- Security Deposit Management.
- Rental Invoicing.
- Payment Reconciliation.
- Fleet Profitability.
- Customer Communications.
- General rental activity logging.
- A new financial ledger.
- A new pricing engine.
- Application-wide redesign.

Do not reopen accepted Incident Management or Maintenance Management functionality.

## 17. Migration authorization dossier

If a migration is required, provide:

- Exact migration filename.
- SHA-256 checksum.
- Migration purpose.
- Affected tables, policies, functions and triggers.
- Existing snapshot mechanism reused.
- Financial history preservation mechanism.
- Authorization and security boundaries.
- Compatibility with existing rentals.
- Account closure compatibility.
- Automated test results.
- Existing baseline failures.
- Current staging migration ledger.
- Exact isolated worktree path.
- Exact staging migration application commands.
- Rollback and recovery considerations.
- Remaining material limitations.

Save the dossier in the remediation report.

Wait for owner authorization before hosted application.

Continue independent frontend implementation and local testing while awaiting authorization where practical.

## 18. Staging deployment

After the owner authorizes and applies any required migration:

- Verify the hosted migration ledger.
- Verify the deployed schema and security boundaries.
- Verify the staging project reference.
- Run the guarded staging build.
- Deploy through the authorized staging branch.
- Use normal fast-forward Git operations.
- Preserve the existing Hostinger configuration.
- Verify actual deployed frontend assets and release-specific content.
- Verify previously accepted functionality remains present.

Do not use force pushes.

Do not modify origin/main.

Do not access or deploy production.

## 19. Manual acceptance

Preserve the existing scenarios 30–34 and their actual acceptance status.

Add Scenario 35 — Financial Amendment History, provided that identifier remains available in the consolidated acceptance register.

Include detailed instructions for:

- Repricing a confirmed reservation before issuing a contract.
- Verifying previous and revised amounts.
- Issuing a contract after repricing.
- Extending a rental after contract issuance.
- Verifying historical financial changes.
- Verifying the original issued contract remains unchanged.
- Verifying manager-authorized charge reversals.
- Verifying financial totals and payment balances.
- Verifying desktop, iPad and mobile financial history presentation.

Do not mark any owner acceptance scenario as passed without owner confirmation.

## 20. Mandatory report creation

Physically create and save:

E:\pevvy-car-rental-saas-main\Roadmap\Reports\PEVVY_RENTAL_FINANCIAL_AMENDMENT_HISTORY_REMEDIATION.md

Update:

E:\pevvy-car-rental-saas-main\Roadmap\Reports\PEVVY_RENTAL_FINANCIAL_ADJUSTMENTS_IMPLEMENTATION.md

E:\pevvy-car-rental-saas-main\Roadmap\Reports\PEVVY_RENTAL_FINANCIAL_ADJUSTMENTS_ACCEPTANCE.md

Update the applicable roadmap, feature tracker, architecture decisions, changelog, production release checklist, production release manifest and consolidated acceptance register.

Preserve the previously established mandatory report delivery requirements in CLAUDE.md.

A conversational completion summary is not a substitute for physically saved report files.

## 21. Final delivery evidence

For every required report and archived prompt, provide:

- Absolute file path.
- File existence verification.
- File size in bytes.
- Last modified timestamp.
- SHA-256 checksum.
- Completion status.

Verify the files are non-empty and contain the required evidence.

Explicitly identify any incomplete deliverable.

## 22. Execution instruction

Proceed directly with focused implementation and local verification.

Do not initiate another general architecture review.

Escalate only genuine material blockers.

Pause for hosted migration authorization where required.

After authorization, complete staging deployment and documentation within the same work package.

Do not declare Work Package 4 functionally accepted until the financial amendment history requirement is satisfied and the owner has completed manual acceptance.

Production remains NO-GO.

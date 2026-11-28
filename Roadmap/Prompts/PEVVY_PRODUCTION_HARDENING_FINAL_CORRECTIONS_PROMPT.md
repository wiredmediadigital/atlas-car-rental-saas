# PEVVY — FINAL HARDENING CORRECTIONS AND HOSTED STAGING MIGRATION PREFLIGHT

*Archived verbatim. Received 2026-11-27.*

---

## 1. Review decision

The owner has reviewed the hardening implementation, regression verification, delivery verification, migration authorization package and Work Package 4 final acceptance report.

Accept the following local verification results:

- 203 of 203 test files executed.
- 4,234 of 4,234 tests passed.
- Zero unhandled errors.
- Zero lint errors.
- Fourteen justified non-blocking lint warnings.
- Formatting and TypeScript verification passed.
- Independent PostgreSQL concurrency verification performed.
- Work Package 4 formally closed.

The reduced test worker count of four is accepted.

Preserve the every-file-ran safeguard.

The five hosted migrations are not yet authorized for application.

Complete the following targeted corrections and preflight checks in one execution.

Do not reopen the entire hardening scope.

## 2. Environment boundaries

Canonical implementation worktree:

E:\pevvy-maintenance-acceptance-20261125

Primary protected checkout:

E:\pevvy-car-rental-saas-main

Expected remote baseline:

- origin/main: 31383a9
- origin/staging: 5634555
- Hosted staging migration ledger: 143
- Local migration ledger: 148

Verify actual state before proceeding.

Authorized staging project:

yeklucfthspvejlkffln

Protected production project:

ysnumxtzcgzyabrghxwq

Production access, modification and deployment remain prohibited.

Do not apply hosted migrations or push dependent frontend changes under this instruction.

## 3. Correct duplicate rental check-in

The independent concurrency report confirms that two concurrent rental_check_in calls both commit and the second overwrites the first return readings.

This is not an acceptable unconditional concurrency result.

Preserve the first successfully committed vehicle return.

Under the existing rental row lock:

- Reject a subsequent check-in with different return information.
- An identical retry may be safely rejected or treated as an idempotent success without another mutation.
- Prevent silent overwriting of returned_at, odometer, fuel, condition notes, inspection information or assignment release evidence.
- Prevent duplicate operational and financial side effects.

Inspect the existing return correction workflow.

If an explicit authorized correction workflow already exists, preserve it.

Do not invent a new return correction subsystem.

Do not allow ordinary check-in to serve as an undocumented correction mechanism.

Test:

- First check-in succeeds.
- Sequential duplicate check-in cannot overwrite the original.
- Concurrent check-ins with different readings produce only one accepted mutation.
- Identical retry does not create another mutation.
- Vehicle odometer remains correct.
- Assignment drainage remains correct.
- Rental completion remains functional.
- Existing finalized rental protections remain enforced.

Update concurrency Scenario 4 to assert the actual business integrity requirement.

## 4. Financial amendment revision verification

Verify the interaction between:

- rental_line_items.revision_no.
- rental_pricing_amendments.line_revision_no.
- rental_pricing_amendments_one_per_revision.
- Date-only and zero-value amendments.
- No-op suppression.

The implementation report states that financial line revisions advance when money or tax treatment changes, while date-only amendments remain recordable.

Demonstrate that multiple legitimate date-only amendments can be recorded without a unique-index collision or reuse of amendment evidence.

Test:

- Two successive date-only amendments.
- Date-only amendment followed by financial amendment.
- Financial amendment followed by date-only amendment.
- Multiple legitimate zero-value amendments.
- Repeated identical financial transitions.
- No-op repricing.
- Missing evidence.
- Evidence reuse.

The concurrent unrecorded amendment test previously failed through a PostgreSQL deadlock.

A deadlock alone is insufficient proof that the amendment evidence constraint rejects the invalid mutation.

Add a deterministic test that reaches the evidence enforcement mechanism and fails specifically because evidence is missing or invalid.

Preserve the existing independent concurrency coverage.

Correct any confirmed issue using the existing amendment architecture.

Do not introduce another financial ledger.

## 5. Billing authorization decision

The seven fully gated functions and four safety-exempt functions are accepted in principle.

Accept the documented limitation that incident_update may also permit ordinary incident documentation changes, provided it cannot:

- Resolve or close an incident through an alternative path.
- Remove vehicle safety restrictions.
- Return a vehicle to service.
- Mutate financial records.
- Change tenant associations.
- Bypass existing role checks.

Verify these restrictions behaviourally.

Preserve the existing safety exemption for vehicle_take_off_road.

Do not redesign billing or modify Stripe configuration.

## 6. Maintenance expense editing

Verify that the frontend exposes an understandable workflow when an expense is linked to maintenance.

The delivery report lists no changed expense frontend source.

Confirm that:

- A linked expense's maintenance association is identifiable.
- Incompatible allocation or vehicle changes are refused.
- The refusal is clearly communicated.
- The user can locate the existing authorized unlink operation.
- Legitimate expense edits remain available.
- Silent reassignment remains prohibited.

Implement only the minimum interface correction required if existing behaviour is insufficient.

Do not create a new expense subsystem.

## 7. Hosted staging read-only data preflight

Use authorized read-only inspection against project yeklucfthspvejlkffln.

Do not apply migrations or mutate hosted business records.

### Amendment history

The migration authorization package reports zero existing amendment rows.

This conflicts with the owner's successful Scenario 35 staging acceptance.

Verify:

- Correct project identity.
- Actual amendment row count.
- Counts grouped by organization and rental.
- Presence of the previously tested rental RNT-2026-00004, where retained.
- Existing amendment history and current hire consistency.
- Whether QA records were legitimately removed or replaced.

Do not assume zero rows.

Do not delete, reconstruct or alter existing history.

Confirm that historical rows with NULL line_revision_no remain readable and cannot satisfy future mutation evidence.

### Assignment drainage

Inventory all existing assignment states and their associated rental states.

Capture the complete affected row set, not merely aggregate counts.

Include:

- Assignment ID.
- Organization ID.
- Rental ID.
- Vehicle ID.
- Existing assignment state.
- Relevant assignment timestamps.
- Associated rental state.
- Expected post-migration state.

Store the preflight evidence securely without exposing unnecessary customer information.

Identify exactly which completed or cancelled rental assignments would be released.

Confirm that active and reserved rental commitments remain unchanged.

Identify any anomalous records requiring owner review.

Preserve existing explicit activation settings.

### Maintenance expense anomalies

Run an equivalent read-only anomaly query against the existing schema before migration application.

Do not depend on the new anomaly view already existing.

Report:

- Linked expense count.
- Invalid allocation associations.
- Vehicle mismatches.
- Other invariant violations.
- Relevant maintenance and expense identifiers.

Do not automatically repair financial records.

### Migration compatibility

Verify:

- Hosted PostgreSQL version.
- Existing migration ledger.
- Expected schema definitions.
- Required grants and policies.
- Compatibility with all five proposed migrations.
- No unexpected pending migrations.

## 8. Fresh guarded staging build

The earlier artifact is useful evidence but is not a substitute for a fresh successful build after these final corrections.

Use only the approved staging Supabase URL and staging browser publishable key.

Use an existing authorized staging configuration source if available.

Do not use production credentials.

Do not print key values.

Do not weaken or bypass the staging build guard.

If the approved staging browser configuration is unavailable, identify the exact environment variable names and required values' formats.

Request only the missing staging configuration.

Run the fresh guarded build and record:

- Source commit.
- Project reference.
- Artifact file count.
- Complete manifest SHA-256.
- Build exit code.
- Production reference scan.
- Secret exposure scan.

## 9. Regression verification

Run the complete canonical verification suite with a maximum of four test workers.

Preserve the every-file-ran check.

Repeat affected independent PostgreSQL concurrency scenarios.

Record the actual final number of tests and test files.

Do not reuse the earlier 4,234-test result as evidence for newly modified code.

The fourteen documented lint warnings may remain if unchanged and non-blocking.

Do not undertake unrelated lint refactoring.

Add focused coverage for the RentalNewPage and IncidentNewPage default-selection changes where practical.

Otherwise, carry these two pages into targeted hosted staging acceptance.

## 10. Edge Function readiness

Record the verified inventory as four deployed and five undeployed.

The undeployed functions are:

- mfa-reset.
- public-booking.
- gps-provider.
- account-closure.
- account-closure-notice.

Do not deploy them under this instruction.

Preserve their security, configuration and functional acceptance requirements.

Their absence is not an automatic blocker for Security Deposit Management unless an actual dependency is identified.

Do not activate destructive account closure schedules.

## 11. Migration authorization package

The five proposed migrations have never been applied.

Where necessary, amend these unpublished migrations rather than creating unnecessary corrective migration chains.

Never modify the 143 previously applied migrations.

Recalculate complete SHA-256 checksums for every changed migration.

Prepare the final consolidated authorization package with:

- Exact migration filenames.
- Complete SHA-256 checksums.
- Exact file sizes.
- Verified staging project reference.
- Actual local and hosted migration counts.
- Dry-run output.
- Hosted data preflight results.
- Assignment reconciliation evidence.
- Existing amendment history preservation evidence.
- Maintenance expense anomaly results.
- Recovery requirements.
- Expected post-application state.

Do not apply the migrations.

## 12. Preserve the remaining roadmap

The owner has approved completion of all ten work packages in staging before staged production releases.

The remaining work packages are:

WP5 — Security Deposit Management:
Deposit collection records, held balances, partial and full deductions, releases, refunds, immutable history, authorization and financial reconciliation.

WP6 — Rental Invoicing:
Invoice generation, numbering, tax breakdown, immutable issued documents, credit notes, PDF output and invoice status.

WP7 — Payment Reconciliation:
Payment allocation, partial payments, refunds, outstanding balances, reconciliation and transaction history.

WP8 — Fleet Profitability and Reporting:
Vehicle revenue, maintenance and operating costs, profitability, utilization, financial summaries and accounting-compatible exports.

WP9 — Rental Exceptions:
No-shows, exceptional rental handling, breakdowns, theft, recalls, tolls, traffic violations and other approved exception workflows. Reuse Incident Management and existing rental workflows.

WP10 — Customer Communications:
Booking confirmations, rental reminders, return reminders, payment notifications, approved email templates and delivery history.

These are roadmap-level scope definitions, not authorization to implement them.

Each work package will receive its own detailed implementation instruction.

Do not invent external payment processing requirements.

Preserve separation between rental payments and Pevvy subscription billing.

Do not begin WP5 yet.

## 13. Mandatory deliverables

Physically create:

E:\pevvy-car-rental-saas-main\Roadmap\Reports\PEVVY_PRODUCTION_HARDENING_FINAL_CORRECTIONS.md

E:\pevvy-car-rental-saas-main\Roadmap\Reports\PEVVY_PRODUCTION_HARDENING_HOSTED_PREFLIGHT.md

Update:

E:\pevvy-car-rental-saas-main\Roadmap\Reports\PEVVY_PRODUCTION_HARDENING_STAGING_MIGRATION_AUTHORIZATION.md

E:\pevvy-car-rental-saas-main\Roadmap\Reports\PEVVY_PRODUCTION_HARDENING_REGRESSION_VERIFICATION.md

Archive this exact instruction:

E:\pevvy-car-rental-saas-main\Roadmap\Prompts\PEVVY_PRODUCTION_HARDENING_FINAL_CORRECTIONS_PROMPT.md

Update the canonical roadmap, hardening register, release manifest and applicable handoff documents.

Ensure the complete WP5–WP10 roadmap definitions are physically preserved and no longer truncated.

Provide absolute paths, physical existence verification, file sizes, modification timestamps and complete SHA-256 checksums.

## 14. Execution stopping point

Complete all independently executable corrections, tests, build verification and read-only hosted preflight in one execution.

Do not stop for another general review.

Return the final migration authorization package and explicit readiness recommendation.

Stop before hosted migration application.

Do not deploy to production.

Production remains NO-GO.

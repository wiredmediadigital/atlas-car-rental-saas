# PEVVY — WORK PACKAGE 4: FINAL STAGING DEPLOYMENT AND ACCEPTANCE HANDOFF

*Owner authorization, received 2026-11-27. Archived verbatim.*

## 1. Owner authorization

The final Rental Financial and Lifecycle Integrity Closure dossier is accepted for staging deployment.

The owner has authorized application of:

20261127100000_rental_pricing_amendment_history.sql

Approved SHA-256:

d0d9ca39487486c1cb7e492364a7a7e28bcf4e4f317c4dcc70234ee74b553890

Authorized staging project:

yeklucfthspvejlkffln

The owner will provide confirmation of successful migration application.

Do not independently apply the migration.

Do not access production.

## 2. Approved implementation

Accept the reported implementation of:

- Independent financial amendment history.
- Immutable rental_pricing_amendments records.
- Deferred transaction enforcement.
- Mutation-specific amendment evidence.
- Chronological amendment timestamps.
- Finalized rental pricing input protection.
- Terminal rental date and hand-over protection.
- Existing rental lifecycle compatibility.
- Financial amendment history presentation.
- Account closure compatibility.

Accept the correction to the previous assignment logic finding.

The effective schema already contains the intended assignment_lifecycle_active logic. No unnecessary function rewrite is authorized.

Preserve the permanent regression test.

## 3. Hosted migration verification

Following owner confirmation, verify:

- 143 local migrations.
- 143 hosted staging migrations.
- Zero migration drift.
- No pending migrations.
- Correct staging project reference.
- Applied migration statements correspond to the approved migration.
- rental_pricing_amendments exists.
- Required constraints and indexes exist.
- Deferred enforcement trigger exists and is enabled.
- Rental integrity protection trigger exists and is enabled.
- Browser roles cannot create, modify or delete amendment history.
- Authorized financial operations remain functional.
- Existing rental records remain readable.
- Existing issued contracts remain unchanged.

Use controlled staging QA records for any required mutation tests.

Do not modify unrelated tenant records.

## 4. Remaining production hardening requirements

Document the following without initiating another implementation cycle:

### One-to-one financial amendment evidence

The reported privileged transaction oscillation case demonstrates that identical mutation signatures can potentially reuse earlier amendment evidence.

Record a production hardening requirement for one-to-one correspondence between finalized financial mutations and their amendment records.

Do not represent this residual limitation as resolved.

### Privileged mutation boundaries

Preserve the existing review requirements for:

- service_role.
- Owner-owned SECURITY DEFINER functions.
- Direct PostgreSQL administrative access.

### Rental lifecycle mutation boundaries

Record a targeted production security verification requirement for direct client mutations of lifecycle status, picked_up_at, returned_at and original_ends_at.

Verify that the existing SECURITY INVOKER lifecycle architecture cannot be bypassed through unauthorized direct table mutations.

Do not expand this staging deployment into another general lifecycle redesign.

### Existing baseline failures

Preserve the four established database baseline failures and existing production readiness gates.

## 5. Final regression verification

Preserve the reported baseline:

- 4,198 automated tests.
- 4,194 passing.
- Four established baseline failures.
- Zero newly introduced failures.

Verify the final deployment candidate remains consistent with the tested implementation.

Run the necessary focused regression tests and guarded staging build.

Do not repeat unrelated review cycles.

## 6. Staging deployment

Verify the actual current Git state.

Expected starting baseline:

- origin/staging: aa94dc3.
- origin/main: 31383a9.
- Four unpublished implementation commits.

Publish the verified implementation through the authorized staging branch.

Use normal fast-forward operations.

Do not force push.

Do not modify origin/main.

Preserve the existing Hostinger deployment configuration.

Verify the actual deployed frontend assets and release-specific content.

Confirm:

- Hire amendments panel is present.
- Financial amendment history is connected to the applied staging schema.
- Existing Charges, Money and Agency costs sections remain functional.
- Existing charge reversal functionality remains present.
- Existing four-tab Rental Details layout remains present.
- Existing responsive classes are present.
- Previously accepted Maintenance and Incident Management functionality remains present.
- No production project reference or secret values are included.

Do not rely solely on HTTP 200 responses or deployment timestamps.

## 7. Manual acceptance handoff

Prepare the final executable owner acceptance instructions for Scenarios 30–35.

Preserve the existing scenario identifiers and acceptance history.

Include:

- Exact navigation instructions.
- Required user roles.
- Test data prerequisites.
- Expected financial results.
- Expected authorization behaviour.
- Contract preservation checks.
- Cancellation settlement checks.
- Financial amendment history checks.
- Finalized rental integrity checks.
- Desktop verification.
- iPad portrait verification.
- iPad landscape verification.
- Mobile verification.

Clearly identify which checks require an authenticated browser or physical device.

Do not claim visual responsive acceptance based solely on CSS inspection.

Do not mark owner acceptance checks as passed before owner confirmation.

## 8. Mandatory report delivery

Physically update and save:

E:\pevvy-car-rental-saas-main\Roadmap\Reports\PEVVY_RENTAL_FINANCIAL_ADJUSTMENTS_IMPLEMENTATION.md

E:\pevvy-car-rental-saas-main\Roadmap\Reports\PEVVY_RENTAL_FINANCIAL_ADJUSTMENTS_ACCEPTANCE.md

E:\pevvy-car-rental-saas-main\Roadmap\Reports\PEVVY_RENTAL_FINANCIAL_AMENDMENT_HISTORY_REMEDIATION.md

Create the final deployment closure report:

E:\pevvy-car-rental-saas-main\Roadmap\Reports\PEVVY_RENTAL_FINANCIAL_ADJUSTMENTS_DEPLOYMENT_CLOSURE.md

Archive this instruction:

E:\pevvy-car-rental-saas-main\Roadmap\Prompts\PEVVY_RENTAL_FINANCIAL_ADJUSTMENTS_DEPLOYMENT_CLOSURE_PROMPT.md

Update the applicable roadmap, feature tracker, architecture decisions, changelog, production release manifest, production release checklist and consolidated acceptance register.

Preserve all existing reports.

## 9. Delivery verification

For every required deliverable, provide:

- Absolute file path.
- Physical file existence verification.
- File size.
- Last modified timestamp.
- SHA-256 checksum.
- Completion status.

Verify that all reports are non-empty and contain the required evidence.

A conversational summary does not satisfy the report delivery requirement.

## 10. Final work package status

After successful deployment, record Work Package 4 as:

IMPLEMENTED AND DEPLOYED TO STAGING — OWNER ACCEPTANCE PENDING.

Do not declare it functionally accepted or closed.

Do not begin Security Deposit Management.

Do not initiate another general architecture review.

Complete the deployment, verification, documentation and manual acceptance handoff within this execution.

Production remains NO-GO.

---

## Execution note, 2026-11-27

**§1 and §3.** The migration was already applied when this session checked: 143 local,
143 remote, zero drift, nothing pending. It was **not** applied from here. The applied
statements were compared against the approved file and are identical across all 30
statements once the CLI's stripped separators are normalised, so what is on staging is
`d0d9ca39…3890`.

**§6, the starting baseline.** `origin/staging` was `aa94dc3` and `origin/main`
`31383a9`, both exactly as stated, with **four** unpublished commits — the figure is
correct this time; the earlier "three" was my error and was corrected in the previous
closure prompt's execution note.

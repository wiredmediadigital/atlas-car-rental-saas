# PEVVY — FINAL RENTAL FINANCIAL AND LIFECYCLE INTEGRITY CLOSURE

*Owner authorization, received 2026-11-27. Archived verbatim.*

## 1. Owner decision

The financial amendment history implementation is accepted in principle.

Approve:

- public.rental_pricing_amendments.
- Reuse of the expense_change_events architectural pattern.
- Immutable financial amendment records.
- Independent history preservation without contract issuance.
- Deferred transaction-level enforcement.
- Preservation of the existing rental charge integrity trigger.
- Reuse of p_charge_description as the extension amendment reason.
- Existing Financials tab presentation.
- Existing account closure integration.

Do not replace this architecture.

Hosted migration application is temporarily held pending the focused checks and corrections below.

## 2. Preserve the existing implementation

Preserve the reported implementation baseline:

- origin/staging: aa94dc3.
- origin/main: 31383a9.
- 143 local migrations.
- 142 hosted staging migrations.
- Three unpublished implementation commits.
- 4,162 passing tests.
- Four established baseline failures.
- Existing Rental Details responsive implementation.
- Existing charge reversal and financial integrity protections.
- Twelve saved documentation deliverables.

Verify the actual baseline before proceeding.

## 3. Deferred constraint trigger verification

Verify that the deferred constraint trigger enforces the correct relationship between each finalized hire restatement and its corresponding financial amendment record.

It must not be possible for an earlier amendment record, or an unrelated amendment within the same transaction, to satisfy the requirement for a subsequent unrecorded pricing change.

Verify:

- Multiple amendments within one transaction.
- Consecutive amendments across separate transactions.
- Correct rental association.
- Correct organization association.
- Correct original charge association.
- Previous and revised amounts match the actual mutation.
- Rollback removes both the pricing mutation and its amendment record.
- Unauthorized callers cannot manufacture qualifying history.
- Concurrent operations cannot satisfy each other's history requirements.

Do not redesign the implementation if these guarantees are already enforced.

Add focused tests where coverage is missing.

Distinguish independent database concurrency testing from simulated or sequential testing.

## 4. Correct the obsolete assignment logic

The implementation report identifies obsolete session-GUC wording in:

- public.rental_substitute_vehicle.
- public.rental_reschedule.

Inspect the effective function definitions and compare them with the intended per-organization assignment activation behaviour introduced by migration 20261120100000.

Correct the obsolete logic where the reported defect is confirmed.

Preserve:

- Existing pre-checkout vehicle substitution.
- Existing rental rescheduling.
- Vehicle availability checks.
- Driver conflict prevention.
- Existing rental state restrictions.
- Tenant isolation.
- Existing role authorization.
- Billing entitlement enforcement.
- Existing assignment activation behaviour.

Do not reactivate the withdrawn active vehicle swap workflow.

Do not introduce new vehicle replacement functionality.

Do not change the approved one-vehicle-per-rental business model.

## 5. Protect finalized rental pricing inputs and lifecycle dates

Investigate the reported direct PATCH vulnerability on public.rentals.

Identify the exact columns and mutation paths that allow unauthorized changes to finalized rental pricing inputs, scheduled dates or other financially significant fields.

Protect financially and operationally significant fields according to the existing rental lifecycle rules.

Direct table mutations must not bypass the existing authorized rental workflows.

Preserve legitimate operations through existing RPCs, including:

- Rental creation.
- Draft editing.
- Reservation.
- Authorized rescheduling.
- Authorized pre-checkout vehicle substitution.
- Rental extension.
- Early return.
- Authorized repricing.
- Checkout.
- Return.
- Cancellation.

Completed and cancelled rental records must not be silently rewritten through direct client PATCH requests.

Do not freeze unrelated rental metadata that is legitimately editable.

Use the minimum necessary database protection.

Do not introduce a new rental lifecycle engine.

## 6. Security boundary requirements

Preserve all existing financial integrity protections.

Where privileged RPC boundaries are necessary, enforce:

- Explicit tenant membership.
- Existing role authorization.
- Existing billing entitlement requirements.
- Rental state validation.
- Safe search paths.
- Restricted execution grants.
- Protection against direct unauthorized helper invocation.

Do not use client-settable session flags as security boundaries.

Do not introduce a broad owner exemption without examining the affected privileged functions.

Preserve authorized organization closure and purge operations.

## 7. Focused regression testing

Add or extend tests covering:

- Direct modification of completed rental dates rejected.
- Direct modification of cancelled rental dates rejected.
- Unauthorized modification of finalized pricing inputs rejected.
- Authorized draft editing remains functional.
- Authorized rescheduling remains functional.
- Authorized pre-checkout substitution remains functional.
- Authorized extension remains functional.
- Authorized repricing remains functional.
- Early return remains functional.
- Checkout and return remain functional.
- Cancellation remains functional.
- Vehicle availability validation remains enforced.
- Driver conflict validation remains enforced.
- Cross-tenant mutations rejected.
- Billing-restricted mutations rejected.
- Financial amendment history remains accurate.
- Existing issued contracts remain unchanged.
- Existing charge integrity protections remain enforced.
- Organization closure remains functional.

Preserve all previously accepted workflows.

Do not reopen unrelated Incident Management or Maintenance Management functionality.

## 8. Migration discipline

The financial amendment history migration remains unpublished and unapplied.

Verify that it remains unapplied before modifying it.

Where technically appropriate, incorporate these narrowly related corrections into the existing unpublished migration.

Do not modify any previously applied migration.

Do not create unnecessary migration files.

Inspect effective function definitions after all preceding migrations before redefining functions.

Do not apply the migration to hosted staging.

Do not access production.

## 9. Final migration dossier

Provide a consolidated final dossier containing:

- Exact migration filename.
- SHA-256 checksum.
- Migration size.
- Affected tables, policies, triggers and functions.
- Financial amendment history enforcement mechanism.
- Deferred constraint trigger verification.
- Rental pricing input protection.
- Rental lifecycle date protection.
- Assignment logic corrections.
- Authorization boundaries.
- Compatibility with existing rentals.
- Account closure compatibility.
- Automated test results.
- Existing baseline failures.
- Remaining limitations.
- Local and remote migration ledger.
- Exact isolated worktree path.
- Exact PowerShell staging application commands.
- Recovery and rollback considerations.

Ensure the dossier explicitly states whether any remaining direct client mutation path can bypass the finalized financial and lifecycle protections.

## 10. Documentation requirements

Physically save and update the existing remediation report:

E:\pevvy-car-rental-saas-main\Roadmap\Reports\PEVVY_RENTAL_FINANCIAL_AMENDMENT_HISTORY_REMEDIATION.md

Update the implementation report and acceptance report.

Archive this instruction in:

E:\pevvy-car-rental-saas-main\Roadmap\Prompts\PEVVY_RENTAL_FINANCIAL_LIFECYCLE_INTEGRITY_CLOSURE_PROMPT.md

Update the applicable architecture decisions, roadmap, feature tracker, changelog, production checklist, production release manifest and acceptance register.

Preserve all previously saved reports.

Add the focused lifecycle integrity acceptance checks to the existing acceptance scenarios where appropriate.

Do not unnecessarily expand the manual acceptance register.

Provide physical file verification, absolute paths, file sizes and SHA-256 checksums.

## 11. Execution boundaries

Complete these focused corrections and local verification in one execution.

Do not initiate another general architecture review.

Do not begin Work Package 5.

Do not deploy frontend changes against an unapplied migration.

Do not push to origin/main.

Return the final migration dossier for owner application.

Production remains NO-GO.

---

## Execution note, 2026-11-27

**§2, the commit count.** The baseline says "Three unpublished implementation commits".
There were **two**: `e350322` and `f414616`. The figure came from my own closing summary
of the previous turn, which said three, and the authorization carried it forward. Every
other baseline figure was verified exactly as stated.

**§4, the defect was not confirmed.** The stale session-GUC wording is real in migration
`20261120220000`, but `20261124100000_standard_vehicle_swap_release.sql` re-runs the
rewrite block afterwards and corrects it. Queried against the effective schema, **no**
function in `public` or `app` carries `app.assignment_lifecycle_enabled`, and both
`rental_substitute_vehicle` and `rental_reschedule` use
`app.assignment_lifecycle_active`. My previous report asserted this as a live defect on
the strength of reading migration files rather than the schema; that was wrong. No
correction was made, because none was needed. A permanent regression test was added
instead, since the property has already been lost once.

**§3, the gap was real.** The deferred trigger matched only on rental and transaction, so
one amendment row satisfied every hire restatement in the same transaction. Proved with a
failing test, then closed by matching the evidence to the specific mutation.

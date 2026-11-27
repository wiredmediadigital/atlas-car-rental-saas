# PEVVY — CONSOLIDATED HARDENING IMPLEMENTATION AND OWNER ARCHITECTURE DECISIONS

*Owner authorization, received 2026-11-27. Archived verbatim.*

## 1. Authorization

The owner has reviewed PEVVY_PRODUCTION_HARDENING_REPRODUCTION.md.

The reproduction phase is complete.

Proceed with implementation of the confirmed security and integrity corrections using the architectural decisions below.

Do not stop after producing another reproduction report or general implementation plan.

Complete all independently executable implementation, migration development, regression testing and documentation in one execution.

The approved strategy remains:

- Complete all ten roadmap work packages in staging.
- Deploy to production in controlled release stages after roadmap completion.
- Resolve immediate security and financial integrity defects before Work Package 5.

Do not begin Work Package 5 under this instruction.

## 2. Environment boundaries

Authorized staging project:

yeklucfthspvejlkffln

Protected production project:

ysnumxtzcgzyabrghxwq

Use an isolated worktree based on the latest verified origin/staging.

The reproduction report identifies 5634555 as its starting commit. Verify the actual current baseline.

Preserve origin/main, the primary working directory and existing protected worktrees.

Do not access or modify production.

Do not apply hosted staging migrations without separate owner authorization.

Do not modify previously applied migrations.

## 3. Rental lifecycle authorization correction

Correct the confirmed direct rental lifecycle mutation vulnerability.

The existing status transition machine correctly refuses illegal transitions. Preserve it.

The defect is that authorized browser users can directly perform otherwise legal transitions while bypassing mandatory operational validation.

Use the existing lifecycle RPC architecture.

The preferred approach is to move protected lifecycle operations into narrowly authorized SECURITY DEFINER functions, consistent with the existing rental_extend and rental_reprice architecture, and prevent direct browser mutation of protected lifecycle fields.

Assess and correct:

- rental_confirm.
- rental_check_out.
- rental_check_in.
- rental_complete.
- rental_cancel.
- Other existing authorized writers identified through dependency analysis.

Protect all applicable lifecycle-controlled fields, including:

- status.
- picked_up_at.
- returned_at.
- original_ends_at.
- Pickup and return odometer.
- Pickup and return fuel.
- Other protected handover and return information.

Do not protect only the four initially identified columns while leaving equivalent bypasses available.

For every privileged function, explicitly preserve or enforce:

- Authenticated caller identity.
- Organization membership.
- Required role and permissions.
- Billing entitlement or documented exemption.
- Tenant isolation.
- Valid rental state.
- Vehicle availability.
- Driver availability.
- Maintenance restrictions.
- Inspection requirements.
- Assignment compatibility.
- Atomic transaction behaviour.

Use fixed, safe search paths and appropriately restricted execution grants.

Do not rely on caller-settable session variables as authorization boundaries.

Preserve legitimate draft editing and all approved rental lifecycle operations.

Verify that the complete authorized lifecycle remains functional after direct writes are restricted.

## 4. Owner decision — billing entitlement policy

Adopt narrowly scoped safety-preserving exceptions to the billing restriction policy.

### Fully billing-gated RPCs

The following require the existing billing write entitlement:

- maintenance_link_expense.
- maintenance_unlink_expense.
- maintenance_complete.
- maintenance_cancel.
- maintenance_reschedule.
- maintenance_set_service_plan.
- incident_resolve.

Apply app.billing_require_write or the existing equivalent authorization mechanism after tenant and role validation.

### Limited safety-exempt RPCs

The following may permit narrowly defined safety-preserving operations for billing-restricted agencies:

- incident_create.
- incident_update.
- maintenance_create.
- maintenance_start.

These are not blanket exemptions.

Restricted agencies must be able to record an accident, report a breakdown, document safety-related information and initiate necessary maintenance restrictions.

The exemptions must not permit:

- Financial mutations.
- Arbitrary commercial or administrative updates.
- Returning vehicles to service.
- Removing existing safety restrictions.
- Changing ownership or tenant associations.
- Bypassing role permissions.
- Creating an alternative unrestricted mutation path.

Inspect the actual function parameters and effects.

Where an existing function supports both safety-related and ordinary paid operations, enforce billing entitlement conditionally according to the operation's actual effects.

If the existing function cannot safely distinguish these operations, default to billing-gated behaviour rather than grant an unrestricted exemption. Document the limitation.

Preserve the existing vehicle_take_off_road safety exemption.

Preserve billing restrictions on vehicle_return_to_service.

Do not redesign subscription billing.

Do not modify Stripe configuration.

Document the final authorization matrix, including every exemption and its justification.

Update the structural billing security tests to recognize only explicitly approved and tested exemptions.

Do not merely add all four function names to an exemption list without enforcing their restricted behaviour.

Test actual restricted-agency behaviour through direct API and RPC authorization contexts.

## 5. Owner decision — STG-02 assignment activation

Restore the approved default-OFF assignment activation contract.

A missing organization activation record must not enable assignment lifecycle functionality.

Do not ratify the undocumented default-on behaviour introduced by 20261124100000_standard_vehicle_swap_release.sql.

Preserve the approved architecture:

- Single vehicle per rental.
- Original rental lifecycle.
- No active vehicle swap functionality.
- Authorized pre-checkout vehicle substitution.
- Historical assignment preservation.

### Mandatory transition safety

Before implementing the default change, inventory all affected assignment states and dependencies.

Develop a safe forward migration and compatibility mechanism that:

- Preserves closed historical assignment records.
- Reconciles stale open assignments associated with completed or cancelled rentals.
- Preserves actual customer custody for active rentals.
- Preserves legitimate reserved vehicle commitments.
- Allows existing open assignments to complete their normal lifecycle.
- Prevents new stranded in_custody or swap_pending records.
- Prevents false vehicle availability.
- Prevents permanent vehicle exclusion.
- Prevents duplicate assignment commitments.

Do not close an assignment merely because its organization has no activation record.

Do not mark a vehicle returned when it remains in customer custody.

If necessary, distinguish legacy assignment drainage from new assignment activation.

Existing assignments must remain capable of being released through authorized return, completion and cancellation workflows even when new assignment activation is disabled.

Explicitly enabled organizations must be reconciled against the approved architecture. Do not silently overwrite their activation state.

Remove caller-settable session configuration from the effective activation authorization decision.

The database-controlled activation state must remain authoritative.

### Capability reporting

Ensure can_swap is false regardless of assignment activation state.

Preserve the revoked execution permissions for rental_swap_vehicle.

Do not restore active vehicle swap.

Preserve authorized historical assignment visibility independently of whether new assignment lifecycle operations are enabled.

### Required regression coverage

Test:

- Fresh organization without activation record.
- Explicitly disabled organization.
- Explicitly enabled organization.
- Existing reserved rental with an assignment.
- Existing active rental with an in_custody assignment.
- Completed rental with a stale open assignment.
- Cancelled rental with a stale open assignment.
- Return and completion after activation is disabled.
- Vehicle availability following legitimate assignment release.
- Pre-checkout vehicle substitution.
- Historical assignment visibility.
- Active swap rejection for all browser roles.

If the safe transition cannot be implemented without a material architecture change, report that specific blocker before applying any hosted migration.

## 6. One-to-one financial amendment evidence

Correct the confirmed amendment evidence reuse defect.

Every actual finalized hire restatement must have exactly one corresponding immutable amendment record.

Use a unique per-mutation identifier, sequence or equivalent reliable one-to-one mechanism.

Do not rely exclusively on:

- Transaction identity.
- Amount signatures.
- Timestamps.
- PostgreSQL xmin alone.
- A unique index over previous and revised pricing amounts.

Identical pricing transitions may legitimately occur multiple times within a transaction.

The solution must distinguish each actual mutation.

Preserve the existing rental_pricing_amendments architecture.

Do not introduce a parallel financial ledger.

Test:

- Three restatements with only two amendment records.
- Repeated identical pricing transitions.
- Pricing oscillation.
- Correctly recorded repeated transitions.
- Missing evidence.
- Duplicate evidence.
- Evidence reuse.
- Cross-rental and cross-tenant evidence.
- Rollback behaviour.
- Concurrent repricing and extension.

The final recorded revised hire amount must remain consistent with the live hire.

Suppress no-op amendment records only when no meaningful pricing, quantity, date, rate, tax or other tracked amendment field has changed.

Preserve date-only amendments and other legitimate zero-value financial adjustments.

## 7. Maintenance expense association integrity

The reproduction report confirms that cross-tenant association protection already works.

Preserve those existing protections.

Correct the actual association integrity defects.

### Required invariants

A linked maintenance expense must:

- Belong to the same organization.
- Remain allocated to a vehicle.
- Reference the same vehicle as the maintenance record.
- Satisfy existing expense status restrictions.

Enforce these invariants at the database level.

Do not rely solely on maintenance_link_expense or frontend filtering.

### Editing linked expenses

Reject incompatible changes to allocation or vehicle while the maintenance association exists.

Do not silently clear maintenance_id.

Update the existing expense edit interface to explain the association and the required explicit unlink workflow.

Preserve legitimate edits to other permitted expense fields.

### Reassignment

Do not allow an already-linked expense to be silently reassigned to another maintenance record.

Require an explicit authorized unlink followed by a legitimate link operation.

Preserve existing role and billing authorization.

### Cancelled maintenance

Prevent new expense associations with cancelled maintenance records.

Preserve existing historical costs associated before cancellation.

Do not automatically erase costs because maintenance was cancelled.

### Foreign key

Correct the ON DELETE SET NULL behaviour so that only maintenance_id is cleared where supported by the target PostgreSQL version.

Preserve organization_id and tenant integrity.

### Existing inconsistent records

Identify any existing invalid associations.

Do not silently rewrite or discard financial records.

Provide a deterministic remediation plan and identify any data corrections requiring owner approval.

Verify account closure purge compatibility.

## 8. Reconcile baseline database failures

Correct the reporting of the four historical baseline failures.

They are not four independent product defects.

### Assignment activation test

Retain the approved missing-row default-OFF expectation.

Update or extend the test only as necessary to cover the safe transition and revised capability reporting.

### Withdrawn vehicle swap tests

Replace obsolete successful-swap expectations with explicit withdrawal security tests.

Verify that:

- Active vehicle swap remains unavailable.
- Browser roles cannot execute rental_swap_vehicle.
- Unauthorized invocation fails closed.
- Historical assignment data remains preserved.

Do not simply delete the security coverage.

Do not restore withdrawn functionality.

### Billing test

Resolve the genuine billing authorization bypass through the implementation in section 4.

Do not weaken the security test to conceal the bypass.

The full database test suite should pass with no unexplained failures.

## 9. Independent PostgreSQL concurrency verification

Preserve the existing successful 8/8 reproduction evidence.

Repeat affected concurrency tests after hardening.

Use genuinely independent PostgreSQL sessions and deterministic synchronization.

Complete coverage for:

- Concurrent vehicle reservation conflicts.
- Concurrent driver reservation conflicts.
- Concurrent checkout.
- Concurrent return.
- Concurrent charge reversal.
- Concurrent rental repricing.
- Concurrent rental extension.
- Concurrent financial amendment evidence.
- Maintenance restriction conflicts.
- Legacy assignment release and availability.

Report individual scenarios and assertions separately.

Do not represent multiple assertions within three scenarios as coverage of every requested concurrency scenario.

Verify no partial financial or operational mutations survive failed operations.

## 10. Lint and verification

Resolve the three confirmed react-hooks/set-state-in-effect errors.

Address the fourteen existing warnings through focused changes where practical.

Do not undertake broad unrelated component refactoring.

Document any justified remaining warnings.

Restore the canonical npm run verify workflow.

Run:

- Type checking.
- Lint.
- Formatting verification.
- Frontend tests.
- Database tests.
- Security tests.
- Guarded staging build.

Do not suppress security or correctness failures.

## 11. Edge Function readiness

The local source review found no confirmed security defect.

Do not unnecessarily rewrite Edge Functions.

However, local source inspection does not establish hosted deployment readiness.

Verify the actual hosted staging function inventory and configuration status using authorized read-only inspection.

The owner has confirmed that Resend invitation delivery and Staff onboarding work.

Reconcile actual hosted readiness for all nine functions.

Do not expose secret values.

Do not copy production credentials.

Do not blindly redeploy existing working functions.

Do not activate destructive closure schedules or perform destructive account closure testing.

Document remaining credential, deployment and end-to-end acceptance requirements.

## 12. Preserve Work Package 4 acceptance

Formally close Work Package 4 using the owner-confirmed acceptance results.

Preserve:

- Scenario 30: PASS.
- Scenario 31: PASS.
- Scenario 32: Functional role controls verified; reconcile manager correction message evidence.
- Scenario 33: PASS — 6/6.
- Scenario 34: Qualified PASS — 10/10 on tested viewports.
- Scenario 35: PASS — 8/8.

Retain the deferred iPad landscape and final application-wide responsive verification requirements.

Do not reopen accepted functionality unless affected by the actual corrections.

Record roadmap functional completion as 4 of 10 work packages.

## 13. Migration implementation discipline

Develop the minimum necessary forward migrations.

Group related security and integrity changes coherently.

Do not modify any of the 143 previously applied migrations.

Test the complete migration sequence locally.

Verify:

- Migration ordering.
- Function signatures.
- Grants and policies.
- Trigger interactions.
- Tenant isolation.
- Billing authorization.
- Existing data compatibility.
- Assignment transition safety.
- Account closure purge coverage.
- Financial history preservation.

Prepare one consolidated hosted staging migration authorization package.

For each migration provide:

- Exact filename.
- Complete SHA-256 checksum.
- File size.
- Affected database objects.
- Security impact.
- Data impact.
- Required preflight checks.
- Expected post-migration state.
- Recovery considerations.

Do not apply hosted staging migrations under this instruction.

Do not deploy dependent frontend or Edge Function changes before required migrations are applied.

Complete all local implementation and testing before presenting the authorization package.

## 14. Mandatory documentation

Physically create or reconcile:

E:\pevvy-car-rental-saas-main\Roadmap\Reports\PEVVY_RENTAL_FINANCIAL_ADJUSTMENTS_FINAL_ACCEPTANCE.md

E:\pevvy-car-rental-saas-main\Roadmap\Reports\PEVVY_PRODUCTION_HARDENING_IMPLEMENTATION.md

E:\pevvy-car-rental-saas-main\Roadmap\Reports\PEVVY_PRODUCTION_HARDENING_REGRESSION_VERIFICATION.md

E:\pevvy-car-rental-saas-main\Roadmap\Reports\PEVVY_PRODUCTION_HARDENING_STAGING_MIGRATION_AUTHORIZATION.md

Archive this exact prompt:

E:\pevvy-car-rental-saas-main\Roadmap\Prompts\PEVVY_PRODUCTION_HARDENING_IMPLEMENTATION_PROMPT.md

Update the existing:

- Production hardening register.
- Architecture decisions.
- Master roadmap.
- Feature tracker.
- Production release checklist.
- Production release manifest.
- Consolidated acceptance register.
- Changelog.
- Applicable handoff documents.

Record the owner decisions on billing safety exemptions and default-OFF assignment activation explicitly.

Preserve the original reproduction report as historical evidence.

Provide physical file existence verification, absolute paths, file sizes, modification timestamps and complete SHA-256 checksums.

## 15. Final delivery and stopping conditions

Return:

- Exact starting baseline.
- Confirmed defects corrected.
- Implementation changes.
- Architecture decisions implemented.
- Billing authorization matrix.
- Assignment transition safety evidence.
- Migration files and checksums.
- Full test results.
- Independent concurrency results.
- Remaining limitations.
- Hosted staging migration authorization package.
- Outstanding owner actions.
- Readiness assessment for Work Package 5.

Do not stop for another general review.

Pause only for genuine migration authorization, missing credentials, unsafe data correction or material unresolved architecture decisions.

Do not begin Work Package 5.

Do not deploy to production.

Production remains NO-GO.

---

## Execution note, 2026-11-27

**§2, the baseline.** Verified rather than assumed. `origin/staging` was `5634555` and
`origin/main` `31383a9`, both as stated, with 143 migrations and a clean tree. The
reproduction report's own commit `a673521` sat one ahead of `origin/staging`, unpushed;
this work continued in the same isolated worktree
`E:\pevvy-maintenance-acceptance-20261125` rather than creating another, since that
worktree *is* the isolated one and is a descendant of `origin/staging`.

**§11, the gate record is stale.** The hosted inventory shows **four** functions ACTIVE
on staging, not three: `billing`, `billing-webhook`, `pricing` and `team-invitations`.
So five of nine are undeployed, not six — consistent with the owner's confirmation that
Resend invitation delivery and staff onboarding work.

**§12, scenario 32.** The manager correction message is reconciled with three independent
pieces of evidence in `PEVVY_RENTAL_FINANCIAL_ADJUSTMENTS_FINAL_ACCEPTANCE.md` §2,
including its presence in the deployed bundle.

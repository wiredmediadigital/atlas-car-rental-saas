# Production Release Checklist

## Simplified roadmap release boundary (2026-11-24)

- Assignment architecture, active vehicle swap, sequential assignment rollout, and assignment-dependent future work are withdrawn. Preserve historical data; no cleanup migration is authorized by this decision.
- Incident Management P3-01 through P3-04 is an isolated release candidate only. Verify focused tests, typecheck, build, staging migration, tenant isolation, and authenticated UI behavior before production consideration.
- No production deployment, billing/Stripe/Data API change, destructive cleanup, or remote merge is authorized by the roadmap simplification.

Reusable template. Create a release-specific copy or report for each deployment; do not overwrite historical evidence.

## Release identity

- Release ID: Pending
- Feature IDs: Pending
- Git commit: Pending
- Environment: Pending
- Feature flag state: Pending
- Deployment report: Pending

## Pre-Release

- [ ] Feature scope approved
- [ ] Implementation completed
- [ ] Code review completed
- [ ] Automated tests passed
- [ ] Database migrations reviewed
- [ ] Tenant isolation verified
- [ ] Rental lifecycle regression tests passed
- [ ] Payment regression tests passed
- [ ] Staging verification completed
- [ ] Production backup or recovery point confirmed
- [ ] Rollback or forward-recovery plan documented
- [ ] Deployment explicitly approved

## Deployment

- [ ] Correct Git commit identified
- [ ] Required migrations applied safely
- [ ] Application deployment completed
- [ ] Feature flag state confirmed
- [ ] Deployment logs reviewed

## Post-Deployment

- [ ] Production smoke tests passed
- [ ] Existing rental workflows verified
- [ ] Payment workflows verified
- [ ] Tenant isolation checks passed
- [ ] Monitoring reviewed
- [ ] Feature enabled for intended users
- [ ] Production verification completed
- [ ] Feature tracker updated
- [ ] Release history updated
- [ ] Deployment report saved

Critical failures block release or trigger the documented recovery process.

Phase 1B-02 staging validation is complete for the authorized staging-only scope, but this reusable production checklist remains unapproved and unchecked for production release.

## Standard vehicle assignment staging note — 2026-11-24

- Staging-only migration `20261124100000_standard_vehicle_swap_release` is applied and recorded.
- The release defaults missing organization activation rows to enabled while `app.assignment_lifecycle_enabled` is `on`; explicit organization disables and the emergency global control remain available.
- Authenticated staging checkout/swap/check-in acceptance is pending owner-session verification.
- Production deployment and production verification remain unchecked and unauthorized.
- Evidence: `Reports/PEVVY_STANDARD_VEHICLE_SWAP_RELEASE.md`.

## Active vehicle swap withdrawal — 2026-11-24

- Phase 1B-03 Active Vehicle Swap: **WITHDRAWN — SUPERSEDED BY EXISTING STANDARD RENTAL WORKFLOW**.
- Staging application RPC grants were revoked; the historical function and assignment data remain preserved.
- The active swapped QA rental requires actual final return information before the global lifecycle control can safely be disabled without stranding custody state.
- Production remains unchanged and this withdrawal is not a production deployment authorization.
- Evidence: `Reports/PEVVY_PHASE_1B03_WITHDRAWAL.md`.

## Maintenance Management — production promotion checklist (2026-11-26)

Staging is deployed and verified. These remain before production can be considered.

- [x] **Owner manual acceptance — COMPLETE (2026-11-26).** 28 scenarios, 28 passed,
      0 failed, 0 pending, no owner observations. Scenario 19 (preventive servicing) and
      scenario 28 (Maintenance Management dashboard) were the last two confirmed. The
      11/11/4 interim baseline is superseded. Maintenance Management is **FUNCTIONALLY
      ACCEPTED — CLOSED**. Evidence:
      `Reports/PEVVY_MAINTENANCE_MANAGEMENT_FINAL_ACCEPTANCE.md`.
      **This closes the acceptance gate only. Every unchecked item below still stands, and
      functional acceptance is not production deployment authorization.**
- [ ] Decision: assignment activation defaults ON, contradicting the STG-02 contract.
      Either revert the default or amend the contract.
- [ ] Decision: should the eleven incident and maintenance `SECURITY DEFINER` write RPCs
      ask `app.billing_require_write`? Policy proposal recorded in
      `PEVVY_MAINTENANCE_REMEDIATION_RELEASE_CLOSURE.md` §4.
- [ ] Port `withdraw-active-swap.test.ts` so something asserts the vehicle swap stays
      withdrawn. Nothing on this branch does.
- [ ] Update the two stale pre-withdrawal swap contract tests. They fail on an error
      string, not on a security regression, and must not be reported as one.
- [ ] Make the deployment artifact hash reproducible — pin the builder toolchain or
      publish the reviewed artifact instead of rebuilding. The expected-SHA control
      cannot currently pass; see the deployment report §5.
- [ ] Independent concurrency verification against hosted Postgres. PGlite cannot provide
      two genuinely independent transactions.
- [ ] Decide on the six undeployed Edge Functions. Hosted public booking, account closure,
      MFA reset and team invitations cannot be accepted until they are deployed, and that
      needs its own owner approval.
- [ ] Production migration plan and rollback. `20261125130000` is additive — it drops and
      renames nothing — but there is **no down migration**; reverting needs a new forward one.
- [ ] Hostinger deployment-to-commit attribution for the production target.

## Functional acceptance — closed (2026-11-26)

- [x] **Maintenance Management: 28/28 scenarios.** FUNCTIONALLY ACCEPTED — CLOSED.
- [x] **Incident Management, including its dashboard: scenario 29 PASS, 13/13
      verification items, no observations.** FUNCTIONALLY ACCEPTED — CLOSED.
- [x] **Driver availability / conflict prevention: 9/9 scenarios.** Accepted and
      preserved. Independent concurrent-session evidence is still a release gate and is
      listed below, unchanged.

**These three boxes close the ACCEPTANCE gate and nothing else.** Functional acceptance is
not production deployment authorization. Every unchecked item elsewhere in this file still
stands, including:

- [ ] Six of nine Edge Functions are not deployed to staging.
- [ ] The deployment artifact hash is not reproducible by the deploying party.
- [ ] Independent concurrency verification against hosted Postgres.
- [ ] The STG-02 assignment-activation default decision.
- [ ] Whether eleven incident and maintenance `SECURITY DEFINER` write RPCs should call
      `app.billing_require_write`.
- [ ] No down migration exists; reverting requires a new forward one.
- [ ] Hostinger deployment-to-commit attribution for the production target.

**Production remains NO-GO.**

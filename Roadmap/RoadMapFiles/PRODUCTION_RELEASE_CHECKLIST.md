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

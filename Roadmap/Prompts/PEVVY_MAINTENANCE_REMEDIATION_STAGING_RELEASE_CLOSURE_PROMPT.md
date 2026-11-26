# PEVVY — MAINTENANCE REMEDIATION STAGING RELEASE CLOSURE

> Archived verbatim on 2026-11-26. Owner-issued prompt for the release closure that
> follows `PEVVY_MAINTENANCE_MANUAL_ACCEPTANCE_REMEDIATION_PROMPT.md`. The result is
> recorded in `Roadmap/Reports/PEVVY_MAINTENANCE_REMEDIATION_RELEASE_CLOSURE.md`.

## 1. Objective

The Maintenance Management source remediation report has been reviewed.

Continue from the existing completed implementation.

Do not restart implementation, repeat onboarding or rerun the entire repository test suite.

Complete the focused release safety review and prepare the staging deployment.

## 2. Existing implementation

Worktree:

`E:\pevvy-maintenance-acceptance-20261125`

Branch:

`fix/maintenance-manual-acceptance-20261125`

Current final commit:

`51e904e`

Previous staging baseline:

`977e32eb3447af2ec886cb512e8a9f06212b4259`

Pending migration:

`20261125130000_maintenance_acceptance_remediation.sql`

Authorized staging project:

`yeklucfthspvejlkffln`

Protected production project:

`ysnumxtzcgzyabrghxwq`

Review the existing report:

`E:\pevvy-car-rental-saas-main\Roadmap\Reports\PEVVY_MAINTENANCE_MANUAL_ACCEPTANCE_REMEDIATION.md`

Preserve the completed implementation and automated validation.

## 3. Focused review of additional changes

Review only the additional changes introduced outside the original maintenance requirements.

### Account closure

Verify the new incident and maintenance purge coverage:

- Follows the existing account closure authorization model.
- Respects existing retention requirements.
- Preserves required financial and audit records.
- Deletes only the intended organization's eligible records and storage objects.
- Does not perform deletion merely because the subscription expires.

Do not execute an actual account closure against existing staging organizations.

Do not deploy account closure Edge Functions.

### Private app schema

Verify the PUBLIC and anon privilege correction preserves required authenticated and service-role operations.

Check existing RPC execution, RLS evaluation, public booking contracts and billing dependencies.

Retain least-privilege enforcement.

### Assignment lifecycle

Retain the narrow correction for rescheduling reservations created outside member sessions.

Do not reactivate vehicle swapping.

Do not introduce new assignment architecture.

Document the three existing assignment lifecycle failures and their actual operational impact as production release gates.

### CSV vehicle import

The report states that legacy CSV Status values are now ignored and imported vehicles receive the default operational status.

Ensure vehicles explicitly identified as off-road or under maintenance in an import cannot silently become bookable.

Use the existing import validation or a clear operator warning/rejection for unsupported status values.

Do not introduce a separate import architecture.

## 4. Billing authorization decision

Do not modify the eleven existing incident and maintenance billing authorization paths during this release.

Record the proposed policy for a separate focused authorization correction:

Billing-restricted agencies should retain read access and necessary safety-related operations, including reporting incidents, taking unsafe vehicles off the road, starting necessary safety maintenance and documenting or resolving existing incidents and maintenance.

Commercial expansion and new revenue-generating operations should remain restricted.

Routine maintenance scheduling, preventive service plan configuration, expense mutations, new reservations and checkout should follow the existing subscription write restrictions.

Preserve the current safety exception for vehicle_take_off_road.

Preserve billing enforcement for vehicle_return_to_service and vehicle_resolve_legacy_maintenance.

Do not modify Stripe, subscription pricing, billing functions or payment processing.

The existing billing-restricted-access failure remains an explicitly documented production release gate.

## 5. Release readiness

Verify:

- Current origin/staging HEAD.
- Clean implementation worktree.
- Corrective migration contents.
- No unrelated pending migrations.
- Existing staging ledger of 139 applied migrations.
- Backward compatibility of the corrective migration with the currently deployed frontend.
- Required schema changes are present before publishing the new frontend.

Run only focused tests needed for any additional corrections.

Do not repeat the full database and frontend suites.

If the migration requires corrections, update the unapplied migration and validate it before owner execution.

## 6. Staging migration deployment

The previous database push was refused by the execution environment.

Respect that restriction.

Do not attempt to circumvent the safety classifier.

Prepare the exact owner-run PowerShell commands for:

1. Navigating to the verified worktree.
2. Linking the authorized staging project.
3. Verifying the migration ledger.
4. Performing the migration dry run.
5. Applying the single corrective migration.
6. Verifying the resulting ledger.

If owner execution is required, stop at this specific deployment gate and provide the commands.

Do not request another broad approval or assessment.

After the owner confirms successful migration execution, independently verify the migration is applied and continue frontend deployment.

## 7. Guarded build and frontend deployment

Use the existing authorized staging configuration:

- VITE_SUPABASE_URL: https://yeklucfthspvejlkffln.supabase.co
- VITE_SUPABASE_PUBLISHABLE_KEY: existing approved staging browser key.
- Hostinger branch: staging.
- Build command: npm run build.
- Output directory: dist-staging.

Do not use production credentials.

Do not bypass guarded environment validation.

Do not expose or commit configuration secrets.

If local build configuration remains unavailable, provide the exact owner action required.

Once the corrective migration is verified, publish the validated source through a normal fast-forward push to origin/staging.

Verify Hostinger publication and the corrected frontend assets.

Do not claim deployment success from Git push or HTTP 200 alone.

## 8. Final acceptance

Provide a concise manual acceptance checklist covering all 26 scenarios.

Preserve the historical owner baseline:

- 11 passed.
- 11 failed.
- 4 pending.

Do not mark the scenarios manually accepted until the owner confirms them.

Hosted public booking remains blocked by the missing Edge Function.

Do not deploy unrelated Edge Functions.

Production remains NO-GO.

## 9. Final report

Save:

`E:\pevvy-car-rental-saas-main\Roadmap\Reports\PEVVY_MAINTENANCE_REMEDIATION_RELEASE_CLOSURE.md`

Include:

- Focused release safety review.
- Any final corrections.
- Final source commit.
- Migration dry run.
- Migration application status.
- Verified migration ledger.
- Guarded build status.
- Staging push status.
- Hostinger deployment evidence.
- Manual acceptance checklist.
- Remaining production gates.

Archive this prompt to Roadmap/Prompts.

Do not begin Rental Financial Adjustments.

Complete the release closure without another broad implementation cycle.

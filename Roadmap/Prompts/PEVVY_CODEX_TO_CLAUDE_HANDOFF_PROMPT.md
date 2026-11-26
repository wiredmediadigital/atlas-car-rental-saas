# PEVVY — COMPLETE DEVELOPMENT HANDOFF FROM CODEX TO CLAUDE CODE

## 1. Objective

The project owner is transitioning Pevvy development from Codex to Claude Code.

Prepare a comprehensive, accurate and repository-based development handoff that enables Claude Code to continue development immediately without repeating previous investigations, losing implementation context, overwriting existing work or introducing production risks.

This execution is for documentation and handoff preparation only.

Do not implement additional application features or Maintenance Management corrections during this execution.

## 2. Primary repository

`E:\pevvy-car-rental-saas-main`

Create the handoff directory:

`E:\pevvy-car-rental-saas-main\Roadmap\Handoff`

Preserve the existing directory structure:

- Roadmap/Prompts
- Roadmap/Reports
- Roadmap/RoadMapFiles

Do not move, rename or delete existing project files.

## 3. Establish the actual current project state

Inspect the repository, existing worktrees, Git branches, remote references, roadmap documents, implementation reports and deployment reports.

Do not rely solely on historical reports where the current repository provides more accurate information.

Establish:

- Current local main commit.
- Current remote main commit.
- Current remote staging commit.
- Current production release commit, if established by existing evidence.
- Current staging deployment commit.
- Dirty working directories.
- Uncommitted changes.
- Untracked files.
- Unpushed commits.
- Existing isolated worktrees.
- Active feature branches.
- Superseded feature branches.
- Outstanding database migrations.
- Previously applied migrations.
- Current development blockers.

Clearly distinguish verified information from historical information and unverified assumptions.

Do not clean, reset, stash, merge, rebase or modify existing application work.

## 4. Create CLAUDE.md

Create:

`E:\pevvy-car-rental-saas-main\CLAUDE.md`

If CLAUDE.md already exists, inspect and carefully integrate its existing valid instructions.

This file must provide concise, persistent instructions for Claude Code.

Include:

### Project overview

- Pevvy is a multi-tenant car rental SaaS platform.
- Actual frontend architecture.
- Actual backend architecture.
- Supabase database architecture.
- Authentication and authorization model.
- Tenant isolation requirements.
- Existing application conventions.
- Actual package manager and development commands.

Derive technical details from the repository.

### Mandatory development rules

- Inspect existing implementation before creating new functionality.
- Reuse existing components, RPCs, database structures and application conventions.
- Avoid unnecessary architectural redesign.
- Do not introduce duplicate systems.
- Preserve accepted functionality.
- Prefer implementation and validation over repeated assessment-only reports.
- Use focused regression testing.
- Do not repeatedly execute the entire repository test suite unnecessarily.
- Do not claim tests, deployments or manual acceptance succeeded without evidence.
- Clearly distinguish implementation, automated validation, deployment and manual acceptance.
- Never expose secrets or credentials.

### Environment restrictions

Staging Supabase project:

`yeklucfthspvejlkffln`

Production Supabase project:

`ysnumxtzcgzyabrghxwq`

Staging frontend:

`https://quantum-lavenderblush-buffalo-97.hostingersite.com`

Production frontend:

`https://pevvy.io`

Production changes require explicit owner authorization.

Do not deploy to production merely because staging acceptance passes.

### Git restrictions

- Fetch the latest remote references before integrating changes.
- Preserve dirty worktrees and uncommitted work.
- Use isolated worktrees where appropriate.
- Do not blindly merge historical remediation branches.
- Do not force push.
- Do not rewrite remote history.
- Do not promote superseded or experimental features.

### Mandatory reporting

Every implementation execution must save a report under:

`E:\pevvy-car-rental-saas-main\Roadmap\Reports`

Archive implementation prompts under:

`E:\pevvy-car-rental-saas-main\Roadmap\Prompts`

Maintain roadmap documents under:

`E:\pevvy-car-rental-saas-main\Roadmap\RoadMapFiles`

Reference the detailed handoff documents rather than placing the entire project history inside CLAUDE.md.

## 5. Create PEVVY_PROJECT_HANDOFF.md

Create:

`Roadmap/Handoff/PEVVY_PROJECT_HANDOFF.md`

Include:

- Project purpose.
- Product scope.
- Technical architecture.
- Repository structure.
- Application modules.
- Authentication architecture.
- Tenant isolation architecture.
- Database organization.
- API and RPC conventions.
- Frontend routing.
- State management.
- Query and cache conventions.
- UI component conventions.
- Testing architecture.
- Deployment architecture.
- Relevant technical decisions.
- Current development priorities.

Provide a reading order for Claude Code.

Include links to relevant repository files and existing reports.

Do not duplicate every historical implementation report.

## 6. Create CURRENT_DEVELOPMENT_STATE.md

Create:

`Roadmap/Handoff/CURRENT_DEVELOPMENT_STATE.md`

Document the actual implementation status of:

- Rental lifecycle.
- Fleet Management.
- Vehicle availability.
- Customer Management.
- Driver availability and conflict prevention.
- Incident Management.
- Maintenance Management.
- Expense Management.
- Public booking.
- Rental financial functionality.
- SaaS subscription billing.
- Authentication and authorization.
- Tenant isolation.
- Reporting.
- Other existing modules.

For each module, distinguish:

- Implemented.
- Automatically validated.
- Deployed to staging.
- Manually accepted.
- Partially implemented.
- Failed acceptance.
- Pending.
- Withdrawn.

Record relevant source commits, migrations, reports and outstanding defects.

Do not represent partially implemented functionality as complete.

## 7. Preserve approved product decisions

Document the following established product decisions.

### Rental agreements

- One vehicle per rental agreement.
- Pre-checkout vehicle substitution may follow the existing supported workflow.
- Post-checkout vehicle replacement is handled by closing the original rental and creating another rental.
- Existing discounts may be used for the replacement rental.
- Do not reactivate active vehicle swapping.
- Do not introduce multi-vehicle assignment architecture into the standard rental workflow.

### Driver availability

- Renter and driver are separate roles.
- Both use existing customer records.
- A renter may hold multiple rentals with different eligible drivers.
- A customer may drive multiple rentals when the rental periods do not conflict.
- Primary and additional drivers must not have conflicting committed rental periods.
- Actual overdue custody blocks subsequent checkout until the previous vehicle is returned.
- Preserve the accepted driver availability implementation.

Record the owner-confirmed driver availability acceptance result of 9/9.

### Incident Management

- Incidents record breakdowns, accidents, damage, theft and other operational events.
- Rental association is optional.
- Maintenance association is optional.
- Incident resolution does not automatically complete maintenance.
- Maintenance completion does not automatically resolve incidents.
- Do not automatically modify rental agreements or customer charges.

### Maintenance Management

- Maintenance records control maintenance-related vehicle restrictions.
- Effective vehicle status is system-derived.
- Remove general manual operational status editing.
- Independent off-road restrictions remain supported through dedicated authorized actions.
- Future scheduled maintenance restricts overlapping rental periods.
- Non-overlapping rental periods remain eligible.
- Actual maintenance commencement immediately applies the maintenance restriction.
- Active overdue maintenance continues blocking checkout.
- Maintenance completion releases only the applicable maintenance restriction.
- Other restrictions must remain effective.
- Incident Details provides Create maintenance.
- Maintenance may optionally reference an incident.
- Related maintenance must be visible from Incident Details.

### Financial architecture

- Pevvy is an operational car rental platform, not a full accounting system.
- Preserve existing expense and payment systems.
- Do not introduce a duplicate ledger or comprehensive accounting engine.
- Rental customer financial transactions and Pevvy SaaS subscription billing are separate concerns.

## 8. Create ENVIRONMENT_AND_DEPLOYMENT.md

Create:

`Roadmap/Handoff/ENVIRONMENT_AND_DEPLOYMENT.md`

Document:

- Local development environment.
- Staging environment.
- Production environment.
- Supabase project identities.
- Hostinger deployment configuration.
- Git branch bindings.
- Build commands.
- Build output directories.
- Required environment variable names.
- Existing environment validation.
- Database migration procedures.
- Staging deployment procedures.
- Production release restrictions.
- Rollback procedures where documented.
- Known deployment limitations.

Established staging configuration:

- Git branch: staging.
- Hostinger build command: npm run build.
- Output directory: dist-staging.
- Guarded build: npm run build:staging.
- Staging Supabase URL: https://yeklucfthspvejlkffln.supabase.co.

Verify these against existing repository and deployment evidence.

Document the previously encountered guarded build configuration limitations.

Do not extract, copy, print or store secret values.

Do not change Hostinger configuration.

Do not deploy anything during the handoff.

## 9. Create DATABASE_MIGRATION_STATE.md

Create:

`Roadmap/Handoff/DATABASE_MIGRATION_STATE.md`

Document:

- Local migration inventory.
- Known staging migration ledger.
- Known production migration ledger from existing authorized evidence.
- Migration dependencies.
- Staging-only migrations.
- Production release candidates.
- Superseded migrations.
- Withdrawn feature migrations.
- Outstanding migration verification requirements.
- Known schema differences.
- Required migration sequencing.

Specifically account for:

- Incident Management migrations.
- Driver availability migrations.
- Maintenance Management migrations.
- Maintenance fleet status integration corrections.
- Withdrawn vehicle-swap migrations.
- Historical billing remediation migrations.

Previously reported maintenance migrations:

- 20261125110000_maintenance_management.sql
- 20261125120000_maintenance_fleet_status_integration.sql

Verify staging migration state through safe read-only operations where existing authorized access permits.

Do not access production to establish new information during this handoff.

Do not apply migrations.

Do not repair migration history.

Do not rewrite migration files.

Identify any migration ledger uncertainty explicitly.

## 10. Create WORKTREE_AND_BRANCH_INVENTORY.md

Create:

`Roadmap/Handoff/WORKTREE_AND_BRANCH_INVENTORY.md`

Inspect all relevant Pevvy worktrees and branches.

For each worktree, document:

- Absolute path.
- Branch.
- Current commit.
- Working directory status.
- Uncommitted changes.
- Untracked changes.
- Relationship to origin/main and origin/staging.
- Purpose.
- Whether the worktree is active, historical, superseded or protected.
- Whether its commits are safe release candidates.
- Known dependencies.

Identify the recommended worktree or clean staging baseline for Claude Code to continue Maintenance Management remediation.

Do not assume that the primary repository is clean.

Do not merge or promote entire historical remediation branches.

Do not delete old worktrees.

Provide exact instructions for Claude to establish an appropriate working directory without overwriting existing work.

## 11. Create KNOWN_ISSUES_AND_ACCEPTANCE.md

Create:

`Roadmap/Handoff/KNOWN_ISSUES_AND_ACCEPTANCE.md`

Record the latest owner manual acceptance results.

### Driver availability

9 of 9 scenarios passed.

Preserve this accepted functionality.

### Maintenance Management

26 scenarios:

- 11 passed.
- 11 failed.
- 4 pending.

Passed:

1. Fleet status synchronization.
2. Vehicle Details active maintenance presentation.
3. Removal of standalone In maintenance option from Vehicle Details.
4. Early-start confirmation.
5. Cancelling early-start confirmation.
6. Actual timestamps.
7. Maintenance completion restores eligible availability.
8. Multiple maintenance restrictions.
9. Independent off-road restrictions.
10. Optional incident association.
11. Automatic Fleet and Vehicle Details refresh.

Failed:

1. Future scheduled maintenance availability.
2. Overlapping maintenance reservation prevention.
3. Immediate maintenance restriction after confirmed early start.
4. Overdue maintenance checkout restriction.
5. Incident-to-maintenance creation and prepopulation.
6. Related maintenance on Incident Details.
7. Incident resolution lifecycle independence.
8. Preventive servicing interface.
9. Downtime calculation or presentation.
10. Supporting documents.
11. Standard rental regression.

Pending:

1. Legacy maintenance restriction resolution.
2. Incident resolution warning.
3. Maintenance completion independence.
4. Expense integration.

Additional owner-confirmed interface defects:

- Vehicle Details still contains an Operational status dropdown.
- Edit Vehicle still contains the legacy Status dropdown.
- Maintenance Details displays a generic View incident link.
- Incident Details does not display related maintenance records.
- Maintenance MNT-2026-00009 and incident INC-2026-00002 are relevant staging examples.
- Vehicle DEMO-004 is relevant to the observed interface defects.

Record the previous automated test result of 105 passed, while making clear that this did not establish successful manual acceptance.

Do not infer the root cause of each failed scenario without supporting evidence.

Identify critical operational failures separately from missing interface functionality.

Maintenance Management remains NO-GO for production.

## 12. Create NEXT_IMPLEMENTATION_TASK.md

Create:

`Roadmap/Handoff/NEXT_IMPLEMENTATION_TASK.md`

The immediate next development task is:

PEVVY — MAINTENANCE MANAGEMENT MANUAL ACCEPTANCE FAILURE REMEDIATION

Locate the latest consolidated remediation prompt if it has already been archived.

Expected location:

`Roadmap/Prompts/PEVVY_MAINTENANCE_MANUAL_ACCEPTANCE_REMEDIATION_PROMPT.md`

If it exists, reference it and preserve its complete requirements.

If it does not exist, explicitly identify the missing prompt and state that the owner must provide it to Claude Code.

Do not claim the prompt has been archived if it is unavailable.

Document the immediate implementation priorities:

1. Restore standard rental lifecycle integrity.
2. Correct period-specific maintenance availability.
3. Correct immediate and overdue maintenance restrictions.
4. Remove operational status dropdown from Vehicle Details.
5. Remove Status from general vehicle editing.
6. Preserve dedicated independent off-road actions.
7. Complete legacy maintenance restriction resolution.
8. Complete incident-to-maintenance creation.
9. Display related maintenance on Incident Details.
10. Improve related incident presentation on Maintenance Details.
11. Implement incident resolution warning and lifecycle independence.
12. Complete preventive servicing interface.
13. Validate and expose maintenance downtime.
14. Complete supporting documents.
15. Verify expense integration.
16. Preserve previously accepted functionality.
17. Deploy corrected functionality to staging.
18. Obtain owner manual acceptance.

Do not execute these implementation tasks during handoff preparation.

## 13. Roadmap and production release manifest

Inspect the existing:

- FEATURE_TRACKER.md
- MASTER_ROADMAP.md
- ARCHITECTURE_DECISIONS.md
- CHANGELOG.md
- PRODUCTION_RELEASE_CHECKLIST.md
- PRODUCTION_RELEASE_MANIFEST.md

Document the current status and identify inconsistencies.

Update documentation only where necessary to accurately record the development handoff and latest owner acceptance results.

Preserve existing feature identifiers.

The approved simplified roadmap remains:

1. Vehicle-swap withdrawal.
2. Incident Management.
3. Maintenance Management.
4. Rental Financial Adjustments.
5. Security Deposit Management.
6. Rental Invoicing.
7. Payment Reconciliation.
8. Fleet Profitability and Reporting.
9. Rental Exceptions.
10. Customer Communications.

Driver availability is an accepted core rental integrity correction.

Maintenance Management remains the current work package.

Rental Financial Adjustments must not begin until Maintenance Management acceptance is completed or the owner explicitly changes priorities.

Do not mark production release candidates approved merely because they have been deployed to staging.

## 14. Document testing conventions

Identify the actual supported commands for:

- Dependency installation.
- Local development.
- TypeScript validation.
- ESLint.
- Focused frontend tests.
- Focused backend tests.
- PGlite database tests.
- Migration validation.
- Guarded staging build.
- Production build.

Document known test harness limitations.

Specifically distinguish sequential database tests from independent concurrent transaction testing.

Record outstanding production release gates.

Do not run the entire regression suite during handoff preparation.

## 15. Secret and credential handling

Do not include:

- Supabase service role keys.
- Database passwords.
- Stripe secrets.
- Webhook secrets.
- GitHub tokens.
- Hostinger credentials.
- Authentication session tokens.
- Environment file contents containing secrets.

Document environment variable names and approved configuration sources only.

Do not copy secrets between worktrees.

Do not modify authentication or deployment credentials.

## 16. Final handoff validation

Verify:

- CLAUDE.md exists.
- All seven handoff documents exist.
- Referenced repository paths are accurate.
- Referenced reports exist or are explicitly identified as missing.
- Current Git state is accurately documented.
- Existing worktrees remain preserved.
- Maintenance acceptance failures are accurately recorded.
- Driver availability acceptance remains recorded.
- Production restrictions are explicit.
- The next implementation task is unambiguous.
- No application code was modified.
- No database migrations were applied.
- No staging or production deployments occurred.
- No secrets were included.

Do not automatically commit or push the handoff documentation.

Report its Git status and recommended documentation commit procedure.

## 17. Final report

Save the final handoff preparation report to:

`E:\pevvy-car-rental-saas-main\Roadmap\Reports\PEVVY_CODEX_TO_CLAUDE_HANDOFF_REPORT.md`

Include:

1. Handoff completion status.
2. Files created.
3. Files updated.
4. Verified current repository state.
5. Recommended Claude Code working directory.
6. Current staging commit.
7. Known deployment state.
8. Migration state.
9. Existing worktree inventory.
10. Outstanding Maintenance Management defects.
11. Missing documentation or prompts.
12. Production release restrictions.
13. Remaining blockers.
14. Exact instructions for starting Claude Code.
15. Confirmation that no application or database changes were performed.

Archive this prompt to:

`E:\pevvy-car-rental-saas-main\Roadmap\Prompts\PEVVY_CODEX_TO_CLAUDE_HANDOFF_PROMPT.md`

Execute the complete handoff preparation now.

Do not begin application remediation.

The objective is to transfer development ownership to Claude Code with a complete and accurate project context.
# PEVVY Staging Branch Release Candidate Audit

Date: 2026-11-20
Repository: `E:\pevvy-car-rental-saas-main`
Proposed branch: `staging`
Execution mode: read-only audit and documentation

## Verdict

**PARTIAL**

The release scope, exact production base, required changes, exclusions, and safe
branch procedure are established. The repository is not yet a release candidate:
the current worktree is dirty, the staging branch does not exist, the STG-02
migration is not applied to hosted staging, the browser-safe staging build
configuration is unavailable in this environment, and the Hostinger staging
deployment boundary has not been verified in the Hostinger interface.

## Git state

- Current branch: `main`
- Current HEAD: `fbbfe3878826da5ee858d3a9a2280f15f0fd744f`
- Production branch reference: `origin/main` at `31383a9`
- Divergence: local `main` is ahead 1 and behind 0 relative to `origin/main`
- Local HEAD commit: `fix: ensure failure-safe Phase 1B-03 staging cleanup`
- Staged changes: none
- Modified tracked files: 15
- Untracked paths: 191 (including the untracked `Roadmap/` evidence tree)
- Remotes: `origin` points to the target GitHub repository; `upstream` is
  disabled for push
- Relevant ignored files: `.env.staging.local` and `dist-staging/` are ignored;
  no environment contents were printed or included

The current local HEAD is not a clean release baseline. The one local commit is
not present on `origin/main`, and the dirty worktree contains both related
Phase 1B-03 work and unrelated changes. No reset, stash, clean, branch, worktree,
merge, rebase, commit, fetch, or push was performed.

## Existing evidence reviewed

All requested reports were present, including the Phase 1B-03 closure evidence,
STG-02 local implementation/security/validation reports, staging blocker reports,
and the application deployment runbook. Historical acceptance evidence is
preserved, but its fixture sidecars and operational reports must not be copied
blindly into an application release commit.

The closure report records hosted database acceptance PASS for ten scenario groups
with zero residue. It explicitly does not establish browser application
acceptance, STG-02 hosted migration, Hostinger deployment, or production readiness.

## Scope assessment

### Include after review

**Staging infrastructure:** `.gitignore`, `eslint.config.js`, `package.json`,
`package-lock.json`, `vite.config.ts`, `scripts/build-staging.mjs`,
`scripts/staging-build-guard.mjs`, its declaration file, and its tests.

**Phase 1B-03 application:** the rental assignment UI components, rental API and
query integration, assignment access/eligibility code and tests, generated
database types, and the focused lifecycle tests.

**Database dependencies, in migration order:**

1. `20261116100000_rental_assignment_schema_foundation.sql`
2. `20261117100000_historical_assignment_backfill.sql`
3. `20261117110000_assignment_lifecycle_primitives.sql`
4. `20261118100000_rental_pointer_security_remediation.sql`
5. `20261118110000_assignment_lifecycle_integration.sql`
6. `20261118120000_assignment_lifecycle_operations.sql`
7. `20261120100000_assignment_feature_activation.sql`

The final migration depends on the prior assignment schema, helper functions,
enums, lifecycle RPCs, and AAL2-aware authorization helpers. The application must
not be deployed as activated STG-02 behavior before the final migration is
separately reviewed and applied to staging.

**Harness:** commit `fbbfe3878826da5ee858d3a9a2280f15f0fd744f` contains the
failure-safe PostgreSQL acceptance harness and tests. Its current worktree
adjustments must be reviewed together with the STG-02 contract before inclusion.

### Exclude from the application release candidate

- `.env.staging.local`, all credentials, connection strings, and generated
  staging output
- Historical `Roadmap/Reports` acceptance reports, fixture evidence JSON,
  recovery evidence, and session checkpoints; retain them as audit artifacts,
  not browser-release inputs
- `docs/superpowers/plans/*` and `docs/superpowers/specs/*`
- Phase 1B-02 CLI/reconciliation scripts unless a separate operator-tools commit
  explicitly requires them
- Unrelated changes to account-closure, analytics-security, and
  billing-restricted-access tests
- Any unrelated application or configuration changes discovered during commit
  review

## Build and security audit

The local staging build path is present and fail-closed. It uses process-only
variables, requires explicit staging intent, requires the exact approved staging
API URL and a browser publishable key, rejects the production project reference,
privileged keys, legacy-key conflicts, unknown Supabase browser variables, and
does not use `.env.staging.local`.

It targets `dist-staging/`, does not run migrations or Edge Function deployment,
and does not activate assignment-aware functionality. `npm run build:staging`
was blocked in this managed environment because the effective browser staging URL
and publishable key were unavailable. This is a correct safety failure, not a
deployable-build PASS.

The normal production-mode build passed locally, but that does not establish
staging safety. No production Supabase connection or deployment was performed.

## Local verification

- `node --test scripts/staging-build-guard.tests.mjs`: PASS, 2/2
- Focused STG-02/rental/app suite: PASS, 19/19
- `npm run format:check`: PASS
- `npm run lint`: PASS, 0 errors; 12 existing warnings
- `npm run typecheck`: PASS
- `git diff --check`: PASS
- Prior full-suite evidence records 3,832 passing tests plus one Vitest worker
  startup timeout for `Wordmark.test.tsx`; a direct rerun passed that file's 4
  tests. The current wrapper explicitly fails rather than hiding worker errors.
  A new full-suite PASS was not claimed in this audit.

## Remaining blockers

1. Create a clean, reviewed staging release candidate from `origin/main`; do not
   release the current dirty worktree.
2. Decide and review the exact commit set from the manifest.
3. Obtain browser-safe staging URL/key through the authorized Hostinger config
   mechanism and run the guarded staging build.
4. Verify the isolated Hostinger Web App, branch, access protection, rollback
   artifact, Auth redirects, SSL, and SPA fallback in the owner interface.
5. Separately authorize and apply the ordered staging migrations, then validate
   STG-02 before any organization activation.

The next task is **branch preparation only**: create the reviewed candidate from
the exact base and selected files, after owner approval of this manifest. It is
not deployment, migration, activation, or production release authorization.

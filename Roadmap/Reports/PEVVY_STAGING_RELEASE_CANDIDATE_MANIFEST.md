# PEVVY Staging Release Candidate Manifest

## Proposed base

Use immutable `origin/main` commit `31383a9` as the base. Do not branch from the
dirty local `main` worktree. Introduce the reviewed local harness commit
`fbbfe3878826da5ee858d3a9a2280f15f0fd744f` as its own commit, then add the
selected uncommitted changes in separately reviewable commits.

## Proposed commit boundaries

1. **Harness foundation:** cherry-pick `fbbfe38`, then review the current
   `scripts/phase-1b03-postgres-harness.mjs`, its tests, and the PowerShell safety
   tests as one acceptance-tooling boundary.
2. **Staging infrastructure:** `.gitignore`, `eslint.config.js`, package manifest
   and lockfile, `vite.config.ts`, staging build/guard scripts, declaration, and
   guard tests.
3. **Database contract:** the seven ordered assignment migrations listed in the
   release audit, plus the focused PGlite database tests.
4. **Application integration:** assignment UI components, access module/tests,
   rental API/queries/page changes, generated types, and app query tests.
5. **Release documentation:** only the reviewed branch manifest, audit,
   checklist, and plan. Keep fixture sidecars, credentials, and historical
   operational evidence outside the browser release payload.

## Required source files

### Infrastructure

`.gitignore`, `eslint.config.js`, `package.json`, `package-lock.json`,
`vite.config.ts`, `scripts/build-staging.mjs`, `scripts/staging-build-guard.mjs`,
`scripts/staging-build-guard.d.mts`, and
`scripts/staging-build-guard.tests.mjs`.

### Application

`src/features/rentals/assignment-access.ts`, its test,
`src/features/rentals/assignment-queries.test.tsx`,
`src/features/rentals/components/ActiveSwapDialog.tsx`,
`src/features/rentals/components/AssignmentHistoryPanel.tsx`,
`src/features/rentals/api.ts`, `src/features/rentals/queries.ts`,
`src/pages/rentals/RentalDetailPage.tsx`, and `src/types/database.ts`.

### Database and tests

All seven ordered migration files from the audit, plus
`supabase/tests/assignment-feature-activation.test.ts`, the three lifecycle test
files, and `supabase/tests/historical-assignment-backfill.test.ts` after review.

## Explicit exclusions

Exclude `.env.staging.local`, `dist-staging/`, all secrets and connection
strings, historical fixture evidence JSON, historical acceptance reports,
unrelated account/analytics/billing test edits, superpowers planning files,
Phase 1B-02 operator scripts unless separately approved, and any unreviewed
Roadmap artifact. Do not include the entire dirty worktree with `git add .`.

## Release acceptance for the candidate

The candidate is not release-ready until the selected files are committed,
reviewed, built with real authorized browser-safe staging configuration, scanned
for the approved project and absence of production/privileged references, and
tested from the isolated staging branch. The first push must be a reviewed
`staging` push, never a push to `main`.

# Pevvy Release History

Append-only production history. A release is not marked successful without deployment and production-verification evidence.

## No production releases recorded

The governance setup and Phase 0/Phase 1A documents are documentation-only artifacts. No production deployment is claimed by this file.

Future entries must include:

- Release ID and date
- Feature IDs
- Git commit
- Database migrations
- Deployment environment
- Feature flag status
- Deployment result
- Production verification result
- Known issues
- Rollback or recovery reference
- Associated deployment report

## Staging release — 2026-11-26 — Maintenance acceptance remediation

Recorded because it is a deployment with evidence. **It is not a production release and
no production deployment is claimed.**

- Release ID: staging / maintenance-acceptance-remediation-20261126
- Date: 2026-11-26
- Features: Maintenance Management acceptance remediation; incident/maintenance
  integration; vehicle restriction actions; CSV import restriction safety.
- Git commit: `caf6cd1452ed1060e010ebdd1f30daf737f364eb` on `origin/staging`
  (reviewed code `4772e242e6d3b5fb004387776645de4a7a4a62cf`).
- Database migrations: `20261125130000_maintenance_acceptance_remediation.sql`, applied
  by the owner. Staging ledger 140/140, zero drift.
- Deployment environment: Supabase `yeklucfthspvejlkffln` + Hostinger staging
  (`quantum-lavenderblush-buffalo-97.hostingersite.com`).
- Feature flag status: no flag introduced. Assignment lifecycle remains ON by default,
  contradicting the STG-02 contract — open gate.
- Deployment result: **success.** Manifest `f722d3d1…`/192 → `8cfefba1…`/196; reviewed
  code confirmed present in the served bundle by string probe; no production reference
  and no secret key in the artifact.
- Production verification result: **none. Production was not touched.**
- Known issues: six of nine Edge Functions not deployed, so hosted public booking,
  account closure, MFA reset and team invitations cannot be accepted; two stale swap
  contract tests; eleven ungated incident/maintenance write RPCs; deployed artifact hash
  not reproducible by the deploying party.
- Rollback reference: previous staging tip `977e32eb3447af2ec886cb512e8a9f06212b4259`,
  previously deployed artifact `f722d3d19a84ca8a48a8ea881eef6d58aee37b7c232335064162b496063237fe`.
  The migration is additive — it drops and renames nothing — but there is **no down
  migration**; reverting the schema would need a new forward migration.
- Deployment report: `Roadmap/Reports/PEVVY_MAINTENANCE_STAGING_DEPLOYMENT_FINAL.md`
- Manual acceptance: **NOT PERFORMED.** Owner baseline 11 passed / 11 failed / 4 pending
  stands unchanged.

## 2026-11-26 — Maintenance expense workflow enhancement (staging)

- Commits: `33769b6` (feature), `f41ea5e` (permission gate). Two fast-forwards to
  `origin/staging`; no force push; `origin/main` unchanged at `31383a9`.
- Database: **no migration.** Staging ledger unchanged at 140/140, zero drift.
- Deployment environment: Supabase `yeklucfthspvejlkffln` + Hostinger staging
  (`quantum-lavenderblush-buffalo-97.hostingersite.com`).
- Feature flag status: no flag introduced.
- Deployment result: **success.** Manifest `8cfefba1…`/196 → `9357a743…`/196 →
  `7fec4e62…`/196. Verified by content: 170 asset files crawled, all four strings unique
  to this change found in the deployed `MaintenanceDetailPage` chunk served as real
  JavaScript, that chunk byte-identical to the local build once chunk content hashes are
  normalised, 0 production references and 0 leaked secret keys.
- Production verification result: **none. Production was not touched.**
- Known issues: the deployed artifact hash is still not reproducible by the deploying
  party — the host rebuilds from source and Tailwind emits a LAB colour component
  differing by 0.000015, which moves every downstream content hash. Traced to four bytes
  in `index.css` this release, as last. `npm run lint` is red on this baseline with 12
  pre-existing errors in `incidents/api.ts`, `IncidentNewPage.tsx` and
  `RentalNewPage.tsx`, so `npm run verify` cannot pass on `origin/staging`.
- Rollback reference: previous staging tip `f7e331e2b65ef33604b40810b80aa41c803a1dfa`,
  previously deployed artifact
  `8cfefba1e5c966b91c3c5af667509dd4f5ee15b09b6ddf596e53260bc246b245`. Frontend-only —
  no schema change to reverse.
- Deployment report: `Roadmap/Reports/PEVVY_MAINTENANCE_EXPENSE_WORKFLOW_ENHANCEMENT.md`
- Manual acceptance: **NOT PERFORMED.** Owner baseline 11 passed / 11 failed / 4 pending
  stands unchanged. Suggested scenario 27 is in §11 of the report.

## 2026-11-26 — Preventive servicing correction and Maintenance dashboard (staging)

- Commits: `3ba371e`..`cd6fc95` (nine). One fast-forward to `origin/staging`; no force
  push; `origin/main` unchanged at `31383a9`.
- Database: **one corrective migration, `20261126120000`, NOT APPLIED.** Staging stands at
  **140 applied / 141 local**, drift of 1 by design. It replaces `maintenance_complete`
  to advance a recurring service plan, and adds `maintenance_fleet_downtime`. Additive:
  two `create or replace`, a comment and grants; no table DDL, nothing dropped.
- Deployment environment: Supabase `yeklucfthspvejlkffln` + Hostinger staging
  (`quantum-lavenderblush-buffalo-97.hostingersite.com`).
- Feature flag status: no flag introduced.
- Deployment result: **success.** Manifest `7fec4e62…`/196 → `9a8ba920…`/198. Verified by
  content: 172 asset files crawled, eight strings unique to this release found in the
  deployed bundle, the `MaintenanceDetailPage` chunk byte-identical to the local artifact
  once chunk hashes are normalised, 0 production references and 0 leaked secret keys.
- Until the migration is applied: recurring advancement does not happen (no regression,
  the defect simply persists) and the dashboard's downtime tile reads "Unavailable" and
  says why, rather than a bare dash that would look like zero. It self-heals on apply with
  no redeploy.
- Production verification result: **none. Production was not touched.**
- Known issues: the deployed artifact hash is still not reproducible by the deploying
  party — the host rebuilds from source and Tailwind emits a LAB colour component
  differing by 0.000015. `npm run lint` remains red on this baseline with 12 pre-existing
  errors in `incidents/api.ts`, `IncidentNewPage.tsx` and `RentalNewPage.tsx`. The fleet
  CSV export still carries a "Next service" column sourced from the now-unwritable legacy
  column — left deliberately, needs an owner decision.
- Rollback reference: previous staging tip `0766e82b4af959b01d1f6bc499056d388d8652ec`,
  previously deployed artifact
  `7fec4e624cd75a62a4df1108d9cf2786a8ea83d9da6dcad2adea0b171a913bbf`. Frontend-only
  rollback; the migration is unapplied, so there is nothing to reverse.
- Deployment report: `Roadmap/Reports/PEVVY_PREVENTIVE_SERVICING_FINAL_CORRECTION.md`
- Manual acceptance: **NOT PERFORMED.** 26 passed / 1 failed / 0 untested stands. Scenario
  19 remains failed until the owner verifies it; dashboard acceptance is scenario 28.

## 2026-11-26 — preventive servicing deployment closure (staging)

- Published commit: `dd01c82c2e1da56edcb143c9186d9b6f3feae323`
- `origin/staging`: `0f4fc5e..dd01c82`, fast-forward, no force. `origin/main` unchanged at
  `31383a97eb8e000f9189913b255af4da22bf3a26`.
- Staging migration `20261126120000_maintenance_service_plan_advancement.sql`: **APPLIED**
  by the owner. Ledger verified independently and mechanically: 141 local, 141 applied,
  0 local-only, 0 remote-only, 0 mismatched pairs, last applied `20261126120000`.
- Function permissions: **verified on the hosted database** this time, not owner-reported,
  by reading back the live schema. `maintenance_fleet_downtime` and `maintenance_complete`
  are both `REVOKE ALL ... FROM PUBLIC` with `authenticated` and `service_role` granted and
  `anon` absent; both SECURITY DEFINER with `search_path = public, pg_temp`.
- Downtime RPC reachability: a live anonymous call returned HTTP 401 `42501 permission
  denied for function`, not `PGRST202`. PostgREST resolves the function and its named
  signature, so the schema cache has reloaded and the dashboard tile no longer errors.
- Source change: the fleet CSV export's `Next service` column, which was still printing the
  now-unwritable legacy column. Column name, position and the file's 33 columns unchanged.
- Guarded build: 199 files, `09ef62a85d3e6ce7…`. The 198 → 199 move was investigated: the
  previous commit rebuilds to 198 files and `f5e07fe48e3a17c0…`, exactly its recorded hash,
  and the added file is `assets/api-*.js` emitted as a shared chunk.
- Deployment result: **success.** Manifest `9a8ba920…`/198 →
  `e4c586445ed429e7986c344e5d10d17328938eaaf2e10a8d3836785be2a1f698`/199. Verified by
  content: 173 asset files crawled, 171 of 171 `.js` served as JavaScript, the eight
  strings unique to the previous release all still present, 0 production references, 0
  leaked secret keys. Because this release adds no new user-visible string, the CSV
  correction was proved structurally: the deployed `VehiclesPage` chunk now reaches the
  chunk holding the service-plan query, which it did not before.
- Production verification result: **none. Production was not touched.**
- Known issues: the deployed artifact hash remains unreproducible by the deploying party —
  the host rebuilds from source. `npm run lint` is still red on this baseline with 12
  pre-existing errors in `incidents/api.ts`, `IncidentNewPage.tsx` and `RentalNewPage.tsx`.
  Six of nine Edge Functions remain undeployed.
- Rollback reference: previous staging tip `0f4fc5e7ce2bd7003f4aa8fea124361933a45b0a`,
  previously deployed artifact
  `9a8ba920d0cbbee1a1c332b8a36e36998d68019652add28f9a34b776005de424`. Frontend-only; the
  migration replaces a function with a compatible signature, so the previous frontend runs
  against it unchanged.
- Deployment report: `Roadmap/Reports/PEVVY_PREVENTIVE_SERVICING_DEPLOYMENT_CLOSURE.md`
- Manual acceptance: **NOT PERFORMED.** 26 passed / 1 failed / 0 untested stands. Scenario
  19 and scenario 28 both await owner verification.

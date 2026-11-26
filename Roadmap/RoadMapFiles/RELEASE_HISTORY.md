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

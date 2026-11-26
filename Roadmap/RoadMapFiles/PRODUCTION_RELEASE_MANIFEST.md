# Production release manifest

- Candidate: `feat/maintenance-management-20261125`
- Base: `112cc994acaef9dc9f0904c719de4d277d696db3`
- Scope: staging-only Maintenance Management.
- Production project: `ysnumxtzcgzyabrghxwq`, unchanged and not accessed.
- Production release: NO-GO.
- Latest candidate: `977e32e`; corrective staging migration applied, production unchanged.

Promotion requires staging migration, guarded browser build, Hostinger binding,
and authenticated acceptance evidence.

## Maintenance acceptance remediation — 2026-11-26

- Candidate: `fix/maintenance-manual-acceptance-20261125`
- Base: `977e32eb3447af2ec886cb512e8a9f06212b4259` (= `origin/staging`)
- Corrective migration: `20261125130000_maintenance_acceptance_remediation.sql`
- Staging migration: **NOT APPLIED**. The dry run confirmed it as the only
  pending migration, then the push was refused by the execution environment's
  safety classifier. Staging remains at 139 migrations, ending
  `20261125120000`, verified read-only afterwards.
- Staging source push: **NOT PUSHED**, deliberately. The frontend reads columns
  the migration adds, so publishing it first would break staging.
- Production project `ysnumxtzcgzyabrghxwq`: unchanged, not accessed, not linked.
- Production release: **NO-GO**.

### Staging Edge Function parity gap

Three of nine functions are deployed to staging: `billing`, `billing-webhook`,
`pricing`. Not deployed: `account-closure`, `account-closure-notice`,
`gps-provider`, `mfa-reset`, `public-booking`, `team-invitations`. Hosted
acceptance of public booking, account closure, MFA reset and team invitations is
blocked by this, not by a maintenance regression. Deploying them needs its own
owner approval and was not attempted.

### Outstanding before promotion

- Owner manual acceptance of the 26 maintenance scenarios.
- Independent concurrency verification (PGlite cannot provide two independent
  hosted transactions).
- Hostinger deployment-to-commit attribution.
- A decision on whether eleven incident and maintenance write RPCs should ask
  `app.billing_require_write`.

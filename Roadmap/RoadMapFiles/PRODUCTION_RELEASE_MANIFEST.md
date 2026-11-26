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

## Staging deployment executed — 2026-11-26

- Published commit: `caf6cd1452ed1060e010ebdd1f30daf737f364eb`
- Reviewed code commit: `4772e242e6d3b5fb004387776645de4a7a4a62cf` (ancestor, verified)
- `origin/staging`: `977e32e..caf6cd1`, fast-forward, no force. `origin/main` unchanged
  at `31383a97eb8e000f9189913b255af4da22bf3a26`.
- Staging migration `20261125130000_maintenance_acceptance_remediation.sql`: **APPLIED**
  by the owner. Ledger verified independently: 140 local, 140 applied, zero drift, last
  applied `20261125130000`.
- Function permissions after the migration, **owner-verified** (not independently
  verified; this session holds no SQL access to staging): `authenticated` true,
  `service_role` true, `anon` false.
- Hostinger staging publication: **verified by content.** Manifest moved
  `f722d3d1…`/192 files to `8cfefba1…`/196 files, project ref `yeklucfthspvejlkffln`.
- Deployed artifact SHA differs from the locally guarded `c09c4524…`. Investigated:
  every deployed JavaScript file is byte-identical to the guarded artifact once content
  hashes are normalised; the only content difference in the bundle is two Tailwind LAB
  colour values differing in the sixth decimal place in `index.css`. The manifest hashes
  filenames as well as contents, so differing chunk hashes change it. The deployed build
  is the reviewed source.
- Deployed configuration: production project reference absent, no secret key, staging
  reference present; the `env` chunk is byte-identical to the guarded artifact.
- Edge Functions: **none deployed.** Three of nine live (`billing`, `billing-webhook`,
  `pricing`). Hosted public booking, account closure, MFA reset and team invitations
  remain blocked by this pre-existing gap.
- Production project `ysnumxtzcgzyabrghxwq`: unchanged, not accessed, not linked.
- Production release: **NO-GO.**

### Outstanding before promotion

- Owner manual acceptance of the 26 maintenance scenarios. The 11/11/4 baseline stands.
- Assignment activation defaulting ON against the STG-02 contract — owner decision.
- A decision on whether eleven incident and maintenance write RPCs should ask
  `app.billing_require_write`.
- `withdraw-active-swap.test.ts` is absent from this branch, so nothing asserts the
  withdrawn vehicle swap stays withdrawn.
- A reproducible deployment artifact hash: Hostinger rebuilds from source rather than
  publishing the reviewed artifact, so the expected-SHA control cannot currently pass.
- Independent concurrency verification.

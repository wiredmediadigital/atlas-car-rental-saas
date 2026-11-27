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

## Preventive servicing deployment closure — 2026-11-26

- Published commit: `dd01c82c2e1da56edcb143c9186d9b6f3feae323`
- `origin/staging`: `0f4fc5e..dd01c82`, fast-forward, no force. `origin/main` unchanged at
  `31383a97eb8e000f9189913b255af4da22bf3a26`.
- Staging migration `20261126120000_maintenance_service_plan_advancement.sql`: **APPLIED**
  by the owner. Ledger verified independently: **141 local, 141 applied, zero drift**, last
  applied `20261126120000`.
- Function permissions after the migration: **independently verified on the hosted
  database** by reading back the live schema — not owner-reported, unlike the previous
  entry. `maintenance_fleet_downtime` and `maintenance_complete`: `authenticated` true,
  `service_role` true, **`anon` absent**; both SECURITY DEFINER with
  `search_path = public, pg_temp`; the downtime function scoped by `app.is_org_member`
  within its own WHERE clause.
- PostgREST exposure confirmed live: anonymous call returns `42501 permission denied for
  function`, not `PGRST202`, so the schema cache has reloaded.
- **No migration was created by this package.** `supabase/migrations/` is unchanged at 141.
- Hostinger staging publication: **verified by content.** Manifest moved `9a8ba920…`/198
  files to `e4c58644…`/199 files, project ref `yeklucfthspvejlkffln`. 173 asset files
  crawled; 171 of 171 `.js` served as JavaScript; 0 production references; 0 secret keys.
- The single added file was investigated, not assumed: the previous commit rebuilds to 198
  files and `f5e07fe48e3a17c0…`, exactly its recorded hash, and the 199th file is
  `assets/api-*.js` emitted as a shared chunk now that the Vehicles page reaches it.
- Deployed artifact SHA still differs from the locally guarded `09ef62a8…`; the host
  rebuilds from source rather than publishing the reviewed artifact. File count matches.
- Edge Functions: **none deployed.** Six of nine remain undeployed, as before.
- Production project `ysnumxtzcgzyabrghxwq`: unchanged, not accessed, not linked.
- Production release: **NO-GO.**

### Outstanding before promotion

- Owner manual acceptance of **scenario 19** (preventive servicing) and **scenario 28**
  (maintenance dashboard). The register stands at 26 passed / 1 failed / 0 untested and the
  11/11/4 owner baseline is unchanged.
- The 12 pre-existing lint errors in `incidents/api.ts`, `IncidentNewPage.tsx` and
  `RentalNewPage.tsx`.
- Six undeployed staging Edge Functions.
- A reproducible deployment artifact hash.
- Independent concurrency verification.
- Assignment activation defaulting ON against the STG-02 contract — owner decision.
- Whether eleven incident and maintenance write RPCs should call
  `app.billing_require_write` — owner decision.

## Maintenance Management functional acceptance — 2026-11-26

- Owner final manual acceptance: **28 scenarios, 28 passed, 0 failed, 0 pending**, no
  owner observations. Scenario 19 and scenario 28 were the last two confirmed.
- Accepted staging commit: `131ac9a0fbb8f82787c0a17079d042c7c5bb37d0`, deployed artifact
  `e4c586445ed429e7986c344e5d10d17328938eaaf2e10a8d3836785be2a1f698`, 199 files, verified
  by content.
- Migration ledger at acceptance: **141 local / 141 applied / zero drift**, last applied
  `20261126120000`.
- Status: **FUNCTIONALLY ACCEPTED — CLOSED.** Scope frozen.
- **Production release: NO-GO.** Functional acceptance is not production deployment
  authorization. Every outstanding gate in `PRODUCTION_RELEASE_CHECKLIST.md` is preserved
  unchanged — notably the six undeployed Edge Functions, the unreproducible deployment
  artifact hash, independent concurrency verification, the STG-02 assignment-activation
  decision, the `app.billing_require_write` decision, and the absence of a down migration.
- Production project `ysnumxtzcgzyabrghxwq`: unchanged, not accessed, not linked.

## Incident Management dashboard — 2026-11-26

- Published commits: `a2861b8`, `b163cc6`.
- `origin/staging`: `131ac9a..b163cc6`, fast-forward, no force. `origin/main` unchanged at
  `31383a97eb8e000f9189913b255af4da22bf3a26`.
- **No migration created.** `supabase/migrations/` unchanged at 141 local / 141 applied.
- Hostinger staging publication: **verified by content.** Manifest `e4c58644…`/199 →
  `ff41ee11…`/199, project ref `yeklucfthspvejlkffln`. 173 asset files crawled; 171 of 171
  `.js` served as JavaScript; 0 production references; 0 secret keys; all eight
  release-unique strings present; all six accepted-release probes still present.
- Maintenance Management: **not reopened.** Its 28/28 acceptance and scope freeze stand.
- Acceptance: **scenario 29 PASS (2026-11-26), 13/13 verification items, no observations.**
  Incident Management, including its dashboard, is **FUNCTIONALLY ACCEPTED — CLOSED** and
  frozen. Evidence: `Reports/PEVVY_INCIDENT_MANAGEMENT_FINAL_ACCEPTANCE.md`.
- Production project `ysnumxtzcgzyabrghxwq`: unchanged, not accessed, not linked.
- Production release: **NO-GO.**

### Outstanding before promotion

Everything listed under the preventive servicing entry above, unchanged. The owner
acceptance gate is now **closed** for Maintenance (28/28) and Incident Management
(scenario 29, 13/13); every other gate stands. The two pre-existing
`IncidentNewPage.tsx` lint errors remain; that file is incident reporting and was
deliberately not modified.

## Rental Financial Adjustments — 2026-11-27

- Published commits: `7664645`, `b402ba2`, `967833f`, `497e6fb`.
- `origin/staging`: `bc4139a..497e6fb`, fast-forward, no force. `origin/main` unchanged at
  `31383a97eb8e000f9189913b255af4da22bf3a26`.
- **Migration applied to staging:** `20261126130000_rental_charge_integrity.sql`, SHA-256
  `ee503f7790b09692c8546a6435c5acd5ff0231400087fb6f801725637a574f5e`, 1,087 lines /
  47,450 bytes. Ledger **142 local / 142 applied, zero drift**.
  - The owner's authorization expected 141 applied before application; staging already
    reported 142. **It was not applied from this session.** The 46 statements recorded in
    `supabase_migrations.schema_migrations` were compared against the approved file and
    are character-identical once the CLI's stripped separators are accounted for, so what
    is applied is the approved migration. Reported in §2.1 of the implementation report.
- Hosted staging schema verification: **39 catalog checks and 30 behavioural checks, all
  passing.** The behavioural checks ran inside a transaction that was rolled back; a count
  taken afterwards confirmed no QA record persisted and that existing record counts were
  unchanged (4 rentals, 4 charge lines, 5 payments).
- Hostinger staging publication: **verified by content.** Manifest
  `9a8ba920…`/199 → `c9f211de…`/199, project ref `yeklucfthspvejlkffln`. 172 asset files
  crawled; 170 of 170 `.js` served as JavaScript; 0 production references; 0 secret key
  values; all 16 release-unique strings present; all 4 accepted-release probes still
  present.
- Local guarded build: 199 files, SHA-256
  `ea3c41b0e06fc2f1538447e8dfe47cee9329f1a253dfab18ce5aab6e693f4875`. The guard refused
  `.env.local` (production project) and the legacy JWT anon key before it would build.
- Maintenance downtime caption correction `7664645`, held since 2026-11-26, travelled with
  this deployment as authorized rather than prompting one of its own.
- Maintenance Management (28/28), Incident Management (scenario 29) and Driver
  availability (9/9): **not reopened.** Their acceptances and scope freezes stand.
- Test suite: 4,127 tests, **4,123 pass, 4 pre-existing failures** (three assignment,
  one billing definer gate). The billing failure names eleven incident and maintenance
  RPCs and **neither `rental_extend` nor `rental_reprice`**, which is the evidence that
  making them SECURITY DEFINER opened no ungated write path.
- Lint: 3 errors, 14 warnings, **all pre-existing** in `RentalNewPage.tsx` and
  `IncidentNewPage.tsx`, both untouched and blamed to 2026-11-25.
- Acceptance: **NOT ACCEPTED.** Scenarios 30–34 in
  `Reports/PEVVY_RENTAL_FINANCIAL_ADJUSTMENTS_ACCEPTANCE.md` are the owner's pass and have
  not been run. No responsive screenshots were captured; visual verification at the four
  widths is scenario 34.
- Production project `ysnumxtzcgzyabrghxwq`: unchanged, not accessed, not linked.
- Production release: **NO-GO.**

### Outstanding before promotion

Everything listed under the Incident Management entry above, unchanged, plus:

- Amendment history is **not** preserved for a reservation repriced before any contract is
  issued. Where a contract exists the superseded version preserves the previous hire;
  where none exists nothing does. Needs a further migration and its own authorization, and
  the acceptance requirement covering preservation of authorized amendment history must
  not be marked complete until then.
- `app.rental_is_finalized` and `app.rental_charges_purge_exempt` are SECURITY DEFINER and
  executable by `authenticated`, structurally, because the integrity guard runs as the
  caller. Read-only boolean oracles; accepted residual exposure.
- Any future owner-owned SECURITY DEFINER function able to write `rental_line_items`
  inherits the guard's exemption by virtue of its ownership.
- No down migration exists for `20261126130000`; reverting requires a new forward one that
  decides what to do with reversal lines already posted.

## Rental financial amendment history remediation — 2026-11-27

- **Migration created, NOT applied.**
  `20261127100000_rental_pricing_amendment_history.sql`, SHA-256
  `27b8f62d7ee1f7dfcb9ec6b3aaaedd8bf1e0de1f59414787261c3142d5ee7308`, 621 lines /
  26,305 bytes. Ledger **143 local / 142 remote — exactly one pending**.
- Hosted application requires separate owner authorization and has not been performed.
  No remote command beyond read-only ledger verification was run.
- Creates `public.rental_pricing_amendments` (no insert, update or delete grant for any
  browser role), `app.record_rental_pricing_amendment`,
  `app.require_rental_pricing_amendment_evidence` and the deferred constraint trigger
  `rental_line_items_amendment_evidence`. Redefines `public.rental_extend`,
  `public.rental_reprice` and `app.organization_purge_tables`. Public RPC signatures
  unchanged. `app.guard_rental_line_item_integrity` and the cancellation settlement
  boundaries from `20261126130000` are untouched.
- No frontend depending on this migration has been deployed.
- Acceptance: **scenario 35 added, not run.** Scenarios 30–34 remain not run.
- Production project `ysnumxtzcgzyabrghxwq`: unchanged, not accessed, not linked.
- Production release: **NO-GO.**

## Rental financial and lifecycle integrity closure — 2026-11-27

- **Migration amended in place, still NOT applied.**
  `20261127100000_rental_pricing_amendment_history.sql`, SHA-256
  `d0d9ca39487486c1cb7e492364a7a7e28bcf4e4f317c4dcc70234ee74b553890`, 798 lines /
  35,823 bytes. Supersedes the earlier `27b8f62d…` at 621 lines. Ledger **143 local /
  142 remote — exactly one pending**, confirmed by a read-only dry run.
- No previously applied migration was modified and no second migration file created.
- Adds `app.guard_rental_pricing_inputs` and trigger `rentals_guard_pricing_inputs`;
  tightens `app.require_rental_pricing_amendment_evidence` to match each mutation's
  signature; changes `rental_pricing_amendments.amended_at` to `clock_timestamp()`.
- **No change to the assignment gate** — the reported defect is absent from the effective
  schema. A regression test was added.
- Hosted application still requires separate owner authorization. No remote command
  beyond read-only ledger verification and a dry run was run. Production not accessed.
- No frontend depending on this migration has been deployed. `origin/staging` remains
  `aa94dc3`; `origin/main` remains `31383a9`.
- Acceptance: scenario 35 gains sub-check 35h for lifecycle integrity. The register is
  not expanded. Scenarios 30–35 remain not run.
- Production release: **NO-GO.**

## Work Package 4 — staging deployment — 2026-11-27

- Published commits: `e350322`, `f414616`, `09c9954`, `357961e`.
- `origin/staging`: `aa94dc3..357961e`, fast-forward, no force. `origin/main` unchanged
  at `31383a97eb8e000f9189913b255af4da22bf3a26`.
- **Migration applied to staging:** `20261127100000_rental_pricing_amendment_history.sql`,
  SHA-256 `d0d9ca39487486c1cb7e492364a7a7e28bcf4e4f317c4dcc70234ee74b553890`, 798 lines /
  35,823 bytes. Ledger **143 local / 143 applied, zero drift**. Applied by the owner, not
  from the session; applied statements verified identical to the approved file.
- Hosted schema verification: **33 catalog checks and 24 behavioural checks, all
  passing.** Behavioural checks ran in a rolled-back transaction; existing records
  unchanged at 4 rentals, 4 charge lines, 5 payments, 3 contracts, and no QA residue.
- Local guarded build: 199 files, SHA-256
  `0ef652a76d1218b45ae3c152de9fda210493530339f2ade11a0a87663d4f79ed`.
- Hostinger staging publication: **verified by content.** Manifest `554d9c72…`/199 →
  `2f6f37db…`/199, project ref `yeklucfthspvejlkffln`. 172 asset files crawled; 170 of
  170 `.js` served as JavaScript; 0 production references; 0 secret values; 23 of 23
  release-unique strings; 6 of 6 responsive classes; 7 of 7 accepted-release probes.
- Regression: 400 of 400 focused tests on the deployment candidate; full suite 4,198 with
  4,194 passing and the four established baseline failures. Zero new failures.
- Maintenance Management (28/28), Incident Management (scenario 29) and Driver
  availability (9/9): **not reopened.**
- Acceptance: **NOT ACCEPTED.** Scenarios 30–35 prepared and executable; none run. No
  responsive check verified visually by the implementer.
- Production project `ysnumxtzcgzyabrghxwq`: unchanged, not accessed, not linked.
- Production release: **NO-GO.**

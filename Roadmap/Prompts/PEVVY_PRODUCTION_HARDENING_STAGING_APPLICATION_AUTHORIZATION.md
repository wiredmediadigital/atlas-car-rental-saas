# PEVVY — OWNER AUTHORIZATION: APPLY HARDENING MIGRATIONS AND COMPLETE STAGING DEPLOYMENT

*Archived verbatim. Received 2026-11-28.*

---

## 1. Explicit authorization

The owner authorizes application of the five final hardening migrations to hosted staging, followed by deployment of the verified hardening application.

The final deployment report and hosted preflight report are accepted.

Do not initiate another reproduction, implementation or general review cycle.

Complete migration application, hosted verification, staging deployment and deployment closure in one execution, subject to the safety gates below.

## 2. Authorized environment

Staging project:

yeklucfthspvejlkffln

Authorized worktree:

E:\pevvy-maintenance-acceptance-20261125

Verified build source:

a1728a9d5f602f1788d1f6a9612069bddc55f61c

Verified artifact manifest SHA-256:

e0261061734798d077423da9c2b4a200ec7eb672767e00294d20ae8998b7d352

Expected artifact file count: 200, excluding the manifest itself.

Protected production project:

ysnumxtzcgzyabrghxwq

Production access and deployment remain prohibited.

## 3. Approved migration checksums

Only the following five migrations are authorized.

### Migration 1

20261128100000_rental_lifecycle_authorization.sql

SHA-256:
43c9b2e7dbeacb218da8a15b639e649f8fdbe2b110bbb2e7f7d4de7d9c744094

### Migration 2

20261128110000_billing_authorization_matrix.sql

SHA-256:
60830dfab601498230f1769438ffac0b050bfdb1299aeb832d5212051db9e57f

### Migration 3

20261128120000_amendment_evidence_one_to_one.sql

SHA-256:
8ead334c1f96d9a8001ba2a9552875bc46680308da3ca1f11a451e1d074d7ab4

### Migration 4

20261128130000_maintenance_expense_integrity.sql

SHA-256:
1defc28e664f859540316015f2769496b1e4e1d1cd9c4208dd415f0ffb881b47

### Migration 5

20261128140000_assignment_activation_default_off.sql

SHA-256:
59135446944eed8bfd955011621cc2af076a0413f3a5f5e9f880aed9bbee2134

All earlier checksum lists are superseded.

Do not modify these migrations after authorization.

## 4. Immediate pre-application safety checks

Verify:

- Correct linked staging project.
- All five approved checksums.
- Local ledger 148.
- Hosted ledger 143.
- Exactly five pending migrations.
- No unexpected seeds or role changes.
- No changes to previously applied migrations.
- Verified build source and artifact integrity.
- No production configuration.

Temporarily suspend staging acceptance activity during migration application and deployment.

Capture the current hosted baseline and appropriate recovery evidence using the existing authorized staging backup mechanism.

Preserve existing amendment history, payments, contracts, rental commitments and complete open assignment records.

Latest accepted baseline:

- Three historical amendment records.
- Nine payments.
- Fourteen assignment records.
- Two open assignments.
- Zero assignment rows requiring drainage.
- Zero maintenance expense anomalies.
- Zero explicit assignment activation rows.

If amendment or payment counts have legitimately increased, reconcile and preserve the latest records.

Do not proceed if drainage, anomalies, migration checksums, project identity or schema compatibility differ from the approved conditions.

## 5. Apply the migrations

Execute from the approved worktree:

Set-Location 'E:\pevvy-maintenance-acceptance-20261125'

npx supabase db push --linked

Expected notices:

- Assignment drainage: released 0 open assignments.
- Maintenance expense integrity: 0 existing linked costs violating the new invariants.

If an unexpected notice or error occurs, stop further deployment activity, inspect the actual applied migration ledger and report the resulting database state.

Do not assume that a failed multi-migration push rolled back every preceding migration.

Do not automatically rerun failed migrations or perform destructive recovery.

## 6. Hosted database verification

Confirm:

- 148 local / 148 hosted migrations.
- Zero migration drift.
- All five approved migrations applied.
- Hosted migration statements match the approved files.
- Correct effective function definitions.
- Correct SECURITY DEFINER authorization boundaries.
- Correct grants, policies and triggers.
- Direct lifecycle mutation refused.
- Duplicate return mutation refused.
- Authorized lifecycle operations remain functional.
- Billing restrictions and approved safety exemptions enforced.
- One-to-one amendment evidence enforced.
- Existing amendment history preserved and readable.
- Maintenance expense association integrity enforced.
- Default-OFF assignment activation.
- Active vehicle swap remains unavailable.
- Existing open assignments preserved.
- Authorized return can release legacy custody assignments.

Use rollback-contained verification or approved disposable staging fixtures.

Do not alter existing owner acceptance records for destructive testing.

## 7. Staging deployment

After successful hosted database verification:

- Publish the approved hardening changes to origin/staging.
- Preserve origin/main at 31383a9.
- Use the existing approved Hostinger staging deployment configuration.
- Verify the intended source commit.
- Verify the published application and assets.
- Verify the staging Supabase reference.
- Verify absence of production references and private credentials.
- Verify release-specific application content.
- Confirm the deployment is the new hardening release, not merely an HTTP 200 response.

If Hostinger rebuilds the application, record the actual deployed artifact attribution and manifest rather than assuming byte-for-byte identity with the local build.

Do not force-push or modify protected worktrees.

## 8. Targeted staging acceptance

Conduct focused hosted verification of the functionality affected by hardening:

1. Rental creation, confirmation and checkout.
2. Vehicle return and duplicate-return protection.
3. Rental completion.
4. Rental repricing and extension.
5. Financial amendment history.
6. Maintenance expense linking and unlinking.
7. Linked expense editing restrictions.
8. Staff and Manager authorization.
9. Billing restrictions and safety exemptions.
10. Vehicle availability after legacy assignment release.
11. RentalNewPage and IncidentNewPage default selection.

Preserve previously accepted functionality.

Do not repeat the complete WP1–WP4 manual acceptance exercise.

Clearly distinguish automated hosted verification from owner manual acceptance.

Provide a concise owner acceptance checklist for any remaining manual checks.

## 9. Final deployment closure

Update:

E:\pevvy-car-rental-saas-main\Roadmap\Reports\PEVVY_PRODUCTION_HARDENING_FINAL_DEPLOYMENT_CLOSURE.md

Archive this exact authorization:

E:\pevvy-car-rental-saas-main\Roadmap\Prompts\PEVVY_PRODUCTION_HARDENING_STAGING_APPLICATION_AUTHORIZATION.md

Update the canonical roadmap, hardening register, migration authorization package, release manifest, acceptance register and applicable handoff documents.

Include:

- Applied migration versions and checksums.
- Hosted ledger verification.
- Pre-application and post-application data comparison.
- Hosted security verification.
- Published Git commit.
- Hostinger deployment verification.
- Remaining owner acceptance checks.
- Known limitations.
- Readiness for WP5.

Provide physical file existence verification, absolute paths, file sizes, modification timestamps and complete SHA-256 checksums.

## 10. Completion boundary

Do not begin Work Package 5 automatically.

Do not deploy the five unrelated missing Edge Functions.

Do not implement the deferred return-reading correction workflow.

Do not access or deploy to production.

Production remains NO-GO.

Once staging deployment and targeted verification are complete, stop and return the final closure report.

The next authorized development package will be WP5 — Security Deposit Management.

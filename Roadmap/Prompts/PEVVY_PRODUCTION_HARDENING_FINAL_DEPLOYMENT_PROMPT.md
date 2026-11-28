# PEVVY — FINAL HARDENING BUILD, MIGRATION AUTHORIZATION AND STAGING RELEASE

*Archived verbatim. Received 2026-11-28.*

---

## 1. Review decision

The latest hardening verification results are accepted:

- 205 of 205 test files executed.
- 4,292 of 4,292 tests passed.
- 10 independent concurrency scenarios.
- 25 of 25 concurrency assertions passed.
- Canonical verification chain exit 0.
- Zero lint errors.
- Fourteen unchanged non-blocking warnings.
- Formatting and type checking passed.
- Migration dry run passed.

Do not initiate another comprehensive hardening cycle.

## 2. Vehicle return correction decision

Accept the duplicate return protection implementation.

Preserve the first successfully committed vehicle return.

Do not permit ordinary check-in to overwrite existing return readings.

Do not implement a new correction workflow during this hardening phase.

Record Manager-authorized, auditable correction of incorrectly entered return information as a candidate requirement under Work Package 9 — Rental Exceptions.

Preserve this operational limitation in the hardening register.

## 3. Fresh guarded staging build

Use the owner-provided staging browser publishable key.

Authorized staging project:

yeklucfthspvejlkffln

Approved staging Supabase URL:

https://yeklucfthspvejlkffln.supabase.co

Required browser key:

VITE_SUPABASE_PUBLISHABLE_KEY

Use the existing approved staging build configuration.

Do not use production credentials.

Do not expose the supplied key in reports or commit it to Git.

Run the fresh guarded staging build.

Verify:

- Build exit code 0.
- Current source commit.
- Complete artifact manifest.
- Full SHA-256 checksum.
- Artifact file count.
- Correct staging project reference.
- No production project references.
- No embedded private credentials.

Do not reuse the stale be240a5b artifact.

## 4. Final migration authorization

Prepare the exact final migration authorization package for the following five migrations:

- 20261128100000_rental_lifecycle_authorization.sql
- 20261128110000_billing_authorization_matrix.sql
- 20261128120000_amendment_evidence_one_to_one.sql
- 20261128130000_maintenance_expense_integrity.sql
- 20261128140000_assignment_activation_default_off.sql

Use the latest corrected files and complete SHA-256 checksums.

Do not use superseded checksums.

Verify:

- Local migration ledger: 148.
- Hosted staging migration ledger: 143.
- Dry run lists exactly five pending migrations.
- No unexpected seeds, roles or additional migrations.
- All previously applied migrations remain unchanged.

Repeat the read-only hosted preflight immediately before authorization.

Expected baseline from the latest report:

- Two existing amendment records on RNT-2026-00004.
- Zero assignment rows requiring drainage.
- Zero maintenance expense anomalies.
- Zero explicit assignment activation rows.

Report any changes to this baseline.

The default-OFF assignment behaviour is intentional and accepted.

Preserve existing active and reserved rental commitments and historical assignment records.

## 5. Hosted migration approval gate

After the fresh build succeeds, present the final migration application command, exact worktree path, complete checksums and verified preflight results.

Stop for explicit owner authorization before applying the five hosted migrations.

Do not introduce further review cycles unless an actual new blocker is identified.

## 6. Post-authorization execution

After receiving separate owner authorization:

- Apply the five approved migrations to staging.
- Verify the hosted migration ledger reaches 148 of 148.
- Verify zero migration drift.
- Verify effective hosted function definitions, grants, triggers and policies.
- Verify both existing amendment records remain preserved.
- Verify default-OFF assignment activation.
- Verify existing rental commitments remain intact.
- Publish the verified hardening changes to origin/staging.
- Verify Hostinger deployment against the intended commit and published assets.
- Conduct targeted hosted security and functional smoke tests.

Do not deploy frontend changes that depend on unapplied migrations.

Do not modify origin/main.

## 7. Final documentation

Physically create:

E:\pevvy-car-rental-saas-main\Roadmap\Reports\PEVVY_PRODUCTION_HARDENING_FINAL_DEPLOYMENT_CLOSURE.md

Archive this exact instruction:

E:\pevvy-car-rental-saas-main\Roadmap\Prompts\PEVVY_PRODUCTION_HARDENING_FINAL_DEPLOYMENT_PROMPT.md

Update the canonical roadmap, hardening register, migration authorization package, release manifest and applicable handoff documents.

Provide absolute paths, physical file existence verification, file sizes, modification timestamps and complete SHA-256 checksums.

## 8. Completion boundary

Once staging deployment and targeted verification are complete, report readiness for Work Package 5 — Security Deposit Management.

Do not automatically begin WP5.

Do not deploy the five unrelated missing Edge Functions during this execution.

Do not access or deploy to production.

Production remains NO-GO.

The approved strategy remains completion of all ten work packages in staging, followed by four controlled production releases.

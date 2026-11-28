# Pevvy — production hardening: delivery verification

**Date:** 2026-11-27  
**Instruction:** §9 — delivery verification with absolute paths, sizes, timestamps and checksums.  
**Nothing applied. Nothing deployed. Production not accessed.**

---

## Scope

**29 files**, each one changed by this work, verified in both locations: the
isolated worktree where the work was done, and the primary checkout.

- Worktree: `E:\pevvy-maintenance-acceptance-20261125` — branch `fix/maintenance-manual-acceptance-20261125`, HEAD `31b58d3`
- Primary checkout: `E:\pevvy-car-rental-saas-main` — HEAD `fbbfe38`

SHA-256 is of the file's bytes. Sizes are bytes. Times are local modification times.

---

## Migrations — developed, NOT applied

| File | Bytes | Modified | SHA-256 |
|---|---|---|---|
| `supabase/migrations/20261128100000_rental_lifecycle_authorization.sql` | 12,171 | 2026-11-27 17:10:51 | `36bcd48a259b6f59c3e048f31c77319ccda93bd1155d57b76412e929e3fc9fbf` |
| `supabase/migrations/20261128110000_billing_authorization_matrix.sql` | 11,275 | 2026-11-27 17:20:40 | `60830dfab601498230f1769438ffac0b050bfdb1299aeb832d5212051db9e57f` |
| `supabase/migrations/20261128120000_amendment_evidence_one_to_one.sql` | 13,198 | 2026-11-27 17:27:28 | `8ead334c1f96d9a8001ba2a9552875bc46680308da3ca1f11a451e1d074d7ab4` |
| `supabase/migrations/20261128130000_maintenance_expense_integrity.sql` | 9,068 | 2026-11-27 17:30:43 | `71782326dafee8bd971bf0b0a9c242e7ed2f81b406a3da84fda0b3268a7288f5` |
| `supabase/migrations/20261128140000_assignment_activation_default_off.sql` | 11,130 | 2026-11-27 17:34:17 | `59135446944eed8bfd955011621cc2af076a0413f3a5f5e9f880aed9bbee2134` |

Absolute paths:

```
E:\pevvy-maintenance-acceptance-20261125\supabase\migrations\20261128100000_rental_lifecycle_authorization.sql
E:\pevvy-maintenance-acceptance-20261125\supabase\migrations\20261128110000_billing_authorization_matrix.sql
E:\pevvy-maintenance-acceptance-20261125\supabase\migrations\20261128120000_amendment_evidence_one_to_one.sql
E:\pevvy-maintenance-acceptance-20261125\supabase\migrations\20261128130000_maintenance_expense_integrity.sql
E:\pevvy-maintenance-acceptance-20261125\supabase\migrations\20261128140000_assignment_activation_default_off.sql
```

**The same paths in the primary checkout:**

| Path | SHA-256 | State |
|---|---|---|
| `E:\pevvy-car-rental-saas-main\supabase\migrations\20261128100000_rental_lifecycle_authorization.sql` | — | absent — path not on that branch |
| `E:\pevvy-car-rental-saas-main\supabase\migrations\20261128110000_billing_authorization_matrix.sql` | — | absent — path not on that branch |
| `E:\pevvy-car-rental-saas-main\supabase\migrations\20261128120000_amendment_evidence_one_to_one.sql` | — | absent — path not on that branch |
| `E:\pevvy-car-rental-saas-main\supabase\migrations\20261128130000_maintenance_expense_integrity.sql` | — | absent — path not on that branch |
| `E:\pevvy-car-rental-saas-main\supabase\migrations\20261128140000_assignment_activation_default_off.sql` | — | absent — path not on that branch |

---

## Database and security tests

| File | Bytes | Modified | SHA-256 |
|---|---|---|---|
| `supabase/tests/analytics-security.test.ts` | 22,644 | 2026-11-27 18:23:27 | `1da58cdc27f5856943fa21edac74d122759b852439da52bbd8954258976d2f2c` |
| `supabase/tests/assignment-feature-activation.test.ts` | 6,489 | 2026-11-27 17:57:30 | `f6b0ae705f477a78baa4d5a7485c077b50c6a13d815b09390f0ed7386027c1b1` |
| `supabase/tests/assignment-gate-wording.test.ts` | 3,944 | 2026-11-27 17:57:30 | `61b160cb6b30d47d9f14dd4ebdc5403c109b297d8977ac77dba9d92bf0f2b0ca` |
| `supabase/tests/assignment-lifecycle-integration.test.ts` | 6,979 | 2026-11-27 18:23:27 | `2066519a7d3c6867f44376acb8201941e91bc08db6bbeded6f831e64256f4553` |
| `supabase/tests/assignment-lifecycle-operations.test.ts` | 6,983 | 2026-11-27 17:57:31 | `0986137d8f7a7f0dfde9fbf7aa1c057c2b316c141de43fe443cce449d14e771e` |
| `supabase/tests/billing-restricted-access.test.ts` | 37,889 | 2026-11-27 17:24:18 | `85d021149a555184fdd81471d350d28e3f9014592a6a62955d2df333e246ef84` |
| `supabase/tests/maintenance-acceptance.test.ts` | 25,184 | 2026-11-27 17:57:37 | `a5d014930730c4bf12c6f285acc8217807ba5ffa7140c5b14f2ec0d75e712921` |
| `supabase/tests/rental-lifecycle-integrity.test.ts` | 21,920 | 2026-11-27 17:57:41 | `eae8955027d88883bb2fc227e6c2ddbc6fa4ab146dccddaa7dfa21af6c08d5ab` |
| `supabase/tests/rental-pricing-amendments.test.ts` | 37,874 | 2026-11-27 17:57:41 | `960660e9791be943f068c596be9be6f01b7531cffe03ac8a79e7c369b75879c5` |

Absolute paths:

```
E:\pevvy-maintenance-acceptance-20261125\supabase\tests\analytics-security.test.ts
E:\pevvy-maintenance-acceptance-20261125\supabase\tests\assignment-feature-activation.test.ts
E:\pevvy-maintenance-acceptance-20261125\supabase\tests\assignment-gate-wording.test.ts
E:\pevvy-maintenance-acceptance-20261125\supabase\tests\assignment-lifecycle-integration.test.ts
E:\pevvy-maintenance-acceptance-20261125\supabase\tests\assignment-lifecycle-operations.test.ts
E:\pevvy-maintenance-acceptance-20261125\supabase\tests\billing-restricted-access.test.ts
E:\pevvy-maintenance-acceptance-20261125\supabase\tests\maintenance-acceptance.test.ts
E:\pevvy-maintenance-acceptance-20261125\supabase\tests\rental-lifecycle-integrity.test.ts
E:\pevvy-maintenance-acceptance-20261125\supabase\tests\rental-pricing-amendments.test.ts
```

**The same paths in the primary checkout:**

| Path | SHA-256 | State |
|---|---|---|
| `E:\pevvy-car-rental-saas-main\supabase\tests\analytics-security.test.ts` | `51f7cd46a6d7ca9cb7ebced9e3d54099006a6814893a347219f8ceda217f19cf` | that branch's older content |
| `E:\pevvy-car-rental-saas-main\supabase\tests\assignment-feature-activation.test.ts` | `1dc08a98bba98c47377e8dd94da8a819dcb2994ca80d9a0cfc7dd87c695be6fa` | that branch's older content |
| `E:\pevvy-car-rental-saas-main\supabase\tests\assignment-gate-wording.test.ts` | — | absent — path not on that branch |
| `E:\pevvy-car-rental-saas-main\supabase\tests\assignment-lifecycle-integration.test.ts` | `c3fecabb7c763980ae582461269595d01d4bbd8a9cf20c5116be2a4d845021b5` | that branch's older content |
| `E:\pevvy-car-rental-saas-main\supabase\tests\assignment-lifecycle-operations.test.ts` | `e7bdfc2c0ac1217db477e279f11e8ef7c02cf30b539722e5097d7d4b4554df9e` | that branch's older content |
| `E:\pevvy-car-rental-saas-main\supabase\tests\billing-restricted-access.test.ts` | `ac867fa31b5d86800f84366d90e33bdac28445c5940ef06b02dd4fc6187517e4` | that branch's older content |
| `E:\pevvy-car-rental-saas-main\supabase\tests\maintenance-acceptance.test.ts` | — | absent — path not on that branch |
| `E:\pevvy-car-rental-saas-main\supabase\tests\rental-lifecycle-integrity.test.ts` | — | absent — path not on that branch |
| `E:\pevvy-car-rental-saas-main\supabase\tests\rental-pricing-amendments.test.ts` | — | absent — path not on that branch |

---

## Frontend sources

| File | Bytes | Modified | SHA-256 |
|---|---|---|---|
| `src/pages/incidents/IncidentNewPage.tsx` | 9,604 | 2026-11-27 17:57:13 | `f29e49db1e9647f6bae7ce3ca4d46c1c4960136f0ea8be990c2e20366069a0f3` |
| `src/pages/rentals/RentalNewPage.tsx` | 31,976 | 2026-11-27 17:57:25 | `518fc54f90c8d8223866c69d6f4b818f5caadf9c0b4064102fac4cc251fd9bed` |

Absolute paths:

```
E:\pevvy-maintenance-acceptance-20261125\src\pages\incidents\IncidentNewPage.tsx
E:\pevvy-maintenance-acceptance-20261125\src\pages\rentals\RentalNewPage.tsx
```

**The same paths in the primary checkout:**

| Path | SHA-256 | State |
|---|---|---|
| `E:\pevvy-car-rental-saas-main\src\pages\incidents\IncidentNewPage.tsx` | — | absent — path not on that branch |
| `E:\pevvy-car-rental-saas-main\src\pages\rentals\RentalNewPage.tsx` | `666ad07ef016e99da41af2e2d26bb1272202986f207f9e2995c82d7657d7811d` | that branch's older content |

---

## Reports and prompts

| File | Bytes | Modified | SHA-256 |
|---|---|---|---|
| `Roadmap/Prompts/PEVVY_PRODUCTION_HARDENING_IMPLEMENTATION_PROMPT.md` | 19,866 | 2026-11-27 18:13:14 | `ddcc6d25ee9a66e40168111fb53763c99ae098b1ebb8ab83188402a7f46b772f` |
| `Roadmap/Reports/PEVVY_PRODUCTION_HARDENING_IMPLEMENTATION.md` | 19,118 | 2026-11-27 18:10:16 | `62425a9e1f9f6630506e2504121daa253e777c3842665d84a829742a24375564` |
| `Roadmap/Reports/PEVVY_PRODUCTION_HARDENING_REGRESSION_VERIFICATION.md` | 17,497 | 2026-11-27 20:18:54 | `670e872fd2e92968c7ca857ec29203d91d202744a81a21bec9373d4d6a63c3d3` |
| `Roadmap/Reports/PEVVY_PRODUCTION_HARDENING_STAGING_MIGRATION_AUTHORIZATION.md` | 11,413 | 2026-11-27 18:11:32 | `48c2088dc0a6bca6eab2ac42d0ab56be1ac542ceb87c8a6fdacd43ca3d2b5c46` |
| `Roadmap/Reports/PEVVY_RENTAL_FINANCIAL_ADJUSTMENTS_FINAL_ACCEPTANCE.md` | 6,074 | 2026-11-27 18:08:00 | `09b03f6b22890a036bee465a9d646e1be26c641107aaea5e5b880e959b693805` |

Absolute paths:

```
E:\pevvy-maintenance-acceptance-20261125\Roadmap\Prompts\PEVVY_PRODUCTION_HARDENING_IMPLEMENTATION_PROMPT.md
E:\pevvy-maintenance-acceptance-20261125\Roadmap\Reports\PEVVY_PRODUCTION_HARDENING_IMPLEMENTATION.md
E:\pevvy-maintenance-acceptance-20261125\Roadmap\Reports\PEVVY_PRODUCTION_HARDENING_REGRESSION_VERIFICATION.md
E:\pevvy-maintenance-acceptance-20261125\Roadmap\Reports\PEVVY_PRODUCTION_HARDENING_STAGING_MIGRATION_AUTHORIZATION.md
E:\pevvy-maintenance-acceptance-20261125\Roadmap\Reports\PEVVY_RENTAL_FINANCIAL_ADJUSTMENTS_FINAL_ACCEPTANCE.md
```

**The same paths in the primary checkout:**

| Path | SHA-256 | State |
|---|---|---|
| `E:\pevvy-car-rental-saas-main\Roadmap\Prompts\PEVVY_PRODUCTION_HARDENING_IMPLEMENTATION_PROMPT.md` | `ddcc6d25ee9a66e40168111fb53763c99ae098b1ebb8ab83188402a7f46b772f` | identical |
| `E:\pevvy-car-rental-saas-main\Roadmap\Reports\PEVVY_PRODUCTION_HARDENING_IMPLEMENTATION.md` | `62425a9e1f9f6630506e2504121daa253e777c3842665d84a829742a24375564` | identical |
| `E:\pevvy-car-rental-saas-main\Roadmap\Reports\PEVVY_PRODUCTION_HARDENING_REGRESSION_VERIFICATION.md` | `670e872fd2e92968c7ca857ec29203d91d202744a81a21bec9373d4d6a63c3d3` | identical |
| `E:\pevvy-car-rental-saas-main\Roadmap\Reports\PEVVY_PRODUCTION_HARDENING_STAGING_MIGRATION_AUTHORIZATION.md` | `48c2088dc0a6bca6eab2ac42d0ab56be1ac542ceb87c8a6fdacd43ca3d2b5c46` | identical |
| `E:\pevvy-car-rental-saas-main\Roadmap\Reports\PEVVY_RENTAL_FINANCIAL_ADJUSTMENTS_FINAL_ACCEPTANCE.md` | `09b03f6b22890a036bee465a9d646e1be26c641107aaea5e5b880e959b693805` | identical |

---

## Roadmap and handoff documents

| File | Bytes | Modified | SHA-256 |
|---|---|---|---|
| `Roadmap/Handoff/CURRENT_DEVELOPMENT_STATE.md` | 5,105 | 2026-11-27 18:21:49 | `8c1dc9f6ab98506b986809d5d45e76a5ad4241eb806eed3aff6487be25215811` |
| `Roadmap/Handoff/DATABASE_MIGRATION_STATE.md` | 2,732 | 2026-11-27 18:21:50 | `4313d4b2f14404ff67d62f5eec5694ea6eecd5518a765afc9fe2508d4937cf28` |
| `Roadmap/RoadMapFiles/ARCHITECTURE_DECISIONS.md` | 21,314 | 2026-11-27 18:19:06 | `f3fac04f730873cb69c6e48970669acd7805e76d1101c8dd166052ccb45f90fc` |
| `Roadmap/RoadMapFiles/CHANGELOG.md` | 21,839 | 2026-11-27 18:19:03 | `18f387e7b5202df16d63595eaf4c12c79c3aaf83a26462190069ea58779ee257` |
| `Roadmap/RoadMapFiles/FEATURE_TRACKER.md` | 8,148 | 2026-11-27 18:19:04 | `e5022fc5c4704e223214bd7365185d9c18aa81d08e80311e209bfce0aaaeb9ee` |
| `Roadmap/RoadMapFiles/MASTER_ROADMAP.md` | 14,439 | 2026-11-27 18:19:03 | `d9c4c4857db3f1692e51854a073f8450d61036c79d4e8126716f3ad097c6220a` |
| `Roadmap/RoadMapFiles/PRODUCTION_RELEASE_CHECKLIST.md` | 16,479 | 2026-11-27 18:19:04 | `1b8d16afe96e32ea4f6841b5a266f305a9c4b59e61b4a2cd5cfcf57373729740` |
| `Roadmap/RoadMapFiles/PRODUCTION_RELEASE_MANIFEST.md` | 20,562 | 2026-11-27 18:19:03 | `0913cfc73a5025d4a7774d3c5694614630b712ae03464b9b9506ff9fb7f06dbe` |

Absolute paths:

```
E:\pevvy-maintenance-acceptance-20261125\Roadmap\Handoff\CURRENT_DEVELOPMENT_STATE.md
E:\pevvy-maintenance-acceptance-20261125\Roadmap\Handoff\DATABASE_MIGRATION_STATE.md
E:\pevvy-maintenance-acceptance-20261125\Roadmap\RoadMapFiles\ARCHITECTURE_DECISIONS.md
E:\pevvy-maintenance-acceptance-20261125\Roadmap\RoadMapFiles\CHANGELOG.md
E:\pevvy-maintenance-acceptance-20261125\Roadmap\RoadMapFiles\FEATURE_TRACKER.md
E:\pevvy-maintenance-acceptance-20261125\Roadmap\RoadMapFiles\MASTER_ROADMAP.md
E:\pevvy-maintenance-acceptance-20261125\Roadmap\RoadMapFiles\PRODUCTION_RELEASE_CHECKLIST.md
E:\pevvy-maintenance-acceptance-20261125\Roadmap\RoadMapFiles\PRODUCTION_RELEASE_MANIFEST.md
```

**The same paths in the primary checkout:**

| Path | SHA-256 | State |
|---|---|---|
| `E:\pevvy-car-rental-saas-main\Roadmap\Handoff\CURRENT_DEVELOPMENT_STATE.md` | `8c1dc9f6ab98506b986809d5d45e76a5ad4241eb806eed3aff6487be25215811` | identical |
| `E:\pevvy-car-rental-saas-main\Roadmap\Handoff\DATABASE_MIGRATION_STATE.md` | `4313d4b2f14404ff67d62f5eec5694ea6eecd5518a765afc9fe2508d4937cf28` | identical |
| `E:\pevvy-car-rental-saas-main\Roadmap\RoadMapFiles\ARCHITECTURE_DECISIONS.md` | `f3fac04f730873cb69c6e48970669acd7805e76d1101c8dd166052ccb45f90fc` | identical |
| `E:\pevvy-car-rental-saas-main\Roadmap\RoadMapFiles\CHANGELOG.md` | `18f387e7b5202df16d63595eaf4c12c79c3aaf83a26462190069ea58779ee257` | identical |
| `E:\pevvy-car-rental-saas-main\Roadmap\RoadMapFiles\FEATURE_TRACKER.md` | `e5022fc5c4704e223214bd7365185d9c18aa81d08e80311e209bfce0aaaeb9ee` | identical |
| `E:\pevvy-car-rental-saas-main\Roadmap\RoadMapFiles\MASTER_ROADMAP.md` | `d9c4c4857db3f1692e51854a073f8450d61036c79d4e8126716f3ad097c6220a` | identical |
| `E:\pevvy-car-rental-saas-main\Roadmap\RoadMapFiles\PRODUCTION_RELEASE_CHECKLIST.md` | `1b8d16afe96e32ea4f6841b5a266f305a9c4b59e61b4a2cd5cfcf57373729740` | identical |
| `E:\pevvy-car-rental-saas-main\Roadmap\RoadMapFiles\PRODUCTION_RELEASE_MANIFEST.md` | `0913cfc73a5025d4a7774d3c5694614630b712ae03464b9b9506ff9fb7f06dbe` | identical |

---

## Reconciliation

| | Count |
|---|---|
| Files delivered | 29 |
| Documents mirrored, byte-identical in both locations | 13 |
| Code files absent from the primary checkout | 10 |
| Code files present there at that branch's older content | 6 |

**Every document is byte-identical in both locations. No document mismatches.**

### Why the code files do not match, and why that is correct

The 16 code files — the five migrations, nine test files and two frontend
sources — are committed on the worktree branch
`fix/maintenance-manual-acceptance-20261125` and are deliberately **not** copied
into the primary checkout.

The primary checkout sits at `fbbfe38` on a different lineage. For 10 of those
paths that branch has no history at all — `git log -- <path>` returns nothing, and
the file is absent. The other 6 exist there at that branch's own older content.

Neither is a delivery gap. Copying code into the primary checkout would disturb
the unrelated in-progress work its dirty working tree carries, which the
development handoff requires be preserved. The code is delivered where it was
developed and tested; only the documents are mirrored, and those match exactly.

### This document

This report is the 30th deliverable. Its own checksum is reported separately,
since a file cannot contain its own hash.

---

## Work Package 5 — readiness assessment

**Work Package 5 has not begun, and nothing here starts it.**

### Its scope is not recorded, and is not invented here

No definition of Work Package 5 exists in this repository. `MASTER_ROADMAP.md` names Work
Packages 3 and 4 and states only *"Work Package 5 has not begun."* The instruction that
set out the Work Package 5–10 sequence was truncated before that section was readable, and
no later instruction restated it.

**The owner should supply or point to the Work Package 5 definition before it is started.**
Until then any readiness statement about its specific content would be invention, and none
is offered. What follows is readiness in the sense that can be assessed: whether the
platform is in a fit state for the next work package, whatever it turns out to be.

### What is ready

- **The ten hardening items are closed.** Four were confirmed defects and are corrected,
  one was partly real, one gate was closed by verification, three were not defects, and
  one was an owner decision.
- **The test suite is genuinely green**: 203 files, 4,234 tests, zero errors, with the
  every-file-ran check satisfied. That baseline is trustworthy for the first time in this
  sequence — the four long-standing database failures are gone, and two of the runs that
  looked green were caught as incomplete.
- **Concurrency behaviour is characterised**, not assumed: ten scenarios, 23 assertions,
  against real PostgreSQL rather than PGlite.
- **Lint has zero errors**, so `npm run verify` is no longer blocked on them.
- **Work Package 4 is closed** on the owner's acceptance. Roadmap completion is **4 of 10**.

### What blocks Work Package 5

1. **The five migrations are not applied.** Ledger **148 local / 143 remote**. Any work
   package touching rentals, billing, maintenance or assignments builds on a schema that
   exists only locally. Hosted application needs the owner's authorization —
   `PEVVY_PRODUCTION_HARDENING_STAGING_MIGRATION_AUTHORIZATION.md` is the package for it.
2. **Nothing is deployed.** `origin/staging` is unchanged at `5634555`; the branch holding
   this work has not been pushed.
3. **Five Edge Functions remain undeployed on staging** — `account-closure`,
   `account-closure-notice`, `gps-provider`, `mfa-reset`, `public-booking`. The public
   booking page does not work on staging until the last of those is deployed.
4. **No authenticated browser acceptance** has been performed for this work. iPad landscape
   and the application-wide responsive certification remain deferred.
5. **Two decisions are open**, both recorded and neither taken unilaterally: whether a
   second check-in should be refused once `returned_at` is set, and whether the existing
   inconsistent maintenance-expense links should be repaired.

### The honest summary

The code is ready for review and for hosted staging application. **It is not ready to be
built upon**, because the schema it assumes is not yet on any hosted database. Work Package
5 should begin after the migrations are applied to staging and the result verified — not
before.

**Production remains NO-GO.**

---

## Final delivery list

| Group | Count | State |
|---|---|---|
| Forward migrations | 5 | Developed, tested, **NOT applied** |
| Database and security test files | 9 | Changed; all green |
| Frontend sources | 2 | Lint corrections; no automated coverage |
| Reports and prompts | 6 | Complete |
| Roadmap and handoff documents | 8 | Updated |
| **Total** | **30** | |

### Verification state

| | |
|---|---|
| Suite | 203 files, 4,234 tests, 0 errors, all files ran |
| Concurrency | 10 scenarios, 23 of 23 assertions, clean replay, exit 0 |
| Lint | 0 errors, 14 warnings, each justified |
| Formatting, type checking | clean |
| Guarded staging build | 199 files, SHA-256 `be240a5b44a0af9c8c9e4e6c1fe8d018a46f7db59979f3e08e560d736c24e228`; no build input newer |

### Boundaries held

- Staging project `yeklucfthspvejlkffln` confirmed before every remote command.
- Production project `ysnumxtzcgzyabrghxwq` **not accessed, not linked, not referenced** in
  any build. The only local browser credentials point at production and were **not used**.
- No existing migration edited. No migration applied. No Edge Function deployed or
  redeployed. No destructive closure action.
- `origin/main` unchanged at `31383a9`; `origin/staging` unchanged at `5634555`. Nothing
  force-pushed, nothing rewritten, nothing pushed to the original upstream repository.
- No secret key, access token, database password or invitation link printed.
- The primary checkout's dirty working tree, untracked investigations, worktrees and
  branches are preserved untouched.

# Pevvy — production hardening: final deployment closure

**Date:** 2026-11-28
**Status:** **AWAITING OWNER AUTHORIZATION TO APPLY.** Nothing applied. Nothing deployed.
**Production project `ysnumxtzcgzyabrghxwq`:** not accessed, not connected to, not named in
any query or any built file. **NO-GO.**

---

## 1. The fresh guarded staging build

Run with the owner-supplied browser publishable key, loaded inside the build process from
`E:\pevvy-car-rental-saas-main\.env.staging.local`. **The key never reached a command line,
a process list, a log, this report or Git.** The guard was not weakened or bypassed:
`scripts/build-staging.mjs` validated the environment exactly as it always does.

| | |
|---|---|
| Source commit | **`a1728a9d5f602f1788d1f6a9612069bddc55f61c`** (`a1728a9`) |
| Branch | `fix/maintenance-manual-acceptance-20261125` |
| Build mode | `staging` |
| Project reference | **`yeklucfthspvejlkffln`** |
| Artifact file count | **200** |
| Manifest SHA-256 | **`e0261061734798d077423da9c2b4a200ec7eb672767e00294d20ae8998b7d352`** |
| **Build exit code** | **0** |
| Artifact path | `E:\pevvy-maintenance-acceptance-20261125\dist-staging` |
| Total bytes on disk | 6,867,319 across 201 files (200 + the manifest) |

**The stale `be240a5b…` artifact was not reused.** It was superseded by six changed frontend
sources and is not referenced here as evidence of anything.

### Environment, exactly as the guard saw it

| Variable | Value |
|---|---|
| `VITE_SUPABASE_URL` | `https://yeklucfthspvejlkffln.supabase.co` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | supplied; 46 characters; `sb_publishable_` prefix. **Value not recorded** |
| `VITE_SUPABASE_ANON_KEY` | **unset** |
| Other `VITE_` variables | **none** — every inherited `VITE_` variable was stripped before the build so nothing from another context could reach the bundle |

The key was validated against every guard condition before the build: correct prefix, not a
`service_role` JWT, no `sb_secret_`, no production reference.

### Artifact scan — production references

**Zero.** No file in the artifact contains `ysnumxtzcgzyabrghxwq`.

The staging reference `yeklucfthspvejlkffln` appears in **2** files, which is required and
expected. The publishable key appears in **1** file, also required — it is the browser key
and shipping it is the point.

### Artifact scan — embedded private credentials

| Checked for | Found |
|---|---|
| `sb_secret_` followed by key material | **0** |
| `service_role` JWT | **0** |
| Staging database password | **0** |
| Staging database connection string | **0** |
| PEM private key block | **0** |
| Supabase access token (`sbp_…`) | **0** |

**One finding worth recording, because the first scan reported it as a failure.**

The bare string `sb_secret_` appears in two bundles. That is **not** a leaked credential: it
is Pevvy's own guard code. `src/lib/config/env.ts` refuses a key beginning with that prefix,
and the warning text names it — *"This is a secret (service_role or sb_secret_) key. It
bypasses Row Level Security and must never be exposed to a browser."*

Every occurrence was checked and all three are the **bare prefix with nothing after it**.
The scanner's rule was too naive, not the artifact. It now requires the prefix **plus key
material** before flagging, and reports the bare prefix separately as expected. The original
failure is recorded rather than quietly re-run, because a scanner that cries wolf is how a
real finding gets waved through later.

**Verdict: ARTIFACT CLEAN.**

---

## 2. Vehicle return correction — owner decision recorded

Accepted as implemented:

- the first successfully committed vehicle return is preserved;
- ordinary check-in cannot overwrite existing return readings;
- no new correction workflow was implemented during this hardening phase.

**The operational limitation stands and is registered:** a mis-keyed return reading on a
committed rental has no route to correction in Pevvy today.

**Recorded as a candidate requirement under Work Package 9 — Rental Exceptions:**
*Manager-authorized, auditable correction of incorrectly entered return information.* It is
a candidate, not a commitment, and WP9 has not begun.

---

## 3. Final migration authorization package

### The five migrations, with current checksums

**Any earlier checksum list is superseded and must not be used.**

| # | File | SHA-256 | Bytes |
|---|---|---|---|
| 1 | `20261128100000_rental_lifecycle_authorization.sql` | `43c9b2e7dbeacb218da8a15b639e649f8fdbe2b110bbb2e7f7d4de7d9c744094` | 17,063 |
| 2 | `20261128110000_billing_authorization_matrix.sql` | `60830dfab601498230f1769438ffac0b050bfdb1299aeb832d5212051db9e57f` | 11,275 |
| 3 | `20261128120000_amendment_evidence_one_to_one.sql` | `8ead334c1f96d9a8001ba2a9552875bc46680308da3ca1f11a451e1d074d7ab4` | 13,198 |
| 4 | `20261128130000_maintenance_expense_integrity.sql` | `1defc28e664f859540316015f2769496b1e4e1d1cd9c4208dd415f0ffb881b47` | 12,461 |
| 5 | `20261128140000_assignment_activation_default_off.sql` | `59135446944eed8bfd955011621cc2af076a0413f3a5f5e9f880aed9bbee2134` | 11,130 |

Superseded, **do not use**: `36bcd48a…` (migration 1) and `71782326…` (migration 4).

### Ledger and dry run

| | |
|---|---|
| Local migration ledger | **148** |
| Hosted staging ledger | **143** (read-only, verified twice) |
| Pending | exactly these five |
| Seeds | **none** |
| Role changes | **none** |
| Dry run exit code | **0** |
| Previously applied migrations modified | **none of the 143** |

```
$ npx supabase db push --linked --dry-run
Would push these migrations:
 • 20261128100000_rental_lifecycle_authorization.sql
 • 20261128110000_billing_authorization_matrix.sql
 • 20261128120000_amendment_evidence_one_to_one.sql
 • 20261128130000_maintenance_expense_integrity.sql
 • 20261128140000_assignment_activation_default_off.sql
{"upToDate":false,"dryRun":true,"migrations":[...5...],"seeds":[],"roles":[],
 "message":"Finished supabase db push."}
```

### Preflight re-read immediately before authorization — one change

| Item | Expected baseline | Re-read | |
|---|---|---|---|
| Amendment records on `RNT-2026-00004` | 2 | **3** | **changed** |
| Assignment rows requiring drainage | 0 | **0** | as expected |
| Maintenance expense anomalies | 0 | **0** | as expected |
| Explicit activation rows | 0 | **0** | as expected |
| Hosted ledger | 143 | **143** | as expected |

**The amendment count moved from 2 to 3.** A further pricing amendment was recorded on
`RNT-2026-00004` at 2026-11-28 02:09:06 UTC, with a further payment — continued owner
acceptance activity. The rental total moved 23,520 → 35,280 and the last recorded amendment
19,600 → 29,400.

**The history still agrees with the live hire**: last recorded 29,400, live hire 29,400.

**What this changes about the authorization: one number and nothing else.** Migration 3 will
set `line_revision_no = NULL` on **three** rows rather than two. All three properties proven
by test hold for three rows exactly as for two — readable, not colliding, unable to satisfy
future evidence.

If acceptance continues before application the count will move again. That is harmless. The
figures that must **not** move are drainage (**0**) and anomalies (**0**).

### Expected state after application

- ledger **148 / 148**, zero drift;
- *"Assignment drainage: released **0** open assignment(s)"* — **any other number: stop**;
- *"Maintenance expense integrity: **0** existing linked cost(s)…"*;
- the five lifecycle functions SECURITY DEFINER with tenant, role and billing checks;
- `rentals_guard_lifecycle_columns`, `expenses_guard_maintenance_link` and
  `rental_line_items_zz_revision` present and enabled;
- `rental_pricing_amendments_one_per_revision` present;
- all three existing amendment records preserved, carrying `NULL` revisions;
- `app.assignment_lifecycle_active` reading no session setting and defaulting **false**;
- both open assignments still open, on the same two rentals;
- `public.expense_ledger` carrying `maintenance_id`;
- existing rentals, charges, payments and contracts unchanged in count.

### Recovery

Four of the five are additive or restore prior function bodies by forward migration.
Migration 5 is the only one that writes business rows, and on this project **it writes
none** — so there is nothing to recover. If that changes before application, capture the
drainage preflight query's full row set first: `released` is terminal and the migration does
not record each row's prior state.

---

## 4. The approval gate

**Everything up to this point is complete. Nothing has been applied.**

The command, the exact path and the verification are in §5 of this document's companion
summary. **Applying the five migrations requires separate, explicit owner authorization**,
and it has not been given.

---

## 5. What is not authorized and has not been done

- Applying the five migrations to hosted staging.
- Pushing anything to `origin/staging` or `origin/main`.
- Deploying any frontend change.
- Deploying the five undeployed Edge Functions — `mfa-reset`, `public-booking`,
  `gps-provider`, `account-closure`, `account-closure-notice`.
- Activating any account-closure schedule.
- Anything at all touching production.
- Beginning Work Package 5.

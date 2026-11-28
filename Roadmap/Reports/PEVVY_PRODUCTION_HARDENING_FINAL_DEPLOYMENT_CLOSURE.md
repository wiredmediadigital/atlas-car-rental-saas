# Pevvy — production hardening: final deployment closure

**Date:** 2026-11-28
**Status:** **APPLIED TO HOSTED STAGING** under owner authorization, 2026-11-28.
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

## 4. Application to hosted staging

Authorized by the owner and applied on 2026-11-28 from the authorized worktree.

### Pre-application safety checks — all passed

| Check | Result |
|---|---|
| Linked project is the authorized staging project | `yeklucfthspvejlkffln` |
| Linked project is not production | confirmed |
| All five approved checksums | **match**, byte for byte |
| Local ledger | **148** |
| Exactly five pending | **5**, and they are the approved five |
| Artifact manifest matches the authorized value | `e0261061…` |
| Artifact digest **recomputed from disk** | `e0261061…` — identical |
| Artifact file count | **200** |
| No production reference in any built file | **0** |

The artifact digest was recomputed from the 200 files on disk rather than read back out of
the manifest it was supposed to be verifying.

### Recovery evidence captured first

`supabase db dump` runs `pg_dump` inside a container and **Docker Desktop was not running**,
so the dump failed and produced an empty file. Rather than block on it, equivalent evidence
was captured over the same authorized read-only connection and written to
`E:\pevvy-staging-preapply-20261128\baseline.json` (357,725 bytes):

- the complete row set of 14 business tables;
- **21 function definitions as they stood before application** — the evidence that actually
  matters for reversing these migrations;
- 134 triggers, 129 policies, 244 indexes, and the 143-entry migration ledger.

**Stated plainly: this is supplementary evidence, not a platform backup.** Supabase's own
automatic backups remain the real recovery mechanism and nothing here replaces them.

### The application

```
$ npx supabase db push --linked
Applying migration 20261128100000_rental_lifecycle_authorization.sql...
Applying migration 20261128110000_billing_authorization_matrix.sql...
Applying migration 20261128120000_amendment_evidence_one_to_one.sql...
Applying migration 20261128130000_maintenance_expense_integrity.sql...
Applying migration 20261128140000_assignment_activation_default_off.sql...
{"upToDate":false,"dryRun":false,"migrations":[...5...],"seeds":[],"roles":[],
 "message":"Finished supabase db push."}
```

**Exit code 0. All five applied. No seeds, no role changes.**

One warning appeared: *"failed to cache migrations catalog … docker API"*. That is the CLI
writing a **local** catalog cache through a container, with Docker not running. It says
nothing about the database — and the ledger verification below is what settles that
question, not the absence of a warning.

### Ledger after application

| | |
|---|---|
| Local / hosted | **148 / 148** |
| Drift | **zero** — every entry has `local == remote` |
| `db push --dry-run` | `{"upToDate":true,"migrations":[],"seeds":[],"roles":[]}` |

---

## 4.1 Hosted verification — 73 checks, all passed

**44 structural**, read-only, and **29 behavioural**, inside a transaction always rolled
back.

### Why the behavioural checks had to be re-run as a signed-in member

The first behavioural attempt reported the lifecycle column guard as **NOT REFUSED**, and
the reason matters more than the result: the hosted connection is `postgres`, which **is the
table owner**, and `app.guard_rental_lifecycle_columns` deliberately exempts the owner so
the authorized SECURITY DEFINER functions can do their work.

A guard that exempts the session you are testing from cannot be tested from that session.
The checks were re-run with `request.jwt.claims` set and `set local role authenticated` —
exactly as a request arriving at PostgREST — driven as the real staff member and the real
owner of the acceptance agency.

This is recorded rather than quietly fixed, because *"the owner session could not refuse
itself"* would otherwise have read as *"the guard does not work"*, or worse, been reported
as a pass.

### Structural (44)

- the five lifecycle functions are **SECURITY DEFINER** and carry both the role check and
  `app.billing_require_write`;
- `rental_check_in` carries the return-once guard **and** the idempotent retry path;
- the seven gated functions all call `app.billing_require_write`;
- the four exemptions are registered **with reasons**: `incident_create`, `incident_update`,
  `maintenance_create`, `maintenance_start`;
- `app.assignment_lifecycle_active` reads **no session setting**;
  `app.assignment_lifecycle_engaged` exists;
- `rentals_guard_lifecycle_columns`, `expenses_guard_maintenance_link` and
  `rental_line_items_zz_revision` are present **and enabled**;
- `rental_pricing_amendments_one_per_revision` present;
- `expense_ledger` carries `maintenance_id`; `rental_line_items` carries `revision_no`;
- `rental_swap_vehicle` is executable by **no** browser role;
- `expenses_maintenance_fkey` is `ON DELETE SET NULL (maintenance_id)` — that column only;
- `public.rentals` still carries its 4 policies.

### Data preserved

| | |
|---|---|
| Amendment records | **3**, all readable |
| …carrying `NULL line_revision_no` | **3** |
| Payments | **9** |
| Rentals | **5** |
| Contracts | **5** |
| Assignment records | **14** |
| Open assignments | **2** — `planned`/draft and `in_custody`/active |
| Open assignments on a completed or cancelled rental | **0** |
| Explicit activation rows | **0** (default-OFF) |
| Maintenance expense anomalies | **0** |

### Behavioural (29), as real signed-in members

| Check | Result |
|---|---|
| The session is a signed-in member, not the table owner | `authenticated` / staff uid |
| A staff member can confirm a reservation | reserved |
| **Counterfeit check-out by direct write refused** | *"The status of a rental is set by the action that changes it…"* |
| Direct write to a hand-over column refused | *"The odometer in of a rental is set by…"* |
| Direct write to the original return date refused | *"The original return date of a rental…"* |
| Notes remain editable | yes |
| Staff can check out, record the return, and complete | all three |
| **A staff check-in advances the vehicle odometer** | 21000 |
| **A staff member cannot overwrite a recorded return** | *"This rental has already been returned…"* |
| `maintenance_create` works for a manager | created |
| `expense_ledger` shows the maintenance attachment | linked |
| A linked cost cannot change allocation | *"…has to stay a vehicle cost."* |
| A linked cost cannot move to another vehicle | *"…the vehicle that was worked on."* |
| The authorized unlink detaches it | detached |
| Assignment activation default-OFF | `enabled=false` |
| `can_swap` reports false | `can_swap=false` |
| `rental_swap_vehicle` unavailable to a member | the function does not exist for that role |
| Restating a committed hire without evidence refused | *"…restated without recording what changed."* |
| **An authorized return releases the legacy custody assignment** | **0 open after** |

The last one exercises the **real** `in_custody` assignment on `RNT-2026-00004` — the car
currently in a customer's hands. It ran inside the rollback and **the record was not
altered**; it is the only honest way to prove drainage works against the actual data.

### The verification left no trace

Re-counted after the rollback: rentals **5**, vehicles **40**, customers **2**, amendments
**3**, payments **9**, expenses **3**, maintenance **8**, assignments **14**, open
assignments **2**. Every figure identical to the pre-application baseline.

---

## 5. Staging deployment

### Published

| | |
|---|---|
| Repository | `github.com/wiredmediadigital/atlas-car-rental-saas` (the owner's own) |
| Branch | `staging` |
| Was | `5634555` |
| Now | **`5198e0e`** |
| Commits published | 6 |
| Method | fast-forward; **no force, no history rewrite** |
| `origin/main` | **`31383a9` — unchanged**, verified after the push |

The push was confirmed a fast-forward *before* it was made, and the remote was confirmed to
be the owner's repository and not the original upstream.

### The deployed site

`https://quantum-lavenderblush-buffalo-97.hostingersite.com`

### Two false readings on the way, both corrected

**First: the wrong host.** `PEVVY_HOSTINGER_STAGING_CONFIGURATION_CHECKLIST.md` names
`basic-brown-ostrich-10.hostingersite.com`. That host returns HTTP 200 and serves a
Hostinger **"Coming soon" parking page** — no Pevvy, no assets, no Supabase reference. On
that evidence alone the conclusion would have been "staging is not deployed". The hostname
actually referenced throughout the rest of the roadmap, fifteen times against that one, is
`quantum-lavenderblush-buffalo-97`, and that is the real site.

**Second: a check that could not fail.** The host serves `index.html` with **HTTP 200 and
`text/html` for any path that does not exist** — an SPA fallback. A verification that
fetched each asset and accepted a 200 therefore proved nothing; it would have passed against
an empty server. Demonstrated directly: `/assets/DOES-NOT-EXIST-xyz123.js` returns 200.

Comparing the deployed site against the **local** artifact's filenames then reported 91
files "missing" and 24 "different" — which looked like a half-finished deployment and was
not one. Hostinger **rebuilds the application from the branch**, so its chunk hashes are its
own; the local build's filenames simply do not exist there, and the help images are
recompressed by the host.

The sound test is to follow the **deployed site's own asset graph** and require a non-HTML
content type. That is what the figures below come from.

### What the site actually serves

| | |
|---|---|
| Files genuinely served | **174** |
| Fallback responses while walking the graph | **0** |
| Total bytes | 4,778,311 |
| Deployed artifact SHA-256 | **`29973cd46c7a38630bd78672433fca1788b898eb1b2b613fbd6008690d763a19`** |

**This is the deployed build's own manifest.** It is deliberately *not* equal to the local
artifact's `e0261061…`, and it should not be: the host rebuilt from source. Recording the
local hash as if it described the deployment would have been a false attestation.

### It is this release, not merely a 200

Five strings exist only in this release. All five are present in what the server serves:

| Marker | Present |
|---|---|
| maintenance-link refusal mapping | yes |
| allocation refusal mapping | yes |
| vehicle refusal mapping | yes |
| duplicate-return refusal mapping | yes |
| expense detail "belongs to a maintenance record" notice | yes |

**On commit attribution, precisely:** the deployed bundle demonstrably contains code that
exists only at `a1728a9` and later, and the published branch head is `5198e0e`. The commits
between them are documentation only and produce byte-identical bundles, so the deployed
bundle cannot distinguish between them — and nothing is claimed beyond that.

### Project identity and credentials, in the deployed bytes

| | |
|---|---|
| Staging reference `yeklucfthspvejlkffln` | **present** |
| Production reference `ysnumxtzcgzyabrghxwq` | **absent** |
| Publishable browser key | present — expected; it is the browser key |
| `sb_secret_` key material | **none** |
| `service_role` JWT | **none** |
| Database password | **none** |
| Supabase access token | **none** |
| PEM private key | **none** |

### SPA routing and transport

A direct navigation to `/rentals` returns the application over HTTPS. Given the fallback
behaviour above, that is a weak signal on its own and is recorded as such — it confirms
routing is not broken, not that the route renders correctly.

---

## 6. Targeted staging acceptance

**Everything below is automated verification against the hosted database and the deployed
bundle. None of it is owner manual acceptance**, and none of it should be recorded as such.

| # | Area | Verified automatically | Still needs the owner |
|---|---|---|---|
| 1 | Rental creation, confirmation, checkout | confirm, check-out and the status transitions, as a real signed-in staff member | the screens and the wording |
| 2 | Vehicle return and duplicate protection | return recorded; a second different return **refused**; identical retry mutates nothing; odometer advances | how the refusal reads at the desk |
| 3 | Rental completion | completes after a refused second return | — |
| 4 | Repricing and extension | evidence enforced; revision behaviour covered by 52 local tests | hosted repricing through the UI |
| 5 | Financial amendment history | 3 records preserved and readable; `NULL` revisions cannot satisfy future evidence | the history tab renders the three records |
| 6 | Maintenance expense link and unlink | link, `expense_ledger` exposure, authorized unlink | the maintenance screen's link/unlink controls |
| 7 | Linked expense editing restrictions | allocation and vehicle changes **refused** by name | **the new notice and link on the expense detail page** |
| 8 | Staff and Manager authorization | staff can run the lifecycle; manager-only `maintenance_create` works for the owner | a staff account seeing manager-only controls hidden |
| 9 | Billing restrictions and exemptions | the seven gated functions carry the check; four exemptions registered with reasons | a genuinely restricted agency in the UI |
| 10 | Vehicle availability after legacy release | an authorized return releases the real `in_custody` assignment, **0 open after** | availability shown in the UI afterwards |
| 11 | RentalNewPage / IncidentNewPage defaults | the shared rule has 17 unit tests, including the cleared-field case | **the two pages themselves — no render-level coverage** |

### Not re-run

The complete WP1–WP4 manual acceptance exercise was **not** repeated, as instructed.

### Owner acceptance checklist — the short list

Each of these needs a signed-in browser and takes a minute:

1. **Expense detail, linked cost.** Open a cost attached to maintenance. Confirm the
   *"Attached to maintenance"* badge, the notice explaining what can and cannot be edited,
   and that the link opens the maintenance record. Then try changing its allocation and
   confirm the refusal names the unlink step rather than saying *"some of the values entered
   are not valid"*.
2. **Duplicate return.** Return a vehicle, then try to record a different return on the same
   rental. Confirm it is refused and the first reading stands.
3. **New rental, primary driver.** On RentalNewPage, clear the suggested primary driver and
   confirm it **stays cleared** rather than refilling itself.
4. **New incident, vehicle and hire.** On IncidentNewPage, pick a vehicle that is out with a
   customer and confirm the current hire is offered; clear it and confirm it stays cleared.
5. **Amendment history.** Open `RNT-2026-00004` and confirm its three amendment records are
   listed and the figures match the live hire.
6. **Assignment lifecycle.** Confirm no new assignment rows appear for ordinary work — the
   feature is default-OFF for every agency — and that the one car still out with a customer
   can be returned normally.

Items 1, 3 and 4 are the ones with no automated UI coverage at all, so they carry the most
weight.

---

## 7. Known limitations

- **A mis-keyed return reading has no route to correction.** Closing the duplicate check-in
  closed the only informal one. Registered as a **WP9 candidate requirement**:
  Manager-authorized, auditable correction of incorrectly entered return information.
- **`RentalNewPage` and `IncidentNewPage` have no render-level coverage.** The defaulting
  rule they share has 17 unit tests; the pages do not.
- **Assignment activation is now OFF for every agency on staging**, because none holds an
  explicit activation row. Intended, and the STG-02 contract — but it is a change every
  tenant experiences, not a no-op.
- **Five Edge Functions remain undeployed**: `mfa-reset`, `public-booking`, `gps-provider`,
  `account-closure`, `account-closure-notice`. Not deployed under this instruction. The
  public booking page does not work on staging until the last of those is deployed.
- **`service_role` bypasses row level security**, and owner-owned SECURITY DEFINER functions
  inherit the trigger exemptions. Pre-existing, unchanged, recorded.
- **The staging configuration checklist names the wrong hostname.**
  `basic-brown-ostrich-10.hostingersite.com` is a parking page; the live staging site is
  `quantum-lavenderblush-buffalo-97.hostingersite.com`. The checklist should be corrected.
- **Hostinger rebuilds from the branch**, so the deployed artifact hash will never equal the
  local one. Any future verification that compares them will report a false mismatch.
- **Recovery evidence is supplementary.** Supabase's own platform backups remain the real
  recovery mechanism; `baseline.json` is a convenience, not a substitute.

---

## 8. Readiness for Work Package 5 — Security Deposit Management

**Ready to begin, on the owner's instruction. Not begun.**

What now holds that did not before:

- the rental lifecycle is a privileged operation with tenant, role and billing checks, and
  the lifecycle columns are frozen against direct writes — **verified on hosted staging**;
- a vehicle return is recorded **once**, so deposit logic can rely on a single return event
  rather than defending against a silently overwritten one;
- every restatement of a finalized hire needs its own evidence, one-to-one — the foundation
  any deposit deduction must sit on;
- billing entitlement is enforced across the maintenance and incident RPCs;
- the schema on staging is **148 / 148 with zero drift**, so WP5 builds on a hosted
  database rather than a local replay.

What WP5 should settle early:

- **where a deposit lives.** `public.rentals` already carries `deposit_minor`. Deposit
  *records*, held balances, deductions and releases are a different shape, and whether they
  extend the rental or become their own tables is an architecture decision, not an
  implementation detail.
- **the separation the owner has insisted on**: what an agency's customer pays for a hire is
  not what the agency pays Pevvy. Deposits belong firmly on the first side.
- **immutable history.** The amendment architecture built here is the right precedent — a
  recorded, attributed restatement rather than an overwrite — and the deferred
  return-correction workflow should probably be designed alongside it.

**No dependency of WP5 on the five undeployed Edge Functions has been identified.** That is
a statement about what was looked for, not a guarantee; it should be asked again against
WP5's actual design.

---

## 9. What is still not authorized and has not been done

- Pushing anything to `origin/main`, which remains at `31383a9`.
- Deploying the five undeployed Edge Functions — `mfa-reset`, `public-booking`,
  `gps-provider`, `account-closure`, `account-closure-notice`.
- Activating any account-closure schedule.
- Anything at all touching production.
- Beginning Work Package 5.

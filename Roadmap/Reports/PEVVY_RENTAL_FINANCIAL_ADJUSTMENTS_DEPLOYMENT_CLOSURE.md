# Pevvy — Work Package 4: staging deployment closure

**Date:** 2026-11-27
**Status:** **IMPLEMENTED AND DEPLOYED TO STAGING — OWNER ACCEPTANCE PENDING**
**Production:** **NO-GO.** Production project `ysnumxtzcgzyabrghxwq` was not accessed,
not linked and not deployed to.

This is not functional acceptance and does not claim to be. Scenarios 30–35 in
`PEVVY_RENTAL_FINANCIAL_ADJUSTMENTS_ACCEPTANCE.md` are the owner's pass and have not
been run.

---

## 1. What was deployed

| | |
|---|---|
| Branch | `fix/maintenance-manual-acceptance-20261125` |
| Worktree | `E:\pevvy-maintenance-acceptance-20261125` |
| Published | `aa94dc3..357961e` → `origin/staging`, **fast-forward, no force** |
| `origin/main` | **unchanged** at `31383a9` |
| Remote | `github.com/wiredmediadigital/atlas-car-rental-saas` — the user's own repository |
| Commits | 4: `e350322`, `f414616`, `09c9954`, `357961e` |

The starting baseline was exactly as the authorization stated — `origin/staging` at
`aa94dc3`, `origin/main` at `31383a9`, four unpublished commits.

---

## 2. The migration

| | |
|---|---|
| File | `20261127100000_rental_pricing_amendment_history.sql` |
| SHA-256 | `d0d9ca39487486c1cb7e492364a7a7e28bcf4e4f317c4dcc70234ee74b553890` |
| Size | 798 lines / 35,823 bytes |
| Ledger | **143 local / 143 remote, zero drift, nothing pending** |
| Project | `yeklucfthspvejlkffln`, confirmed against `supabase/.temp/project-ref` |

**It was already applied when this session checked, and was not applied from here.**

A ledger row proves only that a row exists, so the applied content was compared against
the approved file: **30 statements, identical** once the CLI's stripped statement
separators are normalised. The raw difference was exactly 30 characters against 30
statements — one terminating semicolon each. What is on staging **is** `d0d9ca39…3890`.

---

## 3. Hosted schema verification

**33 catalog checks and 24 behavioural checks, all passing.** The behavioural checks ran
inside a transaction that was rolled back; a count taken afterwards confirmed no QA user,
organization, subscription, rental, charge line or amendment persisted, and that existing
record counts were unchanged at 4 rentals, 4 charge lines, 5 payments, 3 contracts.

### Catalog

`rental_pricing_amendments` exists with all fourteen columns; `difference_minor` is
`GENERATED ALWAYS`; `amended_at` defaults to `clock_timestamp()`; the rental foreign key
is composite and cascades, the line-item key sets null; three indexes present.

`rental_line_items_amendment_evidence` exists, **enabled, deferrable and initially
deferred**. `rental_line_items_integrity` — the accepted charge protection — still
exists and is enabled. `rentals_guard_pricing_inputs` exists, is enabled, and its
function is **SECURITY INVOKER**, which is what makes `current_user` name the real
writer.

All three internal functions are unreachable by `anon` and `authenticated`. On the table
itself, browser roles hold **`authenticated: SELECT` and nothing else** — `anon` holds
nothing — behind a single select-only policy.

### Behaviour, on the live schema

- A confirmed reservation repriced from **€1.00 → €150.00** recorded one amendment,
  `diff +€149.00`, naming the operator and the charge line, **with no contract issued**
  and `contract_version` null. Zero contract versions existed afterwards.
- Staff **insert**, manager **update** and owner **delete** against the history were each
  refused with *permission denied for table rental_pricing_amendments*.
- A hire restated without recording anything was refused with *"The hire on a committed
  rental was restated without recording what changed."*
- A completed rental refused direct changes to the return date, day rate, tax rate,
  currency, deposit, days charged, return time and odometer — eight refusals, each with
  its own sentence.
- The same completed rental could still be **annotated**, and a draft could still be
  **edited**. Both deliberate.
- A contract was issued, the rental then repriced, and **version 1's snapshot was
  byte-identical afterwards**; the amendment recorded `contract_version = 1`.

**A note on method.** The first behavioural run reported the evidence requirement as not
refusing. It was a probe artefact, not a schema fault: the constraint is **deferred**, so
it fires at commit, and the probe transaction is deliberately never committed. Forcing it
with `SET CONSTRAINTS … IMMEDIATE` produced the refusal. Worth recording, because a
deferred constraint tested inside an uncommitted transaction looks exactly like a
constraint that is not working.

---

## 4. Deployed frontend verification

A manifest hash proves a build changed; it does not prove what is in it. The deployed
site was crawled and checked by content: **172 asset files fetched, 170 of 170 `.js`
served as JavaScript, 11 of 11 checks passing.**

| Check | Result |
|---|---|
| Manifest | `554d9c72…` → `2f6f37db614161c410d078935464adaa8853f6d077f014342b0390a5dd42ea51`, 199 files, `projectRef: yeklucfthspvejlkffln` |
| **23 release-unique strings** | all present |
| **6 responsive classes** | all present |
| **7 accepted-release probes** | all present |
| Staging project ref in bundle | present |
| Production project ref | **absent** |
| Secret key value / `service_role` JWT | **absent** |

The release-unique set includes *Hire amendments*, *has not been repriced or extended*,
*Every authorized change to the hire charge*, *was in force*, *Reverse this charge*,
*Post the reversal*, *Customer credit*, *Net effect on this contract*, *Rental sections*,
*corrected by posting a reversal, which a manager does*, and *Actual downtime is
temporarily unavailable* — so the amendment history panel, the reversal interface, the
financial overview, the four-tab layout and the held caption correction are all genuinely
live.

The preserved set includes *Nothing charged yet.*, *Refundable deposit, held separately*,
*Hand-over*, *Nobody is named as the driver*, *Maintenance*, *Incidents* and *Open
incidents*, so Charges, Money, Agency costs, the hand-over record and the accepted
Maintenance and Incident Management work are all still present.

**The amendment history is connected to the applied schema**: the panel reads
`rental_pricing_amendments` through PostgREST, the table exists on
`yeklucfthspvejlkffln` with a select grant for `authenticated`, and the deployed bundle
carries that project ref and no other.

---

## 5. Regression

The deployment candidate is the tested implementation. Focused regression on it:
**400 of 400 passing** across the financial, lifecycle, closure, permission and rental
frontend suites — `rental-pricing-amendments` 32, `rental-lifecycle-integrity` 23,
`rental-charge-integrity` 59, `assignment-gate-wording` 3, `account-closure-purge` 23,
`cancellation-fee` 28, `permission-matrix` 65, plus 167 frontend and authorization tests.

The full suite on this code was **4,198 tests, 4,194 passing, 4 failing**, all four being
the established baselines:

| File | Test |
|---|---|
| `assignment-feature-activation` | defaults missing activation to disabled and keeps the decision tenant-scoped |
| `assignment-lifecycle-operations` | supports repeated active swaps with idempotent operation keys and preserved inspections |
| `assignment-lifecycle-operations` | fails closed for unauthorized and cross-tenant active swaps |
| `billing-restricted-access` | leaves no SECURITY DEFINER write path ungated and unexplained |

**Zero newly introduced failures.** The guarded staging build verified 199 files at
SHA-256 `0ef652a76d1218b45ae3c152de9fda210493530339f2ade11a0a87663d4f79ed`; the guard
refused `.env.local` (production project) and the legacy JWT anon key before it would
build.

---

## 6. Production hardening requirements, recorded not resolved

### 6.1 One-to-one financial amendment evidence

**Open. Not resolved, and not represented as resolved.**

The evidence check matches a mutation's *signature* — rental, organization, charge line,
previous and revised amount, and the quantity, unit-rate and tax-treatment changes. That
closes the case where an earlier or unrelated amendment vouches for a later unrecorded
change, which was a real hole and was proved with a failing test before it was fixed.

It does not establish strict one-to-one correspondence. A single transaction that moved
the hire 100 → 200 → 100 → 200 while recording only the first change would have its third
mutation matched by the first amendment's signature, because the signatures are identical.

**Requirement:** before production, each finalized financial mutation must claim its own
amendment record, so that evidence is consumed rather than merely matched. A signature
match is not a claim.

**Reachability today:** the caller must already be inside an owner-owned SECURITY DEFINER
function; any other writer is refused outright by the charge integrity guard. No existing
function performs oscillating restatements.

### 6.2 Privileged mutation boundaries

Review requirements preserved, unchanged:

- **`service_role`** bypasses row-level security entirely. Held only by Edge Functions.
  Pre-existing and architectural.
- **Owner-owned SECURITY DEFINER functions** inherit the trigger exemptions on both
  `rental_line_items` and `rentals` by construction. The exemption is per-role, not
  per-function. The five that exist were enumerated and checked; a future one must be
  reviewed explicitly for tenant, role, billing, grants, search path and financial
  integrity.
- **Direct PostgreSQL administrative access** as `postgres`. Outside the application's
  threat model.

### 6.3 Rental lifecycle mutation boundaries

**Open. A targeted production security verification requirement.**

`status`, `picked_up_at`, `returned_at` and `original_ends_at` are deliberately **not**
frozen by `app.guard_rental_pricing_inputs`, because the lifecycle RPCs that write them —
`rental_confirm`, `rental_check_out`, `rental_check_in`, `rental_complete`,
`rental_cancel` — are **SECURITY INVOKER** and run as the caller. Freezing them would
break every one.

What protects them today is narrower and should be verified rather than assumed:

- `status` has its own transition guard (`rentals_guard_status_transition`), which
  refused `completed → draft` under test;
- `picked_up_at` and `returned_at` are frozen once the rental is **completed or
  cancelled**, verified on the live schema;
- between confirmation and completion they are **directly writable** by a staff member
  with a billing entitlement;
- `original_ends_at` is writable throughout, because `rental_confirm` writes it.

**Requirement:** verify before production that the SECURITY INVOKER lifecycle
architecture cannot be bypassed by a direct client mutation of these four columns on a
rental that is reserved or active — in particular, that a direct write cannot
counterfeit a check-out or a return without the RPC's validation.

This is recorded as a verification requirement, not expanded into a lifecycle redesign.

### 6.4 Existing baseline failures and gates

The four database baseline failures above are preserved and unresolved. Every existing
production readiness gate stands, including the six undeployed Edge Functions, the
non-reproducible deployment artifact hash, independent concurrency verification against
hosted Postgres, the STG-02 assignment-activation default, the eleven incident and
maintenance definer RPCs that do not call `app.billing_require_write`, the absence of any
down migration, and Hostinger deployment-to-commit attribution.

---

## 7. What is not claimed

**No responsive verification was performed visually.** The six responsive classes are
confirmed present in the shipped bundle, which proves they were built, not that the
layout is right at any width. No screenshots were captured and no device was used. First
visual verification is the owner's, in scenarios 34 and 35g, which say so explicitly and
ask which of physical device or emulation was used.

**No authenticated browser session was used against staging at any point.** Every
behavioural check above ran through the database as the roles in question. The acceptance
scenarios are the first authenticated interface verification.

**Amendment history begins at this migration.** Rentals repriced before it show an empty
history, which is accurate rather than missing. Nothing was reconstructed.

---

## 8. Work package status

**Work Package 4 — Rental Financial Adjustments: IMPLEMENTED AND DEPLOYED TO STAGING —
OWNER ACCEPTANCE PENDING.**

Not functionally accepted. Not closed. Maintenance Management (28/28), Incident
Management (scenario 29) and Driver availability (9/9) are preserved and were not
reopened.

**Production remains NO-GO.**

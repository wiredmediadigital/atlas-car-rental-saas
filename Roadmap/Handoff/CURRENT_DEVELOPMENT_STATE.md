# Current development state

Evidence date: 2026-11-25. The labels below distinguish implementation, automated validation, deployment evidence, and owner acceptance.

| Module | Status | Evidence / limitation |
|---|---|---|
| Rental lifecycle | Implemented; automated coverage exists; standard rental regression remains an owner acceptance failure in the maintenance candidate | `src/pages/rentals/`, rental migrations, maintenance acceptance |
| Fleet Management | Implemented; maintenance-derived status integrated locally/reported staged | Live authenticated acceptance pending |
| Vehicle availability | Implemented with rental, overdue, driver, and maintenance guards | Independent hosted concurrency remains unverified |
| Customer Management | Implemented baseline | Existing customer feature and migrations |
| Driver availability | Implemented; owner accepted 9/9 | Independent concurrent-session proof remains open |
| Incident Management | Implemented and preserved; UI correction candidate exists | Maintenance acceptance still reports incident-link UI failures |
| Maintenance Management | Partially implemented; local/PGlite validation and reported staging migration work exist; manual acceptance NO-GO | 11 passed, 11 failed, 4 pending of 26 |
| Expense Management | Existing system implemented; maintenance linkage exists in candidate | Integration acceptance pending; no duplicate ledger |
| Public booking | Implemented through opt-in tenant-scoped Edge Function and lead workflow | `supabase/functions/public-booking/` |
| Rental financial functionality | Existing payments, deposits, cancellation, repricing, and customer ledger preserved | Adjustments wait for Maintenance |
| SaaS subscription billing | Implemented in billing functions/migrations; dirty mixed changes exist in main | Do not infer hosted parity from local source |
| Authentication/authorization | Supabase Auth, MFA, terms, membership, and role gates implemented | `src/features/auth/`, `src/lib/authz/` |
| Tenant isolation | RLS/RPC and tenant-aware relationships implemented | Hosted isolation remains a release gate |
| Reporting | Existing overview, financial, fleet, and operational reports | No new reporting work authorized |

## Blockers

Maintenance remains production NO-GO pending owner manual acceptance of the remediation. The owner-approved prompt is archived at `Roadmap/Prompts/PEVVY_MAINTENANCE_MANUAL_ACCEPTANCE_REMEDIATION_PROMPT.md` as of 2026-11-26. Hostinger deployment-to-commit binding and authenticated UI acceptance are not proven. The primary checkout is mixed and dirty, not a safe implementation base.

---

## 2026-11-27 — Production hardening developed, not applied

**Where things stand.** Work Package 4 is FUNCTIONALLY ACCEPTED — CLOSED on the owner's
scenario 30–35 results. Roadmap functional completion is **4 of 10**. Work Package 5 has
not begun and must not begin until the hardening below is applied and verified.

**Branch and worktree.** `fix/maintenance-manual-acceptance-20261125` in the isolated
worktree `E:\pevvy-maintenance-acceptance-20261125`. `origin/staging` is unchanged at
`5634555`; `origin/main` is unchanged at `31383a9`.

**Five forward migrations exist locally and are NOT applied.** Ledger 148 local / 143
remote. Their checksums, preflight queries, data impact and recovery notes are in
`Reports/PEVVY_PRODUCTION_HARDENING_STAGING_MIGRATION_AUTHORIZATION.md`. Read that before
applying anything.

| Migration | What it changes |
|---|---|
| `20261128100000` | Lifecycle RPCs become privileged; lifecycle and hand-over columns frozen against direct writes |
| `20261128110000` | Billing entitlement on seven RPCs; four registered safety exemptions |
| `20261128120000` | One amendment record per hire restatement, identified by revision |
| `20261128130000` | Maintenance-linked costs held to their vehicle and allocation |
| `20261128140000` | Assignment activation default-off, with drainage |

**The one with data impact is `20261128140000`.** It releases open assignments whose
rental is already completed or cancelled. Nothing on an active rental is touched. Capture
the preflight row set first if the prior per-row state matters — `released` is terminal.

**Do not deploy the frontend before these are applied.** The lint corrections in
`RentalNewPage` and `IncidentNewPage` do not depend on them, but are held with them.

**Two things await an owner decision:**

1. Whether a second `rental_check_in` should be refused once `returned_at` is set. Today
   it overwrites the first reading; one coherent record survives, so this is a lost
   update rather than corruption.
2. What to do about existing inconsistent maintenance-expense links, listed by
   `app.maintenance_expense_anomalies`. Nothing was rewritten.

**Five Edge Functions remain undeployed on staging**: `account-closure`,
`account-closure-notice`, `gps-provider`, `mfa-reset`, `public-booking`. The public
booking page does not work on staging until the last of those is deployed. Four are
ACTIVE — the release gate saying "six of nine" is stale.

## 2026-11-27 — final hardening corrections and hosted preflight

The five migrations are still **unapplied**; two of them changed, so **use the checksums in
`Reports/PEVVY_PRODUCTION_HARDENING_STAGING_MIGRATION_AUTHORIZATION.md` and not any earlier
list**.

What changed in the code:

- `rental_check_in` refuses a second, different return and answers an identical retry without
  mutating anything (amended into `20261128100000`).
- `public.expense_ledger` carries `maintenance_id`, and the expense detail screen shows the
  attachment and links to the unlink (amended into `20261128130000`).
- Five database refusals now survive the frontend error mapping instead of being replaced by
  a generic sentence.
- The defaulting rule behind the three react-hooks corrections is extracted to
  `src/pages/selection-defaults.ts` and covered by tests; the two pages themselves still have
  no render-level coverage.

Two open decisions for the owner:

1. **A mis-keyed return reading has no route to correction.** Closing the duplicate check-in
   closed the only informal one. No correction workflow was invented.
2. **Applying `20261128140000` stops every agency on staging from opening new assignment
   rows**, because no organization holds an explicit activation. Intended, but it is a change
   every tenant experiences.

Still true: production not accessed, `origin/main` 31383a9, `origin/staging` 5634555,
nothing pushed, nothing deployed, Work Package 5 not begun.

## 2026-11-28 — build verified, awaiting migration authorization

The guarded staging build is **fresh and clean**: commit `a1728a9`, 200 files, SHA-256
`e0261061…`, exit 0, zero production references, zero embedded credentials. The earlier
`be240a5b…` artifact is stale and must not be used.

**The five migrations are still unapplied and require explicit owner authorization.** Use
the checksums in `Reports/PEVVY_PRODUCTION_HARDENING_FINAL_DEPLOYMENT_CLOSURE.md` §3 and no
earlier list.

**The hosted baseline moves while acceptance continues.** Amendment records on
`RNT-2026-00004` went 2 → 3 and payments 8 → 9 during this execution. Harmless: the recorded
history still agrees with the live hire. Re-read before applying, and check the two numbers
that must not move — drainage **0** and anomalies **0**.

Unchanged: `origin/main` 31383a9, `origin/staging` 5634555, nothing pushed, nothing
deployed, production not accessed, WP5 not begun.

## 2026-11-28 — hardening released to staging

**Applied and deployed.** Hosted ledger 148/148, zero drift. 73 hosted verification checks
passed. `origin/staging` is `5198e0e`; `origin/main` untouched at `31383a9`. The deployed
site is `quantum-lavenderblush-buffalo-97.hostingersite.com` — **not** the
`basic-brown-ostrich-10` hostname the configuration checklist names, which is a parking
page.

Two traps worth knowing for next time:

1. **The hosted connection is `postgres`, the table owner**, and the lifecycle column guard
   deliberately exempts the owner. Behavioural security checks must set
   `request.jwt.claims` and `set local role authenticated`, or they test nothing.
2. **The staging host serves `index.html` with HTTP 200 for any missing path.** Any
   deployment check that accepts a 200 will pass against an empty server. Follow the
   deployed site's own asset graph and require a non-HTML content type.

**Next authorized package: WP5 — Security Deposit Management. Not begun.**
Production not accessed. **NO-GO.**

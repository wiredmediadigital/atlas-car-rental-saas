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

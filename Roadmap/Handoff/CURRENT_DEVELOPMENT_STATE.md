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

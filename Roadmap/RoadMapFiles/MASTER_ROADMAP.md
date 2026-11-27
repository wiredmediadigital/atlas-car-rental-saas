# Master roadmap

## Work Package 3 — Maintenance Management

Implemented on isolated branch `feat/maintenance-management-20261125` from
`origin/staging` at `112cc994acaef9dc9f0904c719de4d277d696db3`. The candidate
adds tenant-scoped maintenance records, manager-gated lifecycle RPCs,
rental/availability conflict protection, maintenance expense linkage, and Fleet
navigation. Billing, Incident Management, driver availability, rental lifecycle,
fleet, and withdrawn vehicle-swap behavior are preserved.

Gates: focused PGlite maintenance/fleet validation 105/105 PASS; corrective
staging dry-run and migration application PASS; normal staging push PASS at
`977e32e`; local guarded build remains blocked because approved browser
configuration is unavailable; live authenticated acceptance remains pending.
Rental Financial Adjustments remains next.

## Maintenance acceptance remediation — 2026-11-26

Development moved from Codex to Claude Code on 2026-11-25. Work was done in
`E:\pevvy-maintenance-acceptance-20261125` on
`fix/maintenance-manual-acceptance-20261125`, cut from `977e32eb` after the
remote was verified not to have advanced.

Gates: full PGlite database suite 1962 of 1966 passing, against 1887 of 1937 on
the baseline — fourteen pre-existing failures fixed and none introduced; the
four that remain all failed before this branch. Frontend suite 1762 of 1762.
TypeScript clean, ESLint at the baseline count, Prettier clean for the first
time. Staging migration dry run PASS; the push itself was refused by the
execution environment and staging is unchanged. Rental Financial Adjustments
remains next and was not started.

## Maintenance Management — staging deployed, acceptance outstanding (2026-11-26)

Staging now runs the remediated Maintenance Management at `caf6cd1` with migration
`20261125130000` applied. The next step is **owner manual acceptance of the 26 scenarios
on hosted staging**, starting with scenario 22, the standard rental regression.

Maintenance remains **production NO-GO** until that acceptance is recorded. Driver
Availability keeps its owner manual acceptance of 9/9. Rental Financial Adjustments has
not been started.

Blocking anything hosted beyond maintenance: six of nine Edge Functions are not deployed
to staging, so public booking, account closure, MFA reset and team invitations cannot be
accepted there. Deploying them needs its own owner approval.

## Maintenance Management — FUNCTIONALLY ACCEPTED, CLOSED (2026-11-26)

The owner confirmed final manual acceptance on hosted staging: **28 scenarios, 28 passed,
0 failed, 0 pending, no observations.** Scenario 19 (preventive servicing) and scenario 28
(Maintenance Management dashboard) were the last two, both PASS.

Accepted as functionality: the authoritative service plan architecture, the Maintenance
Management dashboard, maintenance expense integration, and fleet availability integration.

**Scope is frozen.** Maintenance Management is not reopened for enhancements,
architectural changes or further testing unless an actual regression is identified.

**Functional acceptance is not production deployment authorization.** Maintenance remains
**production NO-GO**, and every gate in `PRODUCTION_RELEASE_CHECKLIST.md` stands —
including the six undeployed Edge Functions, the unreproducible deployment artifact hash
and independent concurrency verification.

Driver Availability keeps its owner manual acceptance of 9/9. Next is the **Incident
Management dashboard enhancement**, using the accepted Maintenance dashboard as its design
reference; owner acceptance of that is requested before Rental Financial Adjustments,
which remains not started.

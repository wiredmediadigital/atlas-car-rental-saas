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

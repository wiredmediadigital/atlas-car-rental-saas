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

## Incident Management dashboard — staging deployed, acceptance outstanding (2026-11-26)

Staging runs the Incident Management dashboard at `b163cc6`, built on the accepted
Maintenance dashboard and deployed with **no migration**. Verified by content on the
deployed bundle.

Acceptance is recorded as **scenario 29** and is outstanding. No previously accepted
incident functionality was reopened, and Maintenance Management stays closed at 28/28.

**Rental Financial Adjustments remains not started.** Per the owner's instruction,
acceptance of the Incident dashboard is requested before it begins. Maintenance and
Incidents both remain production NO-GO; every gate in the production release checklist
stands.

## Incident Management — FUNCTIONALLY ACCEPTED, CLOSED (2026-11-26)

The owner confirmed **scenario 29 — Incident Management dashboard: PASS**, with **13/13**
verification items and no observations. Incident Management, **including its dashboard
enhancement**, is **FUNCTIONALLY ACCEPTED — CLOSED** and its scope is frozen.

Three areas are now closed and none supersedes another: Maintenance Management 28/28,
Incident Management scenario 29 at 13/13, and Driver availability / conflict prevention
9/9, whose independent concurrent-session evidence remains a release gate.

**Functional acceptance is not production deployment authorization.** Production remains
**NO-GO** and every remaining gate in `PRODUCTION_RELEASE_CHECKLIST.md` stands.

Next is **Rental Financial Adjustments**, which has not been started and for which no work
package has yet been supplied. The owner's approved Maintenance downtime caption
correction is committed and deliberately held unpushed, to travel with that package's
deployment rather than prompt one of its own.

## Work Package 4 — Rental Financial Adjustments — 2026-11-27

Commissioned as an enhancement and verification assignment, not a new financial system.
No parallel adjustment ledger, payment ledger, pricing engine, tax engine or customer
credit system was built, and the Charges / Money / Agency costs architecture is unchanged.

The brief required the existing delete action on rental charge lines to be investigated
rather than assumed unsafe. It was unsafe: the delete was a direct PostgREST `DELETE`
whose only backend control was a policy that said nothing about the state of the rental,
so a staff member could destroy a charge after the contract was issued, after payment and
after completion. The only lifecycle gate was in the browser.

Migration `20261126130000_rental_charge_integrity.sql` closes it. Corrections after a
rental is committed are posted as mirrored reversal lines that preserve the original,
carry an operator, a timestamp and a reason, and cannot be posted twice. The base hire is
covered by the same protection; repricing and extension continue to restate it through
`public.rental_extend` and `public.rental_reprice`, now privileged functions carrying the
tenant, role, billing and state checks that row-level security previously applied on their
behalf. Public RPC signatures are unchanged. Cancellation settles by reversal with its
pricing outcome unchanged.

The migration is applied to **staging only** — 142 local / 142 remote, zero drift — and
the applied statements were compared against the approved checksum rather than trusted
from a ledger row. Production has not been accessed and remains NO-GO.

Rental Details is now four tabs — Overview, Financials, Inspections, Documents, and
deliberately no Activity tab — with an authoritative financial overview strip whose six
figures are all read from the database rather than recomputed in the browser. Reversing a
charge is a manager's authority. Destructive actions on finalized charges are gone.

**Not accepted.** Scenarios 30–34 in
`Reports/PEVVY_RENTAL_FINANCIAL_ADJUSTMENTS_ACCEPTANCE.md` are the owner's pass, and the
acceptance gate closed for Maintenance (28/28) and Incident Management (scenario 29) is
open again for this package. One requirement is declared **incomplete in advance**:
a confirmed reservation repriced before any contract is issued leaves no record of the
previous hire amount, which needs a further migration and its own authorization.

Maintenance Management (28/28), Incident Management (scenario 29) and Driver availability
(9/9) are preserved and not reopened.

## Work Package 4 — financial amendment history remediation — 2026-11-27

The outstanding requirement from the Rental Financial Adjustments implementation. A
confirmed reservation repriced before any contract had been issued lost its previous
hire amount; where a contract existed, the superseded version preserved it.

Issuing a contract to preserve history was investigated and rejected on evidence.
`rental_issue_contract` irreversibly supersedes every live version, surfaces a document
awaiting signature and PDF, permanently flips `app.rental_is_finalized`, and makes
rescheduling refuse. There is also no reusable snapshot builder — the pricing jsonb is
built inline and reachable only by inserting a contract row. More fundamentally,
issuance is a manual act, so any design routing history through it leaves history
depending on whether somebody pressed a button.

Migration `20261127100000_rental_pricing_amendment_history.sql` adds
`public.rental_pricing_amendments`, shaped after the existing `expense_change_events`:
one row per act, two headline amounts as columns, everything else as `{from, to}` in
`changes`. Nobody holds insert, update or delete on it; a privileged recorder writes it
and a deferred constraint trigger refuses to commit a restated finalized hire that left
no record. Both pricing functions were restated from their effective definitions with
the per-organization assignment gate preserved word for word.

**Created and locally tested only. Not applied to any hosted database.** Ledger 143
local, 142 remote. Hosted application needs the owner's authorization. Production
remains NO-GO.

Scenario 35 is added to the consolidated acceptance register and cannot be run until the
migration is applied. Scenarios 30–34 keep their status, which is not yet run.

## Work Package 4 — financial and lifecycle integrity closure — 2026-11-27

The owner accepted the amendment history architecture in principle and held hosted
application pending focused checks. Three things came out of them.

**One real gap, found by the owner asking the right question.** The deferred constraint
matched on rental and transaction only, so a single amendment row satisfied every hire
restatement in that transaction. Proved with a failing test, then closed by matching the
evidence to the specific mutation — rental, organization, charge line, and the before and
after of every field that qualifies a change.

**One reported defect that was not real.** The obsolete session-GUC wording in
`rental_substitute_vehicle` and `rental_reschedule` exists in migration `20261120220000`
but is corrected by `20261124100000`, which re-runs the rewrite. Queried against the
effective schema, no function carries it. The earlier report asserted it from reading
migration files; that was wrong, and is corrected rather than acted on. A regression test
was added instead.

**One vulnerability broader than reported.** A direct PATCH on `public.rentals` could
change the day rate, tax rate, currency, deposit, billable days, return date and customer
of a completed rental, and erase its hand-over record. `app.guard_rental_pricing_inputs`
closes it, exempting the table owner — which required first establishing that most
lifecycle RPCs are SECURITY INVOKER and write only status, the hand-over timestamps and
`original_ends_at`.

All three corrections were folded into the existing unpublished migration, which is now
798 lines, SHA-256 `d0d9ca39…3890`. **Still created and locally tested only; 143 local,
142 remote.** Hosted application needs the owner's authorization. Production remains
NO-GO.

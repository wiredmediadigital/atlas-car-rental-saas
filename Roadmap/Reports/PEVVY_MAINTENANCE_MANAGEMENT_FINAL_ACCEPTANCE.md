# Pevvy — Maintenance Management final acceptance

**Date:** 2026-11-26
**Status:** **FUNCTIONALLY ACCEPTED — CLOSED**
**Recorded by:** the owner, on hosted staging, signed in.

---

## 1. Result

| | |
|---|---|
| Total scenarios | **28** |
| Passed | **28** |
| Failed | **0** |
| Pending | **0** |
| Owner observations | **None** |

The last two scenarios confirmed were:

- **Scenario 19 — Preventive servicing: PASS.**
- **Scenario 28 — Maintenance Management dashboard: PASS.**

This supersedes the interim register of 26 scenarios at 11 passed / 1 failed / 0 untested,
and the earlier owner baseline of 11 passed / 11 failed / 4 pending.

---

## 2. What is accepted

| Area | Accepted as |
|---|---|
| Authoritative service plan architecture | One service plan per vehicle, held on the maintenance record, written only by `maintenance_set_service_plan`, read everywhere through `evaluateVehicleServicing` |
| Maintenance Management dashboard | Eight summary figures, filterable records tab, fleet-wide preventive servicing tab including vehicles with no plan |
| Maintenance expense integration | Preserved intact through the servicing work and accepted |
| Fleet availability integration | Availability derived from maintenance records and explicit off-road restrictions via `app.maintenance_restriction_range` |

Supporting facts at acceptance:

- Accepted staging commit **`131ac9a0fbb8f82787c0a17079d042c7c5bb37d0`**.
- Deployed artifact **`e4c586445ed429e7986c344e5d10d17328938eaaf2e10a8d3836785be2a1f698`**,
  199 files, verified by content rather than by HTTP status.
- Migration ledger **141 local / 141 applied / zero drift**, last applied
  `20261126120000_maintenance_service_plan_advancement.sql`.
- The 22 automated maintenance acceptance tests in
  `supabase/tests/maintenance-acceptance.test.ts` pass unmodified.

---

## 3. Scope freeze

Maintenance Management is **closed**. It is not reopened for enhancements, architectural
changes or additional testing unless an **actual regression is identified** — meaning
observed behaviour that contradicts an accepted scenario, not a preference, a tidying
opportunity or a new idea.

If a regression is found, it is reported against the specific scenario number it breaks.

---

## 4. What acceptance does not mean

**Functional acceptance is not production deployment authorization.**

Maintenance Management remains **production NO-GO**. Every outstanding gate in
`RoadMapFiles/PRODUCTION_RELEASE_CHECKLIST.md` is preserved unchanged. The acceptance
checkbox is the only one that moved. Still open, among others:

- Six of nine Edge Functions are not deployed to staging.
- The deployment artifact hash is not reproducible by the deploying party.
- Independent concurrency verification against hosted Postgres; PGlite cannot provide two
  genuinely independent transactions.
- The STG-02 assignment-activation default decision.
- Whether eleven incident and maintenance `SECURITY DEFINER` write RPCs should call
  `app.billing_require_write`.
- No down migration exists; reverting requires a new forward one.
- Hostinger deployment-to-commit attribution for the production target.

Production project `ysnumxtzcgzyabrghxwq` remains unchanged, not accessed and not linked.

---

## 5. Evidence preserved

Implementation, migration, deployment and acceptance evidence is retained in full. Nothing
was deleted or rewritten; the superseded interim results are kept and marked as history.

| Document | Holds |
|---|---|
| `Handoff/KNOWN_ISSUES_AND_ACCEPTANCE.md` | The acceptance register, with the superseded 11/11/4 breakdown preserved verbatim |
| `Reports/PEVVY_PREVENTIVE_SERVICING_FINAL_CORRECTION.md` | Root cause, the 93-agent adversarial review, 19 confirmed defects, the dashboard build |
| `Reports/PEVVY_PREVENTIVE_SERVICING_DEPLOYMENT_CLOSURE.md` | Ledger, hosted grants, RPC exposure probe, CSV correction, deployment verification |
| `Reports/PEVVY_MAINTENANCE_MANAGEMENT_DEPLOYMENT_CLOSURE.md` | Earlier maintenance deployment record |
| `Reports/PEVVY_MAINTENANCE_REMEDIATION_RELEASE_CLOSURE.md` | Remediation closure and the billing-gate policy proposal |
| `RoadMapFiles/RELEASE_HISTORY.md` | Per-release deployment evidence and rollback references |
| `supabase/migrations/` | The schema history through `20261126120000`, unedited |

---

## 6. Next

The **Incident Management dashboard enhancement** proceeds, using the accepted Maintenance
dashboard as its design reference. Owner acceptance of that dashboard is requested before
**Rental Financial Adjustments**, which has not been started.

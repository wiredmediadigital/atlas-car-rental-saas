# Pevvy — Incident Management final acceptance

**Date:** 2026-11-26
**Status:** **FUNCTIONALLY ACCEPTED — CLOSED**
**Recorded by:** the owner, on hosted staging, signed in.

---

## 1. Result

| | |
|---|---|
| Scenario 29 — Incident Management dashboard | **PASS** |
| Verification items | **13 of 13 passed** |
| Observations | **None** |

Incident Management, **including its dashboard enhancement**, is **FUNCTIONALLY ACCEPTED
— CLOSED**.

The script run was the thirteen-step manual acceptance in
`Reports/PEVVY_INCIDENT_MANAGEMENT_DASHBOARD_ENHANCEMENT.md` §10, which covers the two
kinds of summary figure, every tile acting as a filter, the in-progress case that the
Open incidents tile must include, an incident with several maintenance records counted
once, a resolved incident whose maintenance is still open, period stepping, All time,
search, the seven filters, the occurred-date range, pagination, unchanged Incident
Details, refresh after resolution, and the responsive card list.

---

## 2. The three closed acceptances

| Area | Owner result | State |
|---|---|---|
| Maintenance Management | **28/28** scenarios | ACCEPTED — CLOSED, frozen |
| Incident Management incl. dashboard | **Scenario 29 PASS**, 13/13 items | ACCEPTED — CLOSED, frozen |
| Driver availability / conflict prevention | **9/9** scenarios | Accepted and preserved |

**Preserved, not superseded.** This acceptance adds to the other two and replaces neither.
Driver availability keeps its 9/9, and its independent concurrent-session evidence remains
an open release gate.

---

## 3. What is accepted

| Area | Accepted as |
|---|---|
| Incident dashboard summary | Six figures split into three period metrics and three current-state metrics, each tile captioned with which it is, each acting as a filter onto the rows it counted |
| Incident records table | Eight columns of business identifiers, no UUIDs, responsive to a card list, every row reaching the existing Incident Details |
| Search and filtering | Reference, vehicle, rental, customer and the free text of the report; status including an explicit Unresolved, type, responsibility, vehicle, rental, maintenance and an occurred-date range; all held in the URL, with All time beside the period stepper |
| Maintenance integration | Counts per incident with outstanding work flagged, counted once per incident however many records it raised, preserved on resolved incidents because the two lifecycles are independent |
| Accuracy and failure behaviour | Every figure from one complete paged read, de-duplicated by primary key; a failed read shows a dash rather than a zero, with the two reads tracked separately |

Supporting facts at acceptance:

- Accepted staging commit **`b163cc63d3375d4e606e152d5a1e48cabb21fb7a`**.
- Deployed artifact **`ff41ee11dbe87b6b2b230f0a44a9f09f5ea2cfb3bedaba8923742fc5f70b76a2`**,
  199 files, verified by content rather than HTTP status.
- **No migration.** Frontend only; the ledger stayed at 141 local / 141 applied.
- 65 tests added, including five that prove tenant isolation on both new reads in both
  directions. The 22 automated maintenance acceptance tests pass unmodified.

---

## 4. Approved presentation correction

The Maintenance dashboard's downtime tile carried an error caption written when the
service plan migration was still unapplied:

> Needs the maintenance service plan migration to be applied to this project.

That stopped being true when the owner applied `20261126120000`. It was reported rather
than changed at the time, because Maintenance was frozen. The owner has now approved the
replacement:

> Actual downtime is temporarily unavailable. Refresh the page or try again later.

**Status: committed, deliberately not published.** The owner's instruction was to include
it in the next authorized staging deployment and **not** to initiate a deployment solely
for the caption. Publishing it now would do exactly that — the documentation in this
closure does not change the bundle, so the caption would be the only deployed change. The
commit is therefore held on the branch and will travel with the next authorized
deployment.

How to find it: it is the **single commit on the local branch that is not on
`origin/staging`**, subject `fix: the downtime caption no longer blames an applied
migration`. It touches one file, `src/features/maintenance/components/MaintenanceSummary.tsx`,
changing one caption string and the stale comment above the prop that drives it. Confirm
with:

```
git log --oneline origin/staging..HEAD
```

Expected: exactly one commit. If it ever shows none, the caption has already been
published and this note is spent; if it shows more, something else is riding along and
should be looked at before the next deployment.

The change is covered by the existing maintenance suites, which pass (42 tests), and by
typecheck, lint and the format gate. No test asserted the old caption text, so none
needed changing — worth recording, because that absence is why the obsolete wording
survived the migration being applied.

This is the one change made to frozen Maintenance code, and it was made under explicit
owner approval.

---

## 5. Scope freeze

Incident Management and Maintenance Management are **closed**. Neither is reopened for
enhancements, architectural changes or additional testing unless an **actual regression is
identified** — meaning observed behaviour that contradicts an accepted scenario, not a
preference, a tidying opportunity or a new idea.

A regression is reported against the specific scenario number it breaks.

---

## 6. What acceptance does not mean

**Functional acceptance is not production deployment authorization.**

Production remains **NO-GO**. Every outstanding gate in
`RoadMapFiles/PRODUCTION_RELEASE_CHECKLIST.md` is preserved unchanged; only the acceptance
boxes moved. Still open:

- Six of nine Edge Functions are not deployed to staging.
- The deployment artifact hash is not reproducible by the deploying party.
- Independent concurrency verification against hosted Postgres.
- The STG-02 assignment-activation default decision.
- Whether eleven incident and maintenance `SECURITY DEFINER` write RPCs should call
  `app.billing_require_write`.
- No down migration exists; reverting requires a new forward one.
- Hostinger deployment-to-commit attribution for the production target.
- Two pre-existing `react-hooks/set-state-in-effect` errors in `IncidentNewPage.tsx`, the
  incident reporting form, which was deliberately not modified.

Production project `ysnumxtzcgzyabrghxwq` remains unchanged, not accessed and not linked.

---

## 7. Evidence preserved

Nothing was deleted or rewritten. Superseded results are kept and marked as history.

| Document | Holds |
|---|---|
| `Handoff/KNOWN_ISSUES_AND_ACCEPTANCE.md` | The acceptance register, with the superseded 11/11/4 maintenance breakdown preserved verbatim |
| `Reports/PEVVY_INCIDENT_MANAGEMENT_DASHBOARD_ENHANCEMENT.md` | Implementation, metric definitions, the ten defects found before publication, tests, deployment evidence, the acceptance script |
| `Reports/PEVVY_MAINTENANCE_MANAGEMENT_FINAL_ACCEPTANCE.md` | The 28/28 maintenance acceptance |
| `Reports/PEVVY_PREVENTIVE_SERVICING_DEPLOYMENT_CLOSURE.md` | Ledger, hosted grants, RPC exposure, CSV correction |
| `RoadMapFiles/RELEASE_HISTORY.md` | Per-release deployment evidence and rollback references |
| `supabase/migrations/` | The schema history through `20261126120000`, unedited |

---

## 8. Next

**Rental Financial Adjustments.** Not started, and **no work package for it has been
supplied** — the instruction closing this acceptance refers to "the next authorized Rental
Financial Adjustments work package", which has not yet arrived. This documentation closure
is complete and self-contained; implementation of that package awaits its brief.

The approved caption correction is committed and waiting to travel with that package's
deployment.

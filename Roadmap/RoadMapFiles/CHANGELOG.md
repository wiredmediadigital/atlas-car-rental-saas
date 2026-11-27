# Changelog

## Unreleased — Work Package 4: Rental Financial Adjustments (2026-11-27)

- A posted rental charge can no longer be destroyed. Deleting a charge is permitted
  only while the rental is still a draft; once it is confirmed, contracted or paid
  against, the database refuses the delete and a correction is posted as a reversal
  instead. Previously the only gate was in the browser.
- Corrections are additive and attributed: a reversal mirrors the original line,
  records who posted it, when and why, and cannot be posted twice against the same
  charge. The original charge stays on the contract.
- The base hire is covered by the same protection. Repricing and extension continue
  to restate it, through `public.rental_extend` and `public.rental_reprice`, which are
  now privileged functions carrying the tenant, role, billing and rental-state checks
  that row-level security used to apply on their behalf. Their signatures are unchanged.
- Cancellation settlement posts reversals rather than erasing the hire. The pricing
  outcome is unchanged.
- Reversing a charge is a manager's authority, not a staff member's, matching the
  database rule rather than inheriting the old staff-level delete permission.
- Rental Details is now four tabs — Overview, Financials, Inspections, Documents — with
  a financial overview strip above them reporting the rental total, payments received,
  outstanding, customer credit, deposit held and agency costs. Every figure is read from
  the database; none is recomputed in the browser.
- Corrected the Maintenance downtime caption, which blamed an applied migration.
- Known limitation: a confirmed reservation repriced before any contract is issued
  leaves no record of the previous hire amount. Where a contract exists, the superseded
  version preserves it.

## Unreleased — Work Package 3

- Added tenant-scoped Maintenance Management lifecycle and UI.
- Added maintenance conflict protection to rental confirmation and availability.
- Reused existing vehicle expenses through maintenance linkage; no duplicate ledger.
- Applied the validated maintenance migration to staging; live frontend asset
  publication remains pending verification.
- Synchronized fleet and Vehicle Details effective status with active
  maintenance, removed the manual maintenance toggle, added early-start
  confirmation, actual timestamps, and Incident Details → Create maintenance.

## Unreleased — Maintenance Management acceptance remediation (2026-11-26)

- Restored the overdue unreturned hire exclusion and the deterministic order
  that the maintenance rewrite dropped from `vehicles_available_between`.
- Made a maintenance restriction mean the period it covers, so a vehicle in the
  workshop today can still be reserved for a date the work does not touch, and
  a vehicle free today cannot be booked across a future maintenance window.
- Gave availability, the rental guard and the conflict listing one shared
  definition of that period, so they cannot disagree.
- Made taking custody revalidate current restrictions, whatever the contract's
  own dates say, and kept an overdue repair restrictive until it is completed.
- Removed operational status from Vehicle Details and from vehicle editing, and
  made the database refuse the write; restrictions are applied and released by
  actions that name them, each recording a reason.
- Added resolution for legacy manual maintenance restrictions, refused while
  real work is still open.
- Completed the reverse incident relationship, incident context on Maintenance
  Details, the incident resolution warning, preventive servicing, supporting
  documents and expense linkage on Maintenance Details.
- Corrected downtime to count only work that actually happened, to accrue
  unfinished work to now, and to merge overlapping records.
- Extended account closure to the maintenance and incident tables and their
  three private buckets, which it had never purged.
- Closed PUBLIC, and therefore anon, out of the private `app` schema.

Automated validation only. Manual acceptance has not been re-run.

## 2026-11-26 — Maintenance acceptance remediation deployed to staging

Published `caf6cd1` to `origin/staging` as a fast-forward; the owner applied migration
`20261125130000`. Staging ledger 140/140, zero drift.

- A maintenance restriction now means the period it actually covers. The rewritten
  `vehicles_available_between` had lost the overdue-unreturned-hire exclusion and made
  any in-progress record block every period, which is why one defect produced the
  standard rental regression, the period-specific failures and the overdue-checkout
  failure at the same time.
- A CSV import can no longer land a vehicle as bookable when its own file says the car is
  off the road. The row is held back with a message naming what to do instead.
- Four defects found by the pre-release safety review and fixed before publication: a
  missing `EXECUTE` grant on `app.maintenance_restriction_range` that would have made
  every availability search fail for every signed-in member; account closure collecting
  three storage buckets its sweeper refused, leaving a closed agency's files in Storage;
  `off_road_by` able to make an Auth account undeletable; and an undisclosed second
  caller of the assignment self-heal.

Not accepted: the owner's 11 passed / 11 failed / 4 pending baseline is unchanged.
Production untouched and NO-GO.

## 2026-11-26 — Maintenance expense workflow enhancement deployed to staging

Published `33769b6` and `f41ea5e` to `origin/staging` as fast-forwards. No migration:
the schema was already sufficient.

- A cost can now be recorded from the Costs section of a maintenance record. It opens
  the existing expense form, prefilled with the vehicle, the maintenance reference and
  title, and the expense category mapped from the maintenance category by its seeded
  `system_key`, then attaches the new cost to the record. The same ledger, the same
  validation and the same authorization as Finance → Record a cost.
- A cost that is recorded but cannot be attached now says so. It used to be impossible
  to report at all; the obvious implementation would have shown "The cost was not saved"
  over a cost sitting in the ledger, which is how an invoice gets entered twice.
- The Link an existing expense picker no longer offers costs that are already attached
  to a maintenance record. Linking one used to move it off whatever record already had
  it, quietly reducing that record's actual cost. Voided costs are excluded too.
- When nothing is eligible to link, the card says so instead of hiding the picker.
- Two pre-existing defects fixed in passing: the picker was gated on `maintenance.update`
  where the database checks `expenses.create`, and its label pointed at an element id
  that `Field` discards, so screen readers read an unlabelled combobox.

Not accepted: the owner's 11 passed / 11 failed / 4 pending baseline is unchanged — this
adds a scenario rather than resolving one. Production untouched and NO-GO.

## 2026-11-26 — Preventive servicing correction and Maintenance dashboard (staging)

Published `3ba371e`..`cd6fc95` to `origin/staging` as fast-forwards. One corrective
migration, `20261126120000`, **not applied** — staging stands at 140 applied, 141 local.

Scenario 19. The service plan was always being saved: replaying the real migration
history, `maintenance_set_service_plan` stores all four columns and reads back intact.
Every symptom the owner reported was a surface that failed to show it.

- The read-back lived in the `canManage === false` branch, so the manager who saves was
  the one person who never saw what had been stored. It now renders for everyone.
- `toNumberOrNull` turned `5,000` into `null` while the RPC overwrites all four columns,
  so a mistyped box silently erased a stored interval and reported success. Parsing is
  strict and per-field now, and the boxes re-seed from the row the RPC returns.
- `text-danger` is not a token in this Tailwind v4 theme, so every error using it rendered
  as grey body text. Nine call sites across maintenance, vehicles and incidents.
- Nothing outside that one card read the plan, and `maintenance_due_summary` had zero
  frontend callers. Vehicle Details was reading an unrelated legacy column.

Service status now has one home in `src/lib/compliance/service.ts`, reusing the agency's
own lead days and reading the day in its time zone. Vehicle Details gains a Service and
maintenance card and loses the Next service row from Compliance. The general vehicle form
no longer edits `next_service_on`; the key came out of the write payload first, so stored
dates survive an edit rather than being nulled one vehicle at a time.

Completing qualifying maintenance now advances the plan — the owner's worked example,
2026-12-10 at 55,200 with 180 days and 5,000, gives 2027-06-08 and 60,200 — and the
completion asks for an odometer reading only where the plan recurs on distance.

The Maintenance page becomes a dashboard: eight figures that say which are states and
which are period totals, a filterable records tab, and a fleet-wide preventive servicing
tab including vehicles with no plan.

Found and fixed before publication: dashboard sums silently truncated by `max_rows = 1000`
(two of them money), and nineteen defects from a 93-agent adversarial review — dates
rendering a day early, a form that could write superseded values back over an advanced
plan, a failing SECURITY DEFINER allow-list test, and a distance advancement that could
never fire because nothing recorded a completion odometer.

Not accepted: 26 passed / 1 failed / 0 untested stands unchanged. Scenario 19 stays failed
until the owner verifies it; dashboard acceptance is recorded separately as scenario 28.
Production untouched and NO-GO.

## 2026-11-26 — preventive servicing deployment closure

The owner applied `20261126120000_maintenance_service_plan_advancement.sql`. Verified
independently: 141 local, 141 applied, zero drift. Both new functions were read back from
the hosted schema — `authenticated` and `service_role` granted, `anon` granted nothing,
both SECURITY DEFINER with a fixed `search_path`, and the downtime function scoped by
`app.is_org_member` inside its own WHERE clause.

The downtime tile is operational. A live probe returned `42501 permission denied` rather
than `PGRST202 not found`, which is the distinction that matters: PostgREST resolved the
function and its named signature and Postgres refused the anonymous role, so the schema
cache has reloaded and the tile's error path is gone.

The fleet CSV export's `Next service` column now reads the authoritative service plan
instead of the frozen `vehicles.next_service_on`. The column keeps its name, its position
and the file's 33 columns. A configured plan wins; a mileage-only plan leaves the cell
blank, because such a vehicle is due at a reading and not on a day and a fallback there
would print a plausible wrong date; the legacy date survives only where no plan exists at
all. It resolves through `evaluateVehicleServicing`, the same call Vehicle Details makes,
so the file and the screen cannot disagree. Plans are paged, so a fleet over PostgREST's
1,000-row ceiling does not report everything after the first page as unplanned.

The build moved 198 → 199 files. Investigated rather than assumed: rebuilding the previous
commit reproduced its recorded hash exactly, and the added file is the maintenance API
emitted as a shared chunk now that the Vehicles page reaches it.

Not accepted: 26 passed / 1 failed / 0 untested stands unchanged. Scenario 19 and the
dashboard's scenario 28 both await owner verification. No migration was created,
production was not touched, and it remains NO-GO.

## 2026-11-26 — Maintenance Management functionally accepted

The owner confirmed scenario 19 (preventive servicing) and scenario 28 (Maintenance
Management dashboard) as PASS. Final consolidated result: **28 scenarios, 28 passed, 0
failed, 0 pending, no observations.** Maintenance Management is **FUNCTIONALLY ACCEPTED —
CLOSED** and its scope is frozen.

Accepted as functionality: the authoritative service plan architecture, the Maintenance
Management dashboard, maintenance expense integration, and fleet availability integration.

The interim 11 passed / 11 failed / 4 pending result is preserved as history in
`Handoff/KNOWN_ISSUES_AND_ACCEPTANCE.md` and is superseded, not deleted.

Functional acceptance is **not** production deployment authorization. Maintenance remains
production NO-GO and every remaining gate in the production release checklist stands.

## 2026-11-26 — the Incidents page becomes a dashboard

Built on the accepted Maintenance dashboard rather than beside it: the same page skeleton,
period stepper, debounced search, filter drawer, clamped pagination and table/card-list
split. The Incidents route and the Report incident action are unchanged, and no navigation
module was added.

Six figures of two kinds, and each tile says which it is. Three describe the selected
period; three describe now, whenever the incident happened. That split is the point rather
than a detail — an incident opened in March and never closed is the most actionable row in
the product, and a dashboard that hid it behind a month selector would be worse than no
dashboard. "All time" exists so the list can reach those rows too.

Every figure comes from one complete list, paged past PostgREST's 1,000-row ceiling and
de-duplicated by primary key, so the summary cannot contradict the table beneath it and a
total is never taken from whatever the first page happened to hold. A failed read shows a
dash, never a confident zero, and the two reads fail independently.

The records list becomes an eight-column table of business identifiers, with the related
maintenance summarised per incident — counted once per incident however many records it
raised, and still counted when the incident itself is resolved, because the two lifecycles
are independent.

Three defects found before publication: the period tiles reset the period; the Open
incidents tile counted in-progress work and then filtered it out of its own drill-down;
and the date filter read the UTC day while the table displayed the agency's. An adversarial
review found seven more, including a confident zero over a failed maintenance read and a
hover class that referenced a border the button did not have.

Not accepted: recorded as scenario 29, awaiting owner verification. Maintenance remains
28/28 and frozen; no accepted incident functionality was reopened. Production untouched
and NO-GO.

## 2026-11-26 — Incident Management functionally accepted

The owner confirmed scenario 29, the Incident Management dashboard, as PASS: **13/13
verification items, no observations.** Incident Management, including the dashboard
enhancement, is **FUNCTIONALLY ACCEPTED — CLOSED** and frozen.

Maintenance Management keeps its 28/28 acceptance and Driver availability its 9/9. All
three are closed functionally; none is a production authorization, and production remains
NO-GO with every other release gate standing.

One approved presentation correction was made to the Maintenance dashboard: the downtime
tile's error caption no longer claims the service plan migration is unapplied, which
stopped being true when the owner applied it. It now reads "Actual downtime is temporarily
unavailable. Refresh the page or try again later." The change is committed but **not
published on its own** — the owner asked that it travel with the next authorized
deployment rather than prompt one for a caption.

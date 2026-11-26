# Changelog

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

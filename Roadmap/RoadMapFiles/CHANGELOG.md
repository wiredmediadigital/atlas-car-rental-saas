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

# Architecture decisions

## Maintenance is an operational domain

Maintenance records use dedicated tenant-scoped RPCs and do not mutate rental
identity, financial records, subscription state, or incident resolution. Normal
maintenance blocks conflicting reservations; urgent maintenance remains visible
as a conflict without silently cancelling or completing a rental. Costs reuse
the existing vehicle expense ledger through `maintenance_id`.

Maintenance-related vehicle status is derived from Maintenance Management
records and effective operational restrictions rather than a standalone manual
maintenance status toggle. Incident Details is the primary repair entry point;
incident association remains optional and uses the existing maintenance FK.

Maintenance documents use a private dedicated bucket and tenant-scoped metadata
policies. Service reminders use date and odometer thresholds; downtime is
calculated from clipped, overlapping maintenance intervals so overlapping work
is not double-counted.

## 2026-11-26 — One definition of a maintenance restriction

`app.maintenance_restriction_range` states the period a maintenance record
restricts a vehicle for, and availability, the rental guard and the conflict
listing all read it. Three separate expressions of the same rule had already
drifted apart once; a shared definition is why they cannot again.

Scheduled work restricts its agreed window. Work in progress restricts from when
it actually started until an expected completion that is still in the future;
once that has passed without a completion, the return date is unknown and the
restriction stays open-ended, which is how an overdue unreturned hire has been
treated since 20261107100000.

Taking custody is a separate question from booking a period. A contract may be
held for a date the work does not touch, but the keys are not handed over while
the vehicle is restricted now.

## 2026-11-26 — Operational status is derived, not edited

`vehicles.status` is no longer writable by any browser role.
`app.guard_vehicle_status` refuses the change, so a direct PostgREST call cannot
do what the removed dropdown did. A restriction is applied and released by an
action that names it: maintenance through its own lifecycle, an independent
restriction through take off the road and return to service, and a legacy
manual value through an explicit resolution that is refused while real work is
open. Each records why.

The reason is not tidiness. The vehicle form submits the whole row, so a status
field on it cleared whatever restriction a vehicle was under every time somebody
corrected a typo in its notes.

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

## 2026-11-26 — One authoritative service plan, accepted

Preventive servicing has exactly one home. A vehicle's next service is recorded on the
maintenance record that services it, written only by `maintenance_set_service_plan`, and
every surface reads it through `evaluateVehicleServicing` in
`src/lib/compliance/service.ts`. Maintenance Details, Vehicle Details, the fleet-wide
servicing tab and the fleet CSV export all call that one function, so they cannot disagree
about the same car on the same day.

The reason is not elegance. The product previously had two independently editable
next-service dates — one on the maintenance record and the legacy `vehicles.next_service_on`
— and they never agreed. Removing the second editor required taking the column out of the
vehicle write payload *before* taking the field off the form: the vehicle form submits the
whole row, so a blanked field would have nulled a stored date every time somebody corrected
a typo. The legacy column is now read-only history, surfaced only where no plan exists.

Recurrence is computed at completion, not on read. Completing a record that carries an
interval recomputes the next thresholds from the completion actually recorded — the date in
the agency's own time zone, and the reading taken at the garage. `vehicles.odometer` is
deliberately not substituted for a missing service reading: it is the last rental hand-over
figure, and borrowing it would manufacture evidence that somebody read the odometer during
a service when nobody did.

A due or overdue service is **informational**. It does not take a vehicle off the road,
change maintenance status, cancel a rental or create an expense. Availability is decided by
maintenance records and explicit off-road restrictions, and by nothing else.

This architecture is owner-accepted as of the 28/28 final acceptance and is frozen.

## 2026-11-26 — A dashboard counts from one complete list, accepted

Both accepted dashboards derive their figures from rows the page already holds, read
through one query that pages to the end, rather than from a second server-side aggregate.

The reason is not performance. Counting with one query and listing with another lets
"Open incidents: 4" sit above a list of five whenever the two run a moment apart, and a
summary that contradicts the thing it summarises discredits every other figure on the
page. One source cannot disagree with itself.

Two rules follow, and both are enforced in code rather than left to care:

A figure is never taken from a truncated read. PostgREST stops at `max_rows` and says
nothing about it, so a total counted from the first page is wrong while looking exact —
the worst way for a number to be wrong, because nobody re-checks a plausible figure. The
reads page to the end and de-duplicate by primary key, since offset paging over live data
returns a row twice when something is inserted between two pages.

A failed read shows a dash, never a zero. Zero is a claim; "—" is the truth. Where two
reads back one screen they are tracked separately, so a failure in one cannot make the
other's tile confidently wrong.

Dashboard figures are also split into period figures and current-state figures, and each
tile says which it is. State that is still open — an unresolved incident, a service past
due — is deliberately unbounded by the selected period, because the row somebody most
needs to find is the old one nobody closed.

This architecture is owner-accepted across Maintenance Management (28/28) and Incident
Management (scenario 29, 13/13), and is frozen.

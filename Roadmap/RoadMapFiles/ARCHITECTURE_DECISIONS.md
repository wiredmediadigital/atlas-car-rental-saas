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

## 2026-11-27 — A function is redefined from its effective definition, not its file

A migration that redefines an existing database function must start from the definition
that is live after every preceding migration has run, read with `pg_get_functiondef`, and
not from the `create or replace` statement in whichever older migration file happens to
mention it.

This is not a style preference. `20261120100000_assignment_feature_activation.sql` does
not edit a file: it loops over every function whose body mentions the assignment feature
flag and rewrites that body in place, replacing a session-level GUC check with
`app.assignment_lifecycle_active(organization_id)`. Any function it touched therefore has
a live definition that exists in no migration file at all.

Redefining `public.rental_extend` from its original file reverted exactly that rewrite.
The function still compiled, still passed its own tests, and silently returned the
assignment lifecycle to a session flag that nothing sets — so a confirmed reservation
stopped opening its vehicle assignment row. Nothing in the rental test suites noticed. The
maintenance acceptance suite did, through one scenario about a reservation confirmed
outside a member session, which is a thin thread to have been hanging by.

Any future migration redefining `rental_extend`, `rental_reprice`, `rental_confirm`,
`rental_check_out`, `rental_check_in`, `rental_complete`, `rental_reschedule`,
`rental_substitute_vehicle` or `rental_swap_vehicle` must check the live body first and
preserve the per-organization gate.

## 2026-11-27 — The trusted financial mutation boundary

Any function owned by the table owner and marked SECURITY DEFINER that can write
`rental_line_items` is part of the trusted financial mutation boundary, because the
integrity trigger deliberately stands aside for the table owner.

That is how the guard tells an authorized pricing operation from a direct PostgREST
write: `app.guard_rental_line_item_integrity` is SECURITY INVOKER, so `current_user` names
whoever is actually writing, and it compares that against the owner of
`public.rental_line_items`. A signed-in role cannot become the owner. A client-settable
session flag was rejected for this: `set_config` is callable by anyone, so a GUC the
trigger trusts is a GUC an attacker sets first.

The cost of that choice is that the exemption is granted by ownership rather than by
intent. A new owner-owned definer function that touches charge lines inherits the
exemption whether or not its author considered the question. Every such function must
therefore be reviewed for: tenant membership, minimum role, billing entitlement, its
EXECUTE grants (`anon` revoked, `authenticated` granted explicitly rather than through
PUBLIC), a fixed `search_path`, and whether it can be made to write a charge line that
the trigger would otherwise refuse.

The permission-matrix and billing definer allow-list regression tests enforce the grant
half of this and must not be weakened. Two helpers the guard itself calls —
`app.rental_is_finalized` and `app.rental_charges_purge_exempt` — are executable by
`authenticated` by necessity, since the guard runs as the caller. Both are read-only and
return a boolean about a rental id the caller must already know. This is a known and
accepted residual exposure, recorded here so it is not rediscovered as a surprise.

## 2026-11-27 — Desktop, tablet and mobile are not optional

Every subsequent Pevvy work package is responsive work. Desktop, iPad portrait, iPad
landscape and mobile usability are acceptance requirements, not a later pass, and a
feature is not complete at desktop width alone.

## 2026-11-27 — Financial history is produced by the operation, not by a document

An authorized restatement of a finalized base hire records what it changed inside the
same transaction that changes it. History does not wait for a contract.

The alternative was to issue a contract version, since `rental_contracts.snapshot`
already freezes every charge line. It was rejected on what the function actually does:
`rental_issue_contract` irreversibly supersedes every live version, surfaces a document
awaiting signature and a PDF that nobody asked for, permanently flips
`app.rental_is_finalized`, and makes later rescheduling refuse. There is also no reusable
snapshot builder — the pricing jsonb is constructed inline and reachable only by
inserting a contract row.

The deciding argument is simpler than any of those. Contract issuance is a **manual
act**. Any design that routes financial history through it leaves history depending on
whether somebody pressed a button, and that is not a property a financial record can
have.

Two rules follow, both enforced in the database rather than by convention.

**Nobody writes the history from outside.** `rental_pricing_amendments` has no insert,
update or delete grant for any browser role, exactly as `expense_change_events` does it.
Unauthorized creation, modification and deletion are refused because the privilege does
not exist. A policy can be loosened later without anyone noticing; a missing grant cannot
be used at all.

**An operation that restates a finalized hire cannot commit without recording it.** A
deferred constraint trigger checks, at commit, that an amendment row was written in the
same transaction. Deferral is essential rather than incidental: the pricing function
updates the line and records immediately afterwards, so an immediate check would fire
between the two and refuse every legitimate amendment. Checking at commit asks the only
question that matters — by the time this transaction finished, was there a record? — and
a future pricing path that forgets is refused.

This narrows, for the hire specifically, the per-role exemption recorded above: an
owner-owned SECURITY DEFINER function still bypasses the integrity guard, but it can no
longer restate a finalized hire silently.

History begins at this migration. Nothing is reconstructed for amendments made before
it, and no previous pricing is inferred from balances or payments.

## 2026-11-27 — The figures a rental is priced from are part of the contract

The charge lines were protected first, and that left the inputs exposed. A direct
PostgREST PATCH on `public.rentals` could change the day rate, the tax rate, the
currency, the deposit, the billable days, the return date and the customer of a
**completed** hire, because `rentals_update` asks for a role and a billing entitlement
and says nothing about the state of the rental.

That does not move money by itself, which is exactly why it had survived: the charge
lines still said what was charged. It desynchronises the booking from the contract
silently, and the screen that compares the two only looks while the rental is a draft or
a reservation.

The guard uses the same discriminator as the charge guard — `current_user` against the
table owner, with the trigger SECURITY INVOKER so that `current_user` names the real
writer. Reusing it required checking a fact that is easy to assume and was not true:
**most lifecycle RPCs are SECURITY INVOKER.** `rental_confirm`, `rental_check_out`,
`rental_check_in`, `rental_complete` and `rental_cancel` all run as the caller, and an
owner-only exemption would have broken every one of them.

It does not, because of what they write. They touch only `status`, `picked_up_at`,
`returned_at` and `original_ends_at`, none of which is frozen in the states those
functions run in. The hand-over columns are frozen only once the rental is completed or
cancelled, which is after check-out and check-in have finished with them. `original_ends_at`
is left editable because `rental_confirm` writes it.

Two rules follow for anything added later.

**A new trigger on a lifecycle table must be checked against the invoker RPCs, not only
the definer ones.** The definer list is short and obvious; the invoker list is longer and
is where a protection breaks the desk.

**Non-financial metadata stays editable.** `notes` is deliberately not frozen. A
protection that stops the desk recording what a customer said on the phone is a
protection that gets switched off.

## 2026-11-27 — Evidence has to describe the mutation it vouches for

The deferred constraint that requires an amendment for a restated hire originally matched
on rental and transaction alone. That let one amendment row vouch for every hire
restatement in the same transaction: a function that recorded its first change and then
quietly made a second committed happily.

The requirement is not "a record exists" but "this change is recorded". The check now
compares the amendment against the mutation it is offered for — rental, organization,
charge line, previous and revised amount, and the quantity, unit-rate and tax-treatment
changes. `changes` carries only the keys that moved, so a key's absence is itself a claim
that the field did not move, and the mutation has to agree with that too.

The same reasoning applies to any future evidence requirement: existence checks are
satisfied by the wrong evidence, and the wrong evidence is indistinguishable from the
right evidence until somebody looks.

A consequence worth keeping: `amended_at` defaults to `clock_timestamp()`, not `now()`.
`now()` is the transaction timestamp, so two amendments in one transaction would share it
exactly and could not be ordered — and the order of a financial history is part of what
it says.

## 2026-11-27 — A deferred constraint tested without a commit looks broken

Verifying the amendment evidence requirement against hosted staging reported it as not
refusing. The schema was fine. The constraint is DEFERRED, so it fires at commit, and the
verification deliberately ran inside a transaction that was always rolled back so that no
QA record could survive. The violation was therefore never reached.

`SET CONSTRAINTS <name> IMMEDIATE` is how a deferred constraint is made to answer inside
an uncommitted transaction, and it produced the refusal.

This is worth recording because the failure mode is indistinguishable from a real one: a
deferred constraint that is never committed against looks exactly like a constraint that
does not work. Any future verification of deferred enforcement must either commit, or
force the check, and must say which it did.

The same caution applies in reverse to the local suite: those tests pass because each
statement auto-commits, which is the opposite environment and tests the same property by
a different route. Both are needed.

## 2026-11-27 — Billing entitlement: safety acts are exempt, commerce is not

The owner's decision, and the line it draws. Seven incident and maintenance RPCs now
require the billing write entitlement. Four do not, and the distinction is not "how
important does this feel" but **what the operation actually does to the fleet**.

An exempt operation may only record something that already happened, or make the fleet
smaller. `incident_create` records a crash. `incident_update` documents it, and already
refuses `p_status = 'resolved'`, so it is not a way around the gated `incident_resolve`.
`maintenance_create` reports a breakdown. `maintenance_start` takes the car off the road.
None moves money; none returns a vehicle to service; none removes a restriction.

The gated side is the mirror image. `maintenance_complete` puts a car **back on hire**.
`maintenance_cancel` **removes a safety restriction**. Both would let a restricted agency
keep earning, which is the thing the restriction exists to stop. This is the same
argument that exempted `vehicle_take_off_road` and gated `vehicle_return_to_service`.

**An exemption lives in `app.billing_exempt_functions`, with a reason, or it does not
exist.** The structural billing test reads that table rather than an array in its own
source. A name in a test file is a claim nobody has to justify; a row with a reason and
an approval date is a decision somebody made. A function that is not registered goes on
being reported, which is the behaviour we want from a test whose job is to make ungated
write paths visible.

Where a function cannot distinguish a safety act from an ordinary one, it is gated. The
one accepted exception is `incident_update`, which cannot tell "documenting a crash" from
"tidying an old insurance reference" — accepted because neither moves money, changes
availability or closes the incident, and recorded with that reason rather than waved
through.

## 2026-11-27 — Activation opens; drainage finishes

Assignment activation is default-off again, as STG-02 always said, and the decision no
longer reads a session setting. But switching a feature off cannot be allowed to strand a
car that is in a customer's hands, and that is a general shape worth naming.

**Activation governs opening. Drainage governs continuing.**
`app.assignment_lifecycle_active` answers "may this agency open a new assignment?".
`app.assignment_lifecycle_engaged(rental, organization)` answers "should this rental's
assignment lifecycle run?", and it is true whenever the rental already carries an open
row — whatever activation says.

Without that distinction, turning the gate off while a rental was out would leave its
`in_custody` row open forever, and `rental_vehicle_assignments_no_overlap` would then
block that vehicle over that window permanently, surfacing much later as a raw constraint
error on an unrelated booking.

The one-time reconciliation follows the same principle. An assignment is released only
because **its rental is already over**, never because its organization was never switched
on. Anything on a draft, reserved or active rental is left exactly as it is: marking an
in-custody car returned would be a lie that also frees the vehicle for someone else.

Any future feature flag that gates a multi-step lifecycle needs the same two predicates.
A flag that can orphan work in progress is not a flag, it is a trapdoor.

## 2026-11-27 — Evidence is identified, not recognised

The amendment evidence requirement first matched a mutation's *signature* — same rental,
same line, same amounts. Two mutations with the same shape then shared one record, and an
oscillating hire committed with its third change unrecorded, leaving the history saying
one thing and the live hire another.

A signature recognises; it does not identify. The charge line now carries a revision
number that the database bumps on each mutation that moves money, the amendment names the
revision it describes, and a unique index allows one record per revision.

Both questions are still asked. The revision makes the record **unique**; comparing the
amounts makes it **true**. A revision match alone would accept a record claiming the hire
went to 12345 when it went to 20000 — unique, and wrong.

Deliberately not a transaction id, a timestamp, `xmin`, or a unique index over the
amounts. Every one of those is a fingerprint that two genuinely different mutations can
share, and identical transitions are legitimate: `100 → 200` twice is two amendments, at
two revisions, and both are kept.

## 2026-11-27 — A return is recorded once, and nothing corrects it yet

**Decision.** `rental_check_in` refuses a second return that carries different
information, and answers an identical retry from the existing row without mutating
anything.

**Why not make the second call a correction.** Because a correction that looks like an
ordinary operation is not a correction, it is an overwrite with no audit trail. The
instruction is explicit that ordinary check-in must not serve as an undocumented
correction mechanism, and it was serving as exactly that.

**What this costs, stated rather than hidden.** Pevvy now has **no** route to correct a
mis-keyed return reading on a committed rental. The return columns are frozen against
every writer that is not the table owner, and no RPC restates them. A real need at the
front desk — the operator typed 41000 instead of 14000 — currently has no answer. That is
a worse user experience than the overwrite it replaces, and it is the right trade only
because the overwrite was silent and unaudited.

**Open.** A deliberate, audited return-correction workflow is wanted. It was not invented
here because inventing one was out of scope, and because it should be designed against the
amendment architecture that already exists for pricing rather than beside it.

## 2026-11-27 — A read model must show what the database enforces

**Decision.** `public.expense_ledger` carries `maintenance_id`.

**Why.** `20261128130000` added invariants that refuse an attached cost changing vehicle or
allocation. The expense screens read `expense_ledger`, which did not select the column, so
the attachment was invisible to the interface **by construction**. A user would have been
refused by something their screen could not show, with a message the error mapping replaced
with "some of the values entered are not valid", on a page with no route to the unlink.

**The general rule this records:** enforcing an invariant the interface cannot explain is
how a correct database earns a reputation for being broken. An invariant and the read model
that must explain it belong in the same change.

**Scope held.** The column is appended, not inserted; `security_invoker` is restated rather
than assumed; the unlink was not moved, duplicated or reimplemented.

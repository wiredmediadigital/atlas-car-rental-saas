# Closing an agency account — design

2026-11-08

## Intent

The published privacy policy says that when an account is closed, its data is
deleted or anonymised. **No closure path exists.** `organizations` has no
closure column and there is no purge routine, so today an account is abandoned
rather than closed: the agency stops paying, the records sit in the database
indefinitely, and the promise is unkept.

This builds the missing half.

## Why it matters beyond the promise

Adera Labs is a **processor** for the renter records an agency enters — names,
addresses, dates of birth, passport and driving licence numbers, and scans of
those documents. Under Article 28(3)(g) of the GDPR, when the processing
relationship ends the processor must delete or return that data **at the
controller's choice**. An agency closing its account is that instruction, and
there is currently no way to act on it.

This is **not** the Article 17 right-to-erasure feature. Article 17 belongs to
individuals, not companies. A staff member wanting their own account removed
while the agency continues, or a renter wanting their record erased, are
different flows — and the renter's request runs through their agency, which the
privacy policy already tells them.

## What already exists, and what this reuses

`20261103100000_billing_restricted_access` already gives an agency with no
active subscription a **read-only** account: records open and exportable,
writes refused by `app.billing_may_write`, which both the RLS policies and the
`security definer` functions consult.

So the real state machine is **active → read-only (lapsed) → closed (missing)**.
Only the last transition is absent, and the suspended state this needs is the
read-only state that already works.

## Goals

- An owner can close their agency's account themselves, from Settings.
- A closure mistake is recoverable.
- When the purge runs it is complete: no orphaned rows, and **no document scans
  left in storage**.
- A durable record that closure happened, what was removed, and when —
  surviving the data it describes.
- Billing records required by tax law survive, and the documents say so.

## Non-goals

- Article 17 erasure for an individual. A separate flow.
- Removing one member while the agency continues. Already possible via Team.
- Exporting data. The product already exports; closure points at it.
- Anonymising billing records — see Constraints.
- The EU contract and hosting work (DPA, transfer mechanism, Article 27
  representative, EU region). Real and more urgent than this feature, but
  contract and configuration rather than code. Tracked separately.

## Anti-goals

Failure even if it ships and looks right:

- **Irreversible destruction of a business's records by a misclick**, a
  disgruntled owner, or a compromised account. The worst outcome available
  here; it outranks every other consideration.
- **A partial purge.** Rows deleted but storage objects left behind — passport
  scans with no owner — is worse than not purging, because the record of whose
  they were is gone.
- **Destroying the billing records that tax law requires.** See the cascade
  problem below: the obvious implementation does exactly this.
- **Deleting a person's login because one of their agencies closed.**
- **A purge with no evidence it happened.**
- Holding data after a controller has instructed deletion, in a way never
  agreed with them.

## The cascade problem, and the mechanism it forces

An early draft said the purge deletes the organization row. **It must not.**
Four billing tables reference `organizations(id)` with `on delete cascade` —
`billing_customers` (20260823100000:307), `billing_subscriptions` (:355),
`billing_checkout_sessions` (:463) and `billing_events` (:551), with
`billing_webhook_events` (:517) set to `set null`. Deleting the organization
destroys precisely the records that must survive.

**So closure leaves the organization row in place as a tombstone.** Its
operational and descriptive fields are cleared, a closure timestamp is set, and
the legal name is retained — a tax record whose purpose is showing who was
invoiced cannot have the identity stripped out. Billing rows then keep their
foreign key and nothing cascades.

This is simpler than the alternatives it replaces: no detached archive table
with its own RLS story, and no re-pointing of foreign keys. "Purge" means
*delete the tenant's data and blank the shell*, not *delete the organization*.

## What the user decided

- **Stripe is cancelled immediately on request, with no refund** for the
  remainder. Read-only access continues free through the grace period. This
  matches the existing Terms, which already say part-used periods are not
  refunded.
- **The button requests closure; it does not execute it.** The account
  suspends immediately — read-only, labelled, restorable — so the instruction
  visibly takes effect at once. The purge runs at the end of the 30-day window,
  or sooner only when Adera Labs actions it. **There is no self-serve immediate
  purge.** Every owner and admin is notified the moment closure is requested,
  and typing the agency name is still required to request it.

  This was reconsidered after the first draft, which had a self-serve immediate
  path guarded by an emailed confirmation link. That path was the single most
  dangerous capability in the product — the one place a compromised owner
  account destroys a business's records irrecoverably — and almost every other
  safeguard in this design existed to mitigate it. Removing the capability is
  better than guarding it. Article 28 requires acting on the controller's
  instruction, not providing a button that executes it; suspension within
  seconds and a purge within days is acting on it.
- **The purge is triggered by a scheduled call from outside the deployment** —
  a daily GitHub Action, with a secret, invoking an authenticated Edge
  Function that purges everything past its date. This preserves the project's
  explicit stance that no autonomous background processing runs inside the
  deployment (`20260822100000`: pg_cron and pg_net are available and
  deliberately not installed), while still running when nobody signs in.

## Constraints

- **Billing records are retained identifiably.** The purpose of a tax record is
  knowing who was invoiced; stripping the identity destroys the thing the law
  requires. What is retained: the Stripe customer id, subscription history,
  checkout sessions, billing events, and the organization's legal name. Not the
  operational contact details beyond that.
- **A user with memberships in other agencies keeps their login.** Remove the
  auth account only when this was their last membership. That rule applies
  equally to members with unconfirmed emails and to the requesting owner — who
  will therefore be signed out and removed by the act they initiated, which the
  confirmation screen must say plainly. An unaccepted invitation has no auth
  user; deleting the invitation row is enough.
- **The purge is not one transaction, and the design must not pretend it is.**
  Deleting from `auth.users` and sweeping storage both need the service role
  and neither is transactional with the tenant delete. The tenant data goes in
  one database transaction; storage and auth are separate steps, which is why
  the work must be resumable.
- **Closure state is stored separately from billing state.** `billing_access_
  state_of` already returns `restricted` for a lapsed *or* never-subscribed
  agency, so suspension is indistinguishable from lapse unless recorded
  independently. On restore the account returns to whatever billing says, which
  may still be restricted — the interface must say so rather than imply
  restoring brings writes back.
- **A lapsed or never-subscribed owner must still be able to close and
  restore.** Those calls need the same write-gate exemption the billing pages
  already have. Which calls the exemption covers is security-sensitive and
  should be spelled out, not inherited by accident.
- **"Money is never deleted" is not violated here.** That principle governs
  editing history inside a live contract — void, never delete. Ending the
  relationship is a different act, and the migration should say so, or a later
  reader will take the purge for a contradiction.
- RLS policies and `security definer` functions must agree about whether an
  account may be written to. A second gate that can disagree with
  `app.billing_may_write` is a hole shaped like every function consulting only
  one of them.
- Never edit an existing migration; a schema change is a new, later-dated file.

## The shape

### Requesting closure

Owner-only, from Settings, enforced in the database rather than the interface
alone. The request records who asked and when, cancels the Stripe subscription,
notifies every owner and admin, and moves the account to **suspended**:
read-only, clearly labelled, purge date shown, one-click restore. Nothing is
destroyed yet.

**Closing is owner-only; restoring is owner *or admin*.** The asymmetry is
deliberate: make the destructive action narrow and the undo broad. It is what
covers the hardest case in the threat model — an agency with a single owner
whose account is compromised. Without it, nobody else can reach the restore
button during the grace period; with it, any admin can. An admin still cannot
*close* the account, so widening the undo gives away no authority over the
decision itself.

**30 days by default**, serving the first anti-goal: a mistake must be
recoverable. It also gives the agency time to export. The grace period must
appear in the Terms, so it is a term the agency agreed to rather than one
imposed.

**Purging sooner is an operator action, not a customer one.** An agency that
needs its data gone immediately asks, and Adera Labs actions it. That keeps a
human in the loop for the only irreversible step, and it is still acting on the
controller's instruction — which is what Article 28 requires. A self-serve
button that purges on the spot is not required by any obligation, and it is the
capability that makes every other safeguard here load-bearing.

### The purge

Three stages, in this order, because the order is what makes it safe:

1. **Claim.** Move the account to a purging state first. After this, restore is
   refused — a restore racing a half-finished purge is unrecoverable.
2. **Collect and sweep storage.** Gather every storage key into a record that
   outlives the tenant, then delete the objects. Deleting rows first destroys
   the only list of what to remove. That record is also what makes the sweep
   resumable when it fails halfway, which it eventually will.
3. **Delete the tenant data** in one database transaction, then clear the
   organization shell, then remove auth accounts whose last membership this was.

Everything tenant-scoped goes: customers and their documents, rentals,
contracts, condition photos, drivers, vehicles and media, expenses and
receipts, financing, GPS history and credentials, notifications, invitations,
members, settings — with the matching objects in all six buckets.

### Evidence

A record outside the tenant, surviving the purge: the organization id and legal
name, the requesting user's id (**not** their email — they may themselves be
deleted), the timestamps, and counts of what was removed. **Counts, never
content.** Retained alongside the billing records, and readable by the platform
operator through the service role; there is no in-product reader and this
design does not introduce a platform-admin role.

### The documents change with it

The Terms say records stay readable after a subscription ends; the privacy
policy says they are deleted when an account is closed. Both are true only if
the two events are visibly different, and a reader cannot currently tell. The
Terms must describe closure, the grace period, that purging sooner is by
request to Adera Labs, and the no-refund position; the privacy policy must
point at them.

Drafting falls to the builder, as the existing pages did; the wording is then
for a lawyer to review before it is relied on. **Whether existing customers
must re-accept the changed Terms is a question for that lawyer**, not for this
design.

## Decisions made here, not by the user

- **The organization row survives as a tombstone**, rather than being deleted
  with billing moved to an archive table. Forced by the cascade problem, and
  the simplest correct answer to it.
- **30 days** as the grace period.
- **The suspended state is the existing read-only state**, not a new one.
- **Counts rather than a manifest** in the evidence record, and the requester
  recorded by id rather than email.
- **Billing retained intact**, not anonymised.
- **Restore is refused once the purge has claimed the account.**
- **Restore is open to admins as well as owners**, while requesting closure
  stays owner-only. Asked for explicitly after reviewing the threat model.
- **The self-serve immediate purge is removed**, and with it the emailed
  confirmation token that guarded it. Reconsidered by the user mid-build: the
  capability was the reason most of the other safeguards existed, and no
  obligation requires it.

## What this does and does not protect against

Worth stating, because the limit is a design decision rather than an oversight.

**A disgruntled member below owner: fully stopped.** Closure is owner-only and
enforced in the database, so a manager or staff member cannot reach it through
the interface or by calling the API directly.

**A compromised owner account: cannot destroy anything.** The worst it can do
is suspend the agency — visible immediately to every owner and admin by email,
reversible by any of them with one click, and reversible by Adera Labs in any
case. Nothing is destroyed for 30 days, and the destruction itself is not a
capability the session holds.

This is the point of separating the request from the purge. In the first draft
a compromised owner could purge immediately, and the emailed confirmation link
was the only thing standing in the way — a guard on a capability that did not
need to exist.

**A malicious sole owner: delayed, and visible, but not ultimately prevented.**
They can suspend the agency and let the window expire. That is correct rather
than a gap: the owner is the data controller, the data is theirs, and a
processor that could refuse the instruction would be the defect. What has
changed is that it now takes 30 days and is visible throughout, instead of
being instantaneous and silent. The remaining backstop is the platform's
point-in-time recovery, an infrastructure question this feature cannot answer.

## Left to the builder

- How the write gate learns about pending closure. One question must have one
  answer: policies and definer functions must not be able to disagree. Whether
  that means extending `app.billing_may_write`, composing a new gate that
  delegates to it, or something else is the builder's call — two independent
  gates is not an option.
- Where the storage-key record and the evidence record live, and whether they
  are one table or two.
- Which organization columns the tombstone clears and which it keeps, beyond
  the legal name that tax retention requires.
- The shape of the scheduled caller and how it authenticates.
- Copy, layout, and how the suspended state is signalled in the interface.
- Test strategy, within the project's norms. At minimum: the owner-only gate on
  closing; **an admin restoring successfully, and the same admin refused when
  they try to close** — the asymmetry is the point, so one test without the
  other proves half of it; a restore inside the window; restore refused after
  the claim; a purge leaving no row and no object behind; billing records
  surviving; a user with a second membership keeping their login; the
  requesting owner's own account removed when it was their last; the evidence
  record surviving; and a purge interrupted midway resuming safely.

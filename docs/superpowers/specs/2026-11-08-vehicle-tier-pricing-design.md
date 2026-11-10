# Vehicle-tier pricing — design

**Date:** 8 November 2026
**Status:** awaiting approval

## Intent

Pevvy is sold by subscription, and today there is one thing to buy. This replaces
that with three tiers priced by fleet size, because fleet size is the thing that
actually varies between a two-car operation and a fifty-car one, and it is the
thing both sides can count without arguing.

| Tier     | Monthly    | Vehicles       |
| -------- | ---------- | -------------- |
| Starter  | $59        | up to 5        |
| Pro      | $119       | up to 20       |
| Business | $199       | up to 50       |
| Above 50 | talk to us | by arrangement |

Every tier includes every feature. Nothing in the product is gated by tier except
how many vehicles an agency may have on its fleet at once. Each tier also sells
yearly; the yearly amounts are set in Stripe and are not fixed by this document.

The free trial is **14 days**, and it is a trial _of a tier_ — the agency picks
Starter, Pro or Business and trials that, with that tier's limit.

The trial length needs no code: it is already the deployment variable
`BILLING_TRIAL_DAYS`, read at checkout (`billing-domain.ts`, which sets
`trial_period_days` only when it is above zero) and capped at Stripe's
documented ceiling. Setting it to 14 is configuration.

## Why now

There are no live users. Every decision here is cheap today and expensive once
real agencies are on the old single plan, so the window for doing it without a
migration path is now.

## Goals

- Price tracks the value the agency gets, measured by something neither side can
  dispute.
- An agency always knows where it stands before it is stopped, never after.
- The limit is enforced by the database, not by the interface.
- A new tier, or a changed limit, is a small deliberate change — not a schema
  redesign.

## Non-goals

- Feature gating. Every tier gets everything.
- Usage-based or per-rental pricing.
- Automatic upgrades. Crossing a limit never changes what an agency is charged.
- A self-serve _priced_ tier above 50. Above 50 is a conversation, not a
  checkout — see "Above fifty vehicles".
- Metered overage.

## Anti-goals — this ships wrong if any of these happen

- **The product retires one of their vehicles for them.** Never. Choosing which
  car comes off the road is the agency's decision, always.
- **An agency is locked out of records it already has.** The limit governs
  _adding_, never reading, editing or renting what is already there.
- **Someone is offered a control the database refuses.** A staff member must not
  see an Upgrade button that does nothing when pressed.
- **The limit silently stops being enforced.** See the Stripe-sync trap below.
  A failure that quietly gives the product away is worse than one that shouts.
- **A bulk import half-applies.** A CSV that would breach the limit is refused
  whole, before any row lands.

## What the user decided

- **Three tiers at 5 / 20 / 50**, $59 / $119 / $199 monthly, all features
  included, monthly and yearly for each.
- **The limit bites when adding**, not retroactively. An agency over its limit
  for any reason keeps everything it has.
- **A retired vehicle frees a slot.** The count is vehicles currently on the
  fleet, not everything the agency has ever owned.
- **Downgrading is blocked while the fleet exceeds the target tier's limit.**
  The user's own words: it would not make sense to downgrade while already above
  the tier limit. This is measured against the tier being moved _to_, at the
  moment of the attempt — it is never a permanent state, and it is not triggered
  by having upgraded before.
- **The counter is always visible** (option B of three shown): a quiet
  "5 of 5" beside the Vehicles heading, not a nag strip and not a surprise.
- **14-day free trial**, of a chosen tier.
- **Above 50 vehicles is "talk to us"** rather than a fourth price. An agency
  that size is a conversation worth having before a number is printed, and
  there is no customer data yet to price one from.
- **Changing tier happens inside Pevvy.** Asked for explicitly once the builder
  check established that Pevvy cannot otherwise enforce the downgrade rule. See
  "Changing tier" below: this is the largest piece of new work in the design,
  and it was chosen over the cheaper option with that cost stated.

## What already exists, and decides much of this

Four things in the product already answer questions this design would otherwise
have to invent. They are load-bearing and should not be re-litigated.

**1. An agency with no subscription is already read-only.** Decided 3 November
(`20261103100000_billing_restricted_access.sql`): an agency without a live
subscription keeps everything it can read and loses everything it can write. A
brand-new agency therefore starts restricted and cannot add a single vehicle
until it starts its trial. _This is why no free allowance is needed_ — there is
no state in which an unpaid agency can add vehicles at all.

**2. Trials already work end to end.** Stripe's `trialing` status resolves to
normal access; a trial that ends with no payment method becomes `paused`, which
is restricted. The existing comment is blunt: "the whole point of having a trial
is that it ends." The 14-day trial is Stripe configuration, not new code.

**3. `past_due` and `incomplete` keep working.** An agency whose card is being
retried keeps its tier and its limit. Only when Stripe gives up does access
become restricted.

**4. Vehicles are retired, not deleted.** `rentals_vehicle_fkey` is `on delete
restrict`, and the finance tables reference vehicles the same way, so a vehicle
that has ever been on a contract cannot be deleted — the history would be
orphaned. The real action is `archived_at`, which retires a vehicle while
leaving every contract, payment and expense intact. The database also refuses to
archive a vehicle still committed to a contract.

This last point makes the pricing self-policing, and it is worth stating plainly
because it removes a whole class of anti-abuse work: **the only way to get under
a limit is to archive vehicles, and an archived vehicle cannot be rented.** An
agency that archives cars to squeeze into a cheaper tier has given up earning
from them. The dodge costs more than it saves.

## The shape

### What counts

**Unarchived, non-deleted vehicles belonging to the agency.** Archived vehicles
do not count. That is the whole rule.

### Where the limit bites

Three write paths, and the database beneath all of them:

1. **Adding a vehicle.**
2. **Restoring an archived vehicle** (`restoreVehicle`, which clears
   `archived_at`). This must be gated identically, or the limit is trivially
   bypassed: archive one, add a new one, restore the archived one, and the
   agency is one over. Retiring frees the slot; bringing it back needs a free
   slot.
3. **CSV import** (`src/features/vehicles/csv.ts`). The whole batch is checked
   against remaining capacity _before_ any row is written. A 40-row import by a
   Starter agency is refused as a batch, naming how many slots are free — it
   never half-imports and fails on row six.

   This means the import stops being row-by-row inserts and becomes one
   transactional call, so that the check and the writes cannot be separated by a
   concurrent add in another tab. Restructuring `csv.ts` that way is expected and
   accepted. A check that can be raced is not a check. _(Author's call.)_

The database is the gate. The interface may not be the only thing standing
between an agency and its fifty-first vehicle.

### What the agency sees

A counter beside the Vehicles heading — "5 of 5" — visible to anyone who can see
the fleet, from the first day rather than first appearing at the ceiling.

At the limit, one message that names three things: the tier, the number they
actually have, and both ways out. _"Starter covers 5 vehicles. You have 5.
Upgrade to Pro for 20 vehicles, or retire one you no longer rent."_

**Who gets the Upgrade button is a permission question, not a copy question.**
`billing.manage` is **owner-only** (`src/lib/authz/permissions.ts`), which the
role descriptions state deliberately: the owner has "Full control, including
billing", while an administrator manages team, settings, financing and fleet.
Everyone below owner sees the same first two sentences ending in _"ask the
owner to upgrade"_ and no button. An earlier draft of this document said
owner-and-admin; that was wrong, and widening the permission to match it would
be a security-boundary change, not a copy change. This
follows the rule the account-closure work held throughout: never show someone a
control the database will refuse.

### Changing tier

**Changing tier must happen inside Pevvy, and this is new work.**

Today there is no way to change plan in the product. The billing Edge Function
has four actions — `status`, `checkout`, `portal`, `reconcile` — and `checkout`
refuses an agency that already has a live subscription. An existing subscriber
therefore changes tier in **Stripe's hosted customer portal**, and Pevvy learns
of it afterwards through `billing-webhook`.

That makes the downgrade rule unenforceable as the product stands: an agency
could switch to Starter with twelve vehicles and Pevvy's first knowledge of it
would be a webhook reporting a completed change. The rule would be a
suggestion.

So this design requires two things, and the user chose them over the cheaper
alternative with the cost stated:

1. **An in-app change-plan path** — a new billing action that changes the
   subscription through the Stripe API, which is where the refusal is enforced.
2. **The hosted portal reconfigured so it cannot switch plans.** The portal
   remains for what it is good at: payment methods, invoices, cancellation.
   Leaving plan-switching enabled there leaves the back door open and undoes
   point 1.

**Upgrading is always available and takes effect immediately.**

**Downgrading is refused while the current fleet exceeds the target tier's
limit**, with a message naming the gap: _"Starter covers 5 vehicles. You have 12. Retire 7 to move down."_ The refusal is recomputed on every attempt, so it
clears by itself as the fleet shrinks. Business is always available to a Pro
agency; Starter opens the moment they are at 5.

**Changing tier during a trial** uses the same path and keeps the trial's
remaining days rather than restarting or ending it — the agency is still
evaluating, and a tier change is part of evaluating. The new tier's limit
applies from the moment of the change. _(Author's call.)_

**If a lower tier arrives by webhook anyway** — an operator editing the
subscription in Stripe, or any path outside the product — the agency keeps
every vehicle it has, because nothing in this design is retroactive. The
mismatch is surfaced to the operator rather than resolved automatically; no
code may archive a vehicle to make the numbers agree. _(Author's call.)_

An agency is never trapped. Cancelling outright remains available and drops them
to the existing read-only wind-down, where everything stays visible, searchable
and exportable.

## The trap in the obvious implementation

`billing_plans` has an `entitlements` jsonb column, and its comment says it was
put there for exactly this moment:

> Entitlements, as configured. Empty today. The column exists so a future
> commercial decision has somewhere to land; nothing in this schema invents a
> limit, and no code enforces one that is not here.

It is the natural home for a vehicle limit, and writing the limits into it by
hand would be wrong. The catalogue sync
(`app.billing_replace_catalogue`, `20260823100000_billing_model.sql:1600`) ends
with:

```sql
entitlements = excluded.entitlements;
```

Every catalogue refresh overwrites `entitlements` with whatever the payload
carries, and `refreshCatalogue` in
`supabase/functions/_shared/billing-catalogue.ts` does not send entitlements at
all. So hand-authored limits would survive exactly until the next Stripe sync,
then silently become `{}` — and every agency would become unlimited. Silent,
and in the direction of giving the product away.

**Decision (mine): the enforced limit is authored in a migration and the Stripe
sync never supplies it.** Stripe owns the money; Pevvy owns the entitlement. A
limit that the database tests can replay deterministically is worth more than
one that can be edited in a Stripe dashboard, and this project's database tests
replay every migration from scratch on a fresh Postgres — an authored limit is
covered by that, a synced one is not.

The six plan keys exist in Stripe as of 8 November 2026, and the authored
mapping is exactly this:

| Plan key           | Tier     | Vehicles |
| ------------------ | -------- | -------- |
| `starter_monthly`  | Starter  | 5        |
| `starter_yearly`   | Starter  | 5        |
| `pro_monthly`      | Pro      | 20       |
| `pro_yearly`       | Pro      | 20       |
| `business_monthly` | Business | 50       |
| `business_yearly`  | Business | 50       |

`pro_monthly` and `pro_yearly` are the **existing** keys from the old single
plan, reused for the middle tier. They now mean $119 and 20 vehicles. That is
safe only because there are no subscribers: a key whose meaning changes under a
live subscription would be a silent repricing. Nothing in the product may assume
`pro_*` still means what it meant before this document.

The builder decides the exact shape (a column, a small keyed table, or
`entitlements` written by migration with the sync's update list amended so it
cannot blank it). Whichever shape is chosen, two properties are required:

- A catalogue refresh cannot change or erase an enforced limit.
- Starter-monthly and Starter-yearly resolve to the **same** limit. The limit
  belongs to the tier, not the price, and there are two prices per tier.

## Constraints

- **No new `VITE_` variable.** Anything `VITE_`-prefixed is compiled into the
  browser bundle.
- **Never edit an existing migration.** Every schema change is a new,
  later-dated file.
- **Do not rewrite the existing write gate.** `app.may_write` /
  `app.billing_may_write` has 87 call sites, 75 of them RLS policies. A vehicle
  limit is a _separate_ rule from billing restriction and must not be folded
  into that gate: a restricted agency is blocked from writing at all, which is a
  different sentence to the user and a different reason.
- **`platform_unconfigured` stays exempt.** A deployment with no Stripe keys and
  no sellable plan has not launched billing; it must not acquire a vehicle limit
  out of nowhere.
- **The limit never applies retroactively.** No migration, trigger or sync may
  archive, hide or restrict an existing vehicle.

## Above fifty vehicles

The pricing page carries a fourth card with no price on it: above 50 vehicles,
talk to us. It is not a self-serve tier and does not go through checkout.

This is cheap on the page and worth nothing without the mechanism underneath it,
which is the part that must be designed now rather than retrofitted:

**A per-agency vehicle limit override.** When a deal is agreed with a 150-car
agency, that agency's limit is 150 regardless of which plan it is on. The
override wins over the tier's authored limit.

Two conditions, because an override is exactly the kind of mechanism that decays
into a back door:

- **It is set through the service role, never in the product.** No screen, no
  role, no self-serve path grants an agency a bigger limit. An agency cannot
  raise its own ceiling.
- **It records who set it and when.** A bespoke limit that nobody can explain
  later is a liability. The same standard the closure evidence records hold:
  identify by user id, not email.

_(Author's call: both conditions. The user decided the "talk to us" route.)_

## Which subscription decides the limit

`app.billing_effective_subscription` already answers this. It is the function
the access state uses, it already handles an agency with more than one
subscription row, and the limit must use the same one — two functions
disagreeing about which subscription is "the" subscription is a bug waiting to
happen. The limit follows the effective subscription's plan, through the
authored tier mapping rather than through Stripe.

A `trialing` subscription is a live subscription and carries its tier's limit in
full. An agency with no live subscription is read-only and cannot add vehicles
at all, so no limit needs to apply to it.

## What limit applies when a plan carries none

Reachable in three ways: `platform_unconfigured`, a plan added to Stripe without
an authored limit, or a deployment mid-upgrade. Failing closed stops paying
customers from working; failing open gives the product away.

**Fail open, and be loud.** A missing limit is treated as no limit, because the
alternative punishes a customer for an operator's mistake. Its absence is
reported through the existing platform-state mechanism (`reportPlatformState`),
which is the surface already built for "an operator needs to fix something about
this deployment" — not a log line nobody reads. _(Author's call.)_

The vehicle counter is hidden when there is no limit to count against, rather
than showing a meaningless denominator. _(Author's call.)_

## What is left to the builder

- Where the authored limit physically lives, subject to the two properties above.
- How the tier is derived from the plan key, and whether tier is explicit.
- Trigger versus policy for the database gate, and how the CSV batch check is
  expressed.
- The pricing page's monthly/yearly presentation. It is built from
  `billing_plans` and currently renders `pro_monthly` / `pro_yearly`; it will
  need to render three tiers with an interval toggle.
- How a missing limit is surfaced to the operator.
- Copy for the downgrade refusal beyond the sentence above.

## Not in scope

The existing `pro_monthly` / `pro_yearly` plans, the Stripe products behind
them, and the question of what happens to them, are an operator task in Stripe
rather than a code change. There are no subscribers to migrate.

---
title: Notifications
group: Agency
summary: What the bell is telling you, what you can put away, and what it will never do.
---

> **In short** — most of what appears here is a *condition* rather than an
> event: a car is overdue, a document has expired, a lender has not been paid.
> Conditions clear themselves when they stop being true. Nothing is sent by
> email, and nothing is generated while nobody has {{productName}} open.

![The notifications list](/help/notifications-01-list.jpg)

The bell sits in the sidebar, beside the agency's name, and carries the number
of unread items. Opening it gives the same list in a panel, and
**View all notifications** at the foot of that panel opens the full inbox.

## The six categories

| Category | What it tells you about |
|---|---|
| Rentals | Pick-ups and returns due, overdue returns, and unpaid contracts. |
| Vehicle compliance | Insurance, inspection and registration approaching expiry or expired. |
| Financing | Lender payments due and overdue. |
| Tracking | Tracker connections and positions that have gone quiet. |
| Team | People joining, leaving and changing role. |
| Subscription | Payments, plan changes and cancellation. |

You are only offered the categories you could actually receive. The thresholds
are the same ones the modules themselves use, so somebody who cannot open
Financing is not told about lender payments.

### Conditions and events

A **condition** is derived from the records as they stand. "This document has
expired" is true until somebody renews the document, and it reappears if it
becomes true again.

An **event** is something that happened and is now in the past: a person
joined, a plan changed, a payment was recovered.

The difference decides what you can do with an item, which is why dismissing is
offered on some rows and not others.

## Read the four views
<!-- permission: organization.view -->

**All** is everything currently live: nothing dismissed and nothing snoozed.
**Unread** is what you have not looked at. **Needs attention** is the urgent
end of it — overdue returns, expired documents, late lender payments.
**History** includes what has been dismissed, so putting something away is
recoverable rather than final.

There is no search, no faceting and no date range here. An inbox that needs a
query builder is an inbox nobody reads.

## Put something away
<!-- permission: organization.view -->

The menu on a row offers **Later today**, **Tomorrow**, **Next week** and
**Dismiss**.

Snoozing hides the item for that long, counted from the moment you choose it.
Dismissing hides it for good — but only hides it: an expired document is still
expired, and if the condition is still true it is still true.

Dismissing is not offered on an event, because an event is already in the past
and dismissing it would mean nothing beyond marking it read. Team notifications
are never dismissable for that reason.

## Mark things read
<!-- permission: organization.view -->

**Mark all read** clears the count on the bell without changing anything about
the underlying conditions. Opening an item marks that one read.

## Choose what you are told about

The preferences live in the notifications section of Settings, and they are
yours alone. Muting a category silences it for you, in this agency, and changes
nothing for a colleague.

## If it goes wrong

**Nothing arrived overnight.** Nothing runs overnight. Conditions are worked
out when somebody opens {{productName}}, and no email, text message or push is
sent for any of them.

**A notification came back after I dismissed it.** It is a condition, not an
event, and the condition became true again. Fix the underlying record — renew
the document, close the contract, pay the instalment — and it stops.

**I cannot dismiss one.** It records something that happened rather than
something that is still true. Mark it read instead.

**A colleague gets notifications I do not.** Categories follow the same
thresholds as the modules they describe. The preferences list shows you every
category you are entitled to; one that is absent is one you cannot receive.

**It says a tracking connection is unhealthy but the cars are clearly fine.**
That notification is about the connection to the provider, not about any
vehicle. It does not claim a car is offline and it does not say for how long.

**A subscription notification is vague about the money.** Deliberately. The
detail belongs on the Billing page, behind that page's own permission, not in
an inbox several people can read.

**The list is showing a bare category name with a short line under it.** That
is a kind of notification this build does not have words for yet, usually
because the site has not been rebuilt since a change. It is harmless, and the
line under it is the summary the server wrote.

## Where to go next

- [Rentals](/help/rentals) — the overdue returns and unpaid contracts behind
  most of these.
- [Vehicles](/help/vehicles) — the compliance dates that generate the warnings.
- [Settings](/help/settings) — where the preferences are.
- [Help centre](/help) — every other page.

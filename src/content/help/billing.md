---
title: Billing
group: Agency
summary: Check the subscription, fix a payment method, and understand what happens if it lapses.
permission: billing.manage
---

> **In short** — the card is handled entirely by the payment provider;
> {{productName}} never sees it. If a subscription ends, nothing is deleted:
> the agency's records go read-only and everything can still be opened,
> searched, printed and exported.

![The billing page with an active subscription](/help/billing-01-active-subscription.jpg)

Billing is account administration inside a working product, not a pricing page.
There are no savings claims and no upgrade nudges here — somebody came to check
a date or fix a payment method.

### What the status badge is telling you

The badge says precisely what is known and no more, because several of these
pairs look alike and are acted on differently:

| It says | What that means |
|---|---|
| Active | In good standing. |
| Trial | The trial is running. |
| Cancels at period end | Still active until that date. Not yet cancelled. |
| Confirming | Checkout happened; the provider has not confirmed it yet. Nothing is active until it does. |
| Payment failed | An attempt did not go through. The provider will try again. |
| Unpaid | No further attempts will be made until an invoice is paid. |
| Incomplete | The first payment was never completed. |
| Not started | The first payment was never completed, so the subscription never began. |
| Paused | Not being invoiced. |
| Cancelled | Ended. |
| No subscription | There is none. Choose a plan. |
| Not configured | Subscription billing is not set up for this deployment at all. |

"Cancels on the fourth" and "cancelled" are different sentences about the same
date, and only one of them is something you can still withdraw.

### When a deployment sells nothing

A deployment with no payment account connected is the ordinary free build.
Billing then shows what turning {{productName}} into a subscription product
would look like, rather than reporting a missing configuration value nobody at
a rental desk could act on. Nothing is restricted in that state.

## Start a subscription
<!-- permission: billing.manage -->

When there is genuinely a choice to make, the plans appear on this page and
choosing one hands you to the payment provider's checkout. Come back and the
status reads **Confirming** until the provider says the subscription exists.

That state must never read as subscribed, and it does not. If it persists
longer than a few seconds, **Refresh billing status** asks the provider again.

## Change the card, or find an invoice
<!-- permission: billing.manage -->

**Manage billing** opens the payment provider's own portal. Payment methods,
invoices and receipts all live there — this page deliberately does not keep a
second copy of them.

The button appears only when it would actually open something: the deployment
has to be configured and the agency has to have a billing account with the
provider. A button that opens nothing is worse than no button.

## Cancel, or withdraw a cancellation
<!-- permission: billing.manage -->

Both are done in the provider's portal, through **Manage billing**. A scheduled
cancellation shows on this page as **Cancels on** with its date, and the
subscription stays active until then.

## Read the recent activity
<!-- permission: billing.manage -->

The activity list is a short record of what has happened to the subscription:
checkout started and completed, activations, plan changes, failed and recovered
payments, scheduled and withdrawn cancellations, and refreshes from the
provider. It is a timeline, not an invoice archive.

## Understand what "restricted" means
<!-- permission: billing.manage -->

An agency with no live subscription keeps everything it can read and loses
everything it can write. A banner says so on every page, because otherwise a
refused write surfaces as "that record could not be found", which is not true
in any way a person can act on.

While restricted:

- Nothing new can be recorded — no contracts, customers, payments or costs.
- Everything already recorded stays, and can be opened, searched and printed.
- The rentals book, the customer directory, the fleet, the expense ledger and
  every report can still be exported.
- The agency's own details can still be corrected, people can still be removed
  or have their access changed, and the agency can still be handed on. Each of
  those is a route back out, and a restriction nobody can undo from inside is a
  trap rather than a restriction.
- Inviting new people is refused, because taking on staff is growth.

Starting a subscription restores normal working immediately.

A failed payment does **not** restrict the agency while the provider is still
retrying. Restriction follows the provider giving up — unpaid, cancelled,
paused, or a first payment that never completed — or an agency that never
subscribed at all.

## If it goes wrong

**It still says Confirming.** The provider has not reported the outcome yet.
Press **Refresh billing status**. Nothing is active until it is confirmed, and
no part of the product behaves as though it were.

**Manage billing is not offered.** Either this deployment has no payment
account connected, or this agency has no billing account with the provider yet
— which is the case before the first checkout.

**A colleague cannot see this page.** Billing is the owner's alone, in the
interface and in the database. There is no setting that widens it.

**Everything has gone read-only.** The subscription is not live. The banner
names it, and this page says which of the states above applies.

**Somebody says they cannot be invited.** Invitations are the one write that
stays refused while an agency is restricted. Restart the subscription first.

**An invoice is not here.** Invoices and receipts live in the payment
provider's portal, behind **Manage billing**.

## Where to go next

- [Team](/help/team) — who is in the agency, and who can be invited.
- [Settings](/help/settings) — the agency's own details, which stay editable
  even when records are read-only.
- [Troubleshooting](/help/troubleshooting) — when the answer is not on this
  page.
- [Help centre](/help) — every other page.

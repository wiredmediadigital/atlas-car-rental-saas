---
title: Financing
group: Finance
summary: Record the loans and leases behind the fleet, keep the schedule honest, and see what is actually owed.
permission: financing.view
---

> **In short** — one agreement belongs to one vehicle. Record only what the
> contract actually says: the product works from what you have and does not
> invent the rest. Repaying a lender is not an operating cost, so none of this
> moves the operating result on the dashboard.

![The financing agreements list](/help/financing-01-agreements.jpg)

A vehicle bought outright needs nothing here. Financing exists for the cars
somebody is still paying for.

### Three figures, and why they are three

**Paid to lenders** is every unit of currency that went to the lender,
whatever it was for. It is what the bank account felt. It is not a cost.

**Cost of borrowing** is interest plus fees — the actual price of the money.
Principal is excluded, because repaying a debt is not spending on anything; it
converts one position into another.

**Remaining principal** is what is still owed. It can only be stated when the
amount financed is known and every payment on file has been split. Otherwise it
is genuinely unknown, and the page says so rather than guessing.

None of the three is profit, and nothing here is ever labelled as such.

### Two ways to record an agreement

**Payment plan** is for the common case: you know what you pay and how often,
and nothing is invented about the rest. You get what is due and when, and what
you have actually paid.

**Amortising loan** is for when the contract states the amount financed and the
rate. Then every payment can be split, and principal still owed and cost of
borrowing become answerable too.

The wizard tells you, before you save, which questions the agreement you are
describing will and will not be able to answer.

### The states an agreement moves through

| State | What it means |
|---|---|
| Draft | Not live yet. Terms can still be corrected freely. |
| Active | Running. Payments are due on the schedule. |
| Paid off | Every obligation was met. |
| Closed | Ended for another reason, with that reason on the record. |
| Cancelled | Never came into effect. |

A draft becomes active or cancelled. An active agreement becomes paid off,
closed or cancelled. Paid off can still be closed. Closed and cancelled are the
end.

## Record a new agreement
<!-- permission: financing.create -->

**Add financing** walks through the vehicle, the lender and the kind of
agreement, then the terms, then a review of the payments it will create.

Four optional figures are worth understanding:

- **Down payment** is paid to the seller, not to the lender, so it is not part
  of what is repaid.
- **Final or balloon payment** is shown as its own obligation rather than
  hidden inside the last instalment.
- **Contract payment** wins over the arithmetic. If the paperwork states an
  instalment, that is the instalment.
- **Amount financed** is what makes a principal balance derivable. Without it
  there is nothing to derive one from.

The wizard refuses terms that do not repay the loan, and a balloon larger than
the debt, rather than generating a schedule nobody could follow.

The day of the month the first payment falls on anchors the whole schedule.

## Add a lender
<!-- permission: lenders.manage -->

Lenders are kept as their own list — bank, finance company, leasing company,
dealer finance, private or other — so the same institution is not retyped on
every agreement.

## Activate the agreement
<!-- permission: financing.update -->

A draft holds no obligations. Activating it is what starts the schedule and
what makes payments recordable.

## Record a lender payment
<!-- permission: financingPayments.create -->

**Record a payment** asks what actually left the account and when, which
instalment it settles — leave that blank for a payment outside the schedule —
and its purpose: scheduled, extra, a payoff or a fee.

On an amortising loan the scheduled split into principal, interest and fees is
offered as a starting point. It is clearly labelled as the *scheduled* split
and not the lender's: if the statement says something else, type what the
statement says.

A payment can be recorded against an agreement that has already ended. A final
settlement arriving after the desk has filed the agreement away is ordinary; a
draft is the one state with nothing to settle.

## Void a payment entered wrongly
<!-- permission: financingPayments.void -->

Voiding stops a payment counting towards cash paid, principal repaid and cost
of borrowing, and reopens the instalment it settled. Nothing is deleted.

## Attach the paperwork
<!-- permission: financingDocuments.create -->

The documents panel holds the agreement itself, lender statements, payoff
letters and receipts, up to 10 MB each. They are stored privately and opened
through short-lived links.

## Mark an agreement paid off
<!-- permission: financing.update -->

This is refused unless it is honestly true: the agreement is live, it has a
schedule, nothing on that schedule is outstanding, and — where the figures are
known — no principal remains. When it cannot be marked paid off, the page says
which of those is not yet true.

**End this agreement** is the other route, for an agreement that finished some
other way. It asks for the reason and keeps it on the record.

## Delete a draft
<!-- permission: financing.delete -->

A draft with no payments against it can be deleted outright, because nothing
financial is lost. An agreement with any history is closed instead.

## If it goes wrong

**The terms will not change.** A payment has been recorded against them, so
they are fixed, or the agreement has ended and its terms are part of the
record. If the contract itself changed, close this agreement and record the
replacement.

**The schedule will not regenerate.** Same reason: once money has been recorded
against a schedule, regenerating it would move obligations that have already
been settled.

**The cost of borrowing says "at least".** Some payments were recorded without
stating how much of them was interest, so the figure is a floor. Open those
payments and split them, and it becomes a number.

**Remaining principal shows a dash.** The amount financed was never recorded,
so there is nothing to subtract repayments from. It is not zero and the page
will not print it as zero.

**None of this changed the operating result on the dashboard.** Correct.
Financing is deliberately outside the operating result, so that the money is
not counted twice.

**A cost on the Expenses page is marked as belonging to a financing
agreement.** Costs attached to an agreement are managed from the agreement
rather than from the ledger, so the ledger will not edit or void them.
Recording a lender payment here does not add a row there.

**It will not let me mark it paid off.** The page lists the reason: still a
draft, no schedule, payments outstanding, or principal still showing under the
agreement's own figures.

**The totals show a number of currencies instead of an amount.** The agency has
agreements in more than one currency, and nothing in {{productName}} converts
between them.

## Where to go next

- [Expenses](/help/expenses) — the operating costs financing is kept out of.
- [Reports](/help/reports) — what has been paid, what it cost, and what is
  still owed.
- [Vehicles](/help/vehicles) — the cars these agreements are against.
- [Help centre](/help) — every other page.

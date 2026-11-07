---
title: Reports
group: Finance
summary: Seven views of the same records, with the period, the currency and the comparison under your control.
permission: reports.view
---

> **In short** — the period controls the flow figures: revenue, costs, hires,
> cash. It does not control the position figures — what customers owe, what
> deposits are held, what principal remains — which are always as at now and
> say so. Nothing is ever converted between currencies.

![The business section of the reporting workspace](/help/reports-01-business.jpg)

Reports is one workspace with seven sections rather than seven products. The
section, the period, the currency and the comparison all live in the address
bar, so a view you have set up is something you can send to somebody.

### Two words this product will not use loosely

**Profit.** Nothing here computes one. There is no depreciation model, no
allocation of overhead onto a vehicle and no accounting period. What exists is
an **operating result** — rental revenue less recorded operating cost — and,
per vehicle, an **operating contribution**. Both are named that way everywhere
they appear.

**Total.** There is no exchange rate anywhere in {{productName}}, so two
currencies never make one number. A report either speaks in one currency or it
names the currencies it found and tells you which one the figures are in.

### Choosing a period

This month, last month, the last thirty days, this quarter, last quarter, this
year, or a custom range. A custom range can cover at most 1830 days; a longer
one is shortened and the page says where the figures now end.

**Compare** puts the previous equivalent period beside the current one.

## Read the business section
<!-- permission: reports.view -->

Four figures at the top: rental revenue, operating cost, operating result and
financing cash paid. Below them, money in and out for the period — charges
received, refunds paid, deposits taken, deposits returned, financing interest
and fees, financing principal repaid.

**Where things stand** is the panel that does not move with the period: owed by
customers, deposits held, remaining principal, overdue to lenders. Those are
balances as at this moment, and the panel is labelled so.

## Read the fleet section
<!-- permission: reports.view -->

Fleet utilisation, hires started, fleet revenue and operating contribution,
then a table of every vehicle rankable by revenue, contribution, utilisation,
idleness, direct cost or number of hires. Financial rankings only ever compare
vehicles inside one currency.

Utilisation is vehicle-days committed to hires against vehicle-days available.
It is calendar availability: maintenance downtime is not kept historically, so
it is not subtracted. A car that spent a month in the workshop reads as idle
rather than as unavailable, and that is the honest limit of what was recorded.

The compliance card counts documents expired and expiring. A vehicle whose
insurance date nobody typed in is counted separately as a gap in the records,
not as a breach — folding the two together would turn a filing habit into an
alarm.

## Read the rentals section
<!-- permission: reports.view -->

Hires started and completed, average hire length and average hire value, then a
lifecycle panel: bookings created, bookings confirmed, vehicles collected,
vehicles returned, returned late, cancellations, the cancellation rate and
extensions recorded. Each of those is counted on its own business date rather
than all of them on the contract's start.

A **Right now** panel sits beside it, labelled as current state rather than as
a period figure.

## Read the customers section
<!-- permission: reports.view -->

How many customers rented in the period, how many were first-time and how many
returning, and the repeat rate. Rental cash is attributed to the customer who
paid it. Outstanding balances, again, are as at now.

## Read the costs section
<!-- permission: reports.view -->

The same ledger the Expenses page shows, broken down by category, by supplier
or by what each cost belongs to. Voided costs are absent, and costs attached to
a financing agreement are excluded so the same money is not counted twice.

## Read the financing section
<!-- permission: reports.view -->

Active agreements, paid to lenders, cost of borrowing and remaining principal,
then the same figures by agreement. Vehicles that have left the fleet are
included: a debt does not stop existing because the car was retired.

Where a payment was recorded without stating how much of it was interest, the
cost of borrowing is marked as a floor rather than printed as a settled number.

## Read the tracking section
<!-- permission: reports.view -->

How much of the fleet carries a tracker, how fresh the positions are, and how
the devices and connections are doing.

Every figure here is a snapshot taken when the page loaded. Positions refresh
only while somebody has the tracking workspace open, and nothing is collected
overnight — so there is no uptime, no average position age for a month, and no
count of what went quiet last night. None of it was ever recorded.

## Take a section out as a spreadsheet
<!-- permission: reports.view -->

**Export** produces a file of the section on screen, for the period and
currency on screen. Business, Fleet, Costs, Customers and Financing export;
Rentals and Tracking do not.

## If it goes wrong

**A section says nothing was recorded and I know there was.** Check the
currency selector first. A period containing more than one currency shows the
figures for one of them, and the notice above says which.

**A figure did not move when I changed the period.** It is a position figure.
Owed by customers, deposits held, remaining principal, overdue to lenders and
the "right now" panels are all as at this moment by design.

**The range was shortened.** A report covers at most 1830 days at once, and the
notice names the date the figures now end on.

**Utilisation looks low for a fleet that was busy.** Vehicles off the road are
still counted as available, because maintenance downtime is not kept
historically. There is no record to subtract.

**The section failed to load.** A read that failed is not a read that found
nothing, and the page says so rather than reporting zero. Retry it from the
message.

**Revenue here disagrees with the dashboard tile.** Check that both are on the
same period and the same currency. Beyond that the definition is identical:
money received against hires, refunds subtracted, voided entries ignored.

## Where to go next

- [Overview](/help/overview) — the short version, for today.
- [Expenses](/help/expenses) — where the cost figures are recorded.
- [Financing](/help/financing) — where the lender figures come from.
- [Help centre](/help) — every other page.

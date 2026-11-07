---
title: Overview
group: Overview
summary: What the dashboard is counting, and over what period each figure is counted.
permission: organization.view
---

> **In short** — the period selector at the top governs **Revenue**,
> **Expenses**, **Operating result**, **Completed** and the chart. It governs
> nothing else. Everything about the fleet, the open contracts and the money
> still owed is as at this moment, whichever period is chosen.

![The dashboard, with the money tiles above the fleet strip](/help/overview-01-dashboard.jpg)

Overview is read top to bottom as two questions: what has to be dealt with
today, and how the period is going. The operational half comes first because it
is the half with a deadline.

A new agency sees zeros, because it has zeros. There is no sample fleet and no
illustrative revenue anywhere in {{productName}}.

### Which figures move with the period

The selector offers this month, last month, the last three months and this
year. Month and year boundaries are the agency's own — a month begins when the
agency's calendar says so, not when a clock somewhere else does.

| Figure | Counted over |
|---|---|
| Revenue, Expenses, Operating result | The chosen period |
| Completed | The chosen period |
| The revenue-and-expenses chart | The chosen period, by day or by month |
| Today | Today, in the agency's time zone |
| Fleet status, Active contracts, Upcoming pick-ups | Now |
| Outstanding, Deposits held | Now, across every contract |
| Customers, Contracts | Everything on file |

Changing the period cannot change a figure in the second half of that table,
and it is worth knowing which half you are looking at before quoting a number
at somebody.

### One currency, and no conversion

Only records written in the agency's own currency are counted. Nothing is
converted, because there is no exchange rate anywhere in this product, and
adding two currencies together would be a confident lie.

When the period contains records in another currency, a notice above the tiles
says how many were left out. The figures below it are correct for the agency's
currency and silent about the rest.

## Read the day's work off the top
<!-- permission: rentals.view -->

**Today** is four counts: collecting today, due back today, past return time,
and contracts owing money. Each one is a list you can open, and each is the
same question the Rentals page answers in more detail.

An agency with no contracts yet gets a sentence instead of four zeros.

## Read the money tiles correctly
<!-- permission: organization.view -->

Four tiles, and the differences between them matter.

**Revenue** is money actually received against hires in the period, dated by
when it was received. Refunds are subtracted. A voided entry counts nowhere.
Deposits are not in it at all — a deposit is held, not earned.

**Expenses** is what was recorded as spent, dated by when the cost was
*incurred* rather than when somebody typed it in. It is the gross figure, tax
included, because gross is what left the agency.

**Operating result** is the first less the second. The page says plainly that
this is not profit, and it is worth repeating here: financing, depreciation,
salaries nobody entered and the agency's own tax position are all outside it.
Anyone who treats it as profit will be wrong by whatever was never recorded.

**Outstanding** is money owed on contracts that are reserved, out or completed.
It is a balance as at now and does not move with the period.

## Read the fleet strip
<!-- permission: organization.view -->

The strip counts every vehicle that has not been retired, split by what each
one is doing right now: available, rented, reserved, in maintenance,
unavailable. Rented and reserved are read from the contracts rather than set by
anyone, which is why a vehicle can change category without anybody touching it.

Beside it, **Active contracts** counts the hires that are out with a customer,
and **Upcoming pick-ups** counts confirmed bookings whose collection time has
not arrived yet.

## Follow the setup checklist on a new agency
<!-- permission: organization.view -->

Until the agency has at least one vehicle and at least one contract, a
checklist sits above everything else. Every tick is read from the agency's own
records — a step is complete because the data is there, never because a screen
assumed it.

It retires itself the moment the agency is trading, and it does not come back.

## Read the trend chart
<!-- permission: organization.view -->

**Revenue and expenses** draws the same two definitions as the tiles, bucketed
by day for a month-sized period and by month for a longer one. A cost is drawn
in the month it was incurred, so a July receipt entered in August belongs to
July.

## Check what is owed to lenders
<!-- permission: financing.view -->

**Financing obligations** sits below the chart as context rather than as a
correction: nothing a lender is owed changes the operating result above it.
Financing is deliberately kept out of that figure, so that the day it is
reported in full it is not counted twice.

## If it goes wrong

**The figures look too low.** Check the period first, then check for the notice
about another currency. Records written in a currency other than the agency's
own are not converted and are not in these totals.

**Revenue does not match what the contracts say they are worth.** It is not
meant to. Revenue counts money received; a contract's value is counted when it
is written. A busy month with slow payers shows exactly that difference.

**The operating result is negative and the agency is not losing money.** Costs
land on the day they were incurred and payments on the day they arrived. One
large annual cost in a quiet month produces that, and it is the arithmetic
being honest rather than the business failing.

**Expenses here is smaller than the Expenses page shows.** Voided costs count
nowhere, and costs attached to a financing agreement are excluded on purpose.

**The fleet strip disagrees with a vehicle's own page.** A status set by hand
takes precedence in the badge on the vehicle. The strip counts what the vehicle
is actually doing. Open the vehicle and decide which of the two is true.

**Outstanding did not change when I changed the period.** It is not a period
figure. Neither are deposits held, the fleet strip, active contracts or
upcoming pick-ups.

## Where to go next

- [Rentals](/help/rentals) — the contracts behind the day's four counts.
- [Reports](/help/reports) — the same money, broken down and exportable.
- [Calendar](/help/calendar) — the week the four counts are one day of.
- [Help centre](/help) — every other page.

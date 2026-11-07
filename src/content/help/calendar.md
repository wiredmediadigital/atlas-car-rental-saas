---
title: Calendar
group: Operations
summary: Read the week at a glance, spot the clashes, and move a booking that has not been collected.
permission: rentals.view
---

> **In short** — the board shows **Reserved** and **Out** contracts by default,
> because those are the two that actually hold a vehicle. Drafts, completed and
> cancelled hires are behind the status filter. A booking can be dragged to new
> dates or onto another vehicle only while nobody has collected it.

![The fleet timeline, one row per vehicle across the week](/help/calendar-01-fleet-timeline.jpg)

Calendar is a view over the contracts and nothing else. It holds no bookings of
its own, and every change it starts goes through the same checks the Rentals
module uses — so a booking made here is subject to exactly what a booking made
there is.

The span and the date live in the address bar, along with the status and make
filters, so a board you have set up can be bookmarked or sent to a colleague.
The search box is deliberately left out of the address bar: staff type customer
names into it.

### The four spans

**Day** is the counter's own day at hour resolution. **Week** is where most
scheduling questions are asked. **2 weeks** is long enough to see turnarounds.
**Month** answers "is this car free the weekend after next".

A week begins on whichever weekday the agency uses, not on a weekday this
product picked.

### What is drawn, and what it means

A block is coloured by the contract's state: draft, reserved, out, overdue,
completed, cancelled. **Overdue** is not a sixth state of a contract — it is a
hire that is out, past its return time, and has not been recorded back. It
appears and clears on its own.

Drafts are drawn as outlines and are off by default. A draft holds nothing, so
a filled block for one would say a car is committed when it is not.

Blocks shorten their label rather than overflow. A five-hour hire on a month
view is a few pixels wide and carries no text at all, which is honest — the
label would be unreadable either way.

## Read the day across the top
<!-- permission: rentals.view -->

The strip counts five things for the selected day: collections still to happen,
returns due, vehicles out, anything past its return time, and how many vehicles
are free.

Clicking one of them narrows the board rather than replacing it — the bookings
that answer the question stay lit and everything else dims, so the schedule
around them is still readable. Clicking **free** is the exception: it filters
the rows down to the vehicles with nothing on them that day.

A hire that goes out and comes back the same day appears under both collections
and returns, because those are two separate jobs for the counter.

## Spot a tight turnaround
<!-- permission: rentals.view -->

Between one hire coming back and the next going out, the board reports the real
gap and marks the short ones. No preparation buffer is invented: this product
has no configurable turnaround time, so making one up would be the board
inventing a business rule.

Under three hours is marked for attention. The case that genuinely cannot work
— the car is already late for a booking that has started — is marked
separately.

## Find a vehicle free for a period
<!-- permission: rentals.view -->

**Find a free vehicle** asks for a window and answers from the same
availability check the booking flow runs. There is deliberately no second
availability algorithm anywhere in {{productName}}.

It searches the whole fleet, ignoring the make filter on the board. Answering
"what is free this weekend" through a filter that hides half the fleet would
report the hidden half as committed.

## Start a booking from the board
<!-- permission: rentals.create -->

Clicking an empty stretch of a vehicle's row opens the rental flow with that
vehicle and a one-day period already filled in. Both are suggestions: the flow
checks the vehicle, the dates and the driver again before anything is created,
exactly as it would from a standing start.

## Move a booking to new dates
<!-- permission: rentals.update -->

Drag a block along its row to change the dates, or onto another vehicle's row
to change the vehicle. A dialog shows what is proposed before anything is
saved, and the quick view on a block offers the same move without dragging.

Four things to know:

- **Only before collection.** A draft or a confirmed reservation can be moved.
  A hire that is out cannot: its end moves by extending it, or by recording the
  return.
- **The move is checked like a fresh booking.** If the new period collides with
  another commitment the whole move is refused and the booking keeps the dates
  it had. There is no half-applied move.
- **A contract already issued has to be reissued.** You are refused once, told
  which contract states the booking, and have to ask again meaning it. A new
  version is then issued with the new dates.
- **The charges do not follow.** Only the period and the day count change.
  Repricing somebody's contract because a block was nudged would be a worse
  surprise than a day count that no longer matches its lines, so the correction
  is left to you.

Moving a booking is a renegotiation, not an extension. The new return becomes
the agreed return, and the contract does not afterwards read as though the
customer's hire had been lengthened.

A vehicle that is retired or not in service will not accept a booking dropped
on it.

## Work the day on a small screen
<!-- permission: rentals.view -->

Below a wide screen a Gantt chart answers nothing, so the same day is served as
a worklist: collections, returns and what is out, each opening the same quick
view.

## If it goes wrong

**A booking I know exists is not on the board.** Check the status filter. Only
reserved and out hires are drawn by default; drafts, completed and cancelled
ones have to be asked for.

**The board says the window is very full.** Two thousand bookings is the
ceiling for one window, and the rest are not drawn. That is a filter problem
rather than a drawing problem: narrow the span, or filter by make.

**I cannot drag a block.** It is out with a customer, or already closed, or you
do not hold `rentals.update`. Extend the hire or record the return instead.

**The move was refused and nothing changed.** Something else is booked on that
vehicle inside the new window. Nothing was half-applied; the booking still has
the dates it had.

**It says a contract states this booking.** A contract has been issued against
it. Confirm the move and a new version is issued; the superseded one still
records, immutably, what was agreed before.

**The day count changed but the price did not.** That is deliberate. Adjust the
charges on the contract and reissue it.

**A vehicle has no row.** Retired vehicles are left off unless you include
them, and the make filter hides the rest.

## Where to go next

- [Rentals](/help/rentals) — writing, confirming and closing the contracts this
  board draws.
- [Vehicles](/help/vehicles) — why a vehicle might not be offered at all.
- [Overview](/help/overview) — the same day as four counts.
- [Help centre](/help) — every other page.

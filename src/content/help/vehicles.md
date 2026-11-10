---
title: Vehicles
group: Fleet
summary: Add vehicles, keep their paperwork current, and control what is bookable.
permission: vehicles.view
---

> **In short** — a vehicle is bookable only when it is in service, not retired,
> and has nothing else booked across the period you are asking for. Two of those
> you set by hand; the third comes from the contracts and cannot be set at all.

![The fleet list, with the status counts along the top](/help/vehicles-01-fleet-list.jpg)

Vehicles is the fleet. The strip of counts along the top is also the filter:
click **Maintenance** and the list below becomes the vehicles in maintenance.
The toolbar searches make, model, plate and VIN, and filters by make, model
year, compliance state and whether retired vehicles are included.

As on the rentals list, the view you build ends up in the address bar, so it
can be bookmarked and shared. **Export** takes whatever is on screen out as a
spreadsheet — the file always contains the same rows the page is showing.

### What a vehicle's status means

| Status | What it means |
|---|---|
| Available | On the lot and ready to hire out. |
| Rented | Currently out with a customer. |
| Reserved | Committed to a booking that has started. |
| In maintenance | Being serviced or repaired; not bookable. |
| Off the road | Withdrawn from service; not bookable. |

Only three of those are yours to set, and the dropdown that sets them calls the
first one **In service** rather than Available. **Rented** and **Reserved** are
read from the contracts against the vehicle, so they appear and disappear on
their own as hires start and finish.

They follow the contract, not the clock. **Rented** starts when you check the
vehicle out and lasts until you complete the contract — whatever the booking
said was supposed to happen. Hand a vehicle over early and it reads **Rented**
early. Let a hire run past its return time and it keeps reading **Rented**.
Record the vehicle back and it *still* reads **Rented**, because the contract
is not closed yet.

That last one catches people out, and it is deliberate: a vehicle nobody has
closed out is a vehicle nobody has actually finished with. **Reserved** works
the other way round and is the one clock-driven state — it appears when a
confirmed booking's collection time has arrived and the vehicle has not been
checked out yet.

A vehicle is offered to a new booking only when it is in service, not retired,
and free for the whole period requested.

## Add a vehicle
<!-- permission: vehicles.create -->

**Add vehicle** asks for make, model, registration plate, current odometer
reading and a daily rate. Everything else — model year, VIN, colour, category,
fuel, transmission, seats, notes — is optional and can be filled in later.

![The add-vehicle form](/help/vehicles-02-add-vehicle.jpg)

A few rules are worth knowing before you type:

- The plate has to be unique among the agency's vehicles that are still in the
  fleet, ignoring case and extra spaces. A retired vehicle does not hold on to
  its plate, so a re-registered one can be reused.
- A VIN, if you record one, is unique the same way. It uses letters and digits
  only, and never the letters I, O or Q.
- The daily rate may be zero, for a vehicle that is in the fleet but not for
  hire.
- The odometer is required, and later readings may not be lower than it.

The renewal dates — insurance, technical inspection, registration and road tax,
next service — are on the same form. Recording them here is what makes the
warnings work later, and none of them is compulsory.

Your plan covers a set number of vehicles, and a counter beside the page title
shows how many you have against it, for example **4 of 5**. Retired vehicles do
not count. The counter is hidden when your agency has no limit. When you reach
the limit, **Add vehicle** and **Import** are no longer offered and a message
explains the options: retire a vehicle you no longer rent, or move to a larger
plan (an owner can do that from Billing). A vehicle that would go past the limit
is refused, and nothing is added.

## Import a fleet from a spreadsheet
<!-- permission: vehicles.create -->

**Import** reads a CSV, up to 5 MB and 500 rows at a time. It matches your
column headings to the fields itself where it can, and you correct the rest
from a dropdown.

Nothing is written until you have seen the preview. Every row is put through
the same checks the add-vehicle form uses, and the preview names the rows that
would fail and why.

The preview also tries to flag plates you already have, but treat that as a
help rather than a guarantee: on a large fleet it does not check every existing
vehicle, so a duplicate can reach the import and be refused there instead. The
refusal is safe — nothing is overwritten — and the row is reported with its
line number like any other.

The import counts against your plan's vehicle limit as a whole. If adding every
row would take you past it, the batch is refused and the message says **Nothing
was imported.** Not even the first rows go in. Retire some vehicles or reduce the
file, and import again.

A part-successful import is a real outcome, not a failure: the rows that passed
are added, and the ones that did not are listed with their line numbers so you
can fix those and import again.

## Change what a vehicle is doing
<!-- permission: vehicles.update -->

On a vehicle's own page, **Operational status** switches it between in service,
in maintenance and off the road. The change is immediate, and a vehicle that is
not in service stops being offered to new bookings straight away.

It does not touch bookings that already exist. If a vehicle has to come off the
road and it is committed to a contract, deal with the contract as well —
substitute the vehicle on it, or move the booking.

## Record an odometer reading
<!-- permission: vehicles.update -->

**Record odometer** is in the menu on the vehicle's page. A reading may never be
lower than the last one — the form says what the last one was and refuses
anything below it.

Most of the time you will not need it. Checking a vehicle out or recording its
return writes the reading through to the vehicle automatically, so this is for
the readings taken outside a hire.

## Keep the compliance dates current
<!-- permission: vehicles.update -->

The compliance panel shows four dates: insurance, technical inspection,
registration and road tax, and next service. Each is marked valid, expiring
soon, expired, or no date recorded.

"Expiring soon" is a setting, not a fixed number of days, and the panel states
the window it is using. A certificate is valid for the whole of its last day,
in the agency's own time zone.

A date with nothing recorded is shown as exactly that. The product does not
know what any of these documents mean or which country requires which — it
knows only whether somebody wrote a date down.

To find the gaps across the whole fleet, use the compliance filter in the
toolbar: **Has an expired document** and **Missing a compliance date**.

## Attach a document
<!-- permission: vehicleDocuments.create -->

The documents panel holds the paperwork itself: insurance, registration,
technical inspection, road tax, permits, purchase invoices, lease agreements
and anything else. Record the type, number, issuer and dates, then attach a PDF
or an image of up to 10 MB.

The file is optional. Agencies routinely know a renewal date long before the
certificate is scanned, and recording the date alone is enough to get the
warning.

Expiry on a document means exactly what it means on the compliance panel — it
is the same rule, asked twice.

## Add photographs
<!-- permission: vehicles.update -->

Photographs go on the vehicle's own page: PNG, JPEG or WebP, up to 8 MB each.
The first one you upload becomes the lead photo, and you can change which one
leads at any time. They are stored privately and shown through short-lived
links.

These are the fleet's pictures — how the vehicle looks, for the list and the
pickers. Pictures of a scratch belong on the contract that was running when it
happened, not here.

## Retire a vehicle
<!-- permission: vehicles.update -->

**Retire from fleet** is the answer for a vehicle you no longer operate. It
stops appearing in the fleet and cannot be booked, but every contract, payment
and expense that refers to it stays exactly as it is.

A retired vehicle stops counting against your plan's vehicle limit, so retiring
is how you free a place when you are at it. The place is available as soon as the
vehicle is retired.

It is reversible: a retired vehicle shows a banner on its page with **Return to
fleet** on it (which needs a free place under your limit), and the toolbar's **Include retired vehicles** brings it back
into the list so you can find it.

## Delete a vehicle permanently
<!-- permission: vehicles.delete -->

Deleting is offered only when nothing financial refers to the vehicle — no
contracts, no expenses, no financing. If anything does, the option is not
there, and retiring is what you want.

When it is offered, it takes the vehicle's photographs and documents with it
and cannot be undone. It also frees a place under your limit, but retiring does
the same and keeps the history, so it is the usual choice.

## If it goes wrong

**I cannot add or import a vehicle, or it says my plan covers a number of
vehicles.** You are at your plan's limit. Retired vehicles do not count, so
retire one you no longer rent and try again, or ask the owner about a larger
plan. Your existing vehicles are never removed or retired because of a limit.

**A vehicle is missing from a booking's vehicle list.** It is committed to
another contract across some part of that period, or it is in maintenance, off
the road, or retired. Its own page says which.

**It says Rented and I did not set that.** You cannot set it. It is read from
the contract the vehicle was checked out on, and it clears when that contract
is completed.

**It still says Rented and the vehicle is back on the lot.** Recording the
return is not the same as closing the contract. The vehicle stays **Rented**
until the rental is completed, which is the step that also settles the deposit.
Open the contract and complete it, and the vehicle rejoins the fleet.

**It says In maintenance even though it is out with a customer.** A status you
set by hand takes precedence in the badge. The contract is unaffected — but it
is worth deciding which of the two is actually true.

**The plate is rejected as already in use.** Another vehicle in the fleet has
it. Plates are compared ignoring case and extra spaces, so a difference in how
it was typed will not separate them. Search the list for the plate to find the
vehicle holding it.

**The odometer will not save.** A reading cannot go below the last one
recorded. If the last one was wrong, the correction has to go in as a reading
that is at least as high.

**Rows were skipped during an import.** The preview lists each one with its line
number and the reason. Fix those rows in the spreadsheet and import the file
again; the rows that already went in are refused as duplicate plates rather
than added twice.

**The compliance warning is not appearing when I expect it.** The window is an
agency setting, shown in the panel's own heading. A document with no date
recorded never warns, because there is nothing to warn about.

## Where to go next

- [Rentals](/help/rentals) — booking a vehicle out, and what happens to its
  odometer when you do.
- [Calendar](/help/calendar) — what each vehicle is committed to, week by week.
- [Expenses](/help/expenses) — attaching a cost to a vehicle, which is what
  makes its running cost mean anything.
- [Financing](/help/financing) — the loan or lease behind a car.
- [GPS tracking](/help/gps-tracking) — fitting a tracker to one of these
  records.
- [Who can do what](/help/who-can-do-what) — who may add, edit and retire
  vehicles.
- [Help centre](/help) — every other page.

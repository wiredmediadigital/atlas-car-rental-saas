---
title: Your first vehicle and first rental
group: Getting started
summary: The shortest honest path from an empty agency to a signed contract and money taken.
---

> **In short** — a vehicle, a customer, a booking, a contract, a hand-over.
> Five steps, about ten minutes, and nothing in it has to be undone later. The
> only thing you genuinely cannot skip is the odometer reading at hand-over.

## Add a vehicle
<!-- permission: vehicles.create -->

**Add vehicle** needs five things: make, model, registration plate, the current
odometer reading and a daily rate. Everything else — model year, VIN, colour,
category, fuel, transmission, seats — can wait.

![The add-vehicle form](/help/vehicles-02-add-vehicle.jpg)

Two of those five are worth care. The plate has to be unique among the vehicles
still in the fleet, ignoring case and spacing. The odometer is required because
later readings may never be lower than it, so a guess here becomes a floor you
have to live with.

The renewal dates — insurance, inspection, registration, next service — are on
the same form and none is compulsory. Recording them now is what makes the
expiry warnings work later.

## Record a customer
<!-- permission: customers.create -->

**Add customer** needs a name and nothing else. An individual needs a first or
a last name; a company needs a company name.

Record their driving licence while they are standing there. You *can* book a
hire for a driver with no licence on file — the screen says so rather than
stopping you — but the licence should be recorded before any keys change hands,
and doing it now saves doing it at a counter with somebody waiting.

## Write the booking
<!-- permission: rentals.create -->

**New rental** is five steps, in the order the facts depend on each other:
period, vehicle, people, pricing, review.

![The first step of a new rental, with the running quote beside it](/help/rentals-04-new-rental-period.jpg)

Three things to know the first time:

- **Only free vehicles are offered.** A vehicle missing from the list is
  committed elsewhere, in maintenance, off the road or retired.
- **The renter and the primary driver are different fields.** The renter signs
  and pays; the primary driver takes the keys. They default to the same person.
- **Days are counted from elapsed time, and any started day is charged in
  full,** with a minimum of one. The screen shows how it reached the number.

Finish on **Confirm reservation** rather than **Save as draft**. A draft
reserves nothing — confirming is the moment the vehicle is actually held.

## Issue the contract and take the signature
<!-- permission: rentals.update -->

**Issue contract** freezes everything legally relevant into a snapshot and
produces the PDF from that snapshot alone. If the agency's contract wording is
not written yet, write it first:
[Set up your agency](/help/set-up-your-agency) covers it, and a contract issued
before it carries none of it.

**Sign** records the name as the customer gives it and, optionally, a signature
drawn on screen. Plenty of agencies print and sign on paper instead; the drawn
signature is optional throughout.

## Hand the vehicle over
<!-- permission: rentals.update -->

**Check out** captures when the vehicle went out, the odometer, the fuel level
and the condition. The odometer is required, because every later question about
distance, fuel or damage is answered from it. Saving also moves the vehicle's
own odometer, so the fleet stays accurate without a second step.

Take the condition photographs at this point, from the contract's own
photographs panel. They are the evidence a damage argument turns on, and the
moment to take them is before the car leaves, not after it comes back.

## Take the money
<!-- permission: payments.create -->

The Money panel on the contract shows what is still owed, what deposit is held
and what deposit was agreed. **Record payment** takes money against the hire;
**Take deposit** takes the security deposit.

Keep the two apart. A deposit is held, not earned: it does not reduce what the
customer owes and it is never counted as takings.

## Close it when the car comes back
<!-- permission: rentals.update -->

**Record return** captures the same facts as the hand-over so the two can be
compared. **Complete rental** then closes it — and is refused until the return
has been recorded and no deposit is still being held.

Completing puts the vehicle back in the fleet. It does not collect anything: a
completed contract can quite correctly still read as unpaid.

## If it goes wrong

**The vehicle is not in the list.** Only vehicles that are in service and free
for the whole period are offered. The vehicle's own page says which of those it
fails.

**I cannot confirm the reservation.** No primary driver is named. Add one on
the people step.

**The contract printed with no terms and no charges.** It was issued before
they existed. Add them and reissue; that creates a new version and marks the
previous one superseded.

**The odometer will not save.** A reading can never be lower than the last one
recorded.

**I cannot complete the rental.** Either the return has not been recorded, or a
deposit is still being held. Return the deposit from the Money panel first.

**The dashboard still shows zeros.** Revenue counts money received, not
contracts written. Record the payment and it appears.

**The checklist on the dashboard has not ticked.** It reads the agency's actual
records. A step ticks when the record exists, and the whole checklist retires
once there is at least one vehicle and one contract.

## Where to go next

- [Rentals](/help/rentals) — extensions, vehicle swaps, cancellations and
  everything else a contract can do.
- [Vehicles](/help/vehicles) — compliance dates, documents and retiring a car.
- [Customers](/help/customers) — identification, duplicates and archiving.
- [Help centre](/help) — every other page.

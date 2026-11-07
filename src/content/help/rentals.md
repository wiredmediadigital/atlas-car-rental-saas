---
title: Rentals
group: Operations
summary: Quote a hire, hold a vehicle, hand it over, take the money and close the contract.
permission: rentals.view
---

> **In short** — a contract moves through five states: **Draft**, **Reserved**,
> **Out**, **Completed**, **Cancelled**. It only starts holding the vehicle when
> you confirm it, and it only stops when it is completed or cancelled. Whether
> the customer has paid is tracked separately, so a finished hire can still read
> **Unpaid**.

![The rentals list, showing contracts that are out and reserved](/help/rentals-01-list.jpg)

Rentals is {{productName}}'s contract book. The strip across the top is the day in four
figures — collecting today, due back today, past return time, money owed — and
each figure is also a filter: click it and the list below becomes the contracts
it was counting. Underneath that, the toolbar searches by contract number,
renter or plate, and narrows by state and by balance.

Everything the toolbar does ends up in the address bar, so a view you have set
up can be bookmarked, reloaded or sent to a colleague and it comes back the
same.

### The two states every contract has

The first is where the hire is in its life:

| State | What it means |
|---|---|
| Draft | Being put together. The vehicle is not held for these dates yet. |
| Reserved | Confirmed. The vehicle is held and nobody else can book it. |
| Out | The vehicle is with the customer. |
| Completed | Returned and closed. |
| Cancelled | Called off before the vehicle was collected. |

There is no way back along that line. Handing a vehicle over cannot un-happen,
so a contract that is **Out** is returned and completed, never cancelled.

The second state is the money: **Unpaid**, **Part paid**, **Paid** or
**Overpaid**. It is worked out from the payments recorded against the contract
and nothing else, so the two states move independently. Closing a hire does not
collect the money, and taking the money does not close the hire.

A deposit is not in that calculation at all. It is held, not earned, and it
never reduces what the customer still owes.

## Write a new contract
<!-- permission: rentals.create -->

**New rental** opens five steps, in the order the facts depend on each other.

1. **Period.** Collection and return, in the agency's own time zone. Days are
   counted from elapsed time and any started day is charged in full, with a
   minimum of one — the screen tells you how it reached the number.
2. **Vehicle.** Only vehicles with nothing else booked across that period are
   offered. If the one you want is missing, it is committed elsewhere, in
   maintenance, off the road or retired.
3. **People.** The renter is who signs and pays. The primary driver is who may
   take the keys, and defaults to the renter. Anyone else driving goes in as an
   additional driver.
4. **Pricing.** The daily rate starts from the vehicle's listed rate and the
   deposit and tax rate from the agency's defaults; type over any of them.
   Extras are added as their own lines.
5. **Review.** Check it, then either **Save as draft** or **Confirm
   reservation**.

![The first step of a new rental, with the running quote beside it](/help/rentals-04-new-rental-period.jpg)

The quote on the right updates as you go, so the figure you read at step one is
the figure the contract will carry.

You can book a driver whose licence is not on file — the screen says so rather
than stopping you — but record the licence before the keys change hands.

## Confirm the reservation
<!-- permission: rentals.update -->

A draft reserves nothing. Confirming is the moment the vehicle is held for
those dates and stops being bookable by anyone else, and it is refused until a
primary driver is named.

![A rental contract, showing the hire, the people on it and the hand-over panel](/help/rentals-02-detail.jpg)

The contract screen always offers the one action the hire needs next as the
main button — confirm, check out, record return, complete. When that action is
not available yet, the reason is spelled out above the contract. Everything
else — extend, change vehicle, cancel — sits in the menu beside it, greyed out
until it applies.

## Issue the contract and take a signature
<!-- permission: rentals.update -->

**Issue contract** freezes everything legally relevant into a snapshot and
produces the PDF from that snapshot alone. Correcting a surname afterwards
changes the customer record and leaves the issued document exactly as it was.

If something on the contract does change, reissue it: that creates a new
version and marks the previous one superseded. Nothing is ever edited in place.

**Sign** records the name as the person gives it at the counter, an optional
signature drawn on the screen, and an optional countersignature from whoever is
at the desk. It records that the person was present and agreed to the document
as it stands — it does not alter the document, and it is not a qualified
electronic signature. Plenty of agencies print and sign on paper instead; that
is fine, the drawn signature is optional throughout.

A contract cannot be issued against a draft or a cancelled booking.

## Hand the vehicle over
<!-- permission: rentals.update -->

**Check out** captures when the vehicle went out, the odometer, the fuel level
and the condition. The odometer is required, because every later question about
distance, fuel or damage is answered from it. Saving also moves the vehicle's
own odometer, so the fleet stays accurate without a second step.

Condition photographs are a separate panel further down the contract, split
into hand-over and return. They are the evidence a damage argument turns on, so
take them at both ends. They are kept apart from the vehicle's fleet
photographs deliberately, and they are stored privately — never on a public
address.

Write anything the customer should be shown now rather than argued about later
into the condition notes.

## Add a charge or a discount
<!-- permission: rentals.update -->

Charges can be added and removed for as long as the contract is open. Pick the
type, say what it is for — the description prints on the contract — enter the
amount, and decide whether it counts towards the tax base, which differs by
country and is therefore asked rather than assumed.

A discount is entered as an ordinary positive amount and subtracted for you.

![The charges breakdown and the money panel on a contract](/help/rentals-03-charges-and-money.jpg)

The hire itself is not a line you add. It comes from the period and the daily
rate, which is why it cannot be removed by hand. A closed or cancelled contract
takes no further charges.

## Take a payment or a deposit
<!-- permission: payments.create -->

The Money panel shows three figures: still owed, deposit held, deposit agreed.
**Record payment** takes money against the hire; **Take deposit** takes the
security deposit; **Return deposit** gives it back. The deposit buttons appear
only when there is one to take or to return.

Each entry carries an amount, a method — cash, card, bank transfer, cheque,
online or other — when it was received, and a reference you can file it by.

Keep the two kinds apart. A deposit is held against damage and returned at the
end: it does not reduce the balance and it is never counted as takings. The
amount refunded can never exceed what is actually being held.

## Extend a hire
<!-- permission: rentals.update -->

**Extend** moves the return later and charges for the extra days in one action,
because they are one event. The suggested figure is the extra days at the daily
rate; overwrite it, or set it to zero to extend without charging.

Extra days are measured against the whole hire before and after, so a contract
extended twice never gains or loses a day to rounding. The number of extensions
is shown on the contract.

Only a contract that is holding the vehicle — **Reserved** or **Out** — can be
extended, and only if nothing else is booked on that vehicle in the new window.

## Change the vehicle on a booking
<!-- permission: rentals.update -->

**Change vehicle** moves the booking onto a different vehicle and frees the
original. The replacement is checked for availability exactly as a fresh
booking would be, so a swap cannot create a clash.

This is offered only before the customer collects. Once somebody has driven
away, the vehicle on the contract is a fact rather than a plan.

The pricing does not follow the vehicle. If the replacement is priced
differently, adjust the charges and reissue the contract.

## Record the return and close the contract
<!-- permission: rentals.update -->

**Record return** captures the same facts as the hand-over — when, odometer,
fuel, condition — so the two can be compared. The contract then shows the
distance covered.

**Complete rental** is refused until three things are true: the hire is **Out**,
the return has been recorded, and no deposit is still being held. Return the
deposit from the Money panel first. There is no separate "keep the deposit"
action: damage is charged as a line on the contract and settled like any other
money.

Completing puts the vehicle back in the fleet. It does not collect anything —
a completed contract can quite correctly read **Unpaid**, and the **Money owed**
figure at the top of the list keeps counting it.

## Cancel a booking
<!-- permission: rentals.update -->

Cancelling releases the vehicle for those dates and keeps the record. The
contract, its charges and any money already taken stay exactly as they are.
Give a reason — it is kept with the contract so the history explains itself.

A hire that is already **Out** cannot be cancelled. Record the return instead.

## Void a payment entered by mistake
<!-- permission: payments.delete -->

Money is never deleted. A mistaken entry is voided with a reason: it stays
visible on the contract, struck through, and stops counting everywhere at once.
Voiding an entry that took a deposit releases the hold as well.

## Delete an untouched draft
<!-- permission: rentals.delete -->

A draft with no payments and no issued contract can be deleted outright,
because there is no history to keep. The moment money has moved or a document
has been issued, the option disappears and cancelling is the honest answer.

## If it goes wrong

**The vehicle I want is not in the list.** The picker offers only vehicles with
nothing booked across the whole period, and only ones that are in service. A
vehicle marked as in maintenance, taken off the road or retired is not offered
at all, whatever its diary looks like.

**It says the vehicle is no longer free.** Somebody booked it between the moment
the screen was drawn and the moment you saved. Availability is answered as of
now; the booking itself is what settles it. Choose another vehicle or change the
dates.

**I cannot confirm the reservation.** No primary driver is named. Add one on the
People card.

**I cannot complete the rental.** Either the return has not been recorded, or a
deposit is still being held. The screen says which.

**I cannot cancel it.** It is already out with the customer, or already closed.
Record the return instead.

**I cannot extend it.** Another contract needs that vehicle inside the new
period. The screen names the contract that holds it. Move that booking, or put
this customer in a different vehicle.

**The dates on the booking are wrong.** The collection and return times are not
editable from the contract screen. A booking that is still a draft or reserved
can be moved on the Calendar, which checks the new slot and amends the contract
with it. Once the vehicle has gone out, the period is a record of what happened.

**The contract says it charges nothing.** It was issued before the charges were
added. Add them and reissue before the customer signs.

**It is completed but still says Unpaid.** That is working as intended. Closing
a hire and collecting for it are separate. Record the payment and the badge
changes.

## Where to go next

- [Vehicles](/help/vehicles) — what makes a vehicle bookable, and why one might
  not be offered.
- [Team](/help/team) — who in the agency can do each of the things above.
- [Help centre](/help) — every other page.

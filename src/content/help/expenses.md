---
title: Expenses
group: Finance
summary: Record what the agency spends, attach it to the right car or contract, and correct mistakes without deleting anything.
permission: expenses.view
---

> **In short** — a cost is the gross amount that left the agency, dated by the
> day it was *incurred*. Every cost belongs to exactly one of three things: the
> agency as a whole, one vehicle, or one contract. That choice is what makes a
> vehicle's running cost mean anything.

![The expense ledger for a month](/help/expenses-01-list.jpg)

Expenses works a month at a time. The arrows beside the period step back and
forward, and the filters — category, supplier, allocation, currency, search —
go in the address bar so a view can be bookmarked or sent on.

The strip across the top breaks the period down by what the costs belong to,
and each figure is also a filter.

**Export** takes whatever the filters select. It stays available even to an
agency whose subscription has lapsed, because that is the day a ledger is
needed most.

### Gross, and the tax inside it

**Amount paid** is the total that left the agency, tax included. The tax field
says how much of that total was tax; the difference is the figure before tax.
Entering a rate fills the tax amount for you, and it works the way gross
arithmetic actually works — the tax inside a gross amount is not the amount
times the rate.

Nothing here claims any of that tax is recoverable or deductible. Those are
questions for an accountant and for the agency's own country.

Every total in {{productName}} uses gross, because gross is what was spent and
because one consistent basis cannot double count.

### The three allocations

| Belongs to | Use it for |
|---|---|
| Agency overhead | Rent, software, marketing — nothing one car or one hire owns. |
| A vehicle | Tyres, a service, this car's insurance. |
| A rental | A delivery, a toll, cleaning that one hire caused. |

They are mutually exclusive and the database enforces it. A cost attached to a
contract carries no vehicle of its own: the car is whichever one the contract
is for.

## Record a cost
<!-- permission: expenses.create -->

**Record a cost** asks for the date it was incurred, what it was for, the
amount paid, the currency, a category and what it belongs to. Supplier,
invoice number, who paid and an odometer reading are optional.

![Recording a cost](/help/expenses-02-record-a-cost.jpg)

The date is the one that matters. A receipt typed in August for a cost incurred
in July belongs to July, and every report in the product agrees with that.

## Import a month of receipts
<!-- permission: expenses.create -->

**Import** reads a CSV of up to 5 MB and 500 rows at a time, matching your
column headings where it can. Nothing is written until the preview, which puts
every row through the same checks the form uses and names the ones that would
fail.

## Keep the categories and suppliers in order
<!-- permission: expenseVendors.manage -->

**Categories and suppliers** holds both lists. A supplier is operational — the
manager who records a repair needs to be able to add the garage they just used.

Retiring an entry keeps it on the costs that already use it and takes it out of
the picker. Two suppliers cannot share a tax or business identifier.

## Rename or retire a category
<!-- permission: expenseCategories.manage -->

The category list is structural rather than operational: renaming one changes
how every historical cost reads, which is why it sits a level above adding a
supplier.

## Attach the receipt
<!-- permission: expenses.create -->

The documents panel takes PDFs, PNGs, JPEGs and WebP files of up to 10 MB. They
are stored privately and opened through a link that expires within minutes,
never on a public address.

Removing a document leaves the cost itself untouched. To correct the cost,
edit or void it.

## Correct a cost
<!-- permission: expenses.update -->

A recorded cost can be edited while it is still a recorded cost. Every change
is kept: the history panel on the cost says what moved, from what to what, and
who did it. The "who" is taken from the session rather than from anything the
screen sent, because a history whose author can be dictated is not a history.

## Void a cost entered by mistake
<!-- permission: expenses.void -->

Costs are never deleted. **Void** asks for a reason, stops the cost counting
anywhere at once, and leaves it visible on the record with that reason beside
it.

Voiding sits with recording rather than above it. A void destroys nothing — it
is the correction path, and making it rarer than the mistake it fixes would
only encourage worse corrections.

A voided cost is then frozen. It is the record of a correction, and rewriting
it would destroy the thing it exists to preserve.

## If it goes wrong

**I cannot edit or void this cost.** Either it is already voided, or it came
from a financing agreement and is managed there. The page says which.

**The dashboard shows a smaller expenses figure than this page.** Voided costs
count nowhere, costs in another currency are not converted into the agency's
totals, and costs belonging to a financing agreement are deliberately excluded
from the operating result.

**The cost is in the wrong month.** Check the date incurred rather than the
period selector. A cost is filed on the day it happened, not the day it was
entered.

**The vehicle picker is empty on a cost attached to a contract.** It is meant
to be. The car follows from the contract, and asking for both would let the two
disagree.

**Rows were skipped during an import.** The preview lists each one with the
reason. Fix those rows and import the file again.

**The tax figure is not what I expected.** The amount you entered is the gross
total, so the tax inside it is smaller than the rate applied to that total.
Enter the rate and let the form work it out.

**A receipt link has stopped working.** Those links last minutes by design.
Open the document again from the cost.

## Where to go next

- [Financing](/help/financing) — loans, leases and what the agency owes, which
  is deliberately not an operating cost.
- [Reports](/help/reports) — the same costs per vehicle, per category and over
  time.
- [Vehicles](/help/vehicles) — the fleet records a vehicle cost attaches to.
- [Help centre](/help) — every other page.

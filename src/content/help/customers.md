---
title: Customers
group: Operations
summary: Keep renter records, record identification, and find the person a hire belongs to.
permission: customers.view
---

> **In short** — a customer needs a name and nothing else. Identification is a
> separate record attached to them, and the driving licence that stays valid
> longest is the one the product treats as theirs. Document numbers are shown
> as the last four characters until somebody chooses to see the whole thing.

![The customer list, with the filters above it](/help/customers-01-list.jpg)

Customers is the agency's address book, and the place a contract gets its
renter from. The toolbar filters by nationality, by licence state — valid,
expired, or none on file — and by rental history: currently out, owing money,
or never hired. Those filters, the sort and the search term all end up in the
address bar, so "everyone with an expired licence" is a view you can send to a
colleague.

**Export** takes whatever the filters select, not just the page on screen.

### What the search looks at

Name, email and both phone numbers. It also matches identification numbers:
type a passport number with or without spaces and it finds its owner, as long
as you give it at least four characters. Below that a document search matches
most of the agency's paperwork and is not what anybody meant.

Identification numbers are never put in the address bar. Names are not secret;
identifiers are.

### Individuals and companies

An individual needs a first or a last name. A company needs a company name.
Everything else on the form — the second phone, the date of birth, nationality,
language, the whole address — is optional and can be filled in later.

Phone numbers are stored as the customer gives them. There is no country-format
rule, because one country's format rejects correct numbers from everywhere
else; matching is done on the digits.

## Add a customer
<!-- permission: customers.create -->

**Add customer** asks who they are, how to reach them and where they live, and
lets you attach identification in the same pass.

![The add-customer form](/help/customers-02-add-customer.jpg)

While you type an email, a phone number or a document number, the form looks
for a customer who already has it and shows what it found, with the reason each
one matched. Nothing is merged and nothing is blocked — a family sharing one
phone number is ordinary — but a duplicate caught at the counter is cheaper
than one found a month later.

## Record identification
<!-- permission: customerDocuments.create -->

The documents panel takes a passport, national ID, residence permit, driving
licence or anything else. Record the type and the number; the issuing country,
the issue and expiry dates, and the licence classes are optional.

A document number has to be unique within the agency, compared as letters and
digits only — "AB 123 456" and "ab123456" are the same passport.

You can attach a scan of up to 10 MB as a PDF, PNG, JPEG or WebP. The file is
optional: agencies routinely record a number long before anything is scanned.
Scans are stored privately and opened through a link that expires within
minutes, so a copied address stops working rather than becoming a passport page
on the open internet.

Replacing a scan deletes the one it replaced.

## Decide whether somebody may drive
<!-- permission: customers.view -->

A customer reads as one of four things: can drive, licence expired, no licence
on file, or licence expiry unknown. Only the first is a yes.

"No licence on file" and "expired" are kept apart deliberately. The first is a
records gap somebody can fix at the counter. The second is a person who must
not be handed keys.

When a customer has more than one licence recorded, the one that stays valid
longest is the one used, because that is the one that matters operationally.

## See only the last four characters, or all of them
<!-- permission: customers.view -->

A document number is evidence, checked once at the counter — not a display
field. It is shown as its last four characters by default, which is enough for
a person to match the document in their hand.

Revealing the whole number is a deliberate action, on one document at a time.
That keeps identifiers out of screenshots, out of support tickets and off the
screen somebody is standing behind.

## Read a customer's money correctly
<!-- permission: customers.view -->

The profile shows what the customer still owes. It shows a figure only when
every open contract of theirs is in one currency. A customer billed in two
currencies gets a count of currencies instead, because adding them would be a
confident lie, and there is no exchange rate anywhere in this product.

## Import a list of customers
<!-- permission: customers.create -->

**Import** reads a CSV of up to 5 MB and 500 rows at a time. It matches your
column headings itself where it can and you correct the rest.

Nothing is written until you have seen the preview. Every row goes through the
same checks the add-customer form uses, the preview names the rows that would
fail and why, and it flags rows carrying identification the agency already
holds. Document numbers are masked in the preview too.

A part-successful import is a real outcome: the rows that passed are added, and
the rest are listed so you can fix them and import again.

## Archive a customer
<!-- permission: customers.archive -->

**Archive customer** takes them out of the list and stops them being put on a
new contract. Every contract, payment and document already attached to them
stays exactly as it is, and **Include archived** in the toolbar finds them
again.

It is reversible from a banner on their own page.

## Delete a customer permanently
<!-- permission: customers.delete -->

Deleting is offered only when nothing financial refers to the person — no
contracts, no payments, and they are not named as a driver anywhere. The
profile lists what they are attached to, so you can see why the option is or is
not there.

When it is offered, it takes their identification records and every scan with
them, and it cannot be undone. Archiving is the answer for anybody with
history.

## If it goes wrong

**I cannot find a customer I know is there.** They may be archived — tick
**Include archived**. A document-number search needs at least four characters.
A licence or rental filter left on from earlier is the other common reason.

**The document number is rejected as already in use.** Another record in this
agency holds it. Numbers are compared as letters and digits only, so spacing
and case will not separate two copies of the same passport. Search for it to
find the record holding it.

**The duplicate warning is showing people who are not duplicates.** It is a
hint, not a judgement — it matches on an email, a phone number or a document
number, and shared contact details are ordinary. Nothing is merged.

**Delete is not offered.** Something financial refers to them. The references
panel on their page says what. Archive them instead.

**A scan will not open.** The link each view mints lasts only minutes. Open it
again from the document rather than reusing an address you copied earlier.

**The file was refused.** Scans are identified by their content, not their file
name, so a renamed file is refused on what it actually is. PDF, PNG, JPEG and
WebP are accepted, up to 10 MB.

**The outstanding figure shows a number of currencies rather than an amount.**
That customer has balances in more than one currency, and nothing in
{{productName}} converts between them.

## Where to go next

- [Rentals](/help/rentals) — putting a customer on a contract, and naming the
  people allowed to drive it.
- [Calendar](/help/calendar) — finding the hire a customer is on right now.
- [Reports](/help/reports) — repeat renters, and who owes what.
- [Help centre](/help) — every other page.

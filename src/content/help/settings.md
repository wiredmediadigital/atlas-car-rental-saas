---
title: Settings
group: Agency
summary: The agency's own details, its currency and time zone, its logo and the wording printed on its contracts.
permission: organization.view
---

> **In short** — everything on this page belongs to the agency, not to you,
> with one exception: the notification preferences are yours alone. Everyone
> can read these settings; changing them needs `organization.update`.

![The general section of Settings](/help/settings-01-general.jpg)

Settings is six unrelated forms rather than one long one, so it shows a section
at a time. A half-finished edit survives a look at another section, and the
rail marks any section still holding one.

## Record the agency's own details
<!-- permission: organization.update -->

**General** holds the trading name, the registered legal name where it differs,
the tax identifier, an email, a phone number, a website and the business
address.

These are not decoration. They appear across the workspace and at the head of
the contracts and receipts the agency issues, so a blank address line is a
blank address line on the paperwork a customer takes away.

## Set the currency, time zone and language
<!-- permission: organization.update -->

**Regional** decides three things, and each of them reaches further than it
looks:

- **Default currency** applies to records written from now on. Existing records
  keep the currency they were written in, and nothing in {{productName}}
  converts between currencies — so changing this does not restate history, it
  starts a second currency in the agency's books.
- **Time zone** is the agency's own idea of today. Collection and return times,
  the day the Calendar opens on, and the month boundaries every report uses all
  come from it.
- **Language** sets how numbers, dates and money are formatted.

These apply to the agency, not to your account.

## Upload the agency logo
<!-- permission: organization.update -->

**Branding** takes a PNG, JPEG or WebP of up to 2 MB. It appears in the
sidebar, on contracts and on receipts.

## Write the contract wording
<!-- permission: organization.update -->

**Contract terms** is where the agency's own paperwork is written. It holds the
tax rate and what the tax is called, five policies — fuel, mileage, late
return, damage and deposit — the full terms and conditions, and a one-line
footer.

Each policy prints as its own clause, in that order, and an empty one is left
out rather than printed blank. The terms and conditions print after them.

Two things to be clear about:

- **{{productName}} supplies no legal text.** The terms are written by the
  agency or its lawyer. There is no template here and no default wording.
- **Contracts already issued do not change.** A document is a snapshot of what
  was agreed when it was issued. New wording reaches the next contract, not the
  last one.

The tax rate is entered as a percentage and applied to contracts written from
then on.

## Choose what you are told about

**Notifications** lists the categories of reminder you can receive, and a
switch for each. Changes save as you make them.

This one is personal. Muting a category silences it for you, in this agency,
and changes nothing for a colleague. There is no agency-wide notification
policy and no way to edit somebody else's inbox.

There are no email, text-message or push switches here, because none of those
channels is delivered. A switch that turns on nothing is worse than an absent
feature: it makes somebody believe they will be told.

## Check which build you are running

**About** names the product, the version and who made it. It is the quickest
way to answer "which build is this" when something is being looked into.

## If it goes wrong

**Everything is greyed out.** You hold `organization.view` but not
`organization.update`. The values are shown to everyone, because knowing the
agency's currency and time zone matters to whoever is writing contracts.

**I changed the currency and the old figures look wrong.** They are not wrong.
Every existing record keeps the currency it was written in, and nothing is
converted. The agency now has two currencies in its books, and reports will
show figures for one at a time and say which.

**Times are an hour out.** Check the time zone here before anything else.
Collection and return times, and the agency's own idea of today, are all read
from it.

**The new terms are not on a contract I just printed.** The contract was issued
before the terms were saved. Reissue it and the new version carries the new
wording.

**A policy printed as an empty heading.** It will not — an empty policy is left
out of the document entirely.

**The logo was refused.** PNG, JPEG and WebP up to 2 MB.

**I cannot find the compliance warning window or the GPS freshness windows.**
They are agency settings, but there is no screen to change them in this build.
The panels that use them state the window they are using.

## Where to go next

- [Rentals](/help/rentals) — the contracts this wording is printed on.
- [Notifications](/help/notifications) — what each category actually sends.
- [Team](/help/team) — who can change any of this.
- [Help centre](/help) — every other page.

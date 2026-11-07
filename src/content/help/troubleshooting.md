---
title: Troubleshooting
group: Reference
summary: Invitations, sign-in, password resets, missing buttons, read-only agencies and tracking that has gone quiet.
---

> **In short** — most problems here are one of three things: a link that has
> expired, an account signed in under the wrong address, or an action your
> access does not include. Work down the matching section below before asking
> anybody.

This page is readable without signing in, which is deliberate: the two moments
you most need it — accepting an invitation and resetting a password — are the
two moments you cannot sign in.

## The invitation email has not arrived

Wait a few minutes, then check the spam folder. After that, the person who
invited you can look at the invitation list in the agency's Team page, which
shows what is known about the delivery.

The strongest thing that list will ever say is that the email provider accepted
the message. A provider accepting a message is not a colleague reading it, and
that gap is usually the whole problem.

If nothing was sent at all, or sending failed, whoever invited you is handed a
one-time link to pass on by hand. Ask them for it.

## The invitation link does not work

An invitation link is good for seven days. Four things stop one working:

- **It expired.** Ask for a new one.
- **It was already used.** The account that used it is already in the agency.
- **It was replaced.** Sending a new invitation stops the previous link
  working. Use the most recent email.
- **It was withdrawn.** That stops it immediately.

A fifth cause is not the link at all: the address was copied without everything
after the `#`. An invitation link carries its code there, and half an address
is not a valid invitation. Copy the whole thing, or open it straight from the
email.

If you are already signed in when you open it, check the address shown on the
screen. Joining with the wrong account is the commonest way an invitation gets
used up; sign in as the invited address first.

## I signed up from an invitation and cannot get in

Creating an account sends a confirmation link. Open it, then go back to the
invitation email and open **its** link again. The invitation email is the
durable copy, and the invitation is still waiting.

## I am signed in but there is no agency

You have an account but no membership yet. If you were invited, open the
invitation link from your email rather than creating an agency on that screen —
creating one starts a new agency of your own, which is not what you want if you
meant to join a colleague's.

## The password reset link does not work

Reset links last one hour and work once. Beyond that, the most common cause is
the least obvious: **open the link on the same device and in the same browser
you asked for it from.** Part of what completes the reset lives in that
browser, so a link requested on a laptop and opened on a phone cannot work.

Request a new one from the forgot-password screen and open it on the device you
requested it from.

The screen that asks for your email always says a link is on its way if an
account exists. It does not confirm whether one does, so a typo in the address
looks exactly like success.

## A page, a button or a whole section is missing

Almost always this is access rather than a fault.
[Who can do what](/help/who-can-do-what) lists every action in the product and
what it needs, and each module's help page labels its tasks the same way. Look
the action up there first.

A control your role cannot use is usually absent rather than greyed out, so
"the button is not there" and "I am not allowed" look identical on screen. That
reference page is what tells the two apart.

If you belong to more than one agency, check which one you are in. The switcher
is at the top of the sidebar, and access in one agency says nothing about
another.

To be given access, ask inside your own agency. An administrator or the owner
can change it immediately, and the change takes effect without anybody signing
out and back in. {{supportEmail}} cannot grant anybody access to anything — a
support address has no business being able to.

## Everything has gone read-only

The agency's subscription is not live. Everything recorded is still there and
can be opened, searched, printed and exported; nothing new can be written.
[Billing](/help/billing) explains the states and who can restart it.

This is not a role problem and no change of access fixes it.

## Tracking has stopped reporting

Look at the connection before you look at the vehicles. If synchronising is
failing — a rejected credential, an unreachable provider — then every position
on the page is as old as the last success and refreshing a single vehicle will
not help. [GPS tracking](/help/gps-tracking) has the full list.

Two things are working as intended and look like faults: nothing is collected
while the screen is closed, and a tracker whose link state the provider does
not report is shown as unknown rather than offline.

## A question about a payment or a deposit

**If you are a renter:** contact the rental business you hired from. They hold
your contract and your deposit. {{supportEmail}} is the address for the
software itself and cannot see your booking, change a charge, or return money.

**If you work at the agency:** the money questions are answered inside the
product. A deposit is held rather than earned and never reduces the balance; a
completed hire can quite correctly still read as unpaid; money is never
deleted, only voided. [Rentals](/help/rentals) covers all three.

**If it is about the agency's own subscription:** that is
[Billing](/help/billing), which needs `billing.manage`.

## Still stuck

Write to {{supportEmail}}. That address is for problems with {{productName}}
itself — something that is broken, something that is wrong, something the
documentation does not cover.

It is not the route to:

- **access or permissions** — ask an administrator or the owner of your own
  agency;
- **a deposit, a charge or a refund** — ask the agency you hired from;
- **your agency's subscription** — that is Billing, and it needs
  `billing.manage`.

When you do write, say which page you were on, what you expected and what
happened instead. Never send a password, an access token or a link from an
invitation or a reset email: those are keys, and anybody holding one can use
it.

## Where to go next

- [Accept your invitation](/help/accept-your-invitation) — the whole joining
  flow, start to finish.
- [Who can do what](/help/who-can-do-what) — the full access reference.
- [Help centre](/help) — every other page.

---
title: Team
group: Agency
summary: Invite colleagues, set what each of them can reach, and hand the agency on.
permission: team.view
---

> **In short** — everyone in the agency can see who else is in it. Changing who
> is in it, and what they can reach, is a smaller group's job, and handing the
> agency itself to somebody else is one person's. Each heading below says which.

![The team page, listing the people with access](/help/team-01-members.jpg)

Team has three parts. **Members** is the roster — everyone with access, what
each of them can reach, and when they joined. **Invitations** lists people who
have been asked to join but have not yet. **Recent activity** is the record of
what has changed.

The lower two are not shown to everyone, because both of them name people who
are not members of the agency — not yet, or not any more.

### How access works here

Access comes in four levels, from the front desk upwards. Nothing in
{{productName}} asks you to learn them by name: wherever you pick one, the
screen prints a line describing what that level actually covers in this
product, and that line is the thing to read.

Two points are worth knowing before you start:

- A level is granted for **this agency only**. It changes nothing else about
  somebody's account, and nothing in any other agency they belong to.
- A change takes effect immediately, everywhere. Nobody has to sign out and
  back in.

Each task below is labelled with who may do it, wherever that is narrower than
everybody. Those labels are read from the same table the database enforces, so
they cannot quietly go out of date.

## Invite somebody to the agency
<!-- permission: team.invite -->

**Invite member** asks for an email address and a level of access, and sends
them a link. The link is good for seven days. Until they use it, they appear
under Invitations rather than on the roster.

You can only grant a level at or below your own.

Two badges on the Invitations list mean different things and are easy to run
together. The one beside the address is the state of the invitation — waiting,
joined, expired, withdrawn. The badge underneath is what is known about the
email, and the strongest thing it will ever say is that the provider accepted
the message. A provider accepting a message is not a colleague reading it, and
the difference is usually why somebody is looking at this list.

Inviting somebody who is already in the agency does nothing and says so.

## Pass an invitation on by hand
<!-- permission: team.invite -->

If no email could carry the invitation — nothing is configured to send it, or
the provider refused — you are handed a one-time link in a dialog instead, for
you to pass on yourself. It appears straight after inviting somebody, and
**Send again** produces a fresh one later.

Treat that link as a key. Whoever opens it joins the agency at the level the
invitation names. It is shown once and nowhere else: not in an email, not in
the list, not afterwards. If you lose it, send again and pass on the new one.

**Send again** also works for an invitation that simply has not been acted on.
It issues a fresh link, which stops the previous one working and restarts the
seven days. There is a short pause between sends, and a ceiling on how many an
agency may issue in an hour.

**Withdraw** cancels an invitation and the link in that email stops working.

## Change what somebody can reach
<!-- permission: team.update -->

**Change role** is on the row's menu. The dialog describes each level as you
select it.

You cannot change your own, and you cannot act on somebody above you — on those
rows the action is simply not offered. For the person who owns the agency there
is nothing to change at all: moving that is a transfer, below.

The change applies immediately, everywhere.

## Remove somebody from the agency
<!-- permission: team.remove -->

**Remove from agency** ends their access to this agency straight away —
contracts, customers, vehicles, costs and reports.

It removes a membership, not a person and not their work:

- Everything they recorded stays exactly as it is, still attributed to them.
- Their account is not deleted, and any other agency they belong to is
  untouched.
- You can invite them back at any time.

## Leave an agency yourself

Your own row offers **Leave this agency**. You lose access immediately; your
account and your work stay as they are, and somebody would have to invite you
back.

An agency always has somebody who owns it, so if that is you, you cannot leave
until you have handed it on. The dialog says so rather than letting you try.

## Hand the agency on to somebody else
<!-- permission: team.transferOwnership -->

**Transfer ownership** is the only way an agency changes hands. It is not
something an invitation can grant, and it is not reachable from **Change role**.

Pick the person, and pick what you keep for yourself afterwards. Both changes
happen together, so the agency is never without somebody at the top.

Afterwards, only the new holder can transfer it again — including back to you.
Nothing else moves: no contract, cost or customer record is touched.

## Check what has changed
<!-- permission: team.history -->

**Recent activity** is one line per event: invitations sent, resent and
withdrawn, people joining, access changed, people removed or leaving, and the
agency changing hands. Each line names who did it, to whom, and when.

Taking a one-time link is recorded there too, because handing somebody a key is
an event in the agency's history and not a detail of how a screen was drawn.

## If it goes wrong

**The invitation email has not arrived.** Check the delivery badge on the
Invitations list first. If it says the provider accepted the message, the
invitation left this product and the next place to look is the recipient's spam
folder. If it says nothing was sent or that sending failed, use **Send again**
and pass the link on yourself.

**Send again is greyed out.** One was issued moments ago. The button says how
long until it is available.

**It says the agency has sent a lot of invitations recently.** There is an
hourly ceiling for the whole agency, not per person. Wait and try again.

**The link has stopped working.** Links last seven days, and sending again
replaces the previous one. Withdrawn invitations stop working immediately.
Issue a fresh one.

**That person is already a member.** The invitation is not created and the
dialog says so. They are on the roster; search it by name or address.

**The row has no menu, or the action I want is missing.** You can act on people
at or below your own level only, and never on yourself, apart from leaving. The
roster shows everyone regardless; what is missing is the action, not the person.

**I cannot leave the agency.** You are the one who owns it. Transfer ownership
first, choosing what you keep, and then leave.

**I removed somebody and their work has gone from my screen.** It has not. A
removal ends access and nothing else; every contract, customer and cost they
recorded is still there, still attributed to them. If a list looks shorter,
check its filters.

## Where to go next

- [Rentals](/help/rentals) — the actions the front desk uses every day, each
  labelled with who may do it.
- [Vehicles](/help/vehicles) — the same, for the fleet.
- [Help centre](/help) — every other page.

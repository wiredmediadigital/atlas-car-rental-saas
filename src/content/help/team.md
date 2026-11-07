---
title: Team
group: Agency
summary: Invite colleagues, set what each of them can reach, and hand the agency on.
permission: team.view
---

> **In short** — everyone in the agency can see who else is in it. Changing who
> is in it, and what each of them can reach, is an administrator's job, and
> handing the agency itself to somebody else is the owner's alone.

![The team page, listing the people with access](/help/team-01-members.jpg)

Team has three parts. **Members** is the roster — everyone with access, what
each of them can reach, and when they joined. **Invitations** lists people who
have been asked to join but have not yet. **Recent activity** is the record of
what has changed.

The lower two are not shown to everyone, because both of them name people who
are not members of the agency — not yet, or not any more.

## The four roles

Everyone in the agency holds exactly one of these, and it decides what they can
reach everywhere in {{productName}} — not just on this page.

{{roleTable}}

Each role includes everything the one below it can do. An administrator can do
anything a manager can, and more; the owner can do anything an administrator
can, plus hand the agency on.

Three things are worth knowing before you start:

- A role is held in **this agency only**. It changes nothing else about
  somebody's account, and nothing in any other agency they belong to.
- A change takes effect immediately, everywhere. Nobody has to sign out and
  back in.
- Nobody can give somebody a role above their own, and nobody can change their
  own.

Each task below is labelled with the role it needs, wherever that is more than
everybody has.

## Invite somebody to the agency
<!-- permission: team.invite -->

**Invite member** asks for an email address and a role, and sends them a link.
The link is good for seven days. Until they use it, they appear under
Invitations rather than on the roster.

You can only grant a role at or below your own, and the owner's role is not on
the list at all — an invitation cannot grant it.

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

Treat that link as a key. Whoever opens it joins the agency in the role the
invitation names. It is shown once and nowhere else: not in an email, not in
the list, not afterwards. If you lose it, send again and pass on the new one.

**Send again** also works for an invitation that simply has not been acted on.
It issues a fresh link, which stops the previous one working and restarts the
seven days. There is a short pause between sends, and a ceiling on how many an
agency may issue in an hour.

**Withdraw** cancels an invitation and the link in that email stops working.

## Change what somebody can reach
<!-- permission: team.update -->

**Change role** is on the row's menu. The dialog describes each role as you
select it, in the same words as the table above.

You cannot change your own role, and you cannot act on somebody above you — on
those rows the action is simply not offered. The owner's role is not on the
list at all, because it does not move this way: it moves by transfer, below.

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

An agency always has an owner, so if that is you, you cannot leave until you
have transferred ownership. The dialog says so rather than letting you try.

## Hand the agency on to somebody else
<!-- permission: team.transferOwnership -->

**Transfer ownership** is the only way an agency changes hands. It is not
something an invitation can grant, and it is not reachable from **Change role**.

Pick the person, and pick the role you keep for yourself afterwards. Both
changes happen together, so the agency is never without an owner.

Afterwards, only the new owner can transfer it again — including back to you.
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
at or below your own role only, and never on yourself, apart from leaving. The
roster shows everyone regardless; what is missing is the action, not the person.

**I cannot leave the agency.** You are the owner. Transfer ownership first,
choosing the role you keep, and then leave.

**I removed somebody and their work has gone from my screen.** It has not. A
removal ends access and nothing else; every contract, customer and cost they
recorded is still there, still attributed to them. If a list looks shorter,
check its filters.

## Where to go next

- [Who can do what](/help/who-can-do-what) — every action in the product and
  the role it needs.
- [Accept your invitation](/help/accept-your-invitation) — what the person at
  the other end of an invitation sees.
- [Settings](/help/settings) — the agency details and contract wording an
  administrator also owns.
- [Billing](/help/billing) — the subscription, which is the owner's alone.
- [Troubleshooting](/help/troubleshooting) — invitations that do not arrive and
  links that do not work.
- [Help centre](/help) — every other page.

---
title: Who can do what
group: Reference
summary: The four roles, and every action in the product with the role it needs.
---

> **In short** — everyone in an agency holds exactly one of four roles, and
> each role can do everything the one below it can. The product leaves out what
> your role cannot reach, so an action you cannot take is usually simply not
> there. This page is the list of what *is* there, which is how you find out
> who to ask.

### The four roles

{{roleTable}}

They stack. An administrator can do anything a manager can, and more; the owner
can do anything an administrator can, plus hand the agency on.

Three things follow from that, and all three surprise people:

- **A role is held in one agency only.** It says nothing about your account and
  nothing about any other agency you belong to.
- **A change takes effect immediately, everywhere.** Nobody signs out and back
  in.
- **Nobody can grant a role above their own, and nobody can change their own.**

Ownership is the exception to the whole scheme. It does not move by changing
somebody's role; it moves by transfer, which hands the agency over and sets the
previous owner's new role in the same action — so the agency is never without
an owner.

### How to read a permission

Every page in this help centre labels its sections with a permission rather
than a role, and every label on those pages is worked out from the table below.
A permission looks like `rentals.create`: the thing on the left is what is
being acted on, the thing on the right is what is being done to it.

`view` and `history` read. `create`, `update`, `delete`, `void`, `archive`,
`invite`, `manage` and the rest all write, and that difference decides which
permissions survive a lapsed subscription.

## Look up an action

This is the whole matrix, generated from the product's own definition of it.
Nothing here is typed by hand, so it cannot describe a rule the product no
longer has.

{{permissionMatrix}}

## Understand what the interface does with this

The table above is not what stops anything. Access is enforced on the server,
on every single request, and it would refuse an action it did not permit even
if every screen in {{productName}} offered it.

What the interface does with the matrix is narrower and worth knowing: it
avoids *offering* an action that is going to be refused. A hidden button is a
courtesy, not a control.

That is also why a missing menu item is usually the answer to "why can't I do
this?" — the row is still there, the record is still there, and only the action
is absent.

## Know when the rules change for everybody

An agency with no live subscription goes read-only, whatever anybody's role is.
Everything already recorded stays readable, searchable, printable and
exportable; nothing new can be written.

Five things stay available, because each one is a way out of that state and a
restriction nobody can undo from inside is a trap: managing billing,
correcting the agency's own details, changing somebody's access, removing
somebody, and transferring ownership. Inviting new people is not among them.

## If it goes wrong

**The action I want is not in the menu.** Find its permission in the table
above and compare it with your own role. The module's own help page labels each
task with the permission it needs.

**I can see the page but not the button.** That is the design. A page-level
permission answers "may I open this", which is a different question from "may I
do this particular thing". Most modules span several minimum roles.

**I cannot change my own role.** Nobody can. Ask somebody who holds a role at
or above the one you want.

**I cannot act on a colleague's row.** You can only act on people at or below
your own role. The roster shows everyone regardless; what is missing is the
action, not the person.

**Everything is read-only for everyone.** That is not a permission problem.
The agency has no live subscription.

**My role changed and the screen has not.** It should have, immediately.
Reload the page; if it still looks wrong, check which agency you are in — the
switcher is at the top of the sidebar, and a role in one agency says nothing
about another.

## Where to go next

- [Team](/help/team) — inviting people, changing access and transferring the
  agency.
- [Troubleshooting](/help/troubleshooting) — when the problem is not access.
- [Help centre](/help) — every other page.

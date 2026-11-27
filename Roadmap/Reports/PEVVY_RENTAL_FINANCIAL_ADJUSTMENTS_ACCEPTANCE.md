# Pevvy — Rental Financial Adjustments: manual acceptance

**Date prepared:** 2026-11-27
**Status:** **NOT ACCEPTED — awaiting the owner's pass**
**Environment:** hosted staging, `yeklucfthspvejlkffln`, signed in with a verified second
factor.

Consolidated numbering continues from the three closed acceptances. Scenarios 1–28 are
Maintenance Management, scenario 29 is Incident Management, and the nine Driver
availability scenarios are preserved separately. **This work package is scenarios 30–34.**

Nothing here is acceptance until the owner records a result. Local tests, a staging
migration and an HTTP 200 are none of them manual acceptance.

---

## Before you start

Sign in on hosted staging as a user who is an **owner or admin**, and have a second
sign-in available as a **staff** member of the same agency. Several steps turn on the
difference between the two, and the staff case is the one that was previously wrong.

You will need a rental you are willing to charge and correct. Scenario 30 creates one.

---

## Scenario 30 — A charge on a committed rental cannot be destroyed

The defect this work package was commissioned to close.

1. Create a rental, add a charge of your choosing (a cleaning or fuel line), and
   **confirm the reservation**.
2. Open the rental and go to the **Financials** tab.
3. Confirm there is **no delete control** on any charge line.
4. Confirm a **reverse** control is offered instead, on every line except the hire.
5. Create a second rental and leave it as a **draft**. On its Financials tab, confirm a
   charge **can** still be deleted outright, and that deleting it removes it.

**Expected:** deletion is available on a draft and nowhere else. Past confirmation the
only correction offered is a reversal.

---

## Scenario 31 — A correction leaves both numbers on the contract

1. On the confirmed rental from scenario 30, reverse a charge. Enter a reason.
2. Before confirming, check the dialog shows the amount charged, the mirrored amount and
   a net effect of zero.
3. Confirm it.
4. Check that the **original charge is still listed**, struck through, with the reversal
   beneath it carrying your reason and the time.
5. Check the rental total has moved by exactly the reversed amount, and that the
   **financial overview strip at the top** agrees with the totals at the bottom of the
   Financials tab.
6. Try to reverse the same charge again. Confirm it is not offered.
7. Try to reverse the **hire** line. Confirm it is not offered.

**Expected:** the contract reads as a history. Nothing is erased, the correction is
attributed and explained, and no charge can be reversed twice.

---

## Scenario 32 — A staff member cannot correct a charge

1. Sign in as the **staff** member.
2. Open the same confirmed rental, Financials tab.
3. Confirm **no reverse control is offered**, and that a sentence explains corrections are
   posted by a manager.
4. Confirm the staff member **can** still add an ordinary charge to the rental.

**Expected:** adding a charge and correcting one are different authorities, and the screen
says so before the staff member acts rather than failing afterwards.

---

## Scenario 33 — The financial overview tells the truth

1. On a rental with an outstanding balance, check **Outstanding** carries the amount and
   **Customer credit** reads zero.
2. Take a payment larger than the balance. Check **Outstanding** falls to zero and
   **Customer credit** carries the overpayment — *not* a negative outstanding figure.
3. Take a deposit. Check **Deposit held** carries it and the **Rental total does not
   change**.
4. As a user with expense permission, check **Agency costs** is shown separately and
   matches the Agency costs section lower down. As a staff member without it, check the
   figure is absent rather than zero.
5. Cross-check every figure on the strip against the Money and Charges sections below.

**Expected:** six figures, all agreeing with the sections that explain them, with the
deposit outside the total and the overpayment shown as credit.

---

## Scenario 34 — The four tabs, on four screens

Run this at **desktop**, **iPad portrait**, **iPad landscape** and **mobile**.

1. Confirm the tabs are **Overview, Financials, Inspections, Documents** — and that there
   is **no Activity tab**.
2. Confirm none of the four is empty: Overview carries the hire and the people,
   Financials the charges, money and agency costs, Inspections the hand-over readings and
   the condition photographs, Documents the contract versions.
3. Switch tabs and confirm the address bar changes. Reload, and confirm you land on the
   same tab.
4. On each screen size check: no horizontal scrolling of the page; the tab strip reachable
   (it scrolls sideways on a phone); the overview strip readable; the reversal dialog
   usable with its buttons reachable; the charge list legible; the primary rental actions
   (confirm, check out, record return, extend, cancel) reachable.
5. On the **Maintenance** page, confirm the downtime caption now reads *"Actual downtime is
   temporarily unavailable. Refresh the page or try again later."* when downtime cannot be
   read.

**Expected:** the same four tabs and the same figures on every screen size, with nothing
cut off and nothing requiring a sideways scroll of the page.

---

## Result

| Scenario | Result | Observations |
|---|---|---|
| 30 — Finalized charges cannot be destroyed | | |
| 31 — A correction leaves both numbers | | |
| 32 — Staff cannot correct a charge | | |
| 33 — The financial overview tells the truth | | |
| 34 — Four tabs on four screens | | |

**Not accepted until the table above is completed by the owner.**

---

## Known limitation, declared before acceptance

A confirmed reservation that is repriced **before any contract has been issued** leaves no
record of the previous hire amount. Where a contract exists the superseded version
preserves it; where none exists there is nothing to preserve it in. This is set out in
§4 of `PEVVY_RENTAL_FINANCIAL_ADJUSTMENTS_IMPLEMENTATION.md`, needs a further migration,
and is **not** covered by these scenarios. The acceptance requirement for preservation of
authorized amendment history should not be marked complete on the strength of this pass.

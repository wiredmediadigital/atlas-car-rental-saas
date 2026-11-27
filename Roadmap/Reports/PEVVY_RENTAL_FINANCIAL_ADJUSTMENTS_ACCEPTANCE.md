# Pevvy — Rental Financial Adjustments: manual acceptance

**Date prepared:** 2026-11-27
**Status:** **NOT ACCEPTED — awaiting the owner's pass**
**Environment:** hosted staging, `yeklucfthspvejlkffln`, signed in with a verified second
factor.

Consolidated numbering continues from the three closed acceptances. Scenarios 1–28 are
Maintenance Management, scenario 29 is Incident Management, and the nine Driver
availability scenarios are preserved separately. **This work package is scenarios 30–35.** Scenario 35 was added by the financial
amendment history remediation and requires its migration to be applied first.

Nothing here is acceptance until the owner records a result. Local tests, a staging
migration and an HTTP 200 are none of them manual acceptance.

---

## Consolidated acceptance register

| Area | Owner result | State |
|---|---|---|
| Maintenance Management | **28/28** scenarios (1–28) | ACCEPTED — CLOSED, frozen |
| Incident Management incl. dashboard | **Scenario 29 PASS**, 13/13 items | ACCEPTED — CLOSED, frozen |
| Driver availability / conflict prevention | **9/9** scenarios | Accepted and preserved |
| **Rental Financial Adjustments** | **Scenarios 30–35 — not yet run** | **NOT ACCEPTED** |

**Preserved, not superseded.** This pass adds to the three above and replaces none of
them. Their scope freezes stand and none was reopened by this work package. Driver
availability keeps its 9/9, and its independent concurrent-session evidence remains an
open release gate.

Functional acceptance of this package, when it comes, is **not** production deployment
authorization. Production remains NO-GO.

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

---

## Scenario 35 — Financial amendment history

**Requires migration `20261127100000_rental_pricing_amendment_history.sql` to be applied
to staging first.** Until the owner authorizes and applies it, the Hire amendments panel
will report that the history could not be read, and this scenario cannot be run.

This closes the limitation declared under scenarios 30–34: a confirmed reservation
repriced before any contract was issued used to lose its previous hire amount entirely.

### 35a — Repricing a reservation before any contract exists

1. Create a rental, add a base hire charge of a deliberately wrong amount (1 unit of
   currency will do), and **confirm the reservation**. Do **not** issue a contract.
2. Open the rental, Financials tab. Note the hire amount and the rental total.
3. Reprice the rental (the "The charge does not match this booking" banner offers the
   button, or use the reprice action).
4. In **Hire amendments**, confirm one record showing **Repriced**, the previous amount,
   the revised amount and the signed difference.
5. Confirm it does **not** say a contract version was in force.
6. Go to the **Documents** tab and confirm **no contract was issued** by the reprice.

**Expected:** the amount the hire used to be is still on the screen, and no document was
manufactured to keep it there.

### 35b — Issuing a contract after an amendment

1. On the same rental, issue a contract from the Documents tab.
2. Confirm the contract shows the **revised** hire, not the old one.
3. Return to Financials and confirm the amendment record from 35a is **unchanged**.

### 35c — Extending after a contract exists

1. Check the rental out so it is active.
2. Extend it, entering a reason in the description field (for example
   "Flight delayed by two days") and a charge for the extra days.
3. In **Hire amendments**, confirm a second record showing **Extended**, the previous and
   revised hire, the difference, **your reason**, and that **contract version 1 was in
   force**.
4. Confirm both records are listed, newest first — the reprice from 35a has not been
   displaced.

### 35d — The original contract is untouched

1. In Documents, open **contract version 1**.
2. Confirm it still states the hire as it was when issued, and that the extension did not
   alter it.
3. Issue a new contract version and confirm version 1 is marked superseded and **still
   readable**, with both versions listed.

### 35e — The figures still agree

1. Confirm the financial overview strip (rental total, payments received, outstanding,
   customer credit, deposit held) agrees with the Charges and Money sections.
2. Record a payment and confirm the balance moves as expected and the amendment history
   is unaffected — a payment is not an amendment.
3. Reverse a non-hire charge as a manager and confirm it appears in **Charges** as a
   reversal and **not** in Hire amendments. The two are different things: one corrects a
   charge, the other restates the hire.

### 35f — A rental nobody has amended

1. Open a rental that has never been repriced or extended.
2. Confirm Hire amendments says the hire has not been repriced or extended, rather than
   showing an empty table.

### 35g — Desktop, iPad and mobile

Repeat at **desktop**, **iPad portrait**, **iPad landscape** and **mobile**:

1. Confirm each amendment record is readable, with "Was", "Now" and "Difference" all
   visible without a sideways scroll of the page.
2. Confirm the amounts stay legible and are not truncated.
3. Confirm the panel sits inside the Financials tab and does not displace Charges, Money
   or Agency costs.

### Known limitation to confirm, not to fail on

Amendments made **before** this migration was applied were never recorded and cannot be
reconstructed. A rental repriced last week will show no history. That is accurate rather
than missing, and is not a defect to raise against this scenario.

---

## Result

| Scenario | Result | Observations |
|---|---|---|
| 30 — Finalized charges cannot be destroyed | | |
| 31 — A correction leaves both numbers | | |
| 32 — Staff cannot correct a charge | | |
| 33 — The financial overview tells the truth | | |
| 34 — Four tabs on four screens | | |
| 35 — Financial amendment history | | |

**Not accepted until the table above is completed by the owner.**

---

## Known limitation, declared before acceptance

**Remediated, pending migration application.** A confirmed reservation repriced before
any contract had been issued used to lose its previous hire amount. Migration
`20261127100000_rental_pricing_amendment_history.sql` closes this, and scenario 35 above
verifies it — but that migration is **not yet applied to staging** and needs the owner's
authorization. Until it is applied, scenario 35 cannot be run and the acceptance
requirement for preservation of authorized amendment history stays open.

Amendments made before the migration is applied were never recorded and are not
reconstructed; see §7 of `PEVVY_RENTAL_FINANCIAL_AMENDMENT_HISTORY_REMEDIATION.md`.

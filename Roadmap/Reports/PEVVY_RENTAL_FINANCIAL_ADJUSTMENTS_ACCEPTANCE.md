# Pevvy — Rental Financial Adjustments: manual acceptance

**Date prepared:** 2026-11-27
**Status:** **IMPLEMENTED AND DEPLOYED TO STAGING — OWNER ACCEPTANCE PENDING**
**Environment:** hosted staging, `yeklucfthspvejlkffln`, signed in with a verified second
factor. Migration `20261127100000` (SHA-256 `d0d9ca39…3890`) is **applied**, and the
frontend is deployed, so every scenario below is executable now.

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
| **Rental Financial Adjustments** | **Scenarios 30–35 — not yet run** | **DEPLOYED TO STAGING — ACCEPTANCE PENDING** |

**Preserved, not superseded.** This pass adds to the three above and replaces none of
them. Their scope freezes stand and none was reopened by this work package. Driver
availability keeps its 9/9, and its independent concurrent-session evidence remains an
open release gate.

Functional acceptance of this package, when it comes, is **not** production deployment
authorization. Production remains NO-GO.

---

---

## How to run this pass

### Where

Hosted staging: **https://quantum-lavenderblush-buffalo-97.hostingersite.com**
Supabase project **`yeklucfthspvejlkffln`**. Migration `20261127100000` is applied, so
every check below is live.

### Who you need

Two sign-ins in the **same agency**, because several checks turn on the difference and
the staff case is the one that was previously wrong.

| Role | Needed for | Why |
|---|---|---|
| **Owner or admin** | Scenarios 30, 31, 33, 34, 35 | Issues contracts, sees agency costs |
| **Staff** | Scenario 32, parts of 30 and 35 | Must be refused the manager-only reversal |

Every user needs a **verified second factor**. Pevvy enforces TOTP in the database; a
session without it reads nothing at all, which looks like an empty screen rather than an
error.

### Test data to prepare first

Create these before starting; several scenarios reuse them.

1. **A vehicle** with a known day rate. €50.00/day is assumed throughout; if yours
   differs, the expected figures below scale with it.
2. **A customer**, and a **second customer** (scenario 35h needs two).
3. **Rental A** — 3 days, confirmed reservation, **no contract issued**, carrying a
   deliberately wrong hire charge of €1.00. This is the scenario 30/35a subject.
4. **Rental B** — 3 days, left as a **draft**.
5. **Rental C** — 3 days, taken all the way to **completed** (confirm, check out, check
   in, complete), recording odometer and fuel at both ends.

### What the figures should come to

At €50.00/day over 3 days, with tax at 20%:

| | Expected |
|---|---|
| Hire after repricing | **€150.00** |
| Tax | **€30.00** |
| Rental total | **€180.00** |
| Amendment difference, from €1.00 | **+€149.00** |

### Which checks need what

| Check | Needs |
|---|---|
| All of scenarios 30–33, 35a–35f, 35h | An **authenticated browser** on staging |
| Scenario 34, and 35g | An authenticated browser **at four viewport sizes** |
| The four-width checks | Ideally a **physical iPad and phone**; browser device emulation is acceptable if you record which you used |

**No responsive check in this document has been verified visually by the implementer.**
Classes were confirmed present in the shipped CSS, which is not the same thing and is not
offered as acceptance. Scenario 34 and 35g are the first visual verification.

---

## Scenario 30 — A charge on a committed rental cannot be destroyed

**Role:** owner or admin. **Uses:** Rental A, Rental B.
**Navigate:** Rentals → open Rental A → **Financials** tab.

The defect this work package was commissioned to close.

1. On **Rental A** (confirmed reservation), add a charge — a cleaning line of €30.00
   will do — using *Add a charge* at the foot of the Charges card.
2. Stay on the **Financials** tab.
3. Confirm there is **no delete control** on any charge line.
4. Confirm a **reverse** control is offered instead, on every line except the hire.
5. Open **Rental B** (the draft). On its Financials tab, confirm a charge **can** still
   be deleted outright, and that deleting it removes it.

**Expected:** deletion is available on a draft and nowhere else. Past confirmation the
only correction offered is a reversal.

---

## Scenario 31 — A correction leaves both numbers on the contract

**Role:** owner, admin or manager. **Uses:** Rental A.
**Navigate:** Rentals → Rental A → Financials → the ↺ control on the cleaning line.

1. Reverse the €30.00 cleaning charge. Enter a reason, for example
   *"The valet was not carried out."*
2. Before confirming, check the dialog shows the amount charged, the mirrored amount and
   a net effect of zero.
3. Confirm it.
4. Check that the **original charge is still listed**, struck through, with the reversal
   beneath it carrying your reason and the time.
5. Check the rental total has fallen by exactly **€30.00** plus its tax, and that the
   **financial overview strip at the top** agrees with the totals at the foot of the
   Financials tab.
6. Try to reverse the same charge again. Confirm it is not offered.
7. Try to reverse the **hire** line. Confirm it is not offered.

**Expected:** the contract reads as a history. Nothing is erased, the correction is
attributed and explained, and no charge can be reversed twice.

---

## Scenario 32 — A staff member cannot correct a charge

**Role:** staff. **Uses:** Rental A.
**Navigate:** sign out, sign in as the staff member, Rentals → Rental A → Financials.

1. Sign in as the **staff** member.
2. Open Rental A, Financials tab.
3. Confirm **no reverse control is offered**, and that a sentence explains corrections are
   posted by a manager.
4. Confirm the staff member **can** still add an ordinary charge to the rental.

**Expected:** adding a charge and correcting one are different authorities, and the screen
says so before the staff member acts rather than failing afterwards.

---

## Scenario 33 — The financial overview tells the truth

**Role:** owner or admin (agency costs need `expenses.view`); repeat step 4 as staff.
**Uses:** Rental A. **Navigate:** Rentals → Rental A → the strip beneath the reference.

1. With Rental A repriced to **€180.00** total and nothing paid, check **Outstanding**
   reads €180.00 and **Customer credit** reads €0.00.
2. Record a payment of **€200.00** (Money section → *Record a payment*). Check
   **Outstanding** falls to €0.00 and **Customer credit** reads **€20.00** — *not* a
   negative outstanding figure.
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

**Role:** owner or admin. **Uses:** Rental A.
**Needs an authenticated browser at four widths.** A physical iPad and phone are
preferred; browser device emulation is acceptable — **record which you used**, because
the two are not equivalent evidence.

Suggested widths: desktop **1440×900**, iPad portrait **768×1024**, iPad landscape
**1024×768**, mobile **390×844**.

Run every step at each of the four.

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

**Requires migration `20261127100000_rental_pricing_amendment_history.sql` (SHA-256
`d0d9ca39…3890`) to be applied to staging first.** This closes the limitation declared under scenarios 30–34: a confirmed reservation
repriced before any contract was issued used to lose its previous hire amount entirely.

### 35a — Repricing a reservation before any contract exists

**Role:** owner, admin or manager. **Uses:** Rental A.
**Navigate:** Rentals → Rental A → Financials.

1. Rental A is a confirmed reservation carrying a hire of **€1.00** with **no contract
   issued**.
2. Note the hire amount and the rental total before you start.
3. Reprice it. The caution banner *"The charge does not match this booking"* offers
   **Reprice to €150.00**; use that button.
4. Scroll to **Hire amendments**, below Money. Confirm one record showing **Repriced**,
   **Was €1.00**, **Now €150.00** and **Difference +€149.00**.
5. Confirm it does **not** say a contract version was in force.
6. Go to the **Documents** tab and confirm **no contract was issued** by the reprice.

**Expected:** the amount the hire used to be is still on the screen, and no document was
manufactured to keep it there.

### 35b — Issuing a contract after an amendment

1. On the same rental, issue a contract from the Documents tab.
2. Confirm the contract shows the **revised** hire, not the old one.
3. Return to Financials and confirm the amendment record from 35a is **unchanged**.

### 35c — Extending after a contract exists

**Role:** owner, admin or manager. **Uses:** Rental A, now contracted.

1. Check Rental A out (Inspections tab → **Check out**, recording an odometer reading)
   so it becomes active.
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

**Needs an authenticated browser at four widths**, same widths as scenario 34, and the
same requirement to record whether you used a physical device or emulation.

Repeat at **desktop**, **iPad portrait**, **iPad landscape** and **mobile**:

1. Confirm each amendment record is readable, with "Was", "Now" and "Difference" all
   visible without a sideways scroll of the page.
2. Confirm the amounts stay legible and are not truncated.
3. Confirm the panel sits inside the Financials tab and does not displace Charges, Money
   or Agency costs.

### 35h — A finished rental cannot be rewritten by hand

**Role:** owner or admin. **Uses:** Rental C (completed), Rental B (draft), and a second
customer.

Added by the financial and lifecycle integrity closure. These checks need no special
tooling: they confirm from the interface that the protections are present, and the
database-level proof is in the automated suite.

1. Open a **completed** rental. Confirm the interface offers no way to change its
   collection or return dates, its day rate, its tax rate, its currency, its deposit or
   the customer it belongs to.
2. Confirm the hand-over readings — collection and return times, odometer out and in,
   fuel out and in — are shown as a record and not as editable fields.
3. Confirm **notes can still be added** to a completed rental. That is deliberate: the
   desk has to be able to annotate a finished hire.
4. On a **draft** rental, confirm the day rate, dates and deposit are all still editable.
   A draft is still being written.
5. On a **confirmed reservation**, confirm the authorized actions still work: reschedule
   it, substitute the vehicle before collection, and reprice it. Each should succeed.
6. Check a rental out and back in, and complete it. Confirm every step still works and
   the odometer and fuel readings are recorded.
7. Cancel a reservation and confirm it still settles.

**Expected:** the figures a committed rental is priced from, and the hand-over record of
a finished one, can be changed only through the actions that are meant to change them.

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

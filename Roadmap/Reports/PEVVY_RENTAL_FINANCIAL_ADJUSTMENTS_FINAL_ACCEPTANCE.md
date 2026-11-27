# Pevvy — Work Package 4: Rental Financial Adjustments, final acceptance

**Date:** 2026-11-27
**Status:** **FUNCTIONALLY ACCEPTED — CLOSED**
**Recorded by:** the owner, on hosted staging, signed in.

Functional acceptance is not production deployment authorization. **Production remains
NO-GO.**

---

## 1. Result

| Scenario | Owner result |
|---|---|
| 30 — A charge on a committed rental cannot be destroyed | **PASS** |
| 31 — A correction leaves both numbers on the contract | **PASS** |
| 32 — A staff member cannot correct a charge | **Functional role controls verified** — see §2 |
| 33 — The financial overview tells the truth | **PASS — 6/6** |
| 34 — The four tabs, on four screens | **Qualified PASS — 10/10 on tested viewports** |
| 35 — Financial amendment history | **PASS — 8/8** |

Work Package 4 is **FUNCTIONALLY ACCEPTED — CLOSED**.

**Roadmap functional completion: 4 of 10 work packages.**

---

## 2. Scenario 32 — the manager correction message, reconciled

The owner recorded the functional role controls as verified and asked for the manager
correction message evidence to be reconciled. It is reconciled here.

The message exists, and it is this sentence, shown in the Charges card when the rental is
past draft and the signed-in member may not post a reversal:

> Charges on a committed rental are corrected by posting a reversal, which a manager does.

Three independent pieces of evidence, none of them a claim about what the screen *ought*
to say:

1. **In the source.** `src/features/rentals/components/ChargesPanel.tsx` renders it under
   `isFinalized && !canReverse`.
2. **Covered by test.** `charges-panel.test.tsx` — *"withholds the reversal from staff who
   may not post one"* — asserts both that no reverse control is offered and that this
   sentence is present.
3. **Live in the deployed bundle.** The deployed-content verification for release
   `357961e` crawled 172 asset files and found the exact string
   `corrected by posting a reversal, which a manager does` among its 23 release-unique
   strings. It is one of the strings that proves the release is the one on staging.

The authority behind it is not the sentence. `rentals.reverse_charge` is a manager
permission in the interface, and the database refuses a staff reversal independently
through the `rental_line_items_insert` policy — verified on hosted staging, which returned
*"new row violates row-level security policy for table rental_line_items"*. The sentence
explains a refusal that would happen anyway.

---

## 3. Scenario 34 — what "qualified" covers

Ten of ten checks passed on the viewports that were tested. The qualification is **iPad
landscape**, which was not among them.

Deferred, and carried forward rather than closed:

- **iPad landscape verification** for the Rental Details tabs.
- **Final application-wide responsive certification**, which was already deferred under
  the roadmap completion strategy until the remaining work packages are done.

Neither is reopened by this acceptance and neither is satisfied by it.

---

## 4. What is accepted

The implementation described in
`PEVVY_RENTAL_FINANCIAL_ADJUSTMENTS_IMPLEMENTATION.md` and
`PEVVY_RENTAL_FINANCIAL_AMENDMENT_HISTORY_REMEDIATION.md`, deployed to staging at
`357961e` and verified by content:

- a posted charge on a committed rental cannot be deleted or edited, only reversed;
- reversals are manager-authorized, mirror the original, and leave both lines standing;
- the base hire is protected, with repricing and extension as the only authorized paths;
- cancellation settles by reversal rather than erasure;
- four Rental Details tabs with an authoritative financial overview;
- financial amendment history, independent of contract issuance;
- finalized pricing inputs and terminal hand-over records protected from direct writes.

Migrations `20261126130000` and `20261127100000` are applied to staging, both verified
statement-for-statement against their approved checksums.

---

## 5. The four closed acceptances

| Area | Owner result | State |
|---|---|---|
| Vehicle swap withdrawal (WP1) | Withdrawn and preserved | Accepted |
| Incident Management incl. dashboard (WP2) | Scenario 29 PASS, 13/13 | ACCEPTED — CLOSED, frozen |
| Maintenance Management (WP3) | 28/28 scenarios | ACCEPTED — CLOSED, frozen |
| **Rental Financial Adjustments (WP4)** | **Scenarios 30–35, as above** | **ACCEPTED — CLOSED** |
| Driver availability / conflict prevention | 9/9 scenarios | Accepted and preserved |

**Preserved, not superseded.** This acceptance adds to the others and replaces none. Their
scope freezes stand and none was reopened.

---

## 6. Qualifications carried forward

Acceptance does not discharge any of these. Each remains open on the production readiness
register:

- **iPad landscape** verification, and final application-wide responsive certification.
- **Amendment history begins at migration `20261127100000`.** Rentals repriced before it
  show an empty history. That is accurate rather than missing; nothing was reconstructed.
- **One-to-one amendment evidence** was corrected after this acceptance was recorded, in
  the production hardening work — the signature match that accepted an oscillating
  restatement is now a per-revision claim. See
  `PEVVY_PRODUCTION_HARDENING_IMPLEMENTATION.md`.
- **Rental lifecycle mutation** was likewise corrected after acceptance: a staff member
  could counterfeit a check-out by writing `status` and `picked_up_at` directly. The
  accepted functionality is unaffected; the correction removes a path around it.

Where the hardening work changed something this acceptance covers, it is recorded in that
report rather than silently folded in here.

---

## 7. Scope freeze

Work Package 4 is closed. Its functionality is not reopened unless a confirmed regression
or security defect requires correction — which is the basis on which the lifecycle and
amendment-evidence corrections were made.

**Do not begin Work Package 5 under this document.** Production remains NO-GO.

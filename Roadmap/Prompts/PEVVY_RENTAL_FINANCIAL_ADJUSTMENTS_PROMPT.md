# PEVVY — Rental Financial Adjustments

## Archive completeness, 2026-11-26

The scope confirmation requires this archive to hold **three** owner-provided
instructions. Two of them have not been supplied in this session and are
**requested, deliberately not reconstructed** — the confirmation is explicit that missing
text must be asked for rather than inferred, and a plausible reconstruction of a financial
brief is worse than an honest gap, because it would be indistinguishable from the real
thing once filed.

| # | Instruction | Status |
|---|---|---|
| 1 | **Work Package 4 — Rental Financial Adjustments** | **MISSING — requested from the owner** |
| 2 | Existing Functionality and UI Amendment | **Archived below, verbatim** |
| 3 | **Responsive Design and Cross-Device Acceptance Requirements** | **MISSING — requested from the owner** |
| — | Scope Confirmation (2026-11-26) | **Archived below, verbatim** |

The amendments take precedence over the original work package where they conflict.

What is known about the two missing documents, from the instructions that *are* held:

- Work Package 4 is the original implementation brief; the amendment states it "must be
  interpreted as an enhancement and verification assignment, not a new financial system
  implementation", and that its authorization boundaries, migration safeguards, staging
  deployment requirements and production exclusions remain in force.
- The responsive requirements are summarised by the scope confirmation §6: desktop, iPad
  portrait, iPad landscape and mobile usability are mandatory; the four approved Rental
  Details tabs and all existing financial and operational actions must remain accessible
  across supported viewport sizes; responsive implementation is not deferrable.

Those summaries are the basis on which the work proceeds. They are **not** substitutes for
the original texts, and this table should be completed when the owner supplies them.

## Archival note, 2026-11-26

The amendment below instructs that it be appended to "the archived Rental Financial
Adjustments implementation prompt". **No such standalone prompt exists.** It was searched
for in both the acceptance worktree and the primary checkout, under
`Roadmap/Prompts/`, `Roadmap/Reports/`, `Roadmap/Handoff/` and the repository at large;
there is no file archiving an original Rental Financial Adjustments implementation brief,
and no occurrence of the identifiers `P2-01` … `P2-08` anywhere in the worktree.

This file is therefore created as that archive, and the amendment is recorded as its first
entry rather than as an addition to something earlier. The provenance of the work package
is stated here so nobody later mistakes the gap for a deletion.

**Where the P2 scope actually comes from.** The eight identifiers are defined in
`Roadmap/Prompts/PEVVY_SIMPLIFIED_ROADMAP_AND_INCIDENT_MANAGEMENT_PROMPT.md` in the
primary checkout (untracked there, and not present in this worktree), lines 54–61, and are
summarised in `Roadmap/Reports/PEVVY_ROADMAP_GOVERNANCE_SETUP_REPORT.md` as "Phase 2
amendments and financial adjustments: P2-01 through P2-08":

- **P2-01** — Simplify rental amendments and contract linkage.
- **P2-02** — Reuse existing extensions and early returns.
- **P2-03** — Enhance late fees.
- **P2-04** — Use existing rental workflows for upgrades.
- **P2-05** — Enhance additional charges, discounts and credits.
- **P2-06** — Verify existing partial refunds.
- **P2-07** — Enhance tax adjustments only where required.
- **P2-08** — Retain rental financial statements.

Every one of those is phrased as *reuse*, *verify*, *retain* or *enhance only where
required* — which is consistent with the amendment's own instruction that this is an
enhancement and verification assignment rather than a new financial system.

The report answering this prompt is
`Roadmap/Reports/PEVVY_RENTAL_FINANCIAL_ADJUSTMENTS.md`.

---

# PEVVY — RENTAL FINANCIAL ADJUSTMENTS: EXISTING FUNCTIONALITY AND UI AMENDMENT

> Archived verbatim on 2026-11-26.

The owner has reviewed the existing Rental Details interface.

Pevvy already exposes substantial rental financial functionality. The previous implementation brief must be interpreted as an enhancement and verification assignment, not a new financial system implementation.

## 1. Existing functionality to preserve

The current Rental Details interface includes:

- The hire.
- People.
- Hand-over.
- Contract issuance and versioning.
- Itemized rental charges.
- Additional charge creation.
- Charge type categorization.
- Taxable and non-taxable charge treatment.
- Rental subtotal, tax and total.
- Payment recording.
- Outstanding balance.
- Overpayment detection.
- Refund action.
- Keep on account action.
- Payment voiding.
- Deposit agreed.
- Deposit held.
- Agency costs.

Inspect the underlying implementation of each capability before making changes.

Do not duplicate or replace functionality that already satisfies the approved requirements.

## 2. Financial architecture

Retain the existing Charges, Money and Agency costs architecture.

Do not introduce a parallel financial adjustment ledger, payment ledger, pricing engine, tax engine or customer credit system.

Use the existing charge-line architecture for additional charges, discounts and financial adjustments wherever technically appropriate.

Preserve existing refund, credit and payment workflows.

Verify their actual semantics, authorization and financial integrity.

## 3. Rental Details presentation enhancement

Improve the existing Rental Details page using the accepted Maintenance and Incident dashboard design patterns.

Introduce a compact financial overview below the rental reference and status indicators.

Display:

- Rental total.
- Payments received.
- Outstanding balance.
- Customer credit or overpayment.
- Deposit held.
- Agency costs.

All figures must come from the existing authoritative financial calculation mechanism.

Do not calculate independent financial totals in the presentation layer.

Organize the increasingly long Rental Details page into contextual tabs where supported by existing functionality:

- Overview.
- Financials.
- Inspections.
- Documents.
- Activity.

The Overview should retain the hire, people, vehicle and hand-over information.

The Financials tab should retain and enhance Charges, Money and Agency costs.

Reuse existing inspection, document and audit functionality for the other tabs.

Do not create empty tabs, new modules or new data models solely to satisfy the proposed layout.

Preserve existing checkout, return, extension, contract issuance and other authorized rental actions.

Ensure important operational actions remain readily accessible.

## 4. Charges enhancement

Retain the existing charge creation workflow.

Improve the presentation of charge lines so that operators can distinguish:

- Original rental charges.
- Additional rental charges.
- Extension charges.
- Discounts.
- Early return adjustments.
- Late return charges.
- Financial corrections and reversals.

Inspect the existing supported charge categories and extend only where required.

Preserve the existing tax-base mechanism and monetary calculation rules.

Investigate the existing delete action on original rental charge lines.

Determine whether it permits destructive financial changes after reservation, contract issuance, payment recording or rental completion.

Preserve draft editing where appropriate.

For financially finalized records, ensure corrections are authorized and auditable.

Do not assume that the existing delete action is unsafe without examining its backend implementation.

## 5. Money enhancement

Retain the existing Money section and its actions.

Improve visibility of:

- Rental total.
- Payments received.
- Still owed.
- Overpayment or customer credit.
- Recorded refunds where supported.
- Deposit agreed.
- Deposit held.
- Transaction history.

Preserve:

- Record payment.
- Refund.
- Keep on account.
- Void payment.

Do not implement duplicate versions of these actions.

Verify that recorded refunds and retained customer credits are represented correctly and are not counted twice.

Do not introduce external payment processing.

## 6. Agency costs

Preserve the existing Agency costs section and its association with the rental.

Agency costs must remain separate from customer charges and rental revenue.

Do not automatically convert maintenance expenses or incident costs into customer charges.

## 7. Contract preservation

Preserve the existing contract issuance and versioning architecture.

Issued documents are frozen.

Subsequent contractual changes must follow the existing versioning mechanism.

Do not silently regenerate historical issued contracts.

## 8. Implementation priority

Prioritize:

1. Existing financial architecture reconciliation.
2. Missing P2-01 through P2-08 functionality.
3. Financial integrity and authorization.
4. Financial overview and Rental Details organization.
5. Focused automated verification.
6. Staging deployment and owner acceptance.

Do not rebuild existing financial functionality.

If a requirement is already implemented correctly, record it as reused and verified.

Preserve all other authorization boundaries, migration safeguards, staging deployment requirements and production exclusions from the original implementation prompt.

Include the previously approved Maintenance downtime caption correction in the same deployment.

## 9. Documentation

Append this amendment to the archived Rental Financial Adjustments implementation prompt.

In the final report, distinguish:

- Existing functionality retained.
- Existing functionality verified.
- Existing functionality corrected.
- Newly implemented functionality.
- Presentation enhancements.
- Deferred functionality.

Continue manual acceptance numbering from scenario 30.

Production remains NO-GO.

---

# PEVVY — RENTAL FINANCIAL ADJUSTMENTS: SCOPE CONFIRMATION

> Archived verbatim on 2026-11-26. Takes precedence over the work package where applicable.

The initial repository findings are accepted.

## 1. Authoritative roadmap

Retain the recovered P2-01 through P2-08 definitions exactly as originally recorded.

The original roadmap is authoritative. The implementation brief and subsequent amendments provide implementation guidance and must not unnecessarily expand the approved business scope.

## 2. Rental Details tabs

Approve the following four tabs:

- Overview.
- Financials.
- Inspections.
- Documents.

Defer the Activity tab if the repository survey confirms there is no existing rental-specific activity functionality.

Do not create a new activity table, event store or audit subsystem solely to populate a tab.

Preserve the financial auditability requirements using existing mechanisms or minimal necessary extensions.

## 3. Documents and inspections

Reuse the existing rental-documents storage architecture and associated records.

Organize condition photographs and existing inspection information under Inspections.

Organize contracts, signatures and issued document versions under Documents.

Do not duplicate stored files, change storage paths or introduce additional storage buckets solely for presentation purposes.

Preserve existing storage permissions and tenant isolation.

## 4. Financial architecture

Retain and enhance the existing Charges, Money and Agency costs architecture.

Do not introduce a parallel adjustment ledger, payment ledger, pricing engine or tax engine.

Prioritize verifying existing functionality and correcting demonstrated deficiencies.

Preserve the existing rental amendment, extension, early return, contract versioning and refund workflows wherever they already satisfy the requirements.

## 5. Prompt archive correction

Ensure the archived implementation prompt contains all three owner-provided instructions:

1. Work Package 4 — Rental Financial Adjustments.
2. Existing Functionality and UI Amendment.
3. Responsive Design and Cross-Device Acceptance Requirements.

The amendments take precedence where applicable.

If the original instructions are unavailable in the coding session, request the missing text rather than reconstructing it from assumptions.

Preserve the recorded provenance of the recovered P2 roadmap definitions.

## 6. Responsive implementation

Desktop, iPad portrait, iPad landscape and mobile usability are mandatory.

The four approved Rental Details tabs and all existing financial and operational actions must remain accessible across supported viewport sizes.

Do not defer responsive implementation to another work package.

## 7. Execution

Complete the ongoing repository survey.

Proceed directly into implementation once the existing architecture is understood.

Do not stop for another planning approval unless a material financial, contractual, taxation, security or migration decision requires owner authorization.

Preserve the existing staging deployment safeguards and pending Maintenance downtime caption correction.

Complete implementation, focused verification, responsive testing, documentation and staging deployment within the current authorized execution wherever possible.

Production remains NO-GO.

---

# PEVVY — FINANCIAL RECORD INTEGRITY AND CANCELLATION AUTHORIZATION

> Archived verbatim on 2026-11-26. Authorizes correction of the destructive deletion
> defect within Work Package 4. Migration creation and LOCAL testing only; applying it to
> hosted staging requires separate owner authorization.

## 1. Owner decision

The reported destructive deletion vulnerability in `public.rental_line_items` is accepted as a material financial integrity defect.

Authorize its correction within Work Package 4 — Rental Financial Adjustments.

A frontend-only restriction is an interim mitigation and does not satisfy final acceptance.

## 2. Financial finalization boundary

Permit direct charge editing and deletion only for authorized draft rentals that have no issued contract or recorded financial commitments.

Treat reservation, contract issuance, payment recording, checkout, completion and cancellation as financial finalization boundaries.

Once any applicable finalization boundary has been reached, posted charge lines must be protected against destructive deletion and unauthorized modification.

Enforce this at the database level.

Do not rely exclusively on frontend status checks.

Inspect existing INSERT, UPDATE and DELETE permissions, policies, triggers and RPCs. Protect against equivalent bypasses through direct updates to monetary amounts, tax treatment, rental associations or adjustment metadata.

## 3. Approved reversal architecture

Use the existing `rental_line_items` architecture for financial corrections and reversals.

Do not introduce a parallel financial ledger.

A reversal must:

- Reference the original charge reliably.
- Belong to the same rental and organization.
- Preserve the original charge.
- Reverse the appropriate monetary and tax treatment.
- Record an authenticated operator.
- Record the reason and timestamp.
- Prevent duplicate reversal.
- Prevent unauthorized modification or deletion.
- Produce the correct recalculated rental balance.
- Preserve existing issued contract documents.

Use existing metadata and relationships where sufficient.

If they are insufficient, introduce only the minimum necessary schema extensions and constraints.

Do not describe reversal lines as fully auditable unless these protections are actually enforced.

## 4. Rental cancellation compatibility

Preserve the existing cancellation workflow and its approved business rules.

Inspect:

- `app.settle_cancelled_rental`
- `public.rental_cancel`
- Existing cancellation fee calculations.
- Existing discount handling.
- Existing payments and refund entitlement.
- Related recalculation triggers.
- Existing contract versioning.
- Rental availability and driver commitment release.

Prefer replacing destructive post-finalization cancellation settlement operations with auditable charge corrections and reversals.

Preserve the existing cancellation pricing outcome.

Do not invent a new cancellation policy.

Cancellation settlement must be atomic and safe against retries.

If settlement fails, do not leave partially committed financial adjustments or inconsistent rental lifecycle state.

Do not use client-settable session flags as authorization boundaries.

Do not expose a broadly callable SECURITY DEFINER settlement helper.

If a privileged internal function is genuinely necessary, restrict its execution permissions, validate tenant membership and role authorization, enforce billing entitlement requirements, validate rental state, use a safe search path and prevent direct unauthorized invocation.

Document the chosen security boundary.

## 5. Authorization

Reuse the existing role and permission architecture.

Determine which existing permissions govern:

- Draft charge editing.
- Additional charges.
- Discounts.
- Financial reversals.
- Cancellation settlement.
- Payment recording.
- Refund recording.
- Payment voiding.

Do not introduce a new role system.

Do not automatically grant reversal authority to every staff member merely because the existing DELETE policy permits staff deletion.

Use established financial correction permissions where available.

If no suitable authorization distinction exists, report the specific owner decision required.

## 6. Financial consistency

Verify that charge corrections preserve consistency across:

- Rental line items.
- Rental subtotal.
- Tax calculation.
- Rental total.
- Payment records.
- Outstanding balance.
- Overpayment and refund entitlement.
- Customer credit.
- Rental financial statements.
- Existing financial exports.
- Issued contract versions.

An adjustment may legitimately change a current balance without modifying a historical issued contract.

Make that distinction clear to operators.

Do not silently regenerate historical contracts.

## 7. Existing records

Preserve all existing rental financial records.

Do not perform retrospective financial corrections or manufacture historical audit information.

Ensure existing rentals remain readable and operational after the migration.

Document any limitations affecting legacy records.

## 8. Migration authorization

Authorize creation and local testing of the minimum database migration required for these protections.

This authorization does not authorize applying the migration to the hosted staging database.

Complete implementation and local verification first.

Then provide:

- Exact migration filename.
- Migration purpose.
- Existing policies and functions affected.
- Security boundary changes.
- Compatibility and rollback considerations.
- Local automated test results.
- Current staging migration ledger.
- Exact staging application commands from the correct isolated worktree.

Wait for owner authorization before applying the hosted migration.

Do not deploy a frontend that depends on an unapplied migration.

Production access and deployment remain prohibited.

## 9. Required regression and security tests

Add focused tests covering:

- Authorized draft charge deletion.
- Rejection of deletion after reservation.
- Rejection of deletion after contract issuance.
- Rejection of deletion after payment recording.
- Rejection of deletion during active rental.
- Rejection of deletion after completion.
- Rejection of deletion after cancellation.
- Direct API and database authorization bypass attempts.
- Unauthorized modification of finalized charge lines.
- Authorized reversal creation.
- Duplicate reversal rejection.
- Cross-tenant reversal rejection.
- Incorrect rental association rejection.
- Reversal tax treatment.
- Recalculation of rental totals and balances.
- Cancellation of unpaid rentals.
- Cancellation of paid rentals.
- Cancellation of rentals with issued contracts.
- Cancellation with existing discounts.
- Cancellation fee calculation.
- Cancellation retry and duplicate settlement prevention.
- Cancellation failure without partial financial changes.
- Preservation of issued contracts.
- Preservation of existing vehicle and driver release behaviour.
- Unauthorized invocation of any privileged settlement helper.

Preserve existing accepted workflows.

The test that demonstrates the current destructive DELETE vulnerability must become a regression test proving the corrected behaviour. Do not retain an unsafe behaviour as an expected passing security contract.

## 10. UI requirements

Hide destructive charge deletion actions once a financial finalization boundary is reached.

Provide an authorized reversal or correction action where appropriate.

Show the original charge, reversal status, reason and financial impact.

Require confirmation before posting a reversal.

Preserve desktop, iPad and mobile usability.

## 11. Activity tab

Confirm that the Activity tab is deferred.

The approved Rental Details tabs are:

- Overview.
- Financials.
- Inspections.
- Documents.

Do not create a general rental activity subsystem.

Financial correction auditability remains mandatory.

## 12. Execution

Proceed with the current implementation.

Do not initiate a separate financial integrity work package.

Include this authorization in the archived Rental Financial Adjustments prompt.

Include the previously approved Maintenance downtime caption correction in the eventual authorized staging deployment.

Preserve all existing production readiness gates.

Production remains NO-GO.

---

# PEVVY — RENTAL FINANCIAL ADJUSTMENTS: MIGRATION AUTHORIZATION AND IMPLEMENTATION COMPLETION

*Owner authorization, received 2026-11-27. Archived verbatim.*

## 1. Migration authorization

The final migration dossier is accepted.

Authorize staging application of:

20261126130000_rental_charge_integrity.sql

Approved SHA-256:

ee503f7790b09692c8546a6435c5acd5ff0231400087fb6f801725637a574f5e

Authorized staging project:

yeklucfthspvejlkffln

Authorized isolated worktree:

E:\pevvy-maintenance-acceptance-20261125

The owner will perform the hosted migration application and provide the terminal output.

Do not independently apply the hosted migration or access production.

## 2. Pre-application safeguards

The migration must remain identical to the approved checksum.

The expected migration ledger is 141 remote and 142 local before application.

The dry run must identify exactly one pending migration.

If any discrepancy exists, stop and report it.

After application, verify 142 local and 142 remote migrations with zero drift.

## 3. Post-migration verification

Following owner confirmation of successful application, verify the hosted staging schema and security boundaries.

Confirm:

- Rental charge integrity trigger exists and is enabled.
- Guard function uses SECURITY INVOKER.
- Privileged RPCs have the intended execution semantics.
- Anonymous execution is prohibited.
- Internal privileged helpers are not exposed to unauthorized callers.
- Tenant, role and billing authorization checks remain enforced.
- Reversal constraints and unique index exist.
- Direct finalized charge modification and deletion are rejected.
- Authorized rental extension and repricing remain functional.
- Cancellation settlement remains functional.
- Existing rentals and financial records remain readable.

Use controlled staging QA records for any mutation tests.

Do not modify unrelated tenant records.

## 4. Financial history verification

Confirm how the existing rental amendment and contract versioning architecture preserves the previous base hire amount when an authorized extension or repricing operation updates the base hire line.

Distinguish protection against unauthorized mutation from preservation of authorized financial amendment history.

Do not introduce a parallel ledger.

If the existing mechanism is insufficient, document the precise deficiency and minimum correction required before declaring the relevant acceptance requirement complete.

## 5. Complete frontend implementation

Proceed with the remaining approved Rental Financial Adjustments implementation.

Implement the four approved Rental Details tabs:

- Overview.
- Financials.
- Inspections.
- Documents.

Preserve existing operational functionality.

Implement the authoritative financial overview using existing financial calculations and database values.

Retain and enhance:

- Charges.
- Money.
- Agency costs.
- Existing contract versions.
- Existing inspection and condition photographs.

Implement the manager-authorized reversal interface.

Remove destructive finalized charge actions.

Ensure permission errors and failed financial mutations are clearly communicated.

Do not create an Activity tab.

Do not introduce duplicate financial systems.

## 6. Responsive implementation

Complete desktop, iPad portrait, iPad landscape and mobile support.

Verify responsive layouts, financial forms, navigation, dialogs, transaction records and primary rental actions.

Use the previously approved responsive acceptance requirements.

Capture representative screenshots.

Distinguish browser emulation from physical-device verification.

## 7. Permanent architecture decisions

Record the following findings in the architecture decisions and applicable development guidance.

### Effective database function definitions

Future migrations redefining existing functions must use their effective definitions after all preceding migrations have been applied.

Do not reconstruct functions solely from older migration files.

Specifically document the function-rewriting behaviour introduced by migration 20261120100000.

### Privileged financial mutation boundaries

Any owner-owned SECURITY DEFINER function capable of modifying rental charge lines is part of the trusted financial mutation boundary.

Future privileged functions must undergo explicit tenant, role, billing, execution-grant and financial integrity review.

Preserve the existing permission-matrix and billing definer regression tests.

### Responsive design

Desktop, tablet and mobile usability remain mandatory for all subsequent Pevvy work packages.

## 8. Regression verification

Complete focused database and frontend regression testing.

Preserve the 59 new financial security tests.

Document the four existing database baseline failures without misrepresenting them as new failures or resolved issues.

Verify existing accepted rental, driver, incident and maintenance workflows remain unaffected.

Include the previously approved Maintenance downtime caption correction.

## 9. Staging deployment

After hosted migration verification and frontend testing:

- Verify the correct staging branch and worktree.
- Run the guarded staging build.
- Preserve the existing Hostinger deployment configuration.
- Publish through the authorized staging branch using normal fast-forward operations.
- Verify actual deployed frontend assets.
- Verify the deployed frontend uses the staging Supabase project.
- Confirm the new Rental Details interface and reversal functionality are present.

Do not deploy against an unapplied migration.

Do not modify origin/main.

Do not deploy to production.

## 10. Documentation and acceptance

Update the existing roadmap, feature tracker, architecture decisions, changelog, production release manifest, production checklist and consolidated acceptance register.

Archive this authorization in:

E:\pevvy-car-rental-saas-main\Roadmap\Prompts\PEVVY_RENTAL_FINANCIAL_ADJUSTMENTS_PROMPT.md

Complete the implementation report:

E:\pevvy-car-rental-saas-main\Roadmap\Reports\PEVVY_RENTAL_FINANCIAL_ADJUSTMENTS_IMPLEMENTATION.md

Complete the manual acceptance instructions:

E:\pevvy-car-rental-saas-main\Roadmap\Reports\PEVVY_RENTAL_FINANCIAL_ADJUSTMENTS_ACCEPTANCE.md

Continue consolidated manual acceptance numbering from Scenario 30.

Do not mark the work package functionally accepted before owner verification.

## 11. Execution

Complete the remaining implementation, verification, staging deployment and documentation within the current work package.

Do not initiate another general architecture review or request approval for already authorized implementation decisions.

Escalate only genuine material blockers.

Production remains NO-GO.

---

## Execution note, 2026-11-27

Two departures from the text above are recorded rather than hidden.

**Section 2, the ledger.** The expected pre-application state was 141 remote / 142 local.
Staging already reported **142 / 142** when the check ran, so the migration had been
applied before this session looked. It was not applied from here. Because a ledger row
proves only that a row exists, the applied statements were compared against the approved
file and found character-identical once the CLI's stripped statement separators are
accounted for. The discrepancy is reported in section 2.1 of the implementation report.

**Section 10, the document paths.** The three paths name the primary checkout
`E:\pevvy-car-rental-saas-main`, where `Roadmap/` is untracked. On the acceptance branch
`Roadmap/` is **tracked**, and the Maintenance and Incident closure reports already live
there. The documents were therefore written to the worktree copies, so that they travel
with the branch and the staging deployment rather than sitting outside version control.

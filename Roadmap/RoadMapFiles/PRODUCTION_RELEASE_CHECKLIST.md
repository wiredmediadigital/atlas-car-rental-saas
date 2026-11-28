# Production Release Checklist

## Simplified roadmap release boundary (2026-11-24)

- Assignment architecture, active vehicle swap, sequential assignment rollout, and assignment-dependent future work are withdrawn. Preserve historical data; no cleanup migration is authorized by this decision.
- Incident Management P3-01 through P3-04 is an isolated release candidate only. Verify focused tests, typecheck, build, staging migration, tenant isolation, and authenticated UI behavior before production consideration.
- No production deployment, billing/Stripe/Data API change, destructive cleanup, or remote merge is authorized by the roadmap simplification.

Reusable template. Create a release-specific copy or report for each deployment; do not overwrite historical evidence.

## Release identity

- Release ID: Pending
- Feature IDs: Pending
- Git commit: Pending
- Environment: Pending
- Feature flag state: Pending
- Deployment report: Pending

## Pre-Release

- [ ] Feature scope approved
- [ ] Implementation completed
- [ ] Code review completed
- [ ] Automated tests passed
- [ ] Database migrations reviewed
- [ ] Tenant isolation verified
- [ ] Rental lifecycle regression tests passed
- [ ] Payment regression tests passed
- [ ] Staging verification completed
- [ ] Production backup or recovery point confirmed
- [ ] Rollback or forward-recovery plan documented
- [ ] Deployment explicitly approved

## Deployment

- [ ] Correct Git commit identified
- [ ] Required migrations applied safely
- [ ] Application deployment completed
- [ ] Feature flag state confirmed
- [ ] Deployment logs reviewed

## Post-Deployment

- [ ] Production smoke tests passed
- [ ] Existing rental workflows verified
- [ ] Payment workflows verified
- [ ] Tenant isolation checks passed
- [ ] Monitoring reviewed
- [ ] Feature enabled for intended users
- [ ] Production verification completed
- [ ] Feature tracker updated
- [ ] Release history updated
- [ ] Deployment report saved

Critical failures block release or trigger the documented recovery process.

Phase 1B-02 staging validation is complete for the authorized staging-only scope, but this reusable production checklist remains unapproved and unchecked for production release.

## Standard vehicle assignment staging note — 2026-11-24

- Staging-only migration `20261124100000_standard_vehicle_swap_release` is applied and recorded.
- The release defaults missing organization activation rows to enabled while `app.assignment_lifecycle_enabled` is `on`; explicit organization disables and the emergency global control remain available.
- Authenticated staging checkout/swap/check-in acceptance is pending owner-session verification.
- Production deployment and production verification remain unchecked and unauthorized.
- Evidence: `Reports/PEVVY_STANDARD_VEHICLE_SWAP_RELEASE.md`.

## Active vehicle swap withdrawal — 2026-11-24

- Phase 1B-03 Active Vehicle Swap: **WITHDRAWN — SUPERSEDED BY EXISTING STANDARD RENTAL WORKFLOW**.
- Staging application RPC grants were revoked; the historical function and assignment data remain preserved.
- The active swapped QA rental requires actual final return information before the global lifecycle control can safely be disabled without stranding custody state.
- Production remains unchanged and this withdrawal is not a production deployment authorization.
- Evidence: `Reports/PEVVY_PHASE_1B03_WITHDRAWAL.md`.

## Maintenance Management — production promotion checklist (2026-11-26)

Staging is deployed and verified. These remain before production can be considered.

- [x] **Owner manual acceptance — COMPLETE (2026-11-26).** 28 scenarios, 28 passed,
      0 failed, 0 pending, no owner observations. Scenario 19 (preventive servicing) and
      scenario 28 (Maintenance Management dashboard) were the last two confirmed. The
      11/11/4 interim baseline is superseded. Maintenance Management is **FUNCTIONALLY
      ACCEPTED — CLOSED**. Evidence:
      `Reports/PEVVY_MAINTENANCE_MANAGEMENT_FINAL_ACCEPTANCE.md`.
      **This closes the acceptance gate only. Every unchecked item below still stands, and
      functional acceptance is not production deployment authorization.**
- [ ] Decision: assignment activation defaults ON, contradicting the STG-02 contract.
      Either revert the default or amend the contract.
- [ ] Decision: should the eleven incident and maintenance `SECURITY DEFINER` write RPCs
      ask `app.billing_require_write`? Policy proposal recorded in
      `PEVVY_MAINTENANCE_REMEDIATION_RELEASE_CLOSURE.md` §4.
- [ ] Port `withdraw-active-swap.test.ts` so something asserts the vehicle swap stays
      withdrawn. Nothing on this branch does.
- [ ] Update the two stale pre-withdrawal swap contract tests. They fail on an error
      string, not on a security regression, and must not be reported as one.
- [ ] Make the deployment artifact hash reproducible — pin the builder toolchain or
      publish the reviewed artifact instead of rebuilding. The expected-SHA control
      cannot currently pass; see the deployment report §5.
- [ ] Independent concurrency verification against hosted Postgres. PGlite cannot provide
      two genuinely independent transactions.
- [ ] Decide on the six undeployed Edge Functions. Hosted public booking, account closure,
      MFA reset and team invitations cannot be accepted until they are deployed, and that
      needs its own owner approval.
- [ ] Production migration plan and rollback. `20261125130000` is additive — it drops and
      renames nothing — but there is **no down migration**; reverting needs a new forward one.
- [ ] Hostinger deployment-to-commit attribution for the production target.

## Functional acceptance — closed (2026-11-26)

- [x] **Maintenance Management: 28/28 scenarios.** FUNCTIONALLY ACCEPTED — CLOSED.
- [x] **Incident Management, including its dashboard: scenario 29 PASS, 13/13
      verification items, no observations.** FUNCTIONALLY ACCEPTED — CLOSED.
- [x] **Driver availability / conflict prevention: 9/9 scenarios.** Accepted and
      preserved. Independent concurrent-session evidence is still a release gate and is
      listed below, unchanged.

**These three boxes close the ACCEPTANCE gate and nothing else.** Functional acceptance is
not production deployment authorization. Every unchecked item elsewhere in this file still
stands, including:

- [ ] Six of nine Edge Functions are not deployed to staging.
- [ ] The deployment artifact hash is not reproducible by the deploying party.
- [ ] Independent concurrency verification against hosted Postgres.
- [ ] The STG-02 assignment-activation default decision.
- [ ] Whether eleven incident and maintenance `SECURITY DEFINER` write RPCs should call
      `app.billing_require_write`.
- [ ] No down migration exists; reverting requires a new forward one.
- [ ] Hostinger deployment-to-commit attribution for the production target.

**Production remains NO-GO.**

---

## Work Package 4 — Rental Financial Adjustments (added 2026-11-27)

- [ ] **Rental Financial Adjustments: scenarios 30–34 not yet run.** The acceptance gate
      that was closed for Maintenance and Incident Management is **open again** for this
      package. Script: `Reports/PEVVY_RENTAL_FINANCIAL_ADJUSTMENTS_ACCEPTANCE.md`.
- [ ] **Amendment history is not preserved for a reservation repriced before any contract
      is issued.** Where a contract exists the superseded version preserves the previous
      hire; where none exists nothing does. Needs a further migration and its own
      authorization. The acceptance requirement covering preservation of authorized
      amendment history must **not** be marked complete until then.
- [ ] **Residual privileged exposure.** `app.rental_is_finalized` and
      `app.rental_charges_purge_exempt` are SECURITY DEFINER and executable by
      `authenticated`, because the integrity guard runs as the caller. Both are read-only
      boolean oracles over a rental id. Accepted and recorded, not resolved.
- [ ] **Ownership grants the trigger exemption.** Any future owner-owned SECURITY DEFINER
      function able to write `rental_line_items` inherits the guard's exemption whether or
      not its author considered it. Each such function needs explicit tenant, role,
      billing, grant and integrity review.
- [ ] **No down migration for `20261126130000`.** It is additive, but reverting requires a
      new forward migration that decides what to do with reversal lines already posted.

Migration `20261126130000_rental_charge_integrity.sql` is applied to **staging only**
(142 local / 142 remote, zero drift). It is **not** applied to production, and production
has not been accessed.

**Production remains NO-GO.**

---

## Financial amendment history remediation (added 2026-11-27)

- [ ] **Hosted application of `20261127100000_rental_pricing_amendment_history.sql` is
      not authorized.** Ledger 143 local / 142 remote. The Hire amendments panel will
      report that it could not read the history until the migration is applied.
- [ ] **Scenario 35 cannot be run** until that migration is applied.
- [ ] **Concurrent amendments are not proven against hosted Postgres.** The database
      tests run on PGlite, which is a single connection. What is proven is that each
      amendment shares a transaction with its pricing change and that both pricing
      functions lock the rental row first. This sits alongside the existing
      driver-availability concurrency gate.
- [ ] **`rental_substitute_vehicle` and `rental_reschedule` carry the reverted
      pre-`20261120100000` session-GUC wording.** Pre-existing; the in-place rewrite has
      already been undone for those two.
- [ ] **Pricing inputs on `rentals` have no state protection.** `rentals_update` has no
      state test and the freeze trigger does not cover `starts_at`, `ends_at`,
      `billable_days` or `daily_rate_minor`, so a direct PATCH can change them on a
      completed rental. The charge lines are protected; the booking they describe is not.
- [ ] **No down migration** for `20261127100000`. Reverting needs a new forward one that
      decides what to do with amendment rows already recorded.
- [ ] Amendment history **begins at this migration**. Earlier amendments were never
      recorded and are not reconstructed.

**Production remains NO-GO.**

---

## Financial and lifecycle integrity closure (added 2026-11-27)

- [ ] **Hosted application of `20261127100000` remains unauthorized.** Checksum is now
      `d0d9ca39…3890` (was `27b8f62d…7308`); the earlier value is superseded.
- [ ] **Concurrency is still proven sequentially, not concurrently.** PGlite is a single
      connection. What is proven: each amendment shares a transaction with its pricing
      change, both pricing functions take the rental row `for update`, and
      `pg_current_xact_id()` cannot be shared across transactions. Genuine concurrent
      execution against hosted Postgres remains a gate, beside driver availability.
- [ ] **One residual gap inside the evidence check.** A single transaction that moved the
      hire 100 → 200 → 100 → 200 and recorded only the first change would have its third
      mutation matched by the first amendment's signature. Requires the caller to already
      be inside an owner-owned SECURITY DEFINER function. Recorded, not fixed.
- [ ] **`service_role` still bypasses row-level security entirely**, as it always has.
      Pre-existing and architectural.
- [ ] **A future owner-owned SECURITY DEFINER function inherits the trigger exemptions**
      on both `rental_line_items` and `rentals` by construction, and must be reviewed
      explicitly.
- [ ] **No down migration** for `20261127100000`. Reverting requires a new forward
      migration that drops the constraint trigger before the table.

**Production remains NO-GO.**

---

## Work Package 4 staging deployment (added 2026-11-27)

- [x] **Migration `20261127100000` applied to staging and verified** — 143/143, zero
      drift, applied statements identical to the approved file.
- [x] **Frontend deployed and verified by content** — not by hash or HTTP status.
- [ ] **Scenarios 30–35 not run.** The acceptance gate for Work Package 4 is open.
- [ ] **No responsive verification has been performed visually.** Classes confirmed in
      the shipped bundle; that proves they were built, not that the layout is right.
      Scenarios 34 and 35g are the first visual check and ask whether a physical device
      or emulation was used.
- [ ] **One-to-one financial amendment evidence — OPEN.** The evidence check matches a
      mutation's signature, not a unique claim. A transaction moving the hire
      100 → 200 → 100 → 200 while recording only the first change would have its third
      mutation matched by the first amendment. Requires owner-owned SECURITY DEFINER
      access to reach. **Not resolved.**
- [ ] **Rental lifecycle mutation boundaries — OPEN.** `status`, `picked_up_at`,
      `returned_at` and `original_ends_at` are deliberately not frozen, because the RPCs
      that write them are SECURITY INVOKER. Between confirmation and completion the
      hand-over timestamps are directly writable. Verify before production that a direct
      write cannot counterfeit a check-out or a return.
- [ ] **Privileged mutation boundaries** — `service_role`, owner-owned SECURITY DEFINER
      functions and direct administrative access remain reviewable surfaces, unchanged.
- [ ] **Amendment history begins at this migration.** Earlier amendments were never
      recorded and are not reconstructed.

**Production remains NO-GO.**

---

## Production hardening (added 2026-11-27)

- [x] **Direct rental lifecycle mutation** — corrected by `20261128100000`, not applied.
- [x] **Checkout and return timestamp protection** — same migration.
- [x] **Billing entitlement for privileged RPCs** — corrected by `20261128110000`, with
      four registered safety exemptions, not applied.
- [x] **One-to-one financial amendment evidence** — corrected by `20261128120000`, not
      applied.
- [x] **Maintenance expense association integrity** — corrected by `20261128130000`, not
      applied.
- [x] **Independent PostgreSQL concurrency verification** — ten scenarios against real
      PostgreSQL. Gate closed.
- [x] **The four database baseline failures** — all four resolved.
- [x] **Lint errors** — three resolved, zero remain. Fourteen warnings justified.
- [x] **STG-02 assignment activation** — default-off restored by `20261128140000`, with
      drainage so no vehicle is stranded. Not applied.
- [x] **Edge Function hosted inventory** — reconciled read-only.
- [ ] **Hosted application of the five migrations is not authorized.** Ledger 148 local /
      143 remote.
- [ ] **`20261128140000` writes business rows.** It releases open assignments on rentals
      that are already completed or cancelled. Capture the preflight query's full row set
      before applying if the prior per-row state matters: `released` is terminal and the
      migration does not record what each row was.
- [ ] **Existing inconsistent maintenance-expense links are reported, not repaired.**
      `app.maintenance_expense_anomalies` lists them; correcting them needs owner
      approval.
- [ ] **Five Edge Functions remain undeployed on staging**: `account-closure`,
      `account-closure-notice`, `gps-provider`, `mfa-reset`, `public-booking`. The public
      booking page does not work on staging until the last of those is deployed.
- [ ] **`RentalNewPage` and `IncidentNewPage` have no automated coverage.** The lint
      corrections there are verified by typecheck, lint and build only.
- [ ] **`incident_update` cannot distinguish safety documentation from administrative
      tidying.** Accepted and registered with that reason.
- [ ] **iPad landscape** verification and final application-wide responsive
      certification remain deferred.
- [ ] **`service_role` bypasses row-level security**, and owner-owned SECURITY DEFINER
      functions inherit the trigger exemptions. Pre-existing and recorded.

**Production remains NO-GO.**

---

## Final hardening corrections (added 2026-11-27)

- [x] **Duplicate rental check-in** — corrected in `20261128100000`. A return is recorded
      once; an identical retry mutates nothing. Eight tests.
- [x] **Amendment revision interaction** — investigated across every case the owner listed.
      **No defect**; the suspected unique-index collision is unreachable. Two of my own tests
      were wrong and are corrected.
- [x] **Deterministic evidence enforcement** — two tests reach the mechanism on one
      connection, one for missing evidence and one for evidence that is unique but untrue.
      The deadlock-based concurrency coverage is preserved alongside.
- [x] **`incident_update` limitation** — all six owner conditions verified behaviourally.
- [x] **Maintenance expense editing** — the read model, the error mapping and the detail
      screen now show the attachment. Nine new database tests where there were none.
- [x] **Hosted read-only preflight** — performed. Nothing written.
- [x] **Dry run** — clean: five migrations, no seeds, no roles, exit 0.
- [x] **WP5–WP10 definitions** — preserved in full in `MASTER_ROADMAP.md`.
- [ ] **The guarded staging build has NOT been re-run.** It needs
      `VITE_SUPABASE_PUBLISHABLE_KEY` for `yeklucfthspvejlkffln` (format `sb_publishable_…`).
      A credential fetch was denied and was not worked around. **The standing artifact
      `be240a5b…` is stale** — the corrections above changed six frontend sources.
- [ ] **Hosted application of the five migrations is still not authorized.** 148 local /
      143 remote.
- [ ] **A mis-keyed return reading has no route to correction.** Owner decision.
- [ ] **Applying `20261128140000` stops every agency on staging opening new assignments**,
      because no organization holds an explicit activation row. Intended; not a no-op.
- [ ] **`RentalNewPage` and `IncidentNewPage` still have no render-level coverage.** The
      defaulting rule they share is now extracted and tested; the pages are not.

**Production remains NO-GO.**

---

## Final build and migration authorization (added 2026-11-28)

- [x] **Fresh guarded staging build** — exit 0, commit `a1728a9`, project
      `yeklucfthspvejlkffln`, **200 files**, SHA-256
      `e0261061734798d077423da9c2b4a200ec7eb672767e00294d20ae8998b7d352`.
      The stale `be240a5b…` artifact was **not** reused.
- [x] **Artifact production-reference scan** — zero.
- [x] **Artifact secret-exposure scan** — zero. The bare `sb_secret_` string in two bundles
      is Pevvy's own guard code, not a credential; verified occurrence by occurrence.
- [x] **Preflight re-read immediately before authorization.**
- [x] **Dry run re-run** — five migrations, no seeds, no roles, exit 0.
- [x] **Return correction limitation registered** as a WP9 candidate requirement.
- [ ] **AWAITING OWNER AUTHORIZATION to apply the five migrations.** Nothing applied.
- [ ] **Baseline moved during this execution**: amendment records on `RNT-2026-00004` went
      from 2 to 3, and payments from 8 to 9, through continued acceptance activity. Harmless
      — the history still agrees with the live hire — but the amendment count will keep
      moving while acceptance continues. **Drainage must stay 0 and anomalies must stay 0.**
- [ ] `origin/staging` unchanged at `5634555`; nothing pushed, nothing deployed.

**Operational limitation, carried forward:** a mis-keyed return reading on a committed
rental has **no route to correction**. Candidate requirement under **WP9 — Rental
Exceptions**: Manager-authorized, auditable correction of incorrectly entered return
information. A candidate, not a commitment.

**Production remains NO-GO.**

# PEVVY — Claude Code Onboarding and Development Baseline Verification

Date: 2026-11-25
Executed by: Claude Code (onboarding only)
Scope: read-only verification. No application code was modified, no migration was applied or repaired, nothing was deployed, production was not accessed, no credential value was read or printed.

## Executive result

The Codex handoff's two principal uncertainties are **resolved**.

1. Git authentication works. `SEC_E_NO_CREDENTIALS` does not reproduce. Live remote references were read.
2. The four questioned maintenance-era migrations exist in source **and** are applied to staging. Source and ledger reconcile **1:1 with zero drift** against the maintenance worktree.

A verified development baseline exists and is independently proven healthy: commit `977e32e`, which is simultaneously `origin/staging` HEAD and the clean maintenance worktree.

---

## 1. Handoff documentation reviewed

| Document | Read |
|---|---|
| `CLAUDE.md` (primary checkout, including the 2026-11-25 handoff section) | Yes |
| `Roadmap/Handoff/PEVVY_PROJECT_HANDOFF.md` | Yes |
| `Roadmap/Handoff/CURRENT_DEVELOPMENT_STATE.md` | Yes |
| `Roadmap/Handoff/KNOWN_ISSUES_AND_ACCEPTANCE.md` | Yes |
| `Roadmap/Handoff/NEXT_IMPLEMENTATION_TASK.md` | Yes |
| `Roadmap/Handoff/WORKTREE_AND_BRANCH_INVENTORY.md` | Yes |
| `Roadmap/Handoff/ENVIRONMENT_AND_DEPLOYMENT.md` | Yes |
| `Roadmap/Handoff/DATABASE_MIGRATION_STATE.md` | Yes |
| `Roadmap/Reports/PEVVY_CODEX_TO_CLAUDE_HANDOFF_REPORT.md` | Yes |
| `Roadmap/Reports/PEVVY_MAINTENANCE_MANAGEMENT_DEPLOYMENT_CLOSURE.md` | Yes |
| `Roadmap/Reports/PEVVY_MAINTENANCE_FLEET_STATUS_INTEGRATION_CORRECTION.md` | Yes |
| `Roadmap/Prompts/PEVVY — CONSOLIDATED MAINTENANCE MA.txt` (provisional source, 44,564 bytes) | Yes |

Approved product decisions are understood and will be preserved: one vehicle per rental agreement; no reactivation of active vehicle swapping; renter and driver as separate roles; incident and maintenance lifecycles independent in both directions; maintenance-derived effective vehicle restrictions with no general manual maintenance-status dropdown.

## 2. Git authentication status

**RESOLVED — authenticated read access confirmed.**

`git ls-remote --heads origin` with `GIT_TERMINAL_PROMPT=0` returned refs without prompting. `git fetch --dry-run --all` also succeeded. The Codex-reported `SEC_E_NO_CREDENTIALS` failure does not reproduce in this environment. **No owner action is required for Git.**

Remotes are correctly configured and the original upstream remains push-disabled:

- `origin` — `https://github.com/wiredmediadigital/atlas-car-rental-saas` (fetch and push)
- `upstream` — `https://github.com/salhiworks/atlas-car-rental-saas.git` (fetch), push URL set to `DISABLED--never-push-to-original-atlas`

## 3. Verified remote references

Live values read from the remote on 2026-11-25:

| Reference | Verified value | Previously recorded | Assessment |
|---|---|---|---|
| `origin/main` | `31383a97eb8e000f9189913b255af4da22bf3a26` | `31383a9` | Current and correct |
| `origin/staging` | `977e32eb3447af2ec886cb512e8a9f06212b4259` | `112cc994` | **Handoff value was stale.** Live staging equals the "last reported maintenance staging commit" |
| Local `main` HEAD | `fbbfe3878826da5ee858d3a9a2280f15f0fd744f` | `fbbfe38` | Correct |

The remote carries exactly two branches: `main` and `staging`.

Ancestry (verified with `git merge-base --is-ancestor`):

- `origin/main` is an ancestor of `origin/staging`; staging is **19 commits ahead**, linear, no divergence.
- Local `main` (`fbbfe38`) is **1 unpushed commit** ahead of `origin/main` — `fix: ensure failure-safe Phase 1B-03 staging cleanup`. Preserved, not pushed.
- The local `staging` branch checked out at `E:\pevvy-staging-release` (`01edc3c`) is an **ancestor** of `origin/staging` — it is 18 commits stale and must not be used as a baseline.

The maintenance lineage on `origin/staging`, newest first:

- `977e32e` feat: integrate maintenance with fleet status
- `ac78cf1` feat: link vehicle details to maintenance
- `47f8a13` fix: complete maintenance validation surfaces
- `7b7e034` feat: add maintenance management work package
- `112cc99` chore migrations restore staging ledger history
- `27ed729` fix rentals driver availability conflicts
- `a302525` fix: improve incident vehicle and rental context
- `83892f2` fix: remove discontinued vehicle swap UI
- `f2b7b34` fix: validate incident release candidate
- `385f93c` feat: add tenant-safe incident management

This confirms that driver availability, incident management, vehicle-swap withdrawal and all four maintenance commits are **already contained in `origin/staging`**. The reports' push claims through `ac78cf1` and `977e32e` are corroborated by the live remote.

### Worktree inventory (all 13 preserved, none modified)

The inventory in `WORKTREE_AND_BRANCH_INVENTORY.md` is accurate and was re-verified with `git worktree list`. Of note:

- `E:\pevvy-maintenance-20261125` — branch `feat/maintenance-management-20261125`, commit `977e32e`, **working tree completely clean (0 modified, 0 untracked)**, tracking `origin/staging`.
- `E:\pevvy-car-rental-saas-main` — `main / fbbfe38`, intentionally dirty: 18 modified tracked files plus roughly 40 untracked paths including 9 migrations, `Roadmap/`, and 11 investigation directories. **Preserved untouched.**

## 4. Recommended development baseline

**Commit `977e32eb3447af2ec886cb512e8a9f06212b4259`** (`origin/staging` HEAD).

Justification — this is the only candidate that satisfies every criterion:

| Criterion | Evidence |
|---|---|
| Clean working tree | `git status --porcelain` returns 0 lines |
| Equals live remote staging | `origin/staging` = `977e32e` exactly |
| Contains all accepted functionality | Driver availability, incident management, swap withdrawal, all 4 maintenance commits in ancestry |
| Source matches the staging database exactly | 139 local migrations against 139 applied; zero drift in both directions |
| Compiles | `npm run typecheck` (`tsc -b --noEmit`) — **PASS, exit 0** |
| Passes regression | 4 files / **85 tests PASS** (maintenance, driver-availability, incident-management, rentals) — independently reproduced, matching the closure report's claim |
| Dependencies installed | `node_modules` present in the worktree |

The dirty primary `main` checkout is explicitly **not** a safe base: it is 19 commits behind staging on the feature lineage, mixes untracked billing work, and lacks all maintenance source.

## 5. Recommended working directory

Create a new isolated worktree for remediation; do not implement inside the investigation worktree.

- Path: `E:\pevvy-maintenance-acceptance-20261125`
- Base commit: `977e32eb3447af2ec886cb512e8a9f06212b4259`
- Branch: `fix/maintenance-manual-acceptance-20261125`

Keep `E:\pevvy-maintenance-20261125` as an unmodified read-only reference. Preserve the dirty primary checkout and all 13 existing worktrees. Do not merge historical branches wholesale; cherry-pick only reviewed commits after verifying interfaces and migrations.

**Documentation accessibility gap — requires an explicit decision before the worktree is created.** The handoff documentation is *not* reachable from any worktree based on `origin/staging`:

| Asset | Primary checkout | Staging lineage (`977e32e`) |
|---|---|---|
| `Roadmap/Handoff/` (7 documents) | Present, **untracked** | **Absent** |
| `Roadmap/Prompts/` | Present, **untracked** | **Absent** |
| `Roadmap/Reports/` | Present, untracked | Present, older content |
| `CLAUDE.md` with the 2026-11-25 handoff section | Present, modified | **Absent** (older revision) |

`Roadmap/` is tracked in the staging lineage but untracked in `main`, so the newer handoff material exists **only** as uncommitted files in the primary checkout. Recommended resolution, pending owner approval: commit the handoff documentation and the updated `CLAUDE.md` as a documentation-only change onto the staging lineage, so every future worktree inherits the governing instructions. Until that is approved, the handoff documents must be read from `E:\pevvy-car-rental-saas-main\Roadmap\Handoff\`.

## 6. Supabase CLI authentication status

**AUTHENTICATED — read-only verification only.**

- `supabase` is **not** on PATH; `npx supabase --version` returns **2.114.0**. Use the `npx` form.
- `npx supabase projects list` succeeded, confirming a valid access token.
- Staging `yeklucfthspvejlkffln` (`Pevvy-Staging`, us-east-2, ACTIVE_HEALTHY, PostgreSQL 17.12) — **`linked: true`**.
- Production `ysnumxtzcgzyabrghxwq` (`Pevvy`, us-east-1) — **`linked: false`, not accessed, not queried, not modified.**
- `supabase/.temp/project-ref` = `yeklucfthspvejlkffln`, matching the authorized staging project and `.env.local`. The CLAUDE.md pre-command project check passes.
- `.env.local` contains the names `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_TOTP_ENABLED_FOR`. No value was read or printed.

## 7. Verified staging migration ledger

`npx supabase migration list --linked` (read-only) against `yeklucfthspvejlkffln`:

- **139 migrations applied** on staging.
- **139 migration files** in the recommended baseline.
- **Applied on staging but missing from baseline source: none.**
- **In baseline source but not applied on staging: none.**

The four migrations the handoff flagged as unverified are **all present in source and all applied to staging**:

| Migration | Source | Staging ledger |
|---|---|---|
| `20261124130000_incident_management.sql` | Present (196 lines) | **APPLIED** |
| `20261125100000_driver_availability_conflicts.sql` | Present (238 lines) | **APPLIED** |
| `20261125110000_maintenance_management.sql` | Present (282 lines) | **APPLIED** |
| `20261125120000_maintenance_fleet_status_integration.sql` | Present (98 lines) | **APPLIED** |

Also applied and present: `20261124100000_standard_vehicle_swap_release`, `20261124110000_vehicle_swap_runtime_feedback`, `20261124120000_withdraw_active_vehicle_swap` (the withdrawal migration is correctly applied — the withdrawn feature must not be revived), `20261120220000_rental_lifecycle_billing_authorization`, `20261120230000_pricing_catalogue_service_rpc`.

No migration was applied, repaired, or dry-run. The ledger was only read.

## 8. Source and migration discrepancies

1. **`20261122100000_billing_platform_state_service_rpc.sql` — local only, never applied to staging.** It exists untracked in the primary checkout and in `E:\pevvy-billing-remediation`, but is absent from the staging source lineage and absent from the staging ledger. This is **billing lineage, out of scope**; it must not be carried into maintenance remediation. It is also the sole reason the primary checkout's ledger comparison shows a local-only row.
2. **Primary checkout holds 9 untracked migrations.** Eight are already committed in the staging lineage; only the billing one above is genuinely unique. The primary checkout's apparent "inventory ends at `20261122100000`" is an artefact of it being 19 commits behind, not evidence of missing work.
3. **Stale reference in the handoff.** `ENVIRONMENT_AND_DEPLOYMENT.md` records `origin/staging=112cc994`; the live value and the repository's own tracking ref are both `977e32eb`. `112cc994` is the base of the maintenance branch, not its tip.
4. **Superseded commit in the closure report.** `PEVVY_MAINTENANCE_MANAGEMENT_DEPLOYMENT_CLOSURE.md` names `ac78cf1` as the final source commit; it was superseded by `977e32e` (fleet-status integration) and the later correction report records this.
5. **Edge function deployment gap on staging.** Only **3 of 9** local functions are deployed: `billing` (v4), `billing-webhook` (v1), `pricing` (v4), all ACTIVE. Not deployed to staging: `account-closure`, `account-closure-notice`, `gps-provider`, `mfa-reset`, `public-booking`, `team-invitations`. Per CLAUDE.md an undeployed function fails at runtime as "could not reach the server". This does not block maintenance remediation (maintenance is RPC/RLS-based) but it is a staging-parity gap that will distort any staging acceptance touching account closure, MFA reset, team invitations or public booking.
6. **Date inconsistency.** `PEVVY_MAINTENANCE_FLEET_STATUS_INTEGRATION_CORRECTION.md` is dated 2026-11-26 while describing work handed off on 2026-11-25. Content is consistent with `977e32e`; the header date appears incorrect.

## 9. Outstanding Maintenance Management defects

Owner manual acceptance: **26 scenarios — 11 passed, 11 failed, 4 pending. Production NO-GO.**

**Failed (11):** future scheduled availability; overlapping reservation prevention; immediate restriction after early start; overdue checkout restriction; incident-to-maintenance creation and prepopulation; related maintenance on Incident Details; incident-resolution lifecycle independence; preventive servicing interface; downtime presentation; supporting documents; **standard rental regression**.

**Pending (4):** legacy restriction resolution; incident resolution warning; maintenance completion independence; expense integration.

**Additional UI defects:** Vehicle Details still exposes an Operational status dropdown; Edit Vehicle still exposes the legacy Status dropdown; Maintenance Details shows a generic "View incident" link; Incident Details lacks related maintenance records. Reproduction references: `MNT-2026-00009`, `INC-2026-00002`, `DEMO-004`, plus `DEMO-001`, `DEMO-003`, `DEMO-019` in the fleet-status checklist.

Standard rental regression is the highest-severity item — it indicates accepted rental lifecycle behaviour was disturbed by the maintenance work package and should be remediated first.

The recorded **105 automated passes** and the 85 tests reproduced in this session are automated validation only. **They do not constitute manual acceptance** and will not be presented as such.

## 10. Previously accepted functionality (preserve)

- **Driver availability — owner accepted 9/9.** Preserve. Independent concurrent-session evidence remains an open release gate.
- **Incident Management — previously accepted.** Preserve. Maintenance-integration corrections remain outstanding (items in section 9).
- **Vehicle swapping — withdrawn.** Do not reactivate. The withdrawal migration is applied on staging; the UI removal commit is in the baseline.
- **SaaS subscription billing — preserve the working implementation.** Do not reopen billing remediation. Billing work has its own isolated lineage (`E:\pevvy-billing-remediation`) and must not be mixed into maintenance remediation.
- Rental payments, deposits, cancellation, repricing and the customer ledger are preserved; **Rental Financial Adjustments is not started** and must wait for maintenance acceptance or an explicit owner re-prioritisation.

## 11. Production restrictions

- Production Supabase `ysnumxtzcgzyabrghxwq` was **not accessed**. It is not linked to the CLI.
- Production frontend `https://pevvy.io` was not touched.
- Maintenance Management is **production NO-GO**.
- No production change will be made without explicit owner authorization and a completed release checklist.
- Local tests, a staging migration, a staging push and HTTP 200 will never be represented as authenticated manual acceptance or production approval.
- No force push; no history rewrite; never push to the original upstream repository.
- Independent concurrency verification remains **BLOCKED** — PGlite cannot provide two independent live hosted transactions. This stays a production gate.

## 12. Missing implementation prompt

**Confirmed missing:** `Roadmap/Prompts/PEVVY_MAINTENANCE_MANUAL_ACCEPTANCE_REMEDIATION_PROMPT.md` does not exist.

The closest available source is `Roadmap/Prompts/PEVVY — CONSOLIDATED MAINTENANCE MA.txt` (44,564 bytes). It is a **provisional** source: it predates the owner's 26-scenario manual acceptance results and therefore does not enumerate the 11 failures and 4 pending items. Implementation will not begin from the abbreviated handoff summary or from this `.txt` alone. The owner will supply the complete prompt after onboarding.

## 13. Remaining blockers

| # | Blocker | Owner action required |
|---|---|---|
| 1 | Consolidated maintenance remediation prompt missing | **Yes** — supply the owner-approved Markdown prompt, or authorize archiving the `.txt` as canonical |
| 2 | Handoff docs and updated `CLAUDE.md` unreachable from any staging-based worktree | **Yes** — approve a documentation-only commit onto the staging lineage |
| 3 | Hostinger deployment-to-commit attribution unproven; deployment identifier unavailable | **Yes** — confirm from the Hostinger deployment log |
| 4 | `npm run build:staging` fails closed without the approved staging URL and browser publishable key | **Yes** — provide the approved staging configuration, or accept Hostinger's managed build as the only publication path |
| 5 | Authenticated manual UI acceptance outstanding (26 maintenance scenarios) | **Yes** — owner-executed authenticated staging session |
| 6 | Independent concurrency verification blocked by PGlite | Remains a production gate |
| 7 | 6 of 9 edge functions not deployed to staging | Decision needed on whether staging parity is required for acceptance scope |

None of blockers 1 to 7 prevents establishing the workspace or inspecting code. Blocker 1 prevents **starting implementation**.

## 14. Readiness to begin implementation

**Ready, pending the owner-approved remediation prompt.**

Established and verified in this session:

- Git authentication working; live remote references read and reconciled.
- A clean, compiling, regression-passing baseline identified: `977e32e`.
- Staging migration ledger reconciled 1:1 with that baseline, zero drift.
- Supabase CLI authenticated against staging only; production untouched.
- All existing work preserved — nothing reset, cleaned, stashed, merged, rebased, or force-pushed.

Awaiting owner authorization for, in order: (a) the complete Maintenance Management Manual Acceptance Failure Remediation prompt; (b) creation of `E:\pevvy-maintenance-acceptance-20261125` from `977e32e`; (c) the documentation-only commit that makes `CLAUDE.md` and the handoff set reachable from the new worktree.

No implementation will begin until (a) is received.

---

### Verification commands used (all read-only)

- `git rev-parse HEAD`, `git remote -v`, `git for-each-ref refs/remotes/`
- `GIT_TERMINAL_PROMPT=0 git ls-remote --heads origin`
- `GIT_TERMINAL_PROMPT=0 git fetch --dry-run --all`
- `git merge-base --is-ancestor`, `git log --oneline origin/main..origin/staging`
- `git worktree list`, `git status --porcelain`, `git ls-tree --name-only HEAD`
- `npx supabase --version`, `npx supabase projects list`
- `npx supabase migration list --linked`
- `npx supabase functions list --project-ref yeklucfthspvejlkffln`
- `npm run typecheck` (baseline `977e32e` — PASS)
- `npx vitest run` across 4 suites (baseline `977e32e` — 85/85 PASS)

No write operation was performed against Git, Supabase, Hostinger, or the filesystem outside this report file.

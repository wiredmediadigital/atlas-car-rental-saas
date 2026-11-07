# Resume: Pevvy Help Centre build

**Written:** 2026-11-06 · **Branch:** `feat/help-centre` · **Nothing is pushed.**

This file exists so the work can be picked up after a restart. It is committed
deliberately: the working ledger lives in `.superpowers/sdd/`, which is
git-ignored and would not survive `git clean -fdx`.

---

## What this is

A public Help Centre at `/help` — nineteen Markdown pages, one per app sidebar
tab, with search, derived role labels and entry points from inside the product.

- **Design (approved):** `docs/superpowers/specs/2026-11-06-pevvy-help-centre-design.md`
- **Plan (approved):** `docs/superpowers/plans/2026-11-06-pevvy-help-centre.md`
- **Screenshot inventory:** `docs/superpowers/specs/2026-11-06-help-screenshot-shot-list.md`
- **Working ledger (not committed):** `.superpowers/sdd/2026-11-06-pevvy-help-centre/progress.md`

Execution method: superpowers:subagent-driven-development — a fresh implementer
per task, a fresh reviewer after each, fix rounds until clean, then one
whole-branch review at the end.

## How to resume

1. `git log --oneline` on `feat/help-centre`. The commits are the truth.
2. Read `.superpowers/sdd/2026-11-06-pevvy-help-centre/progress.md` if it still
   exists. Tasks with a `Task <N>: complete` line are done — do not redo them.
3. If the ledger is gone, this file plus `git log` is enough to restart from.
4. Task briefs are at `.superpowers/sdd/2026-11-06-pevvy-help-centre/task-<N>-brief.md`,
   regenerable with this skill's `scripts/task-brief <plan> <N>`.

## Status at time of writing

**Complete and reviewed clean: Tasks 1-9.**

| # | Task | State |
|---|---|---|
| 1 | Markdown loading + front matter | complete |
| 2 | Role labels derived from `PERMISSIONS` | complete |
| 3 | Product-name / support-address tokens | complete |
| 4 | Help routes + article layout | complete (2 fix rounds) |
| 5 | `/help` card index | complete |
| 6 | Client-side search + mobile nav | complete (1 fix round) |
| 7 | Screenshots, manifest, checks | complete (1 fix round) |
| 8 | Metadata, robots.txt, sitemap | complete (2 fix rounds) |
| 9 | In-app entry points | complete (1 fix round) |
| 10 | Content: Rentals, Vehicles, Team | **IN FLIGHT — see below** |
| 11 | Content: remaining 16 pages | not started |
| 12 | Accessibility pass | not started |

Then: whole-branch review on the most capable model, one fix wave, then
superpowers:finishing-a-development-branch.

### Task 10 — exact state

Owner gate **cleared**. Task review returned **Approved**.

**Fix round 1 is committed** at `554faf1` ("docs(help): name the roles on Team,
and fix the late-hire vehicle status"). It applied five of six items and added
a `{{roleTable}}` token to `tokens.ts` that builds the role table from
`ORG_ROLES`/`ROLE_LABELS`/`ROLE_DESCRIPTIONS`. The re-review judged that
machinery sound and **verified its safety claim directly**: `HelpArticlePage`
resolves tokens *before* calling `helpSections`, so line numbers are counted
against the expanded text and a multi-line table cannot detach the role labels
that are looked up by source line.

**Fix round 2 may be UNCOMMITTED in the working tree.** If `git status` shows
`src/content/help/{rentals,vehicles}.md` and
`src/features/help/{tokens.test.ts,help-routing.test.tsx}` modified, that is it.

Round 2 exists because fix round 1's FIX 1 was grounded on a **superseded
migration** and introduced false statements in three places (see retracted bug
3 below). Round 2 rewrites them against
`20260825100000_fleet_occupancy_follows_lifecycle.sql` and adds the missing
test that a section label *after* the `{{roleTable}}` still attaches to the
correct heading.

**I inspected the uncommitted working tree and believe it is correct:**
- `vehicles.md` now says statuses "follow the contract, not the clock" —
  Rented from check-out until the contract is completed, covering early
  handover, overdue, and returned-but-not-closed.
- The false troubleshooting entry "It says Available but the vehicle is still
  out" has been **deleted**; only "It says Rented and I did not set that"
  remains.
- `rentals.md` now says a hire stays **Out** until completed, and draws the
  real consequence: a contract left open keeps its vehicle occupied.

**To resume:** run `npm run verify`; if green, commit the working tree as fix
round 2 and dispatch a scoped re-review of `554faf1..HEAD`. If it is red or the
tree looks incoherent, `git checkout -- .` and re-dispatch round 2 from the
description above. `554faf1` is a safe state; `9df144c` is safe but contains
the false statements.

**Do not start Task 11 until round 2 is reviewed clean.**

---

## Decisions taken on the owner's behalf

Recorded because the owner delegated them and should be able to reverse any.

1. **Workspace:** branch in place, not a separate worktree — the docs and
   screenshots were already uncommitted here.
2. **`permission` in page front matter is optional.** `PERMISSIONS` has no key
   for Notifications, the Getting-started pages or the Reference pages.
   Absence is legal; an unknown key still fails the build.
3. **Per-section role labels**, not one per page — modules span several minimum
   roles.
4. **Section permission syntax** is `<!-- permission: key -->` after the `##`.
5. **Help navigation grows with content** — only slugs whose Markdown exists.
6. **`SECTION_PERMISSION_PATTERN` unexported**, against the plan's interface
   list: it was a stateful global regex.
7. **Heading identity from source position**, not a closure counter — the app
   runs in `StrictMode`, which double-invokes render functions.
8. **CRLF handling elevated from Minor** — a CRLF file silently lost every
   section.
9. **Blank image alt must not throw**, against the plan's own test list. The
   app has one top-level `ErrorBoundary`; a bad alt would blank the whole page.
10. **No 2× screenshots.** The design asked for them; no 2× sources exist and
    upscaling adds weight without detail.
11. **No placeholder sitemap origin committed** — `robots.txt` omits the
    `Sitemap:` line until `npm run help:sitemap -- <origin>` is run.
12. **`.claude/skills/atlas-setup/` left untouched** though a reviewer
    suggested adding the sitemap step. Outside this plan. **Follow-up for the
    owner.**
13. **Reset-password screen links to `troubleshooting`**, not
    `accept-your-invitation`.
14. **Role names allowed on the Team page and the "Who can do what" reference
    page only** — the no-role-names rule stands everywhere else.

## Known product bugs found while writing the pages

Not caused by this work; confirmed against source. For the owner's backlog.

1. `lifecycle.ts` tells the user to "refund or **retain** the deposit" — no
   retain action exists (`RentalAction` has only `refund-deposit`).
2. `VehicleImportDialog.tsx:73` checks duplicate plates over 100 vehicles with
   `includeArchived: true`, while `20260813090300_fleet.sql:75-83` makes the
   plate/VIN unique indexes partial on `archived_at is null` — so it misses
   duplicates past 100 and falsely flags retired plates.
3. ~~`effective_status` shows an overdue hire's vehicle as Available.~~
   **RETRACTED — this is not a bug.** Two agents confirmed it by reading
   `20260814100100_vehicle_fleet_model.sql`, but that view is redefined by
   `20260825100000_fleet_occupancy_follows_lifecycle.sql`, which exists
   specifically to fix it. The current `current_rental` join selects any
   rental with `status='active'` and **no time bounds**, so an overdue hire
   reads **Rented** until the contract is completed. Lesson for anyone
   grounding prose in this schema: **grep for later redefinitions before
   trusting a migration.**

4. **CONFIRMED end to end — a vehicle on an overdue, uncompleted hire is
   offered for booking, and can be booked, for any period starting after its
   scheduled return.** Traced with later-redefinition checks this time;
   `vehicles_available_between`, the overlap constraint, `rental_confirm` and
   `rental_check_out` are each defined once.
   - The exclusion constraint is `exclude using gist (vehicle_id with =,
     tstzrange(starts_at, ends_at,'[)') with &&) where status in
     ('reserved','active')`, so a booking starting after a late hire's
     `ends_at` does not overlap it.
   - `rental_check_out` never touches `vehicles.status`.
   - `vehicles_available_between` filters on `vehicles.status`, **not** on
     `effective_status`.
   - `rental_confirm` checks only draft status and a primary driver.

   Mitigation that already exists: the fleet list and vehicle page show
   **Rented** and withhold "Bookable now". The availability picker consults
   neither. Note `20260825100000`'s header says availability search and the
   constraint were left untouched deliberately — so this may be a known
   trade-off rather than an oversight. Booking a car for next week while it is
   out is ordinary business; the overdue case differs only in that there is no
   evidence the car is coming back. **A schema decision for the owner, not a
   help-centre one — deliberately NOT documented in the pages.**

## Also worth knowing

- `index.html` references `%VITE_APP_NAME%`, which nothing defines, so Vite
  warns on every request. Pre-existing, unrelated to this work.
- `contract-pdf.node.test.ts` ("produces a real PDF file") has hit a 30s
  timeout under suite load; it passes alone in ~3.6s. Pre-existing.
- `npm run verify` takes roughly six minutes. Iterate with
  `npx vitest run src/features/help src/pages/help`.
- Help test files that render routes must call `beforeAll(warmHelpRoutes)` from
  `src/features/help/help-test-support.ts`, or they flake on a cold chunk load.
- Do not hard-code how many help pages exist in any assertion. Four tasks
  shipped count-dependent assertions that had to be fixed.
- **Before grounding prose in a migration, list EVERY migration that defines
  that view or function and read the LAST one.** `grep` returns them
  oldest-first, so the first hit is the one most likely to be stale. This cost
  a full fix round: two agents independently confirmed a "bug" from a
  superseded `vehicle_fleet` definition. Task 11 covers Overview, Calendar,
  Customers, Reports and GPS, all of which read from views that may have been
  redefined the same way.
- Lint runs before tests in `npm run verify`, so `npx vitest` can be green
  while `verify` is red. Check lint separately when iterating.

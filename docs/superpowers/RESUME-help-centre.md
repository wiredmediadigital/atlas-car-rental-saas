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

Committed at `9df144c` ("docs(help): add Rentals, Vehicles and Team pages").
The owner gate is **cleared** and the task review returned **Approved**.

A fix round was dispatched and may be **uncommitted in the working tree** when
you resume. If `git status` shows modified files under `src/content/help/` and
`src/features/help/`, that is the partial fix round. Its scope was:

1. Team page may now name the four roles (ruling below), sourced from
   `ROLE_LABELS` / `ROLE_DESCRIPTIONS`, not retyped.
2. `vehicles.md`: "clears itself when the hire is completed" is false for an
   overdue hire — reword.
3. Cut developer-flavoured sentences (`team.md` "read from the same table the
   database enforces"; `rentals.md` "Availability is answered as of now").
4. `vehicles.md`: soften the import duplicate-plate claim.
5. `rentals.md`: bridge the handover section to the contract/signature section.
6. `rentals.md`: ground or remove "not a qualified electronic signature".

It was also seen modifying `src/features/help/tokens.ts` and its test, which is
machinery rather than prose — likely rendering role names from the permission
constants. **That needs review attention; it was not an explicit instruction.**

Either finish that round and review it, or `git checkout -- .` to drop it and
re-dispatch. `9df144c` is a good state.

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
3. `effective_status` reads Rented only while
   `status='active' AND starts_at<=now() AND ends_at>now()`, so an **overdue**
   hire shows the vehicle as **Available** while it is still out.

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

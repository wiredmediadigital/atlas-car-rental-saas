# Account closure — decision ledger

A record of decisions made while building account closure, in the order they
were made. **This work is paused:** tasks 6 and 7 are unstarted and the branch
is `feat/account-closure`. Historical, not current documentation; see
`README.md` in this folder before relying on anything here.

Spec: `../specs/2026-11-08-account-closure-design.md`
Plan: `../plans/2026-11-08-account-closure.md`

---

# SDD ledger — plan: docs/superpowers/plans/2026-11-08-account-closure.md

Spec: docs/superpowers/specs/2026-11-08-account-closure-design.md (read)
Branch: feat/account-closure (created from main at 412e3e4)
Baseline: npm run verify green at cfcad7b — VERIFY_EXIT=0, 106 files, 2562
tests, 0 lint errors, build clean. Every commit between cfcad7b and 412e3e4 is
docs-only (security procedures, closure design, closure plan), so it stands.

## Pre-flight conflict scan

### Task pairs sharing a file or an interface

| Pair | Produced → consumed | Finding |
|---|---|---|
| T1 → T2 | `app.closure_state_of`, `app.may_write`, `app.require_write`, closure columns | Agrees. T2 adds functions that read T1's state; it does not redefine the gate. |
| T1 → T3 | `purge_started_at`, `closed_at`, `closure_state_of` | Agrees. T3 writes the columns T1 declares. |
| T2 → T3 | `account_closure_events`, `account_closure_objects` | **Ordering risk, not a conflict.** T2 creates both tables; T3's collect and purge write to them. T3 must not re-create them. Ruling below. |
| T2 → T4 | `organization_request_closure`, `organization_restore` | Agrees — T4 never calls them; it runs the purge side. |
| T3 → T4 | `organization_claim_purge`, `organization_collect_objects`, `organization_purge_data` | Agrees. T4 composes all three. |
| T4 → T7 | the Edge Function the workflow calls | Agrees. T7 supplies the schedule and the secret. |
| T2 → T6 | the request function must enqueue a notification | **Ordering risk.** T6 modifies T2's function. Ruling below. |
| T2/T3 → T5 | closure state read by the UI | Agrees; T5 reads, never writes state directly. |
| T1 → everything | `billing_may_write` redefined | The single highest-risk edit on the branch: 87 call sites. T1's own step 4 re-runs the whole `supabase/tests` suite to prove the 75 policies are unchanged. Adequate. |

### Per-task self-agreement

| Task | Finding |
|---|---|
| T1 | Agrees. Tests name each closure state and the no-regression case; the migration is the only file. |
| T2 | Agrees. Tests cover both halves of the owner/admin asymmetry, which Review Focus 5 requires. |
| T3 | Agrees. The explicit 45-table enumeration is stated as deliberate, with the reason. |
| T4 | Agrees. Pure logic in `_shared`, boundary in `index.ts`, matching the project's established split. |
| T5 | Agrees. |
| T6 | **Thinnest brief of the seven** (10 lines). It carries real security weight — the emailed confirmation is what stops a stolen session using the immediate path. Flagged, not blocking: the dispatch must carry more than the brief does. |
| T7 | Agrees. Explicitly closes retention Gap 2 and explicitly leaves Gap 1 open. |

### Checked and clear

- No task edits an existing migration. Three new, later-dated files only.
- No task deletes the `organizations` row; T3 states the tombstone rule.
- No task rewrites an RLS policy.
- `pg_cron`/`pg_net` appear nowhere; T7 schedules from outside the deployment.

### Rulings

Ruling: **Task 2 owns the two tables; Task 3 only writes to them.**
`account_closure_events` and `account_closure_objects` are created in T2's
migration, and T3's migration must assume they exist. The alternative —
creating them in T3 — would leave T2's functions referencing a table that does
not yet exist at its own migration's timestamp, which fails on a fresh replay
of the migration history. The database tests replay every migration, so this
would fail loudly rather than silently; the ruling is to avoid the wasted
round. Cost if wrong: one migration's tables move file; no data implication.

Ruling: **Task 6 modifies Task 2's request function rather than Task 2
anticipating Task 6.** The notification enqueue and the immediate-path token
check are added in T6's own later-dated migration, redefining
`organization_request_closure` with `create or replace`. T2 therefore ships a
function that closes an account without notifying anyone, which is correct for
one commit and wrong to leave — T6 is not optional. Cost if wrong: a window in
the branch's history where the function is incomplete; no shipped state has it,
because the branch merges as a whole.

Ruling: **Task 6's dispatch carries more context than its brief.** The brief is
10 lines and the task is the security layer that makes a quiet deletion
impossible. The dispatch will state the threat model explicitly — stolen
session versus mailbox access — rather than relying on the brief alone. Cost if
wrong: a longer dispatch prompt.

---


Task 1: implementer DONE_WITH_CONCERNS — commit c40941f. 13/13 new tests;
full supabase/tests 34 files / 1297 tests green, which is the evidence that
the 75 untouched policies still behave.

Ruling: ACCEPT the unrequested BEFORE UPDATE trigger guarding the closure
columns, and it belongs in Task 1. Verified the premise myself:
20260813090600_rls.sql:122-126 grants `organizations_update` to authenticated
`using (app.has_min_role(id,'admin'))` with no column restriction — so any
admin can write any column on their own organization row. Without the guard an
admin could null closure_requested_at to silently un-suspend, stamp closed_at
without a purge, or — worst — clear purge_started_at and defeat the "restore is
refused once the purge has claimed the account" rule, which is a safety
guarantee of the design rather than a mere state flag. The plan did not
anticipate this; the implementer found it. Cost if wrong: a trigger refusing a
write nobody legitimately makes, removable in one migration.

Consequence carried into Task 2: organization_request_closure and
organization_restore MUST be security definer, because the trigger refuses
closure-column writes made as authenticated. That is now a requirement, not a
preference.

Ruling: accept closure_state_of returning 'open' for a nonexistent
organization id. Failing closed would change what billing_may_write answers for
ids that do not exist, which is a behaviour change outside this task's scope.
Cost if wrong: a gate answers about a row that is not there; no caller does.

Task 1: review clean — spec compliant, Approved, 0 Critical, 0 Important.
Reviewer verified the guard covers every client write path (authenticated holds
only select+update on organizations; it grepped every migration to confirm no
existing definer writes that table) and that the delegation regression is
genuinely caught (all four gate spellings asked in all five states).

Pre-Task-2 additions (not a numbered fix round): proved a security definer
function called by authenticated CAN set the closure columns — the path Task 2
depends on entirely, previously asserted nowhere; added refusal tests for
purge_started_at, closure_purge_after and closure_requested_by, including the
actual attack (an admin clearing purge_started_at mid-purge is refused and the
state stays 'purging'); added set search_path = '' to the guard function.

Ruling: the implementer edited its own migration file rather than adding a
second one for the search_path fix. Correct. CLAUDE.md's "never edit an
existing migration" protects applied history; this file has been applied
nowhere, exists only on an unmerged branch, and the database tests replay every
migration from scratch. Adding a second migration to amend a typo in an
unapplied one would leave two files where one belongs. Cost if wrong: nothing —
the file is not yet in any project's history.

Task 1: minor (deferred): require_write re-checks closure to pick its message; may_write stays authoritative
Task 1: minor (deferred): no CHECK pins timestamp consistency (closed_at without purge_started_at is accepted)
Task 1: minor (deferred): delegate assertion uses `not like` on a scalar subquery; NULL would not raise
Task 1: minor (deferred): guard denies two named roles rather than allowing privileged ones
Task 1: minor (deferred): nested asUser in two tests leaves the outer session unused
Task 1: minor (deferred): each policy evaluation adds a definer hop that cannot be inlined — watch bulk updates on the 75 gated tables
Task 1: minor (deferred): the new "closed or closing" sentence is not yet mapped in src/lib/supabase/errors.ts — Task 5 must handle it

Task 1: controller-run `npm run verify` on e14b708 — VERIFY_EXIT=0, 107 files,
2581 tests, 0 lint errors, build clean.
Task 1: complete (commits 412e3e4..e14b708, review clean)

Ruling (user-initiated, mid-build): the Settings button REQUESTS closure, it
does not execute it. The self-serve immediate purge and its emailed
confirmation token are removed. Design and plan updated in 6dca3d8. Task 1 was
agnostic between the two shapes so nothing is wasted. The capability removed
was the single most dangerous in the product and the reason most other
safeguards existed; a compromised owner session can now at worst suspend, which
is emailed to every owner and admin and reversible by any of them.
Also corrected in the design: my earlier claim that self-serve was better for
GDPR responsiveness overstated it. Article 28 requires acting on the
controller's instruction, not a button that executes it.

Task 2: implementer DONE_WITH_CONCERNS — commit e065e2a. 21/21 own file; full
supabase/tests 35 files / 1324 tests green.
Task 2: review clean — spec compliant, Approved, 0 Critical, 0 Important.

Reviewer resolved the allow-list concern rather than accepting it:
analytics-security.test.ts is an exact sorted toEqual of every
authenticated-executable definer function, not a skip-list, so adding two names
in sorted position cannot hide a third. billing-restricted-access.test.ts sits
beside leave_organization / create_organization / accept_team_invitation and
the exemption is the stated requirement; the new test file separately asserts a
restricted agency can still use both functions. Necessary and minimal.

Also verified by the reviewer: both halves of the owner/admin asymmetry are
asserted (an admin is refused closure, an admin can restore); restore is
refused for purge_started_at AND closed_at separately, as both owner and admin;
the window has no second signature (pronargs = 1 asserted) and a direct UPDATE
of closure_purge_after is refused by Task 1's guard.

CARRY INTO TASK 3 (requirement, not a preference): the purge's first statement
must be `select ... for update` on the organizations row, followed by the
purge_started_at check — the same lock restore takes. Task 2's restore locks
before checking state; if the purge claims without that lock, a restore and a
claim can both believe they won. The PGlite harness is single-connection so no
test can exercise the race; it is correct by construction or not at all.

Task 2: minor (deferred): role is read before the row lock, so a demotion committed in between is unseen (microseconds; one action by someone just demoted; recoverable by restore)
Task 2: minor (deferred): no test that a non-admin restore of an open org is refused before the "not closing" message — ordering/leak hygiene only
Task 2: minor (deferred): the single-signature assertion covers request but not restore
Task 2: minor (deferred): account_closure_objects has only a partial index where deleted_at is null; looking up a finished sweep by org will scan — a Task 3 concern

Task 2: controller-run verify on e065e2a — VERIFY_EXIT=0, 108 files, 2602 tests.
Task 2: complete (commits 6dca3d8..e065e2a, review clean)

Task 3: implementer DONE_WITH_CONCERNS — e79aa11, then 92b95b1 after a
pre-review fix. 20/20 own file; full supabase/tests 36 files / 1344 tests.

CONTROLLER ERROR (plan gap, found by the implementer): the design says the
Stripe subscription is cancelled when closure is requested, and NO TASK
IMPLEMENTS IT. Seven tasks, none cancels Stripe. Closed in two places:
  - belt, done now: app.organization_claim_purge raises 55000 while
    billing_subscriptions holds a trialing/active/past_due/unpaid/paused row —
    the same status set the old organization-delete guard used. Makes "purged a
    paying customer" unreachable whatever a caller forgot.
  - braces, CARRY INTO TASK 4 (requirement): the runner cancels the
    subscription in Stripe BEFORE it claims. The SQL function cannot reach
    Stripe; the runner holds the secret.

CONTROLLER ERRORS in the Task 3 brief, both corrected by the implementer:
  - I listed six storage buckets; there are seven. vehicle-photos was missing.
    Only the instruction to find the key columns rather than assume prevented
    those scans being orphaned.
  - I said 45 tenant tables; there are 42 base tables carrying organization_id.
    My number counted grep occurrences, not distinct tables.

Verified myself before accepting the security-relevant change: five existing
delete guards read "organizations row is gone" as a teardown signal, and the
tombstone keeps the row, so they would have refused the purge outright. The
app.account_purge bypass is sound — set_config(..., true) is transaction-local,
and every guard compares it against old.organization_id, so naming one
organization cannot authorise deleting another's rows. Still a bypass of five
integrity guards; flagged for the reviewer's close attention.

CARRY INTO TASK 4 (also): a member whose last agency closed still has rows in
auth.users and profiles. Task 4 removes both, not just the auth user.

Task 3: review clean (opus) — spec compliant, Approved, 0 Critical, 3 Important.
Reviewer independently enumerated every create-table block carrying
organization_id and arrived at exactly 42 (accounting for notifications dropped
and financing_plans renamed), confirmed 7 insert-into-storage.buckets
statements, and compared all five redefined guards against their prior
definitions — otherwise unchanged.

Task 3: fix round 2/5 — the three Importants plus one hardening:
  (a) the live-subscription refusal moved onto the irreversible step too;
      purge_data and claim_purge now share app.organization_has_live_subscription
      so they cannot drift.
  (b) the collect-before-delete test did not test that — the seed gave every key
      a storage.objects row, so the prefix branch alone satisfied it. Reseeded so
      only the orphan is in storage.objects; implementer verified by MUTATION
      that removing the collect call fails exactly that test.
  (c) organization_collect_objects now refuses unless purging/closed — it would
      otherwise inventory a LIVE agency's identity-document keys into the sweep
      table that Task 4 deletes from.
  (d) the five guards now also require that organization to be mid-purge, so the
      exemption is unforgeable rather than merely unreachable.

Task 3: fix round 3/5 — the round-2 fix had WEAKENED an existing test: the vault
check moved from counting by value to comparing totals, which would pass if the
purge deleted the WRONG agency's secret. Cross-tenant deletion is the worst
failure a multi-tenant purge can have. Now identified by id: A's absent, B's
present. Forgery test extended from two guards to all five, mutation-verified.
Scoped re-review: all addressed, diff confirmed test-only.

Ruling: editing the unapplied migration in place is correct, same as Task 1 —
CLAUDE.md's rule protects applied history, and nothing here has been applied to
any project.

Noted: the full verify on a60758e showed 1 failure — contract-pdf.node.test.ts
timing out at 30010ms. Confirmed the documented load flake, not this work: it
passes 9/9 in isolation.

Task 3: controller-run verify on f7546fa — VERIFY_EXIT=0, 109 files, 2625
tests, build clean. (The contract-pdf flake that failed the a60758e run passed
here, as it does.)
Task 3: complete (commits e065e2a..f7546fa, review clean after 3 fix rounds)

Ruling (user-decided): Stripe cancellation stays a MANUAL step; the runner does
not touch Stripe. Reasons: claim_purge already refuses while a subscription is
live, so a forgotten cancellation stops the purge rather than billing a purged
customer — it fails safe and visibly; and giving an unattended scheduled job the
Stripe secret on top of service-role access makes one process able to both
delete a tenant's data and move money, which is a bigger blast radius than the
30-second dashboard action it replaces. It also matches the shape already
chosen: a human is in the loop for closures anyway.
Automated instead: DETECTION. The runner reports every organization suspended
with a live subscription, loudly, each run — because an agency billed for a
read-only account it asked to close, data unpurged, is the worst outcome here
and it is silent unless something says so.
Consequence recorded in Task 7: the Terms must say the subscription is
cancelled WHEN THE REQUEST IS PROCESSED, not immediately. Cancellation is
manual; the Terms describe what happens, not the better-sounding version.

CONTROLLER ERROR: my earlier edit removing the confirmation-token flow from
Task 6 silently did not apply — a string replacement that matched nothing. The
plan still instructed Task 6 to build a token flow removed two decisions
earlier, and only a grep caught it. Fixed now. Lesson: verify a scripted edit
landed rather than trusting the script's exit code.

Task 4: implementer DONE_WITH_CONCERNS — 6ccc9cc, then fc90295 (secret gate),
then an eslint-ignore commit. 23 tests on the runner; supabase/tests 37 files /
1370 green.

CONTROLLER ERROR (plan): I specified [functions.account-closure] verify_jwt =
true without checking this project's key format. config.toml:518-520 already
records that its sb_publishable_/sb_secret_ keys are NOT JWTs and cannot
satisfy the platform check — so the function would have been unreachable by any
scheduler, discovered at deploy after Task 7 built a caller for it. Now
verify_jwt = false with an in-function constant-time check against a dedicated
ACCOUNT_CLOSURE_RUNNER_SECRET (not the service key), refusing with a bare 401,
comparison in _shared and tested. Same pattern billing-webhook established.

Task 4: review — spec mostly met, Needs fixes. 0 Critical, 3 Important.
Reviewer confirmed: stage order correct; the secret gate holds on every path it
checked (fails closed on unset, short, null and non-Bearer; refusal claims
nothing, asserted); resumable() cannot pick up an agency it should not (due,
resumable and lingering are disjoint); the pseudo-bucket row is filtered out of
the sweep in two places; and the collector's 7 buckets match the runner's list
exactly, grepped against the Task 3 migration.

Task 4: fix round 2/5 sent — (1) sweepStorage must assert each row belongs to
the organization whose state it checked; today that rests entirely on an
adapter filter in the untested file, and an adapter regression would delete a
LIVE agency's passport scans. (2) move the auth-delete 404/user_not_found
classification into _shared and test it — that one condition is what completes
the only untested crash case, and it lives where nothing checks it. (3) reverse
the profile/auth delete order: profiles.id cascades from auth.users, so
deleting the user first removes the profile atomically and the crash window
stops existing rather than being documented. (4) paginate the delete path —
max_rows = 1000 means listMemberIds silently caps and members past 1000 are
orphaned, and membershipsOf's .in() of up to 1000 uuids is ~37KB of query
string that will be refused, failing that agency on every run forever.

Task 4: minor (deferred): listClosedWithPendingWork can be starved by an unordered limit(1000)
Task 4: minor (deferred): a due, blocked agency goes unnamed if the time budget runs out first
Task 4: minor (deferred): a blocked run returns HTTP 200 — Task 7 owns alerting on needsAttention
Task 4: minor (deferred): a listing failure aborts the whole run rather than one agency
Task 4: minor (deferred): "sweep complete" is inferred from an empty batch, not from nothing pending
Task 4: minor (deferred): invitation-acceptance race between membershipsOf and removeUser
Task 4: minor (deferred): an unset runner secret returns 401 rather than 503

Task 4: fix round 2/5 — all four addressed, scoped re-review clean, 0 new
Critical/Important. Re-reviewer traced the paging arithmetic (1234 rows against
a 1000-row cap -> 500/500/234; exactly 1000 -> 500/500/empty, losing nothing)
and confirmed readAllPages fails CLOSED: `from >= maxRows` throws before the
fetch rather than returning a partial list. Also confirmed removeAuthUsers can
no longer stop while work remains — every record is markDone'd, must() throws
on error, so the set shrinks each pass.

The implementer found a SECOND instance of the same bug while fixing the first:
removeAuthUsers did one capped read and still reported the agency closed. That
is the pattern of this task — not a crash, but finishing early and reporting
success. Named here so the final review looks for a fourth.

FOR THE FINAL FIX WAVE (third instance, flagged by two reviewers):
Task 4: listClosedWithPendingWork uses an unordered .limit(500) over pending
ledger rows then dedupes organization ids — the same truncated-read-on-a-delete-
path class. One closed agency holding 500+ permanently-pending rows can starve
other closed agencies' work indefinitely, which is data retained after a
deletion instruction. Not data loss; bounded; fix is to select distinct
organization ids or paginate.

Task 4: minor (deferred): a malformed pending auth record now throws and fails that agency every run (fail-closed and intended, but a behaviour change)
Task 4: minor (deferred): no hasTime() check between removeAuthUsers batches; resumable, so bounded
Task 4: minor (deferred): the PAGE < max_rows invariant is a comment with no guard or test
Task 4: minor (deferred): interpretAuthDelete's 404 branch could mask a gateway 404, deleting the profile while the auth user survives
Task 4: minor (deferred): recordRemovalCandidates upserts all members in one request, now that members are enumerated past 1000

Task 4: controller-run verify on c04bc7b — 110 files, 2656 tests, 0 lint
errors, build clean.
Task 4: complete (commits 12fa8d0..c04bc7b, review clean after 2 fix rounds)

PATTERN NAMED FOR THE FINAL REVIEW: "truncated read on a delete path, reported
as success". Three instances found on Task 4 alone — listMemberIds capping at
1000 (members orphaned), removeAuthUsers doing one capped read and still
marking the agency closed, and listClosedWithPendingWork's unordered limit(500)
(starvation, deferred). The failure is never a crash; it is finishing early and
reporting done. Look for a fourth.

## Task 5: Settings — request, confirm, restore

- Dispatched: implementer (sonnet), base c04bc7b.
- Implementer status: DONE_WITH_CONCERNS, then DONE after one fix round.
- Commits: `64a901a` Add the account-closure screen: request, confirm, restore; `86eac4e` Give the closure copy a one-click route to support.
- Implementer tests: 44 in organization + supabase; `npx eslint .` 0 errors (12 pre-existing warnings); `tsc --noEmit` clean. Controller ran `npm run verify` separately.
- Ruling: the task-5 brief still carried the `{ immediate }` signature from the pre-change design. The user removed immediate closure mid-build. Controller error, not the implementer's. Binding behaviour: request only, no immediate option, no confirmation-token flow. Cost if wrong: none — the brief contradicted a decision the user had already made in writing.
- Ruling: implementer's claim that no support address exists was wrong. `SUPPORT_EMAIL = 'help@pevvy.io'` at `src/features/help/constants.ts:6`, already imported outside the help feature by `src/pages/legal/legal-config.ts:1`. Fix round 1 required it as a `mailto:` in the confirmation dialog, suspended card, suspended banner and purging banner. No new `VITE_` variable. Cost if wrong: an unreachable support route on the one screen where people are in a hurry.
- Accepted deviations beyond the brief: `usePermission` broadened so writes are withdrawn while suspended/purging/closed (correct — fixing it only on Settings would leave every other screen offering buttons the DB refuses); `ConfirmDialog` gained `isConfirmDisabled`; `errors.ts` maps the Task 1 closed-or-closing sentence.
- Upstream omission recorded: `OrganizationRow` was missing the five closure columns. Task 1 added them to the schema and not the TS row type. Fixed here.
- Review dispatched (opus) with two mandatory cross-cutting questions: does withdrawing writes under suspension also withdraw the restore control, and does it withdraw anything on the billing pages.
- Controller verify at `86eac4e`: VERIFY_EXIT=0, 111 files, 2680 tests, 0 lint errors (12 pre-existing warnings), build clean.
- Report-accuracy note: implementer claimed "31 new tests". The diff adds 24 `it(`/`test(` cases and the suite delta over Task 4 is exactly +24 (2656 -> 2680), with no `.each` expansion. The real figure is 24. No correctness impact; logged because this implementer's self-reported numbers ran high.
- Task 5 review (opus): spec compliant. Verified against the migrations clause by clause that the UI predicates match `organization_request_closure` (owner + open) and `organization_restore` (admin+ and suspended), and that both RPCs are deliberately exempt from the write gate so a billing-restricted agency can still close and restore. Restore bypasses `usePermission` (no call in `features/organization/`); billing surface not double-gated (`AVAILABLE_WHEN_RESTRICTED` covers `billing.manage`/`organization.update`/team perms; only `usePermission('billing...')` consumer is `RestrictedBanner`, untouched).
- Important finding, fix round 1: a billing-restricted AND suspended agency stacks both banners, and `RestrictedBanner` promises "Starting a subscription from Billing restores normal working immediately" — false, because `app.may_write` requires `billing_access_state <> 'restricted'` AND `closure_state_of = 'open'`. `app.require_write` already gives closure precedence; the shell must mirror it.
- Rulings on the rest: TeamPage invitations card hidden while suspended (`TeamPage.tsx:71,347`) is pre-existing under billing restriction and out of scope -> FOLLOW-UP, not a Task 5 change. `workspace-context.ts` importing `@/features/organization/closure` inverts dependency direction with no cycle today -> leave for the whole-branch review. Hook re-calls and duplicate headings -> leave. Cost if wrong: three cosmetic/structural items deferred, none affecting behaviour.
- Fix round 1 dispatched: banner precedence + combined-state test, three cheap minors (merged import, `CLOSURE_WINDOW_DAYS` constant, drop unused `purgeAfter`), and a test for the untested `#account` hash fallback.
- Fix round 1 returned: `77e54c8` "Let the closure banner win over the billing banner". Rule placed in `RestrictedBanner` (returns null when closure state !== 'open'), `AppShell` untouched, so precedence lives in one place. Three minors done. 4 new tests, counted from the diff. Implementer explained the earlier "31" as a run total including existing errors tests.
- Scoped re-review dispatched (sonnet) with two specific checks: the combined restricted+suspended state is right, AND a restricted-but-open agency still gets the billing banner (a fix that silenced it for everyone would be worse than the defect).
- Re-review (sonnet) verdict: ALL FIVE findings ADDRESSED, no new breakage. Confirmed the predicate is exactly the closure state and `if (!isRestricted) return null` is untouched, so a restricted-but-OPEN agency still gets the billing banner; both states pinned by tests. 4 new cases counted from the diff, matching the claim. Minor note: admin, the boundary role, is not exercised in the new SettingsPage test (manager/staff/owner are) -> logged for the whole-branch review, not another round.
- `4217bb6` docs: design doc corrected. It still said the request "cancels the Stripe subscription"; no code does, and cancellation is manual by the user's decision. Now records the manual step, the purge's `organization_has_live_subscription` refusal that makes it load-bearing, and that the operator notification names the agency and says to cancel in Stripe.
- **Task 5 NOT yet marked complete.** `npm run verify` at `77e54c8` was KILLED by the harness for low system memory, not by a failure. No verify result exists for the fix commit. Evidence that does exist: implementer's 90 targeted tests across organization/SettingsPage/billing, `npx eslint .` 0 errors, `tsc --noEmit` clean; and a full green verify at `86eac4e` (111 files, 2680 tests) one commit earlier. Per the harness instruction, do not re-run it unprompted. Resume point: re-run `npm run verify`, then mark Task 5 complete and dispatch Task 6.
- Task 6 and 7 briefs are STALE in the same way Task 5's was: Task 6 still specifies the emailed confirmation token and the immediate path; Task 7 still says the Terms gain "the immediate option". The design doc removed all of it ("The self-serve immediate purge is removed, and with it the emailed confirmation token that guarded it"). Rulings to carry in both dispatches. Task 7 Terms wording: the subscription is cancelled WHEN THE REQUEST IS PROCESSED, not immediately. Task 7 must close data-retention Gap 2 and leave Gap 1 (`gps_positions`) explicitly open.

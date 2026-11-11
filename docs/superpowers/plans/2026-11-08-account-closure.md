# Closing an agency account — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An owner can close their agency's account from Settings; 30 days later every trace of the tenant's data is gone, the billing records tax law requires survive, and there is evidence it happened.

**Architecture:** Closure is recorded on `organizations` and gates writes through the *same* function the billing wind-down already uses, so no second gate can disagree with the first. The purge runs in three stages — claim, sweep storage, delete rows — driven by an authenticated Edge Function that an external scheduler calls daily, because this deployment deliberately runs nothing autonomously. The organization row survives as a tombstone: four billing tables cascade off it, and deleting it would destroy the records that must be kept.

**Tech Stack:** Postgres (RLS, `security definer` functions), Supabase Edge Functions (Deno), React 19 + TypeScript, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-08-account-closure-design.md`

## Global Constraints

- Never edit an existing file in `supabase/migrations/`; every schema change is a new, later-dated file.
- **One write gate.** `app.billing_may_write` has 87 call sites, 75 of them RLS policies. They are not rewritten. The gate is extended, never duplicated.
- **Never delete the `organizations` row.** `billing_customers`, `billing_subscriptions`, `billing_checkout_sessions` and `billing_events` reference it `on delete cascade`.
- Billing records are retained identifiably: Stripe customer id, subscription history, checkout sessions, events, and the organization's legal name.
- A user keeps their login unless this was their **last** membership.
- The purge is **not** atomic. Tenant rows go in one transaction; storage and `auth.users` are separate service-role steps, so every stage must be resumable.
- Closing is **owner-only**. Restoring is **owner or admin**.
- Evidence records counts, never content, and identifies the requester by user id, never email.
- `pg_cron` and `pg_net` stay uninstalled.

## Review Focus

Input classes the spec implies that no happy path exercises. Each gets its test in the owning task.

1. **A restore racing a half-finished purge** — must be refused once the account is claimed, or the tenant is left half-deleted and marked live. (Task 3)
2. **A purge interrupted between the storage sweep and the row delete** — re-running must complete, not fail or double-delete. (Task 4)
3. **A member of two agencies when one closes** — their login must survive; the other agency must be untouched. (Task 4)
4. **An agency that is already billing-restricted requesting closure** — the write gate must not refuse the closure call itself. (Task 2)
5. **An admin attempting to close** — refused; the same admin restoring — allowed. One without the other proves half the rule. (Task 2)

---

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/20261108100000_account_closure_state.sql` | **New.** Closure columns, the closure-state function, and the single extended write gate. |
| `supabase/migrations/20261108100100_account_closure_actions.sql` | **New.** `organization_request_closure`, `organization_restore`, and the evidence/purge-record tables. |
| `supabase/migrations/20261108100200_account_closure_purge.sql` | **New.** The tenant-data purge and the tombstone clear. |
| `supabase/functions/_shared/account-closure.ts` | **New.** Pure logic: which organizations are due, which storage keys to sweep, which users to remove. Testable. |
| `supabase/functions/account-closure/index.ts` | **New.** Thin boundary: authenticates the scheduled caller, runs the stages, is resumable. |
| `supabase/config.toml` | **Modify.** `[functions.account-closure]`, `verify_jwt = true`. |
| `src/features/organization/closure.ts` + `queries.ts` | **New.** Client calls and hooks. |
| `src/pages/SettingsPage.tsx` + a closure card component | **Modify / new.** Request, confirm, restore, and the suspended banner. |
| `.github/workflows/account-closure.yml` | **New.** The daily scheduled caller. |
| `docs/security/data-retention.md`, the Terms and privacy pages | **Modify.** Gap 2 closed; the two events distinguished. |

---

### Task 1: The closure state, and one gate that knows about it

**Files:** Create `supabase/migrations/20261108100000_account_closure_state.sql`; Test `supabase/tests/account-closure-state.test.ts`

**Interfaces — Produces:**
- `organizations.closure_requested_at timestamptz`, `closure_requested_by uuid references auth.users(id) on delete set null`, `closure_purge_after timestamptz`, `purge_started_at timestamptz`, `closed_at timestamptz`
- `public.closure_state` enum: `'open' | 'suspended' | 'purging' | 'closed'`
- `app.closure_state_of(p_organization_id uuid) returns public.closure_state`
- `app.may_write(p_organization_id uuid) returns boolean` — **the** gate: billing not restricted **and** `closure_state_of = 'open'`
- `app.require_write(p_organization_id uuid) returns void` — raises `42501`
- `app.billing_may_write` and `app.billing_require_write` **redefined as thin delegates** to the two above, keeping all 87 call sites working. Their comments must say they are retained because 75 policies name them, and that new code calls `app.may_write`.

- [ ] **Step 1: Write the failing tests**

```ts
it('lets an open, subscribed agency write', ...)
it('refuses a write once closure is requested', ...)          // suspended
it('refuses a write while purging', ...)
it('refuses a write when closed', ...)
it('still refuses a write when billing is restricted and closure is open', ...)  // no regression
it('reports closed only after closed_at is set', ...)
```

- [ ] **Step 2: Run them and watch them fail** — `npx vitest run supabase/tests/account-closure-state.test.ts`, expected FAIL (function does not exist).
- [ ] **Step 3: Write the migration.** Extend the gate; do not touch any policy.
- [ ] **Step 4: Run them and watch them pass**, then `npx vitest run supabase/tests` to prove the 75 policies still behave.
- [ ] **Step 5: Commit.**

---

### Task 2: Requesting closure, and restoring it

**Files:** Create `supabase/migrations/20261108100100_account_closure_actions.sql`; Test `supabase/tests/account-closure-actions.test.ts`

**Interfaces — Consumes:** Task 1's state and gate. **Produces:**
- `public.organization_request_closure(p_organization_id uuid) returns public.organizations` — **owner only**, `security definer` (Task 1's guard trigger refuses closure-column writes made as `authenticated`); sets the closure columns with `closure_purge_after = now() + interval '30 days'`. There is no immediate parameter: purging sooner is an operator action, not a customer one.
- `public.organization_restore(p_organization_id uuid) returns public.organizations` — **owner or admin**; refused once `purge_started_at` is set
- `public.account_closure_events` — the evidence record: organization id, legal name, requester **user id**, requested/purged timestamps, and per-table counts as `jsonb`. Service-role readable only; no `authenticated` policy.
- `public.account_closure_objects` — storage keys collected before deletion, so the sweep is resumable.

Both functions are exempt from the write gate — a billing-restricted agency must still be able to close and to restore. Grant to `authenticated`; revoke from `anon`.

- [ ] **Step 1: Write the failing tests**

```ts
it('lets an owner request closure', ...)
it('refuses closure to an admin', ...)                      // Review Focus 5
it('lets an admin restore', ...)                            // Review Focus 5
it('refuses closure and restore to a manager and to staff', ...)
it('lets a billing-restricted agency request closure', ...) // Review Focus 4
it('sets the purge date 30 days out', ...)
it('has no way for a caller to shorten the window', ...)
it('refuses a restore once the purge has started', ...)     // Review Focus 1
it('records the requester by id and never their email', ...)
it('refuses a member of another agency entirely', ...)
```

- [ ] **Step 2: Run and watch fail.**
- [ ] **Step 3: Write the migration.**
- [ ] **Step 4: Run and watch pass.**
- [ ] **Step 5: Commit.**

---

### Task 3: The purge, in the database

**Files:** Create `supabase/migrations/20261108100200_account_closure_purge.sql`; Test `supabase/tests/account-closure-purge.test.ts`

**Interfaces — Produces:**
- `app.organization_claim_purge(p_organization_id uuid) returns boolean` — sets `purge_started_at`; false when already claimed or not due
- `app.organization_collect_objects(p_organization_id uuid) returns integer` — writes every storage key into `account_closure_objects`
- `app.organization_purge_data(p_organization_id uuid) returns jsonb` — deletes all tenant rows in dependency order, clears the tombstone, sets `closed_at`, returns the counts

The tombstone keeps `id`, `legal_name` (falling back to `name`) and the closure columns. Everything else descriptive is nulled; `name` becomes a neutral placeholder so the row cannot be mistaken for a live agency.

Carry a comment stating that deleting tenant data is not a violation of "money is never deleted" — that principle governs editing a live contract, not ending the relationship.

- [ ] **Step 1: Write the failing tests**

```ts
it('claims an account that is due, and refuses to claim it twice', ...)   // Review Focus 1
it('collects a storage key for every uploaded document', ...)
it('leaves no row in any table carrying this organization_id', ...)
it('leaves the organization row in place', ...)
it('keeps billing_customers, billing_subscriptions, billing_events', ...)
it('clears the descriptive fields but keeps the legal name', ...)
it('does not touch another agency', ...)
it('returns counts, and writes them to the evidence record', ...)
```

- [ ] **Step 2: Run and watch fail.**
- [ ] **Step 3: Write the migration.** 45 tables carry `organization_id`; enumerate them explicitly rather than looping over the catalogue — an explicit list fails loudly when a new table is added without being considered.
- [ ] **Step 4: Run and watch pass.**
- [ ] **Step 5: Commit.**

---

### Task 4: The runner — storage, auth, and resumability

**Files:** Create `supabase/functions/_shared/account-closure.ts`, `supabase/functions/account-closure/index.ts`; Modify `supabase/config.toml`; Test `supabase/tests/account-closure-runner.test.ts`

**Interfaces — Produces (in `_shared`, so it is testable):**
- `dueForPurge(rows, now): string[]`
- `usersToRemove(memberships): string[]` — only users whose **last** membership this was
- `nextSweepBatch(objects, batchSize): StorageKey[]`

`index.ts` holds only: authenticate the caller, loop the due organizations, and for each — claim, collect, sweep storage, purge, remove auth users and their `profiles` row — skipping any stage already done so a re-run completes rather than fails.

**The runner does not touch Stripe.** Cancelling a closing agency's subscription is a manual step taken in the Stripe dashboard, so this job never holds the Stripe secret: one unattended process that can both delete a tenant's data and move money is a larger blast radius than the 30-second dashboard action it would replace. `claim_purge` already refuses while a subscription is live, so a forgotten cancellation stops the purge rather than billing a purged customer.

**It must report what it refused.** Every run lists organizations that are suspended with a live subscription. The job's job is to make that situation impossible to miss, not to resolve it — an agency being billed for a read-only account it asked to close, with its data still present, is the worst outcome available here and it is silent unless something says so.

**The sweep re-checks closure state** rather than trusting the rows in `account_closure_objects`. Those rows name real storage objects, including identity-document scans; a stale or mistaken row is a live tenant's passport scan deleted.

- [ ] **Step 1: Write the failing tests**

```ts
it('returns only organizations past their purge date', ...)
it('skips one already claimed', ...)
it('removes a user whose last membership this was', ...)       // Review Focus 3
it('keeps a user who belongs to another agency', ...)          // Review Focus 3
it('resumes when the sweep stopped halfway', ...)              // Review Focus 2
it('is a no-op on a second run against the same organization', ...)
```

- [ ] **Step 2: Run and watch fail.**
- [ ] **Step 3: Implement.** Add `[functions.account-closure] verify_jwt = true` with a comment: this one is **not** public, unlike `pricing`.
- [ ] **Step 4: Run and watch pass.**
- [ ] **Step 5: Commit.**

---

### Task 5: Settings — request, confirm, restore

**Files:** Create `src/features/organization/closure.ts`, `queries.ts`, `src/features/organization/components/CloseAccountCard.tsx`; Modify `src/pages/SettingsPage.tsx`; Test `src/features/organization/closure.test.tsx`

**Interfaces — Produces:** `requestClosure(organizationId, { immediate })`, `restoreAccount(organizationId)`, `useClosureState()`, `CloseAccountCard`.

The card is visible to owners and admins; the **close** control only to owners. Confirmation requires the agency name typed exactly. The suspended state shows a banner on every page with the purge date and a restore button.

The confirmation must state plainly that the requesting owner's own login will be removed if this is their last membership.

- [ ] **Step 1: Write the failing tests**

```ts
it('shows no close control to an admin, but does show restore', ...)
it('shows nothing to a manager or staff', ...)
it('keeps the confirm button disabled until the name matches exactly', ...)
it('warns the owner their own login will be removed', ...)
it('shows the purge date while suspended', ...)
it('offers restore while suspended, and not once purging', ...)
```

- [ ] **Step 2–5:** fail, implement, pass, commit.

---

### Task 6: Telling people it happened

**Files:** Modify `supabase/functions/_shared/team-email.ts` or add a sibling; Modify Task 2's request function to enqueue; Test alongside.

Every owner and admin is emailed the moment closure is requested, and so is Adera Labs. This is the layer that makes a quiet closure impossible, and the one that starts the retention conversation.

**There is no confirmation-token flow.** It existed only to guard the self-serve immediate purge, which was removed: the button now requests closure rather than executing it.

**The operator's notification must say to cancel the subscription in Stripe**, and name the agency. Cancellation is manual by design, so this message is the only thing standing between a closure request and an agency being billed for an account it asked to close — while its data sits unpurged, because `claim_purge` refuses with a live subscription.

- [ ] **Steps:** failing tests (an email to every owner and admin; one to the operator naming the agency and saying to cancel in Stripe; nothing sent when the caller was refused), fail, implement, pass, commit.

---

### Task 7: The scheduler, and the documents

**Files:** Create `.github/workflows/account-closure.yml`; Modify `docs/security/data-retention.md`, the Terms and privacy pages.

The workflow runs daily and calls the Edge Function with a secret. It must fail loudly — a silently broken scheduler means data retained after a deletion instruction, which is the anti-goal.

The Terms gain closure, the 30-day grace, that purging sooner is by request to Adera Labs, and the no-refund position. The subscription wording must say the subscription is cancelled **when the request is processed**, not immediately — cancellation is a manual step, and the Terms must describe what actually happens rather than the better-sounding version. The privacy policy points at them. `data-retention.md` Gap 2 is closed, and Gap 1 (`gps_positions`) explicitly is **not** — it stays open.

- [ ] **Steps:** add the workflow; update the three documents; run `npm run verify`; commit.

---

## Deployment note

Not part of the tasks, and not to be done without the user saying so: three migrations need `npx supabase db push` after a `--dry-run`, the Edge Function needs deploying, and the GitHub Action needs its secret. Until the scheduler runs, closures suspend but never purge.

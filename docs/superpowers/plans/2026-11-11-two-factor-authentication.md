# Two-Factor Authentication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make TOTP two-factor authentication mandatory for every Pevvy user, enforced in the database, with recovery that cannot be used as a bypass.

**Architecture:** Enrolment runs entirely against the GoTrue MFA API, which does not pass through RLS — so an unenrolled user needs _zero_ database access, and a router guard placed above `WithWorkspace` can force enrolment without any carve-out in the policies. That is what makes it safe to enforce `aal2` inside the two existing authorization helpers (`app.is_org_member`, `app.has_min_role`), which propagates to every policy, every `security_invoker` view and the report read models at once. Recovery cannot mint an `aal2` session, so a recovery code instead authorises _deleting_ the factor via an Edge Function holding the service key, after which the user enrols again.

**Tech Stack:** Supabase Auth (GoTrue MFA, `totp`), `@supabase/supabase-js` 2.112.3, Postgres RLS, Deno Edge Functions, React 19 + React Router, Vitest + PGlite.

**Spec:** `docs/superpowers/specs/2026-11-11-two-factor-authentication-design.md`

## Global Constraints

- Migrations are append-only. A schema change is a new, later-dated file in `supabase/migrations/`. Never edit an existing migration.
- Every new SQL function is `security definer` with `set search_path = ''` and fully schema-qualified identifiers, matching `20260813090200_authorization.sql`.
- Factor type is `totp` only. No phone, no SMS, no email factor.
- No per-organization and no per-role 2FA policy. The requirement is universal. Do not build deadline storage, countdown banners or forced-enrolment clocks.
- `npm run verify` (format, lint, typecheck, unit + PGlite database tests, build) must pass before any task is considered done.
- Secrets never go in `VITE_` variables. Never print a secret, token or recovery code back to the user.
- Do not run `supabase config push` or `supabase db push` without a `--dry-run` first and the user's explicit approval.

## Deployment ordering — read before Task 3 reaches a live project

**TOTP must be enabled on the Supabase project BEFORE the Task 3 migration is applied to it.** If enforcement lands while `[auth.mfa.totp] enroll_enabled = false`, nobody can enrol, every session stays at `aal1`, and every user of every agency is locked out of all data with no path back except service-key SQL. This is the single way this work can brick a production system. The repo-side config change is part of Task 3; confirming it is live on the target project is a precondition for pushing that migration.

## Review Focus

These are the failure modes the spec implies but no obvious task test covers. Each has its test pinned to the task that owns the code.

1. **A session issued before MFA existed** carries no `aal` claim at all. It must be treated as not-passed, never as a pass — a missing claim defaulting to allow would silently disable the whole feature. (Task 3)
2. **An abandoned enrolment** leaves an unverified factor on the account. The next enrolment attempt must not fail or count against the 10-factor ceiling because of it. (Task 6)
3. **Service-role and Edge Function paths** have no `aal` claim. The predicate must not break the existing functions that act on a user's behalf. (Task 3)
4. **A recovery code must be single-use and compared without leaking timing**, and a spent code must never delete a second factor. (Task 2)
5. **A user who belongs to two agencies has one factor.** An owner of agency A resetting that user's factor also removes the protection they carry at agency B. The reset must be recorded with enough detail that agency B can see it happened. (Task 4)

---

## File Structure

| File                                                           | Responsibility                                                                        |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `supabase/migrations/20261112100000_security_events.sql`       | Audit table + `app.record_security_event`                                             |
| `supabase/migrations/20261112100100_mfa_recovery_codes.sql`    | Recovery code storage, generation, consumption                                        |
| `supabase/migrations/20261112100200_require_second_factor.sql` | `app.has_second_factor()` and its composition into the two helpers                    |
| `supabase/functions/_shared/mfa-reset.ts`                      | Factor-reset logic: recovery-code path and owner path. All testable logic lives here. |
| `supabase/functions/mfa-reset/index.ts`                        | Thin Deno entrypoint                                                                  |
| `src/features/auth/mfa.ts`                                     | Typed wrapper over the GoTrue MFA API                                                 |
| `src/features/auth/useSecondFactor.ts`                         | Hook exposing enrolment state to guards and pages                                     |
| `src/pages/auth/EnrollFactorPage.tsx`                          | Mandatory enrolment screen (QR + recovery codes)                                      |
| `src/pages/auth/ChallengeFactorPage.tsx`                       | 6-digit challenge after password                                                      |
| `src/app/routes/guards.tsx`                                    | `RequireSecondFactor` guard (modify)                                                  |
| `src/pages/SettingsPage.tsx`                                   | Security section: replace factor, regenerate codes (modify)                           |

---

## Task 1: Security event audit table

**Files:**

- Create: `supabase/migrations/20261112100000_security_events.sql`
- Test: `supabase/tests/security-events.test.ts`

**Interfaces:**

- Produces: table `public.security_events (id uuid, organization_id uuid null, actor_user_id uuid, subject_user_id uuid, event_type public.security_event_type, detail jsonb, created_at timestamptz)`; enum `public.security_event_type` with values `factor_enrolled`, `factor_removed`, `recovery_code_used`, `factor_reset_by_owner`, `factor_reset_by_operator`; function `app.record_security_event(p_event_type public.security_event_type, p_subject_user_id uuid, p_organization_id uuid, p_detail jsonb) returns uuid`.

- [ ] **Step 1: Write the failing test** in `supabase/tests/security-events.test.ts`, following the shape of `supabase/tests/account-closure-actions.test.ts` (`TestDatabase`, `signUp`, `addMember`, `db.asUser`). Assert:
  - `app.record_security_event('factor_enrolled', <user>, <org>, '{}'::jsonb)` inserts one row and returns its id.
  - An owner reading `public.security_events` sees rows for their own organization.
  - A `staff` member reading `public.security_events` sees none.
  - A user cannot `delete` or `update` a row they are the subject of — `authenticated` has no such grant.

- [ ] **Step 2: Run the test and watch it fail**

Run: `npx vitest run supabase/tests/security-events.test.ts`
Expected: FAIL — relation `public.security_events` does not exist.

- [ ] **Step 3: Write the migration.** Enum, table, indexes on `(organization_id, created_at desc)` and `(subject_user_id, created_at desc)`. Enable RLS. One `select` policy using `app.has_min_role(organization_id, 'owner')`. No insert/update/delete policy at all — writes arrive only through `app.record_security_event`, which is `security definer` with `set search_path = ''`.

- [ ] **Step 4: Run the test and watch it pass**

Run: `npx vitest run supabase/tests/security-events.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261112100000_security_events.sql supabase/tests/security-events.test.ts
git commit -m "feat: security event audit table"
```

---

## Task 2: Recovery codes

**Files:**

- Create: `supabase/migrations/20261112100100_mfa_recovery_codes.sql`
- Test: `supabase/tests/mfa-recovery-codes.test.ts`

**Interfaces:**

- Consumes: `app.record_security_event` from Task 1.
- Produces: table `public.mfa_recovery_codes (id uuid, user_id uuid, code_hash text, used_at timestamptz null, created_at timestamptz)`; `public.mfa_generate_recovery_codes() returns setof text` (replaces any existing unused codes for the caller, returns 10 plaintext codes, once); `app.mfa_consume_recovery_code(p_user_id uuid, p_code text) returns boolean` (marks exactly one matching unused code used, returns whether it matched).

**Decisions this task pins:** 10 codes; each 10 characters from Crockford base32 (no `I`, `L`, `O`, `U`); hashed with `extensions.crypt` using `gen_salt('bf')` consistent with existing practice; comparison via `crypt(p_code, code_hash) = code_hash`, which is constant-time within bcrypt.

- [ ] **Step 1: Write the failing test.** Assert:
  - `mfa_generate_recovery_codes()` returns exactly 10 distinct codes, and a second call replaces rather than appends (still 10 unused rows).
  - `app.mfa_consume_recovery_code(user, <valid code>)` returns `true` the first time and `false` the second — **Review Focus 4**, single use.
  - It returns `false` for a code belonging to a different user.
  - Consuming a code writes a `recovery_code_used` security event.
  - A user selecting directly from `public.mfa_recovery_codes` gets no rows — the plaintext never returns twice and the hashes are not readable.

- [ ] **Step 2: Run the test and watch it fail**

Run: `npx vitest run supabase/tests/mfa-recovery-codes.test.ts`
Expected: FAIL — function `public.mfa_generate_recovery_codes` does not exist.

- [ ] **Step 3: Write the migration.** Table with RLS enabled and **no policies** — all access is through the two functions. Both `security definer`, `set search_path = ''`.

- [ ] **Step 4: Run the test and watch it pass**

Run: `npx vitest run supabase/tests/mfa-recovery-codes.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261112100100_mfa_recovery_codes.sql supabase/tests/mfa-recovery-codes.test.ts
git commit -m "feat: single-use MFA recovery codes"
```

---

## Task 3: Require a second factor in the database

**This is the dangerous task.** Read "Deployment ordering" above before the migration reaches any live project.

**Files:**

- Create: `supabase/migrations/20261112100200_require_second_factor.sql`
- Modify: `supabase/tests/support/supabase-doubles.sql` (add an `auth.jwt()` double)
- Modify: `supabase/tests/support/harness.ts:70` (`asUser` gains an optional assurance level)
- Modify: `supabase/config.toml:385-387`
- Test: `supabase/tests/require-second-factor.test.ts`

**Interfaces:**

- Produces: `app.has_second_factor() returns boolean`; `app.is_org_member(uuid)` and `app.has_min_role(uuid, public.org_role)` both additionally require it.
- Produces: `db.asUser(userId, fn, { aal })` where `aal` defaults to `'aal2'`, so every existing test keeps passing unchanged.

- [ ] **Step 1: Add the `auth.jwt()` double** to `supabase/tests/support/supabase-doubles.sql`, reading `request.jwt.claims` the way `auth.uid()` at line 73 reads `request.jwt.claim.sub`, and returning `jsonb`. Extend `asUser`/`asServiceRole` in `harness.ts` to set `request.jwt.claims` to `{"aal": "<level>"}`, defaulting to `aal2`.

- [ ] **Step 2: Write the failing test** in `supabase/tests/require-second-factor.test.ts`. Assert, for a seeded agency with customer rows:
  - At `aal2`, the owner selects their customers and gets rows.
  - At `aal1`, the same select returns **zero rows** — through `public.customers`, through the `public.customer_directory` view, and through a report read model.
  - At `aal1`, `app.is_org_member(org)` and `app.has_min_role(org, 'staff')` are both `false`.
  - With **no `aal` claim at all**, the same select returns zero rows — **Review Focus 1**.
  - `asServiceRole` is unaffected and still reads rows — **Review Focus 3**.

- [ ] **Step 3: Run the test and watch it fail**

Run: `npx vitest run supabase/tests/require-second-factor.test.ts`
Expected: FAIL — the `aal1` cases return rows, because nothing enforces assurance yet.

- [ ] **Step 4: Write the migration.** `app.has_second_factor()` returns true only when `auth.jwt() ->> 'aal'` is exactly `'aal2'`; a null claim is false. Then `create or replace` both `app.is_org_member` and `app.has_min_role` to `and` it into their existing bodies, leaving the bodies otherwise byte-identical to `20260813090200_authorization.sql`. Update both `comment on function` strings to say the predicate now includes it.

- [ ] **Step 5: Run the full database suite** — every policy in the schema routes through these two functions, so this is the real blast radius check.

Run: `npx vitest run supabase/tests/`
Expected: PASS, all files.

- [ ] **Step 6: Set `enroll_enabled = true` and `verify_enabled = true`** under `[auth.mfa.totp]` in `supabase/config.toml`. Do not push it anywhere.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20261112100200_require_second_factor.sql supabase/tests/ supabase/config.toml
git commit -m "feat: require a verified second factor for all tenant data"
```

---

## Task 4: Factor reset logic

**Files:**

- Create: `supabase/functions/_shared/mfa-reset.ts`
- Test: `supabase/functions/_shared/mfa-reset.test.ts`

**Interfaces:**

- Consumes: `app.mfa_consume_recovery_code`, `app.record_security_event`.
- Produces: `resetOwnFactor(deps, { userId, recoveryCode }): Promise<ResetOutcome>` and `resetMemberFactor(deps, { actorUserId, subjectUserId, organizationId }): Promise<ResetOutcome>`, where `ResetOutcome = { ok: true; factorsRemoved: number } | { ok: false; reason: 'invalid_code' | 'not_permitted' | 'no_factor' }`. `deps` is an injected interface over the admin client and the database, following the dependency-injection shape of `supabase/functions/_shared/closure-notice.ts`.

- [ ] **Step 1: Write the failing test** with fake `deps`. Assert:
  - `resetOwnFactor` with a valid code deletes every factor for that user and returns `ok`.
  - With an invalid code it returns `invalid_code` **and deletes nothing** — Review Focus 4.
  - `resetMemberFactor` succeeds when the actor is an `owner` of the organization and the subject is an active member of it.
  - It returns `not_permitted` when the actor is `admin`, `manager` or `staff`, and when the subject is not a member of that organization.
  - Both paths record a security event naming actor and subject; the member path records `factor_reset_by_owner` with the organization id, so a second agency can see the reset — **Review Focus 5**.

- [ ] **Step 2: Run the test and watch it fail**

Run: `npx vitest run supabase/functions/_shared/mfa-reset.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `_shared/mfa-reset.ts`.** Factor deletion goes through the admin MFA delete on the injected client; it must never be attempted before the code or the role check has passed.

- [ ] **Step 4: Run the test and watch it pass**

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/mfa-reset.ts supabase/functions/_shared/mfa-reset.test.ts
git commit -m "feat: MFA factor reset logic"
```

---

## Task 5: Factor reset endpoint

**Files:**

- Create: `supabase/functions/mfa-reset/index.ts`
- Modify: `supabase/config.toml` (add `[functions.mfa-reset] verify_jwt = true`)

**Interfaces:**

- Consumes: `resetOwnFactor`, `resetMemberFactor` from Task 4.
- Produces: `POST /mfa-reset` taking `{ mode: 'self', recoveryCode }` or `{ mode: 'member', subjectUserId, organizationId }`.

- [ ] **Step 1: Write the entrypoint**, matching the structure of the existing function entrypoints: parse and validate the body, build the real `deps`, call the Task 4 function, map `ResetOutcome` to a status code (`ok` → 200, `invalid_code` → 400, `not_permitted` → 403, `no_factor` → 404). The entrypoint holds no logic of its own — it is outside `tsconfig.test.json` and therefore untested by design.

- [ ] **Step 2: Register it** in `supabase/config.toml` with `verify_jwt = true`. `mode: 'self'` must work for an `aal1` caller, which is the whole point.

- [ ] **Step 3: Verify the build**

Run: `npm run verify`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/mfa-reset/index.ts supabase/config.toml
git commit -m "feat: mfa-reset endpoint"
```

---

## Task 6: Client MFA wrapper

**Files:**

- Create: `src/features/auth/mfa.ts`
- Create: `src/features/auth/useSecondFactor.ts`
- Test: `src/features/auth/mfa.test.ts`

**Interfaces:**

- Produces: `listFactorState(): Promise<FactorState>` where `FactorState = { status: 'none' | 'unverified' | 'verified'; factorId: string | null }`; `beginEnrolment(): Promise<{ factorId: string; qrCodeSvg: string; secret: string }>`; `completeEnrolment(factorId: string, code: string): Promise<void>`; `challenge(factorId: string, code: string): Promise<void>`; `assuranceLevel(): Promise<'aal1' | 'aal2'>`.
- Produces: `useSecondFactor(): { state: FactorState | null; isLoading: boolean; refresh: () => void }`.

- [ ] **Step 1: Write the failing test** against a mocked Supabase client, in the style of `src/lib/supabase/client.test.ts`. Assert:
  - `listFactorState` reports `verified` only for a factor whose status is `verified`, and `unverified` for an abandoned enrolment.
  - **`beginEnrolment` removes a pre-existing unverified factor before enrolling a new one**, so an abandoned attempt neither fails the next one nor accumulates against the 10-factor ceiling — **Review Focus 2**.
  - Errors from the client are converted with `toAppError`, matching `src/features/auth/api.ts`.

- [ ] **Step 2: Run the test and watch it fail**

Run: `npx vitest run src/features/auth/mfa.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement both files.** `useSecondFactor` must not call into supabase-js from an `onAuthStateChange` callback — see the warning at `src/features/auth/AuthProvider.tsx:43`; read factor state from an effect keyed on the session instead.

- [ ] **Step 4: Run the test and watch it pass**

- [ ] **Step 5: Commit**

```bash
git add src/features/auth/mfa.ts src/features/auth/useSecondFactor.ts src/features/auth/mfa.test.ts
git commit -m "feat: client MFA wrapper"
```

---

## Task 7: Enrolment and challenge screens

**Files:**

- Create: `src/pages/auth/EnrollFactorPage.tsx`
- Create: `src/pages/auth/ChallengeFactorPage.tsx`
- Create: `src/pages/auth/RecoverFactorPage.tsx`
- Test: `src/pages/auth/EnrollFactorPage.test.tsx`, `src/pages/auth/ChallengeFactorPage.test.tsx`, `src/pages/auth/RecoverFactorPage.test.tsx`
- Modify: `src/app/routes/paths.ts` (add `enrollFactor: '/sign-in/set-up'`, `challengeFactor: '/sign-in/verify'`, `recoverFactor: '/sign-in/recover'`)

**Interfaces:**

- Consumes: everything from Task 6, and `mfa_generate_recovery_codes` via the Supabase client.

- [ ] **Step 1: Write the failing tests.** For enrolment, assert: the QR code and the typed-entry secret both render; a wrong code shows an error and does not advance; a correct code shows the 10 recovery codes with an explicit acknowledgement control before the user can continue; the codes are shown exactly once. For the challenge screen, assert: a wrong code shows an error and allows a retry; a correct code navigates to the route the user was heading for; a "lost your device" control routes to `paths.recoverFactor`. For the recovery screen, assert: submitting a code calls the Task 5 endpoint with `mode: 'self'`; a rejected code (`invalid_code`) shows an error and does not navigate; an accepted code sends the user to `paths.enrollFactor` to set up a new authenticator; the copy states plainly that the old authenticator stops working.

- [ ] **Step 2: Run them and watch them fail**

- [ ] **Step 3: Implement both pages**, following `src/pages/auth/SignInPage.tsx` for layout (`AuthLayout`), form handling and error presentation. Copy must state plainly that recovery codes are shown once and that using one removes the current authenticator.

- [ ] **Step 4: Run the tests and watch them pass**

- [ ] **Step 5: Commit**

```bash
git add src/pages/auth/ src/app/routes/paths.ts
git commit -m "feat: MFA enrolment and challenge screens"
```

---

## Task 8: Force enrolment, and manage it in settings

**Files:**

- Modify: `src/app/routes/guards.tsx` (add `RequireSecondFactor`)
- Modify: `src/app/routes/AppRouter.tsx:277-284`
- Modify: `src/pages/SettingsPage.tsx`
- Modify: `src/pages/team/TeamPage.tsx` (owner's reset-a-member control)
- Test: `src/app/routes/guards.test.tsx`, `src/pages/SettingsPage.test.tsx`, and the Team page's existing test file

**Interfaces:**

- Consumes: `useSecondFactor` from Task 6; the routes from Task 7.

- [ ] **Step 1: Write the failing tests.** For the guard, assert: a signed-in user with no verified factor is redirected to `paths.enrollFactor` from every protected route; a user with a verified factor but an `aal1` session is redirected to `paths.challengeFactor`; a user at `aal2` passes through; the enrolment and challenge routes themselves are never redirected into a loop. For settings, assert the security section shows enrolment state, offers to replace the authenticator, and offers to regenerate recovery codes. For the Team page, assert: an owner sees a reset control against each other member and using it calls the Task 5 endpoint with `mode: 'member'` and that member's id; a `manager` and a `staff` member see no such control; the control states that the member will have to enrol again.

- [ ] **Step 2: Run them and watch them fail**

- [ ] **Step 3: Implement.** Place `RequireSecondFactor` **between `RequireAuth` and `WithWorkspace`** at `AppRouter.tsx:277-278`. This ordering is load-bearing: `WithWorkspace` reads from the database, and after Task 3 an `aal1` session reads nothing, so the guard must stop the user before that provider mounts.

- [ ] **Step 4: Run the whole suite**

Run: `npm run verify`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/app/routes/ src/pages/SettingsPage.tsx
git commit -m "feat: require a second factor to reach the application"
```

---

## Self-review notes

- **Spec coverage:** every section of the design maps to a task — factor type (6, 7), enforcement (3), recovery codes (2, 7), owner reset (4, 5), operator runbook (documentation, Task 4's `deps` make the SQL path obvious), audit table (1), forced enrolment (8), config change (3). The operator break-glass remains a runbook by design, not a task.
- **Not covered by any task, by decision:** the `aal1` carve-out the design left open turned out to be empty — enrolment uses the GoTrue API only, so no policy needs an exception. If an implementer finds a database read on the enrolment path, that is a signal the guard is in the wrong place, not a reason to widen a policy.

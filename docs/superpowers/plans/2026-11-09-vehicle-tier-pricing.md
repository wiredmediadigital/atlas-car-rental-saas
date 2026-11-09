# Vehicle-tier pricing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sell Pevvy as three tiers priced by fleet size, enforced in the database, with an in-app way to change tier.

**Architecture:** A migration authors the plan-key → vehicle-limit mapping so a Stripe catalogue sync can never erase it, and `app.vehicle_limit_of` resolves an agency's limit from its effective subscription with a per-agency override taking precedence. Triggers on `vehicles` enforce the limit on insert and un-archive; a transactional RPC enforces it for bulk import. A new `change_plan` billing action is where the downgrade refusal lives, because the hosted portal cannot refuse anything.

**Tech Stack:** Postgres (Supabase migrations, PGlite tests), Deno Edge Functions, React 19 + TypeScript, TanStack Query, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-08-vehicle-tier-pricing-design.md`

## Global Constraints

- Never edit an existing file in `supabase/migrations/`; every schema change is a new, later-dated file.
- **No new `VITE_` variable.** Anything `VITE_`-prefixed is compiled into the browser bundle.
- **Do not rewrite the existing write gate.** `app.may_write` / `app.billing_may_write` has 87 call sites, 75 of them RLS policies. The vehicle limit is a separate rule with a separate sentence, and must not be folded into that gate.
- **The limit never applies retroactively.** No migration, trigger or code may archive, hide or restrict an existing vehicle.
- **`platform_unconfigured` stays exempt**, and a missing limit means no limit (fail open), reported through `reportPlatformState`.
- The authored mapping is exactly: `starter_monthly` 5, `starter_yearly` 5, `pro_monthly` 20, `pro_yearly` 20, `business_monthly` 50, `business_yearly` 50.
- Tier display names are **Starter**, **Pro**, **Business**. The middle tier is Pro, not Growth.
- A catalogue refresh must not be able to change or erase an enforced limit.
- Monthly and yearly of the same tier resolve to the **same** limit.
- The limit is read from `app.billing_effective_subscription`, never from a second "which subscription" implementation.
- Never print a secret key, access token, database password or invitation link back to the user.

## Review Focus

Input classes the spec implies that no happy path exercises. Each gets its test in the owning task.

1. **Archive, add, then restore** — the trivial bypass. Archiving frees a slot and re-adding fills it; restoring the archived vehicle must then be refused. (Task 2)
2. **Two adds racing at the last slot** — the check and the insert must not be separable, or both succeed. The gate is a trigger inside the write, never a read-then-write in the client. (Task 2)
3. **An import that exactly fills the remaining slots, and one that exceeds them by a single row** — the first succeeds whole, the second is refused whole with nothing written. (Task 3)
4. **An agency with no limit at all** — `platform_unconfigured`, or a plan key with no authored row. Adding must work, the counter must be hidden, and the operator must be told. (Tasks 1 and 4)
5. **A downgrade that becomes allowed as the fleet shrinks** — refusal is recomputed per attempt and clears itself, and a user without `billing.manage` is never offered the control. (Task 7, Task 8)

---

### Task 1: Authored limits and the resolver

**Files:**

- Create: `supabase/migrations/20261109100000_plan_vehicle_limits.sql`
- Test: `supabase/tests/vehicle-limits.test.ts`

**Interfaces:**

- Consumes: `app.billing_effective_subscription(uuid)`, `app.billing_platform_configured()`, `public.organizations`.
- Produces:
  - `public.plan_vehicle_limits (plan_key text primary key, tier text not null, vehicle_limit integer not null check (vehicle_limit > 0))` — authored, seeded with the six rows, and written by no sync.
  - `organizations.vehicle_limit_override integer`, `organizations.vehicle_limit_override_set_by uuid`, `organizations.vehicle_limit_override_set_at timestamptz`.
  - `app.vehicle_limit_of(p_organization_id uuid) returns integer` — the override if set, else the effective subscription's plan limit, else `null` meaning no limit.
  - `app.vehicle_count_of(p_organization_id uuid) returns integer` — vehicles with `archived_at is null`.

- [ ] **Step 1: Write the failing database tests**

```ts
test('resolves 5 for a starter_monthly subscription', ...)
test('resolves the same limit for starter_monthly and starter_yearly', ...)
test('resolves 20 for pro_monthly and 50 for business_monthly', ...)
test('resolves the tier limit for a trialing subscription', ...)
test('returns null when the plan key has no authored row', ...)
test('returns null when the agency has no subscription', ...)
test('prefers the per-agency override over the plan limit', ...)
test('counts only unarchived vehicles', ...)
test('refuses an authenticated write to vehicle_limit_override', ...)
```

The override test asserts precedence with a plan that resolves to 5 and an override of 150, expecting 150.

- [ ] **Step 2: Run them and watch them fail**

Run: `npm run test:db -- vehicle-limits`
Expected: FAIL — `plan_vehicle_limits` does not exist.

- [ ] **Step 3: Write the migration**

Seed the six rows from the Global Constraints table. Guard the three override columns against `authenticated` and `anon` with a BEFORE UPDATE trigger, in the same shape as `guard_organization_closure_columns` in `20261108100000_account_closure_state.sql` — the override is service-role only, so an agency cannot raise its own ceiling.

`app.vehicle_limit_of` is `stable`, `security definer`, `set search_path = ''`.

- [ ] **Step 4: Run them and watch them pass**

Run: `npm run test:db -- vehicle-limits`
Expected: PASS

- [ ] **Step 5: Prove the catalogue sync cannot touch the limits**

Add to the same test file:

```ts
test('a catalogue replace leaves plan_vehicle_limits untouched', ...)
```

Call `app.billing_catalogue_replace` with a payload for `starter_monthly` and assert the authored limit is still 5 afterwards. This is the trap the spec names; without this test the plan's central decision is unproven.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20261109100000_plan_vehicle_limits.sql supabase/tests/vehicle-limits.test.ts
git commit -m "feat: author the vehicle limit for each plan key"
```

---

### Task 2: Enforce the limit on add and un-archive

**Files:**

- Create: `supabase/migrations/20261109100100_vehicle_limit_enforcement.sql`
- Test: `supabase/tests/vehicle-limit-enforcement.test.ts`

**Interfaces:**

- Consumes: `app.vehicle_limit_of`, `app.vehicle_count_of` (Task 1).
- Produces: a BEFORE INSERT trigger and a BEFORE UPDATE trigger on `public.vehicles`, both raising errcode `55000` with the message `Your plan covers N vehicles. You have N.` — the UI adds the ways out; the database states the fact.

- [ ] **Step 1: Write the failing tests**

```ts
test('allows the fifth vehicle on starter', ...)
test('refuses the sixth vehicle on starter', ...)
test('allows any number when the agency has no limit', ...)
test('allows the insert when an override raises the ceiling', ...)
test('refuses restoring an archived vehicle when the fleet is full', ...)   // Review Focus 1
test('allows restoring when a slot is free', ...)
test('allows archiving regardless of the limit', ...)
test('leaves an over-limit agency able to edit and rent what it has', ...)  // not retroactive
test('refuses the second of two concurrent inserts at the last slot', ...)  // Review Focus 2
```

The concurrency test runs both inserts in one transaction sequence against the same last slot and asserts exactly one succeeds.

The not-retroactive test sets an override of 1 on an agency holding 3 vehicles, then asserts an `update` of a name and a rental insert both still succeed.

- [ ] **Step 2: Run them and watch them fail**

Run: `npm run test:db -- vehicle-limit-enforcement`
Expected: FAIL — inserts past the limit succeed.

- [ ] **Step 3: Write the migration**

The UPDATE trigger fires only on the archived-to-active transition (`old.archived_at is not null and new.archived_at is null`); every other update passes untouched, which is what keeps the rule non-retroactive.

- [ ] **Step 4: Run them and watch them pass**

Run: `npm run test:db -- vehicle-limit-enforcement`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261109100100_vehicle_limit_enforcement.sql supabase/tests/vehicle-limit-enforcement.test.ts
git commit -m "feat: refuse a vehicle past the plan's limit"
```

---

### Task 3: A transactional import

**Files:**

- Create: `supabase/migrations/20261109100200_vehicles_import_batch.sql`
- Test: `supabase/tests/vehicles-import-batch.test.ts`

**Interfaces:**

- Consumes: `app.vehicle_limit_of`, `app.vehicle_count_of` (Task 1); the Task 2 triggers remain the backstop.
- Produces: `public.vehicles_import_batch(p_organization_id uuid, p_rows jsonb) returns setof public.vehicles` — one transaction, capacity checked before any row is written, refusing with errcode `55000` and a message naming how many slots are free.

- [ ] **Step 1: Write the failing tests**

```ts
test('imports a batch that exactly fills the remaining slots', ...)        // Review Focus 3
test('refuses a batch one row over, writing nothing', ...)                // Review Focus 3
test('names the number of free slots in the refusal', ...)
test('imports any size when the agency has no limit', ...)
test('refuses a caller who is not a member of the organization', ...)
```

The refusal test asserts the vehicle count is unchanged afterwards — a partial import is the anti-goal, so the assertion is on the table, not only on the error.

- [ ] **Step 2: Run them and watch them fail**

Run: `npm run test:db -- vehicles-import-batch`
Expected: FAIL — function does not exist.

- [ ] **Step 3: Write the migration**

Membership and write-gate checks follow the existing RPCs in `20260814100100_vehicle_fleet_model.sql`. The capacity check reads the count inside the same transaction as the inserts so it cannot be raced.

- [ ] **Step 4: Run them and watch them pass**

Run: `npm run test:db -- vehicles-import-batch`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261109100200_vehicles_import_batch.sql supabase/tests/vehicles-import-batch.test.ts
git commit -m "feat: import vehicles as one transactional batch"
```

---

### Task 4: The counter, and what the limit says

**Files:**

- Create: `src/features/vehicles/limit.ts`
- Create: `src/features/vehicles/limit.test.tsx`
- Modify: `src/features/vehicles/api.ts` (add `fetchVehicleLimit`)
- Modify: `src/features/vehicles/queries.ts` (add `useVehicleLimit`)
- Modify: `src/pages/vehicles/VehiclesPage.tsx` (the counter beside the heading)

**Interfaces:**

- Consumes: `app.vehicle_limit_of`, `app.vehicle_count_of` (Task 1).
- Produces:
  - Create: `supabase/migrations/20261109100300_vehicle_limit_status.sql` — `public.vehicle_limit_status(p_organization_id uuid) returns table (vehicle_limit integer, vehicle_count integer, tier text)`, member-gated like `fleet_status_counts`. A **new** migration: Task 1's file is already committed and must not be edited.
  - `interface VehicleLimitStatus { limit: number | null; count: number; tier: string | null }`
  - `useVehicleLimit(): UseQueryResult<VehicleLimitStatus>`
  - `vehicleLimitCopy(status: VehicleLimitStatus, canManageBilling: boolean): { sentence: string; showUpgradeButton: boolean } | null` — the at-limit sentence.
  - `downgradeRefusalCopy(targetTier: string, targetLimit: number, count: number): string` — the different sentence Task 7 needs, living in the same file so the two cannot drift.

- [ ] **Step 1: Write the failing tests**

```ts
test('shows "5 of 5" beside the heading', ...)
test('hides the counter when there is no limit', ...)                     // Review Focus 4
test('tells an owner to upgrade and offers the button', ...)
test('tells a staff member to ask an owner or admin, with no button', ...)
test('says nothing while the fleet is below the limit', ...)
```

The copy assertions use the spec's exact wording: `Starter covers 5 vehicles. You have 5. Upgrade to Pro for 20 vehicles, or retire one you no longer rent.` and the staff variant ending `ask an owner or admin to upgrade`.

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/features/vehicles/limit.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `vehicleLimitCopy` and the query**

`showUpgradeButton` is `canManageBilling`, which the caller reads from `usePermission('billing.manage')`. The component never decides permissions itself.

- [ ] **Step 4: Run them and watch them pass**

Run: `npx vitest run src/features/vehicles/limit.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/features/vehicles/limit.ts src/features/vehicles/limit.test.tsx src/features/vehicles/api.ts src/features/vehicles/queries.ts src/pages/vehicles/VehiclesPage.tsx
git commit -m "feat: show the fleet against its limit"
```

---

### Task 5: Point the importer at the batch RPC

**Files:**

- Modify: `src/features/vehicles/api.ts` (add `importVehicles`)
- Modify: `src/features/vehicles/components/VehicleImportDialog.tsx:143` (replace the per-row `createVehicle` loop)
- Test: `src/features/vehicles/components/VehicleImportDialog.test.tsx`

**Interfaces:**

- Consumes: `public.vehicles_import_batch` (Task 3), `vehicleLimitCopy` (Task 4).
- Produces: `importVehicles(organizationId: string, rows: readonly VehicleFormValues[]): Promise<Vehicle[]>`.

- [ ] **Step 1: Write the failing tests**

```ts
test('sends every valid row in one call', ...)
test('shows the refusal and imports nothing when the batch exceeds the limit', ...)
test('does not call the importer at all when no rows are valid', ...)
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/features/vehicles/components/VehicleImportDialog.test.tsx`
Expected: FAIL — still one call per row.

- [ ] **Step 3: Replace the loop with one `importVehicles` call**

The dialog's existing per-row progress reporting has nothing to count once the import is a single call; report the batch outcome instead of a row counter.

- [ ] **Step 4: Run them and watch them pass**

Run: `npx vitest run src/features/vehicles/components/VehicleImportDialog.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/features/vehicles/api.ts src/features/vehicles/components/VehicleImportDialog.tsx src/features/vehicles/components/VehicleImportDialog.test.tsx
git commit -m "feat: import a vehicle batch in one call"
```

---

### Task 6: The `change_plan` billing action

**Files:**

- Modify: `supabase/functions/_shared/billing-domain.ts` (add `changePlanParams`)
- Modify: `supabase/functions/billing/index.ts` (add `case 'change_plan'` beside `checkout`)
- Test: `supabase/functions/tests/billing-change-plan.test.ts`

**Interfaces:**

- Consumes: `app.billing_resolve_plan`, `app.vehicle_limit_of`, `app.vehicle_count_of`, `stripe.request`.
- Produces: a `change_plan` action taking `{ organizationId, planKey }` and returning `{ ok: true }` or a `failure` code. Two new failure codes: `over_target_limit` and `no_subscription`.

- [ ] **Step 1: Write the failing tests**

```ts
test('upgrades immediately', ...)
test('refuses a downgrade while the fleet exceeds the target tier limit', ...)
test('allows the same downgrade once the fleet is under the target limit', ...)  // Review Focus 5
test('refuses when the agency has no live subscription', ...)
test('resolves the price from the catalogue and never from the request body', ...)
test('keeps the remaining trial days when a trialing agency changes tier', ...)
```

The price-tampering test sends a `stripe_price_id` in the body and asserts it is not used — the same defence `checkout` already has.

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run supabase/functions/tests/billing-change-plan.test.ts`
Expected: FAIL — unknown action.

- [ ] **Step 3: Implement the action**

The refusal is computed from `app.vehicle_count_of` against the **target** plan's authored limit, not the current one. The Stripe call updates the subscription item's price with proration left at Stripe's default; the trial is preserved by not sending `trial_end`.

- [ ] **Step 4: Run them and watch them pass**

Run: `npx vitest run supabase/functions/tests/billing-change-plan.test.ts`
Expected: PASS

- [ ] **Step 5: Add the new entrypoint to `eslint.config.js` ignores if it is a new file, then run `npx eslint .`**

Expected: 0 errors. (Both new Deno functions this year were missed here; only a repo-wide lint shows it.)

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/_shared/billing-domain.ts supabase/functions/billing/index.ts supabase/functions/tests/billing-change-plan.test.ts
git commit -m "feat: change plan in app, where the downgrade rule can be enforced"
```

---

### Task 7: Changing tier from the Billing page

**Files:**

- Modify: `src/features/billing/api.ts` (add `changePlan`)
- Modify: `src/features/billing/queries.ts` (add `useChangePlan`)
- Modify: `src/features/billing/components/` (the plan list gains a change control)
- Test: `src/features/billing/change-plan.test.tsx`

**Interfaces:**

- Consumes: the `change_plan` action (Task 6), `downgradeRefusalCopy` (Task 4), `usePermission('billing.manage')`.
- Produces: `changePlan(organizationId: string, planKey: string): Promise<BillingActionResult>`, `useChangePlan()`.

- [ ] **Step 1: Write the failing tests**

```ts
test('offers a higher tier to an owner', ...)
test('does not offer any tier change to a staff member', ...)            // Review Focus 5
test('shows the gap when a downgrade is refused', ...)
test('shows the current tier as current, not as an option', ...)
```

The refusal assertion uses the spec's wording: `Starter covers 5 vehicles. You have 12. Retire 7 to move down.`

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/features/billing/change-plan.test.tsx`
Expected: FAIL — no change control rendered.

- [ ] **Step 3: Implement the control and wire the mutation**

- [ ] **Step 4: Run them and watch them pass**

Run: `npx vitest run src/features/billing/change-plan.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/features/billing src/features/billing/change-plan.test.tsx
git commit -m "feat: change tier from the Billing page"
```

---

### Task 8: Three tiers on the pricing page

**Files:**

- Modify: `supabase/functions/_shared/public-pricing.ts` (carry `displayName` and `vehicleLimit`)
- Modify: `src/features/marketing/api.ts:11-17` (`PublicPlan` gains `displayName: string` and `vehicleLimit: number | null`)
- Modify: `src/features/marketing/renderable-pricing.ts`
- Modify: `src/pages/marketing/components/PricingSection.tsx`
- Test: `src/pages/marketing/components/PricingSection.test.tsx`, `src/features/marketing/renderable-pricing.test.ts`

**Interfaces:**

- Consumes: `public.billing_public_pricing` and `plan_vehicle_limits` (Task 1).
- Produces: `PublicPlan` with `displayName` and `vehicleLimit`.

**Note:** `PublicPlan` currently has no display name at all, so the page cannot print "Starter" until the public payload carries it. That widening is the first half of this task.

- [ ] **Step 1: Write the failing tests**

```ts
test('renders three tiers with their vehicle allowances', ...)
test('switches every card between monthly and yearly', ...)
test('marks Pro as the popular tier', ...)
test('renders a talk-to-us card above 50 vehicles with no price', ...)
test('renders nothing when pricing is unconfigured', ...)
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/pages/marketing/components/PricingSection.test.tsx`
Expected: FAIL — one plan rendered, no interval toggle.

- [ ] **Step 3: Widen the payload, then render the four cards**

The talk-to-us card is static content with a `mailto:` to `SUPPORT_EMAIL` from `src/features/help/constants.ts` — it is not a plan and must not be fabricated into the plans array.

- [ ] **Step 4: Run them and watch them pass**

Run: `npx vitest run src/pages/marketing/components/PricingSection.test.tsx src/features/marketing/renderable-pricing.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/public-pricing.ts src/features/marketing src/pages/marketing/components/PricingSection.tsx
git commit -m "feat: show three tiers and a talk-to-us card"
```

---

### Task 9: Configuration, operator surface and documents

**Files:**

- Modify: `supabase/functions/billing/index.ts` (report a missing limit through `reportPlatformState`)
- Modify: `docs/` — deployment notes for `BILLING_PLAN_CATALOGUE` and `BILLING_TRIAL_DAYS`
- Modify: `src/content/help/vehicles.md`
- Test: `supabase/functions/tests/billing-change-plan.test.ts` (extend)

- [ ] **Step 1: Write the failing test**

```ts
test('reports an active plan with no authored vehicle limit', ...)   // Review Focus 4
test('reports a subscription whose tier is below the agency fleet size', ...)
```

The second covers the spec's webhook case: a lower tier arriving from outside the product (an operator editing Stripe directly). The agency keeps every vehicle — nothing here is retroactive — and the mismatch is surfaced to the operator rather than resolved. Assert that no vehicle was archived.

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run supabase/functions/tests/billing-change-plan.test.ts`
Expected: FAIL — nothing reported.

- [ ] **Step 3: Report it, and write the operator notes**

The notes state three things an operator must do outside the code, none of which this plan performs: all six plan keys in `BILLING_PLAN_CATALOGUE`, `BILLING_TRIAL_DAYS=14`, and **the hosted Stripe portal reconfigured so it cannot switch plans** — leaving plan-switching enabled there is the back door that undoes Task 6.

Help content gains the counter and what happens at the limit. It must not promise an immediate purge, a refund, or any tier above Business.

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run supabase/functions/tests/billing-change-plan.test.ts`
Expected: PASS

- [ ] **Step 5: Run the whole suite**

Run: `npm run verify`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/billing/index.ts docs src/content/help/vehicles.md
git commit -m "docs: operator steps for the three tiers"
```

---

## Deployment note

Not part of the tasks, and not to be done without the user saying so: three migrations need `npx supabase db push` after a `--dry-run`, the `billing` Edge Function needs redeploying, `BILLING_PLAN_CATALOGUE` needs all six keys, `BILLING_TRIAL_DAYS` needs setting to 14, and the Stripe customer portal needs plan-switching turned off. Until the portal is reconfigured, the downgrade rule has a back door.

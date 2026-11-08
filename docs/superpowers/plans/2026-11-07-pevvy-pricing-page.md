# Pricing on the marketing site — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show Pevvy's real Stripe price on the marketing home page, and show nothing at all when there is no real price to show.

**Architecture:** A new public Edge Function reads `public.billing_plans` — which already mirrors Stripe and already carries every display field — with the service role, refreshing it from Stripe only when its newest row is older than a TTL. That timestamp is what bounds a public path to the Stripe API across function instances. The browser gets a small JSON payload and never touches the table, so the existing owners-only RLS policy is unchanged. The marketing section renders only when that payload contains at least one plan.

**Tech Stack:** Supabase Edge Functions (Deno), Postgres, React 19 + TypeScript, TanStack Query, Tailwind, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-11-07-pevvy-pricing-page-design.md`

## Global Constraints

- `[functions.billing] verify_jwt = true` in `supabase/config.toml` is not to be changed.
- No `VITE_` variable carries a Stripe key; the secret key stays server-side.
- Never edit an existing file in `supabase/migrations/`. This work needs no migration.
- No RLS policy is added, altered or dropped. `billing_plans_select` stays owners-only.
- Edge function logic goes in `supabase/functions/_shared/`; `index.ts` is outside tsconfig and cannot be tested.
- **No state may display a price that is not Stripe's current one.** No fallback figure, no hardcoded amount, no "from $X" in copy.
- Missing configuration is a state, not a fault: it is answered calmly, never as an error.

## Review Focus

Input classes the spec implies that no task's happy path exercises. Each has its test added to the task that owns the code.

1. **A plan key that disagrees with its Stripe interval** — `pro_yearly` stored with `interval='month'`. The label must follow the interval, never the key. (Task 2)
2. **Two plans in different currencies** — the saving must be suppressed, never computed across currencies. (Task 5)
3. **Rows exist but every one is `is_active = false`** — the section hides; it does not render an empty card. (Task 2, Task 5)
4. **`configured: true` with zero plans** — Stripe is reachable, the catalogue resolved nothing. The section hides. (Task 2, Task 6)
5. **`trialDays = 0`** — the call to action renders with no trial copy, never "free for 0 days". (Task 5)

---

## File Structure

| File | Responsibility |
|---|---|
| `supabase/functions/_shared/billing-catalogue.ts` | **New.** The Stripe-price→plan-row mapping and the catalogue refresh, moved out of `billing/index.ts` so both callers share one copy and the mapping is testable. |
| `supabase/functions/_shared/public-pricing.ts` | **New.** Staleness decision and the public payload shape. Pure. |
| `supabase/functions/pricing/index.ts` | **New.** HTTP boundary: method check, CORS, service client, calls the two modules above. |
| `supabase/functions/billing/index.ts` | **Modify.** Imports the extracted refresh instead of defining it. |
| `supabase/config.toml` | **Modify.** `[functions.pricing] verify_jwt = false`. |
| `src/features/marketing/api.ts` | **New.** `fetchPublicPricing()`. |
| `src/features/marketing/queries.ts` | **New.** `usePublicPricing()`. |
| `src/pages/marketing/components/PricingSection.tsx` | **New.** The card, toggle, saving, CTA. Renders `null` when there is nothing real to show. |
| `src/pages/marketing/MarketingHomePage.tsx` | **Modify.** Place the section. |
| `src/pages/marketing/components/MarketingHeader.tsx` | **Modify.** Conditional "Pricing" nav link. |
| `src/pages/marketing/components/Faq.tsx` | **Modify.** Conditional cost entry. |

---

### Task 1: Extract the catalogue refresh so two callers can share it

`refreshCatalogue` currently lives in `billing/index.ts`, which no test can reach. The pricing function needs the same logic, and a second copy would be the drift this project exists to avoid.

**Files:**
- Create: `supabase/functions/_shared/billing-catalogue.ts`
- Modify: `supabase/functions/billing/index.ts:144-208` (remove the function, import it)
- Test: `supabase/tests/billing-catalogue.test.ts`

**Interfaces:**
- Consumes: `BillingConfig`, `CatalogueEntry` from `_shared/stripe-config.ts`; `StripeClient` from `_shared/stripe-api.ts`.
- Produces:
  - `interface StripePriceShape { id: string; active?: boolean; currency?: string; unit_amount?: number | null; livemode?: boolean; lookup_key?: string | null; product?: string | { id?: string }; nickname?: string | null; recurring?: { interval?: string; interval_count?: number } | null }`
  - `export function priceToPlanRow(price: StripePriceShape, planKey: string, sortOrder: number, mode: 'test' | 'live'): Record<string, unknown> | null` — `null` means skip.
  - `export async function refreshCatalogue(service: SupabaseClient, stripe: StripeClient, config: BillingConfig): Promise<number>` — unchanged behaviour and signature.

- [ ] **Step 1: Write the failing tests** in `supabase/tests/billing-catalogue.test.ts`

```ts
it('skips an archived price', () => expect(priceToPlanRow({ id: 'price_1', active: false, ... }, 'pro_monthly', 0, 'test')).toBeNull())
it('skips a price from the other Stripe mode', ...)            // livemode true, mode 'test'
it('skips a one-off price with no recurring interval', ...)
it('skips a price with no unit amount', ...)
it('falls back to the plan key when the nickname is empty', ...)       // display_name === 'pro_monthly'
it('falls back to the plan key when the nickname exceeds 80 characters', ...)
it('upper-cases the currency', ...)                                     // 'usd' -> 'USD'
it('defaults interval_count to 1 when Stripe omits it', ...)
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run supabase/tests/billing-catalogue.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `_shared/billing-catalogue.ts`**

Move the body of `refreshCatalogue` verbatim, splitting the per-price filtering and field mapping into `priceToPlanRow`. Behaviour must not change: the same four skip conditions, the same nickname fallback and its reason, the same `app.billing_replace_catalogue` call.

- [ ] **Step 4: Point `billing/index.ts` at it** — delete the local definition, import from `../_shared/billing-catalogue.ts`.

- [ ] **Step 5: Verify**

Run: `npm run verify`
Expected: PASS, with the existing billing tests unchanged.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/_shared/billing-catalogue.ts supabase/functions/billing/index.ts supabase/tests/billing-catalogue.test.ts
git commit -m "refactor(billing): share the catalogue refresh, and test its skip rules"
```

---

### Task 2: The staleness rule and the public payload

**Files:**
- Create: `supabase/functions/_shared/public-pricing.ts`
- Test: `supabase/tests/public-pricing.test.ts`

**Interfaces:**
- Produces:
  - `export interface PlanRow { plan_key: string; currency: string; amount_minor: number; interval: 'month' | 'year'; interval_count: number; is_active: boolean; sort_order: number; updated_at: string }` — the subset of `billing_plans` this reads.
  - `export interface PublicPlan { planKey: string; amountMinor: number; currency: string; interval: 'month' | 'year'; intervalCount: number }`

    No display name. The spec fixes the card heading as page copy, so returning Stripe's nickname would be a field nothing renders — and a second place a product name could disagree with the page.
  - `export interface PublicPricing { configured: boolean; plans: PublicPlan[]; trialDays: number }`
  - `export const PRICING_TTL_SECONDS = 600`
  - `export function isStale(newestUpdatedAt: string | null, now: Date, ttlSeconds?: number): boolean`
  - `export function toPublicPricing(rows: readonly PlanRow[], trialDays: number): PublicPricing`
  - `export const UNCONFIGURED: PublicPricing` — `{ configured: false, plans: [], trialDays: 0 }`

- [ ] **Step 1: Write the failing tests**

```ts
// staleness
it('is stale when nothing has ever been written', () => expect(isStale(null, NOW)).toBe(true))
it('is stale one second past the ttl', ...)
it('is fresh one second inside the ttl', ...)

// shaping
it('drops inactive rows', ...)
it('orders by sort_order', ...)
it('carries the interval Stripe reported, not the one the plan key claims',
   // row: plan_key 'pro_yearly', interval 'month'  ->  plan.interval === 'month'   [Review Focus 1]
)
it('reports configured with no plans when every row is inactive',
   // -> { configured: true, plans: [] }                                            [Review Focus 3]
)
it('never invents a trial', () => expect(toPublicPricing([], 0).trialDays).toBe(0))
it('returns no plans and no trial when unconfigured', () => expect(UNCONFIGURED.plans).toEqual([]))
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run supabase/tests/public-pricing.test.ts` → FAIL, module not found.

- [ ] **Step 3: Implement the module.** Pure functions only — no Supabase or Stripe imports.

- [ ] **Step 4: Run them and watch them pass.**

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/public-pricing.ts supabase/tests/public-pricing.test.ts
git commit -m "feat(pricing): the public payload shape and its staleness rule"
```

---

### Task 3: The public endpoint

**Files:**
- Create: `supabase/functions/pricing/index.ts`
- Modify: `supabase/config.toml` (add `[functions.pricing] verify_jwt = false` beside the other public functions, with a comment saying why it is public: it serves prices to signed-out visitors and returns nothing a landing page does not render)

**Interfaces:**
- Consumes: `loadBillingConfig` / `parseTrialDays` from `_shared/stripe-config.ts`, `refreshCatalogue` from Task 1, `isStale` / `toPublicPricing` / `UNCONFIGURED` from Task 2.
- Produces: `GET /functions/v1/pricing` → `PublicPricing` as JSON, HTTP 200.

- [ ] **Step 1: Implement `index.ts`** — a thin boundary, no logic of its own:

  1. `OPTIONS` → CORS preflight, matching the existing public functions. Any method other than `GET` or `OPTIONS` → 405.
  2. Configuration absent → respond `UNCONFIGURED`, **200**, without contacting Stripe. This is an answer, not an error.
  3. Create the service-role client. Read `billing_plans` (`select *`, ordered by `sort_order`).
  4. If `isStale(newest updated_at, new Date())`, call `refreshCatalogue` and re-read. A Stripe failure here is caught: serve whatever rows exist rather than failing the page, because stale-but-real beats nothing.
  5. Respond `toPublicPricing(rows, config.trialDays)` with `Cache-Control: public, max-age=60`.

- [ ] **Step 2: Add the config entry.**

- [ ] **Step 3: Verify**

Run: `npm run verify`
Expected: PASS. (`index.ts` is outside tsconfig; its logic is covered by Tasks 1 and 2.)

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/pricing/index.ts supabase/config.toml
git commit -m "feat(pricing): a public endpoint serving the real Stripe price"
```

---

### Task 4: Reading it from the browser

**Files:**
- Create: `src/features/marketing/api.ts`, `src/features/marketing/queries.ts`
- Test: `src/features/marketing/pricing.test.ts`

**Interfaces:**
- Produces:
  - `export interface PublicPlan { … }` / `export interface PublicPricing { … }` — mirroring Task 2 exactly.
  - `export async function fetchPublicPricing(): Promise<PublicPricing>` — calls `getSupabaseClient().functions.invoke<PublicPricing>('pricing', { method: 'GET' })`, following `src/features/billing/api.ts:72`.
  - `export function usePublicPricing()` — `useQuery`, `staleTime: 5 * 60_000`, `retry: false`.
  - `export function annualSaving(plans: readonly PublicPlan[]): number | null`

- [ ] **Step 1: Write the failing tests** for `annualSaving` and for `fetchPublicPricing`'s failure path

```ts
it('returns the percentage saved by paying yearly', ...)        // 12*1000 vs 10000 -> 17
it('returns null across different currencies', ...)             // USD + EUR        [Review Focus 2]
it('returns null when both plans bill monthly', ...)
it('returns null with only one plan', ...)
it('treats a failed call as no pricing rather than throwing',
   () => expect(await fetchPublicPricing()).toEqual({ configured: false, plans: [], trialDays: 0 }))
```

- [ ] **Step 2: Run and watch fail.**
- [ ] **Step 3: Implement both files.**
- [ ] **Step 4: Run and watch pass.**
- [ ] **Step 5: Commit**

```bash
git add src/features/marketing src/features/marketing/pricing.test.ts
git commit -m "feat(pricing): read the public price list in the browser"
```

---

### Task 5: The pricing section

**Files:**
- Create: `src/pages/marketing/components/PricingSection.tsx`
- Test: `src/pages/marketing/components/PricingSection.test.tsx`

**Interfaces:**
- Consumes: `usePublicPricing`, `annualSaving`, `PublicPlan` from Task 4.
- Produces: `export function PricingSection()` — renders `null` unless `plans.length > 0`.

Layout, copy and visual treatment follow the existing marketing components; the section carries `id="pricing"`.

- [ ] **Step 1: Write the failing tests**

```ts
it('renders nothing while loading', ...)
it('renders nothing when the deployment is unconfigured', ...)        // configured:false
it('renders nothing when configured but no plan resolved', ...)       // Review Focus 4
it('renders nothing when every plan is inactive', ...)                // Review Focus 3 (empty plans)
it('shows the monthly amount by default', ...)
it('switches to the yearly amount', ...)                               // userEvent on the toggle
it('shows the saving when the two prices are comparable', ...)
it('hides the saving across currencies', ...)                          // Review Focus 2
it('offers no toggle with a single plan', ...)
it('leads the call to action with the trial', ...)                     // trialDays 14
it('drops the trial copy when no trial is configured',
   () => { /* trialDays 0 */ expect(screen.queryByText(/free for/i)).not.toBeInTheDocument() })   // Review Focus 5
it('labels the interval Stripe reported, not the one the key claims', ...)  // Review Focus 1
it('never shows a currency symbol when there are no plans', ...)
```

- [ ] **Step 2: Run and watch fail.**
- [ ] **Step 3: Implement the component.** Amounts are formatted with `Intl.NumberFormat` from the plan's own currency; nothing is hardcoded. The card heading is page copy — the payload carries no product name, so there is nothing Stripe-sourced to render as a title.
- [ ] **Step 4: Run and watch pass.**
- [ ] **Step 5: Commit**

```bash
git add src/pages/marketing/components/PricingSection.tsx src/pages/marketing/components/PricingSection.test.tsx
git commit -m "feat(pricing): a pricing section that hides itself when it has nothing true to say"
```

---

### Task 6: Place it, and the nav and FAQ with it

The nav link and the FAQ entry appear on exactly the same condition as the section. A link to an anchor that is not there, or an FAQ promising an answer the page cannot give, is the failure this task exists to avoid.

**Files:**
- Modify: `src/pages/marketing/MarketingHomePage.tsx` (between `Differentiation` and `FinalCta`)
- Modify: `src/pages/marketing/components/MarketingHeader.tsx:12-14` (`NAV_LINKS`)
- Modify: `src/pages/marketing/components/Faq.tsx`
- Modify: `src/pages/marketing/components/Faq.test.tsx`
- Test: `src/pages/marketing/MarketingHomePage.test.tsx`

- [ ] **Step 1: Write the failing tests**

```ts
// MarketingHomePage.test.tsx
it('offers no Pricing link when there is no price to show', ...)
it('offers a Pricing link when prices load', ...)

// Faq.test.tsx — narrow the existing assertion, keep its intent
it('states no price when none is available', ...)    // existing /\$|€|per month|free trial/i check, no-pricing case
it('answers what it costs when prices are available', ...)
```

- [ ] **Step 2: Run and watch fail.**

- [ ] **Step 3: Implement.** `MarketingHeader` and `Faq` take the loaded pricing as a prop rather than each calling the hook, so the page makes one request and the three parts cannot disagree.

- [ ] **Step 4: Run and watch pass.**

- [ ] **Step 5: Verify the whole suite**

Run: `npm run verify`
Expected: PASS, format/lint/typecheck/tests/build clean.

- [ ] **Step 6: Commit**

```bash
git add src/pages/marketing
git commit -m "feat(pricing): show pricing, its nav link and its FAQ answer together or not at all"
```

---

## Deployment note

Not part of the plan's tasks, and not to be done without the user saying so: the new function must be deployed (`npx supabase functions deploy pricing`) before the section can show anything on the live site, and the frontend change reaches pevvy.io through a push to `main`.

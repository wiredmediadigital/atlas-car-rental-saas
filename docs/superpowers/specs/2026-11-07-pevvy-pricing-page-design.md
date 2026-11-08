# Pricing on the marketing site — design

2026-11-07

## Intent

Pevvy's marketing home page has Hero, Features, Operations, Insights,
Differentiation, FAQ and a final call to action, and **never mentions price**.
The FAQ does not carry a cost question either. A visitor who has been convinced
by the page has no way to learn what Pevvy costs and no next step but **Sign
in**, which is a door for people who already have an account.

Add a pricing section that answers the question, with numbers that come from
Stripe.

## Why it is built this way

Prices are not in this repository and not in the deployment's configuration.
`BILLING_PLAN_CATALOGUE` holds only a map from plan key to Stripe price:

```ts
export interface CatalogueEntry {
  readonly planKey: string
  readonly priceId?: string   // or lookupKey — exactly one is resolved at startup
  readonly lookupKey?: string
}
```

The amounts, currencies and product names live in Stripe. `stripe-config.ts`
states the principle this rests on: *"nobody can create a plan that says one
thing here and charges another there."*

A pricing page with the numbers typed into it would break that deliberately. It
creates a second source of truth that drifts the first time a price changes in
Stripe and the landing page is forgotten — and the resulting failure, a customer
checking out at a price different from the one advertised, is the one bug in
this area with legal weight. So the page reads Stripe.

### Rejected: mirror prices into a table via the webhook

`billing-webhook` already exists and could keep a prices table in sync for the
page to read. Rejected because a webhook mirror is an *authoritative copy*: when
an event is missed or replayed out of order it is wrong, with no bound on how
long it stays wrong, which reintroduces the drift this design exists to prevent.

This is not the same as the **cache** described below, which is a copy that
expires: it can only ever be minutes old, and it is refreshed from Stripe rather
than from an event stream.

### Rejected: a `catalogue` action on the existing `billing` function

`billing` keeps `verify_jwt = true` deliberately — config.toml calls it "the
user-initiated billing boundary". `verify_jwt` is per function, not per action,
so exposing one public action would unauthenticate `checkout`, `portal` and
`reconcile` with it. The public read gets its own function.

## What the user decided

- Go with the read-from-Stripe approach.
- The catalogue holds exactly two entries: **`pro_monthly`** and
  **`pro_yearly`**. One product, two billing intervals. So this is **not** a row
  of tiers with a feature comparison; it is one plan with an interval choice.
- **When prices cannot be loaded, the whole section is hidden** — along with its
  nav link and its FAQ entry. A deployment without billing configured looks
  exactly as it does today. (See "The unconfigured deployment" below.)
- **The call to action leads with the free trial**, with the price shown beneath
  it.
- **The in-app example tiers stay as they are** for now, and are recorded as a
  follow-up rather than changed here.

## The unconfigured deployment

This is a first-class case, not an error path. `stripe-config.ts` opens with
**"MISSING CONFIGURATION IS A STATE, NOT A FAULT"**, `billing/index.ts` names it
`billing_not_configured`, and the README promises "Nothing invents a plan, a
price or a trial." Pevvy ships unconfigured, and every fresh `atlas-setup`
install starts that way.

So the section, its nav item and its FAQ entry **only exist when real prices
have loaded**. An unconfigured deployment gains nothing: no section, no empty
card, no error line, no nav item pointing at an anchor that is not there, and no
FAQ question promising an answer the page cannot give.

This applies equally when prices are *configured but unavailable* — a Stripe
outage, a network failure, every price in the catalogue archived. The page
simply does not claim to know a price. It never shows a fallback figure.

## Goals

- A visitor can learn what Pevvy costs without signing in or asking.
- The amount displayed is the amount Stripe will charge, with a bounded and
  stated staleness.
- The section is linkable and reachable from the primary navigation.
- A deployment without billing configured is unchanged by this work.

## Non-goals

- A feature comparison matrix. There is one plan.
- Plan management, upgrades or cancellation — those exist in-app under Billing.
- Currency conversion or price localisation. Stripe's currency is displayed as
  Stripe reports it.
- A separate `/pricing` route. The existing nav is anchor-based (`#features`,
  `#operations`, `#insights`) and this follows it.
- Changing anything about how checkout or subscriptions work.
- Changing the in-app `MonetizationPreview` examples. See "Known follow-up".

## Anti-goals

These would make the work a failure even if it shipped and looked right:

- **Any state in which the page shows a price that is not Stripe's current
  one.** That includes a hardcoded fallback when the endpoint fails, a "from $X"
  written into the copy, and a cached value served with no bound on its age.
- **An unbounded public path to the Stripe API.** The endpoint is public, so
  without a bound that holds *across* function instances it lets anyone generate
  Stripe API calls at will — and the service degraded would be the one taking
  customers' money.
- **Loosening the authentication on the existing `billing` function.**
- **An unconfigured deployment that looks broken** — an error line, an empty
  card, or a nav link to nothing.
- Returning more of the billing configuration than a landing page needs.

## Constraints

- `supabase/config.toml` keeps `[functions.billing] verify_jwt = true`. Not to
  be changed.
- Secrets never reach the browser: no `VITE_` variable carries a Stripe key, and
  the secret key stays server-side in the function. (CLAUDE.md)
- The marketing page is part of a static SPA build served from `dist/`. There is
  no server rendering, so the fetch happens in the browser after load, and the
  section is absent until it succeeds.
- A schema change is a new, later-dated migration; existing migrations are never
  edited. (CLAUDE.md)
- Row Level Security, authorization functions and payment logic are out of
  scope. (CLAUDE.md)
- Edge function logic belongs in `_shared/` where the test suite can reach it;
  `index.ts` sits outside tsconfig and is not directly testable.

## The shape

### A new public function

A read-only endpoint, `verify_jwt = false`, no parameters, no request body,
`GET` only. It:

1. Reads `BILLING_PLAN_CATALOGUE`, `BILLING_STRIPE_SECRET_KEY` and
   `BILLING_TRIAL_DAYS` through the existing `stripe-config.ts` helpers, reusing
   `parseCatalogue` and the existing mode checks rather than re-implementing
   them.
2. If configuration is absent, answers `billing_not_configured` plainly, without
   contacting Stripe. This is a normal answer, not an error.
3. Otherwise resolves each catalogue entry to a Stripe price (by id or lookup
   key) and returns, per plan: plan key, unit amount in minor units, currency,
   recurring interval and interval count — plus the trial length.

It never returns the secret key, the webhook secret, the app URL, or any
identifier the page does not render.

### Bounding the path to Stripe

A per-instance memory cache does not bound anything: Supabase Edge Functions sit
behind no CDN, so a response cache header protects the browser and not the
origin, and an in-memory value dies with its instance — concurrent and cold
instances still reach Stripe on demand. Since one of the anti-goals above has an
attacker in it, the bound has to hold across instances, which means the database.

**That cache already exists.** `public.billing_plans` holds exactly the display
fields — `plan_key`, `display_name`, `currency`, `amount_minor`, `interval`,
`interval_count`, `mode`, `is_active`, `sort_order`, `updated_at` — and its own
comment says they are "refreshed from Stripe, never authored by hand".
`refreshCatalogue` in `billing/index.ts` already resolves each catalogue entry
against Stripe and replaces the table through `app.billing_replace_catalogue`,
skipping prices that are archived, wrong-mode, non-recurring, or have no amount.

So **no new table and no new migration**: the public function reads
`billing_plans`, and refreshes it from Stripe only when the newest row is older
than the TTL. Stripe calls are bounded globally by that timestamp, however many
instances are serving.

It needs no RLS change either. The existing policy — `to authenticated`, active
owners only — stays exactly as it is. The function holds the service role, so it
reads the table directly; the browser never touches it and sees only the fields
the function chooses to return.

**One real gap this exposes.** `refreshCatalogue` is called from one place: the
authenticated `status` action. Today the table is therefore only as fresh as the
last time an owner opened the Billing page, which is unbounded staleness — the
very thing a webhook mirror was rejected for. Giving the public endpoint its own
TTL-driven refresh closes that for both callers.

### Degrading honestly

`refreshCatalogue` already shows what really happens to a catalogue: a price
that is archived, wrong-mode, non-recurring, or has no unit amount is skipped.
"Exactly two entries" can therefore resolve to one, or none. Deployments may
also configure three plans, one named `standard`, or two prices in different
currencies.

- **No price resolves** → the section is hidden, exactly as if unconfigured.
- **One price resolves** → one card, no interval toggle, no saving figure.
- **Two or more resolve** → a toggle across the intervals actually returned.
- **A saving is only shown** when two prices are directly comparable: same
  currency, one yearly and one monthly. Otherwise the toggle appears without it.

Intervals are read from Stripe's `interval` and `interval_count`, **never
inferred from the plan key**. `pro_yearly` is a string a human typed; a price
with `interval=month, interval_count=12` is the fact. Trusting the key is how a
page ends up labelling a monthly price "per year".

### The section

- A single Pro card with a monthly / annual toggle.
- The heading is marketing copy in the page, not Stripe's product or nickname
  field. Stripe supplies amounts and intervals only.
- The annual saving is computed from the two amounts returned, not written into
  the copy, so it stays correct when either price changes.
- The call to action leads with the trial; where no trial is configured
  (`BILLING_TRIAL_DAYS` unset means zero, which is the default) it falls back to
  a plain call to action with no trial copy.
- `id="pricing"`, added to the primary nav alongside Features, Operations and
  Insights — and rendered only when prices loaded.
- A FAQ entry answering what it costs, conditional on the same data.

## Decisions made here, not by the user

Flagged so they can be overridden on reading:

- **The cache is the existing `billing_plans` table**, refreshed on a TTL. This
  reverses twice: the design first assumed no migration, then called for a new
  cache table after review, and then the table turned out to already exist and
  already be refreshed from Stripe. No new table, no migration, no RLS change.
- **The public function reads the table with the service role**, so the existing
  owners-only policy is untouched and the browser never reaches the table.
- **The TTL refresh is shared with the `status` action**, which closes an
  existing gap: today `billing_plans` is only refreshed when an owner opens the
  Billing page.
- **The card heading is page copy, not Stripe's product name.** Fetching the
  product costs an extra Stripe call per price and gives both intervals the same
  name anyway.
- **Intervals come from Stripe's fields, never from plan-key strings.**
- **The saving is suppressed rather than guessed** when prices are not
  comparable.
- **`Faq.test.tsx` is narrowed, not deleted.** It currently asserts the FAQ
  matches none of `/\$|€|per month|free trial/i`, with the comment "Nothing on
  this site states a price, and an FAQ is not the place to invent one." That
  intent survives: the FAQ still invents nothing. The assertion is narrowed to
  the case where no prices are available, and a second test covers the entry
  appearing when they are.
- **The function is named for what it serves** and is new rather than an action
  on `billing`.

## Known follow-up, not in this work

`src/features/billing/monetizationExamples.ts` ships hardcoded Starter $49 /
Growth $99 / Scale $199 tiers, rendered on the in-app Billing page. Once this
ships, a signed-out visitor sees one real Stripe price and a signed-in owner
sees three invented ones. The module documents them as deliberate illustrations,
and the user chose to leave them for now. Recorded here so the inconsistency is
a known decision rather than a surprise.

## Left to the builder

- Copy, layout and visual treatment of the section, consistent with the existing
  marketing components.
- Whether the existing `monetizationExamples.ts` formatting helpers are reused
  or whether the section formats amounts itself.
- The exact TTL, within "minutes, not hours".
- CORS handling for a public GET, following whatever the existing public
  functions do.
- Test strategy, within the project's norms. At minimum: the endpoint when
  unconfigured, when Stripe is unreachable, and on a well-formed response; the
  cache serving within TTL and refreshing after it; the section's hidden,
  loading and loaded states; one price versus two; non-comparable prices
  suppressing the saving; an interval label driven by a price whose key and
  interval disagree; and that no fallback price can appear in any state.

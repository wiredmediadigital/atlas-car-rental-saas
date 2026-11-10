# Release configuration

_Pevvy — Car Rental Management SaaS, by Adera Labs Inc_

What has to be set before an agency can use Pevvy, and what is optional. Nothing in
this file is a secret; it says which secrets exist and where they belong.

The build distributed today is the **Free build**: every module is unlocked, no
subscription is enforced, and the Billing page shows example pricing rather than a
plan anybody is on.

License: MIT — see [LICENSE](./LICENSE).

---

## Required for the core application

| What                            | Where it goes                             | Notes                                                                                                                                        |
| ------------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `VITE_SUPABASE_URL`             | Build environment (inlined at build time) | Supabase → Project Settings → API → Project URL.                                                                                             |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Build environment (inlined at build time) | The publishable key (`VITE_SUPABASE_ANON_KEY` is still accepted). The app refuses to start if a secret or `service_role` key is pasted here. |
| Database schema                 | `supabase/migrations/`, applied in order  | `supabase db push`, or paste each file into the SQL editor. Nothing is created by hand.                                                      |
| Edge Functions                  | `supabase functions deploy <name>`        | `team-invitations`, `gps-provider`, `billing`, `billing-webhook`.                                                                            |
| Auth redirect URLs              | Supabase → Auth → URL Configuration       | The application origin, plus `/auth/callback`, `/accept-invite`, `/auth/reset-password` and `/confirm-email`.                                |
| Application base URL            | Wherever the static build is served       | `dist/` is a static SPA; `public/.htaccess` supplies the Apache/LiteSpeed rewrite.                                                           |

`VITE_APP_NAME` is optional and only names the product in the tab and the shell.

Both `VITE_` values are public by definition — they are compiled into the browser
bundle. No server secret may ever be given a `VITE_` prefix.

---

## Optional integrations

Each of these is off in the distributed build. None of them is required, and none of
them breaks anything else by being absent — the feature that depends on it reports
itself as unconfigured rather than pretending to work.

### Automatic invitation email

| Secret                | Turns on                                                                     |
| --------------------- | ---------------------------------------------------------------------------- |
| `TEAM_APP_URL`        | The origin invitation links point at. Required before any email can be sent. |
| `TEAM_EMAIL_PROVIDER` | `resend`, or unset for no delivery.                                          |
| `TEAM_EMAIL_API_KEY`  | The provider's key.                                                          |
| `TEAM_EMAIL_FROM`     | A sender address the provider has verified.                                  |

**Without these, invitations still work.** The invitation is created and the
administrator is handed a one-time link to pass on themselves. Nothing claims an
email was sent.

### GPS tracking

A Wialon account and token, entered by an administrator inside the product — not a
deployment secret. Without a connection, the GPS page explains that no provider is
connected and offers to connect one.

Positions are read while somebody has the tracking screen open. There is no
background worker on this deployment, and the product says so rather than implying
continuous monitoring.

### Stripe subscriptions

| Secret                          | Turns on                                                             |
| ------------------------------- | -------------------------------------------------------------------- |
| `BILLING_STRIPE_SECRET_KEY`     | Stripe itself. The key prefix decides test or live mode.             |
| `BILLING_STRIPE_WEBHOOK_SECRET` | The `billing-webhook` endpoint. No unsigned fallback exists.         |
| `BILLING_APP_URL`               | The trusted origin Checkout and the Customer Portal return to.       |
| `BILLING_PLAN_CATALOGUE`        | Which Stripe prices this deployment sells. Amounts come from Stripe. |
| `BILLING_TRIAL_DAYS`            | Free-trial length in days. Unset means no trial; set `14`.           |

Set with `supabase secrets set NAME=value`. **Without them the product is the Free
build**: every module is unlocked, no entitlement is enforced, and `/billing` shows
example pricing clearly labelled as an illustration alongside a link to the setup
guide.

The example figures on that page — Starter $59/$590, Pro $119/$1,190, Business
$199/$1,990, with every feature included at every tier — are illustrations only.
They create no records, grant nothing and gate nothing.

### Fleet map basemap

`VITE_MAP_STYLE_URL` and `VITE_MAP_ATTRIBUTION`. Map tiles are a metered commercial
service and this product ships no endpoint of its own. Unset, the fleet map still
plots every vehicle; it simply draws no basemap and says so.

### Help Centre sitemap

Search-engine output only; nothing breaks without it, and the first build does not need
it. After the site is live, run `npm run help:sitemap -- https://your-domain` and commit
the result, so `robots.txt` and `sitemap.xml` name your domain. Rerun it after upgrading,
because new help pages change the file. Without it, `robots.txt` allows crawling and names
no sitemap.

---

## Before going live

1. `npm run verify` — format, lint, types, tests, build, all green.
2. `npx supabase migration list --linked` — every local migration present remotely,
   nothing pending on either side.
3. Build with the production `VITE_` values set; they are inlined, not read at runtime.
4. Upload the contents of `dist/` to the web root, including `.htaccess`.
5. Load a deep route directly (`/settings`, `/rentals`) and refresh it, to confirm the
   SPA rewrite is in force.
6. Sign up once on the live deployment and confirm the agency is provisioned and the
   Overview setup checklist appears.

Billing with Stripe has five more checks. The first is a precondition: run it before
you deploy, not after.

7. **Every active plan key must be one of the six below. Check this before deploying.**
   The public pricing page works out each tier's name and vehicle allowance from the
   plan key, and it drops a plan whose key it cannot name. If no key can be named, the
   pricing section, the navigation link to it and the FAQ entry all disappear together,
   and nothing on the page reports an error. The `billing` function does log a warning, and
   writes it to `billing_platform_state.reported_reason`, naming any active plan with no
   authored vehicle limit (such a plan allows unlimited vehicles). No screen reads that
   column, so look in the function logs or run
   `select reported_reason from public.billing_platform_state;` after the first status refresh.
8. All six plan keys are present in `BILLING_PLAN_CATALOGUE`: `starter_monthly`,
   `starter_yearly`, `pro_monthly`, `pro_yearly`, `business_monthly`,
   `business_yearly`. A missing key means that tier and interval cannot be bought.
9. `BILLING_TRIAL_DAYS=14`.
10. **Plan switching is turned OFF in the hosted Stripe Customer Portal** (Stripe
    Dashboard, Settings, Billing, Customer portal; do it in both test and live mode).
    The product refuses a downgrade while the agency has more vehicles than the target
    tier allows, and that refusal only exists when the plan is changed through the
    app's Billing page. The Customer Portal changes the plan inside Stripe and never
    asks the app, so leaving switching enabled lets an agency downgrade past the rule
    that stops it. Cancelling and updating the card can stay on.
11. **Change one plan in Stripe test mode after deploying, before the first real
    one.** `change_plan` reads `public.plan_vehicle_limits` with the service client,
    on a table that revokes every grant from `public, anon, authenticated` and
    carries a deny-all RLS policy. `service_role` keeps its grant and bypasses RLS,
    so this is correct by reasoning — but no test executes it with a real key, and
    if that read fails the function raises `plan limit unreadable` and the whole
    plan change fails closed. One test-mode change through the app's Billing page
    proves the grant. A refusal over the vehicle limit counts as a pass: it means
    the table was read.

## Giving one agency a bespoke vehicle limit

A limit outside the three tiers — a 150-car fleet that no plan covers — is an
operator act, not a self-serve one. No screen, role or RPC can raise an agency's
own ceiling; a database trigger refuses any change to the override columns made as
a browser role.

Grant it with the one function that exists for it, as the service role:

```sql
select app.set_vehicle_limit_override(
  '<organization-id>'::uuid,   -- the agency
  150,                         -- the new ceiling, or null to withdraw it
  '<operator-user-id>'::uuid   -- p_actor: YOUR OWN auth.users id
);
```

`p_actor` is the `auth.users` id of the person granting it — the operator, not the
agency's owner, unless the owner really did decide it. It is recorded alongside the
limit and the time, because a bespoke limit nobody can explain later is a liability.
A bare `update organizations set vehicle_limit_override = 150` is refused by
`organizations_vehicle_limit_override_provenance`: there is one way in.

Null withdraws the limit and clears the provenance with it, and the agency goes back
to its plan's allowance. Nothing is retroactive either way: an agency over its new
ceiling keeps every vehicle it has and simply cannot add another.

## Deleting an agency

There is no delete-agency path in the product, deliberately: `organizations`
carries SELECT and UPDATE policies for signed-in users and no DELETE policy, so
no browser session can remove a tenant. Deleting one is an operator act, and it
must go through:

```bash
SUPABASE_URL=https://<ref>.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=<service role key> \
  node scripts/delete-organization.mjs <organization-id> --confirm "Exact Agency Name"
```

Deleting the row alone is **not** enough. Every table cascades from it, but
Storage does not: `storage.protect_delete()` refuses SQL deletion of
`storage.objects`, so the agency's private files survive their owner — unreadable
(every storage policy keys on membership of an agency that no longer exists) but
retained and billed.

The script removes the files first and the row second, across all seven
organization-scoped buckets. That order is the only safe one:

| What fails          | What you are left with                                                                                |
| ------------------- | ----------------------------------------------------------------------------------------------------- |
| Storage step        | The agency still exists, so its files are still enumerable and authorised. Run it again.              |
| Database step       | The agency exists with no files. Run it again; deleting absent objects is a no-op.                    |
| _Row deleted first_ | _Files orphaned permanently — nothing can name their owner any more. This is why the order is fixed._ |

There is no transaction across PostgreSQL and Storage and there cannot be, so
every step is idempotent and the command is safe to re-run until it reports a
clean finish. It refuses a name that does not match the agency, and refuses any
object path whose first segment is not the agency being deleted. The existing
guard still blocks an agency with a live Stripe subscription.

The service-role key belongs in the operator's shell for the length of one
command. It is never read from `.env.local`, never given a `VITE_` prefix, and
nothing in the browser bundle can reach any of this.

## Deliberately not shipped

- No background scheduler: no overnight reminders, no unattended GPS polling, no
  emailed notifications. Reminders are worked out from live records while somebody
  has the product open, and the interface says exactly that.
- No demo or sample data. A new agency sees zeros because it has zero.

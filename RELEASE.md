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
| Edge Functions                  | `supabase functions deploy <name>`        | `team-invitations`, `gps-provider`, `billing`, `billing-webhook`, `account-closure`, `account-closure-notice`.                               |
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

### Account-closure notices

| Secret                   | Turns on                                                                                                                                      |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `CLOSURE_OPERATOR_EMAIL` | Where the operator is told to cancel an agency's Stripe subscription when it asks to close. Server-side only: never give it a `VITE_` prefix. |

Delivery reuses `TEAM_APP_URL`, `TEAM_EMAIL_PROVIDER`, `TEAM_EMAIL_API_KEY` and
`TEAM_EMAIL_FROM` from above. **Without them the closure still works** and owners and
administrators still see the in-app notification, but nobody is emailed and the
operator is not prompted to cancel the subscription. The database records the notice
as `not_configured` rather than sent.

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

Set with `supabase secrets set NAME=value`. **Without them the product is the Free
build**: every module is unlocked, no entitlement is enforced, and `/billing` shows
example pricing clearly labelled as an illustration alongside a link to the setup
guide.

The example figures on that page — Starter $49/$490, Growth $99/$990, Scale
$199/$1,990 — are presentation only. They create no records, grant nothing and gate
nothing.

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
7. **`CLOSURE_OPERATOR_EMAIL` is set** (with `TEAM_EMAIL_PROVIDER`, `TEAM_EMAIL_API_KEY`,
   `TEAM_EMAIL_FROM` and `TEAM_APP_URL`). This is a hard item, not an optional
   integration: it is the only prompt for the operator to cancel a closing agency's
   Stripe subscription. If it is missing, a closed agency keeps being billed while its
   data sits unpurged, and nothing in the product says so. The function logs
   `account-closure-notice: no operator address configured` when it is unset.
8. **Account closure is scheduled.** Without this, closures suspend but nothing is ever
   purged, and an operator notice that failed its first attempt is never retried.
   - **Migrations applied**, after `npx supabase db push --dry-run`, in order:
     `20261108100000_account_closure_state`, `20261108100100_account_closure_actions`,
     `20261108100200_account_closure_purge`, `20261110100000_account_closure_notice_values`,
     `20261110100100_account_closure_notices`,
     `20261110100200_account_closure_notice_retries` and
     `20261110100300_account_closure_operator_uncapped`. Item 2 confirms none is pending.
   - **Both Edge Functions deployed**: `account-closure` and `account-closure-notice`.
   - **`ACCOUNT_CLOSURE_RUNNER_SECRET`** set with `supabase secrets set`: at least 32
     random characters, never a `VITE_` value. Shorter, or unset, and both functions
     refuse every caller.
   - **The same value as the GitHub Actions repository secret**
     `ACCOUNT_CLOSURE_RUNNER_SECRET`, plus the repository variable `SUPABASE_FUNCTIONS_URL`
     (`https://<ref>.supabase.co/functions/v1`). The workflow
     `.github/workflows/account-closure.yml` runs daily at 03:17 UTC and by hand
     (Actions, Run workflow). Run it once by hand and confirm both steps are green. A red
     run is the alarm: a notice or a purge did not complete.

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

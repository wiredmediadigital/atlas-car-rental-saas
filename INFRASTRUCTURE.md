# Infrastructure

What runs where, how each piece is deployed, and the traps that are not obvious
from the code.

This describes the **live deployment**. `RELEASE.md` says which variables turn
features on and lists the go-live checks; `README.md` covers setting the project
up from scratch. This file is for someone who needs to change something that is
already running.

---

## The four pieces

Pevvy is not one deployable. It is four, and they deploy separately. Knowing
which piece a change lives in is the difference between a two-minute deploy and
a change that silently never ships.

| Piece                                       | Where it runs                           | How it gets there                      |
| ------------------------------------------- | --------------------------------------- | -------------------------------------- |
| **Browser bundle** (`dist/`)                | Hostinger, serving `pevvy.io`           | Push to `origin/main`                  |
| **Database** (Postgres, Auth, Storage, RLS) | Supabase project `ysnumxtzcgzyabrghxwq` | `npx supabase db push`                 |
| **Edge Functions**                          | Same Supabase project                   | `npx supabase functions deploy <name>` |
| **Scheduled job**                           | GitHub Actions                          | Push the workflow; it runs on a cron   |

A change to `src/` ships on a push. A change to `supabase/migrations/` does not.
A change to `supabase/functions/` does not. **A change to
`supabase/functions/_shared/` ships to every function that imports it, and only
when each of those is redeployed** — this is the one most easily missed, because
the file lives nowhere near the functions it affects.

---

## Repositories, and a trap

```
origin    https://github.com/wiredmediadigital/atlas-car-rental-saas   (ours)
upstream  https://github.com/salhiworks/atlas-car-rental-saas          (original)
```

`upstream`'s push URL is deliberately set to a non-URL placeholder so a push
there fails loudly rather than succeeding.

**The trap:** `gh` prefers `upstream` when resolving a repo, so an unqualified
`gh secret set`, `gh workflow run` or `gh pr create` in this folder targets the
**original** repository, not ours. A secret written there would be in someone
else's repo, and the workflow here would still have nothing.

This is now fixed locally — `gh repo set-default` wrote
`remote.origin.gh-resolved=base` into `.git/config`, so bare `gh` commands
resolve to `wiredmediadigital`. The setting is per-clone: **a fresh clone will
have the trap again.** Either re-run `gh repo set-default`, or pass
`--repo wiredmediadigital/atlas-car-rental-saas` explicitly.

---

## Deploying each piece

### The site

A push to `origin/main` is the deploy. There is no CI config in the repo for it
and no separate step; Hostinger builds from `main` and the change is live in
roughly two minutes.

The build inlines `VITE_*` values at build time, so they are baked into the
bundle rather than read at runtime. A change to one of those needs a rebuild,
not just a restart.

### The database

```bash
npx supabase db push --dry-run     # always first
npx supabase db push
```

**The schema is the migration history.** Never edit a file in
`supabase/migrations/` — a change is a new, later-dated file. Several migrations
are not safe to run twice, and applying anything through the SQL editor records
a different history than the CLI expects.

**`--include-all` is sometimes required**, and the reason is worth understanding
rather than copying. Two features were built on branches cut at different times.
The account-closure migrations are dated `20261108*`; the vehicle-tier pricing
migrations are dated `20261109*` and reached the database first. So the closure
migrations sort _before_ what is already applied, and a plain push refuses them:

```
LegacyDbPushMissingRemoteError: Found local migration files to be inserted
before the last migration on remote database.
```

That refusal is correct and protective. `--include-all` is the documented way
through it. Any _new_ migration should be dated later than everything applied,
so this does not recur.

### Edge Functions

```bash
npx supabase functions deploy <name>
```

| Function                 | `verify_jwt` | Authenticates how                                                                                                            |
| ------------------------ | ------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `billing`                | on           | Platform JWT, then its own owner-only role check                                                                             |
| `billing-webhook`        | **off**      | Stripe signature; no unsigned fallback                                                                                       |
| `pricing`                | **off**      | Public, read-only, no session to verify                                                                                      |
| `team-invitations`       | **off**      | Its own token check                                                                                                          |
| `account-closure`        | on           | `Authorization: Bearer <ACCOUNT_CLOSURE_RUNNER_SECRET>`                                                                      |
| `account-closure-notice` | **off**      | Either the runner secret, or a user session scoped to one agency                                                             |
| `mfa-reset`              | on           | The caller's own session; `mode: 'member'` additionally needs a verified second factor, `mode: 'self'` deliberately does not |

`verify_jwt` comes from `supabase/config.toml` and is applied on deploy, so a
redeploy preserves it. **Do not run `supabase config push`** — it pushes far
more than function settings.

### The scheduled job

`.github/workflows/account-closure.yml` runs daily at **03:17 UTC**, and can be
run by hand from the Actions tab. It does two things in order: drains any owed
closure or restore notices, then purges agencies whose grace period has ended.
Notices first, because the purge refuses an agency that is still being billed.

It needs one secret and one variable, both on **our** repo:

- secret `ACCOUNT_CLOSURE_RUNNER_SECRET` — must match the Supabase secret of the
  same name, minimum 32 characters. Rotating it means changing **both**, or the
  job starts failing with a 401.
- variable `SUPABASE_FUNCTIONS_URL` — `https://<ref>.supabase.co/functions/v1`

**A red run is the alarm.** It goes red when a notice could not be delivered, or
when a purge is blocked past its due date. Both want investigating rather than
muting.

**GitHub disables scheduled workflows after 60 days of repository inactivity.**
This is the only scheduler Pevvy has. A deployment that goes two quiet months
loses its purge runner silently.

---

## The deploy sequence

A release is three separate deploys, and pushing to `main` does only the first.
The order matters, and it was learned the hard way.

1. **Frontend.** Push to `origin/main`; Hostinger builds in about two minutes.
   Verify by fetching the live bundle and checking that the chunk actually
   contains the new code (see below). A missing asset returns HTTP 200 with
   `index.html` through the SPA rewrite, so comparing local filenames proves
   nothing.
2. **Migrations.** `npx supabase db push --dry-run`, then, with the user's
   approval, `npx supabase db push`. Verify with
   `npx supabase migration list --linked` showing `local == remote`.
3. **Edge Functions.** `npx supabase functions deploy <slug>` for anything new
   or changed. **This is the step that was missed.** `npm run setup:site` now
   checks it: it fails when a directory under `supabase/functions/` is not
   deployed and `ACTIVE` on the linked project, and names the command to run.

**Why the frontend goes before the migrations, for the two-factor feature.** The
enforcement migration makes a verified second factor part of every read. People
must be able to enrol before it lands, so the frontend that lets them enrol has
to be live first.

**A branch that adds a new Edge Function is the case that breaks the habit of
"deploy = push plus migrations".** Two-factor shipped with a new `mfa-reset`
function that nobody deployed, so using a recovery code failed with "We could
not reach the server". The function did not exist on the project, and no check
asked whether it did.

## Verifying a deploy actually landed

Getting this wrong wasted real time, so the method matters.

**Do not** check whether your local `dist/assets/<name>-<hash>.js` exists on the
server. A production build inlines different `VITE_*` values, so its hashes
legitimately differ from a local build — and asking for a missing file returns
**HTTP 200 with `index.html`**, because of the SPA rewrite. That reads as "the
file is there" and means the opposite.

Instead, read the chunk names out of the **live** bundle:

```bash
curl -s https://pevvy.io/ | grep -oE 'index-[A-Za-z0-9_-]+\.js'
curl -s https://pevvy.io/assets/<that file> | grep -oE '(AppShell|SettingsPage|MarketingHomePage)-[A-Za-z0-9_-]+\.js'
curl -s https://pevvy.io/assets/<the lazy chunk> | grep -c "<a string your change introduced>"
```

Feature code is lazily loaded, so it is never in the chunks `index.html` lists
directly.

**`index.html` is not content-hashed and is cached.** A deploy can be live while
a browser still loads the previous chunks. Hard-refresh before concluding
anything is wrong.

**`npm run setup:site -- <domain>` does the rest.** It checks the site is up and
served over HTTPS, that the bundle points at the right Supabase project and
carries no secret key, and that every directory under `supabase/functions/` is
deployed and `ACTIVE` — the check that would have caught `mfa-reset` going out
unbuilt. On a busy machine the Supabase call can exceed its 30-second timeout,
and the function check then reports that it could not read the deployed list
rather than passing or failing. That is the safe answer, not a green light: run
it again before concluding the functions are fine.

---

## Secrets and variables

Values are never recorded here or anywhere in the repo. Names, and where each
one lives:

| Name                                                 | Lives in                               | Notes                                                                                                                                                                                                           |
| ---------------------------------------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` | `.env.local`, build-time               | Compiled into the browser bundle — **never put a secret behind a `VITE_` prefix**                                                                                                                               |
| `BILLING_STRIPE_SECRET_KEY`                          | Supabase secrets                       | Prefix decides test or live mode                                                                                                                                                                                |
| `BILLING_STRIPE_WEBHOOK_SECRET`                      | Supabase secrets                       |                                                                                                                                                                                                                 |
| `BILLING_APP_URL`                                    | Supabase secrets                       | Trusted return origin                                                                                                                                                                                           |
| `BILLING_PLAN_CATALOGUE`                             | Supabase secrets                       | JSON; plan keys to Stripe prices or lookup keys                                                                                                                                                                 |
| `BILLING_TRIAL_DAYS`                                 | Supabase secrets                       | `14`. Unset means no trial                                                                                                                                                                                      |
| `CLOSURE_OPERATOR_EMAIL`                             | Supabase secrets                       | Where closure and restore notices go. Currently a personal mailbox; worth moving to a shared one                                                                                                                |
| `ACCOUNT_CLOSURE_RUNNER_SECRET`                      | Supabase secrets **and** GitHub secret | Must match in both                                                                                                                                                                                              |
| `TEAM_*`                                             | Supabase secrets                       | Invitation email delivery                                                                                                                                                                                       |
| `SUPABASE_TOTP_ENABLED_FOR`                          | `.env.local`                           | Not a secret — the project ref the user confirmed the App Authenticator is on for. `npm run setup:check` blocks without it. Never set it yourself: only the user can say what is switched on in their dashboard |

`supabase/.temp/project-ref` must match the project in `.env.local`. Confirm it
before any remote command.

---

## The quality gate

```bash
npm run verify   # format, lint, types, tests, build
```

It also checks that **every test file that exists actually ran**. A vitest worker
that fails to start leaves its file unrun while the suite still exits 0, because
the summary counts only files that ran — this happened four times in one day on
one machine, once hiding 15 tests. `scripts/test-include.mjs` holds the include
and exclude globs that both the test config and the check read, so the two cannot
disagree about which files should have run.

If the check reports a missing file, the file did not run. That is usually a
worker that failed to start under memory pressure, not a failing test. Re-run.

---

## What is deliberately manual

- **Cancelling a closing agency's Stripe subscription.** The product never moves
  money on its own. The agency cancels its own from Manage billing; the operator
  gets an email and acts only if the subscription is still live past the purge
  date. The purge refuses while one is live, which is what makes that email
  load-bearing rather than a courtesy.
- **Turning off plan switching in the hosted Stripe Customer Portal.** Sessions
  Pevvy opens already use a configuration with it disabled, created
  automatically on first use. The dashboard setting is defence in depth for
  portal links reached any other way.
- **Getting a sole owner back in when they have lost both their phone and their
  recovery codes.** Two-factor is mandatory for every user, so there is no way
  back from inside the product: their own recovery path needs a code, and the
  owner path needs a second owner. `docs/security/second-factor-recovery.md` is
  the runbook — SQL the operator runs against their own project with the service
  key, plus the `app.record_security_event(…)` call that keeps the audit trail
  honest about who did it. It is the only path, so it is worth reading once
  before somebody needs it at speed.
- **Switching the App Authenticator on for a new Supabase project.** Enforcement
  is in the database, so pushing the migrations to a project with TOTP disabled
  leaves every user unable to enrol and unable to read anything. `setup:check`
  blocks on the confirmation; the switch itself is the user's to throw.

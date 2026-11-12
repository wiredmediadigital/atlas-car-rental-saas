---
name: atlas-setup
description: Agent-led, deployment-first setup of this Pevvy folder for people with no technical background — check the computer, install Pevvy into the user's own new Supabase project, publish it to their own GitHub repository, deploy it on Hostinger, configure sign-in for the live address and verify the first Owner agency on the live site. Claude does the work and stops only for steps that need the user's account, decision or approval. Use when the user asks to set up, install, connect, publish or deploy Pevvy, or to continue a setup that was interrupted. Pevvy was formerly called Atlas, and the folder may still be named `atlas-car-rental-saas`; a request to set up Atlas means this.
---

# Pevvy setup

You are setting up Pevvy **for** someone with no technical background, and the goal is Pevvy
running **live on their Hostinger website**. You do the work; the user only does what needs their
account, their decision or their approval. Pevvy is never run on this computer during setup — the
first agency is created on the live site.

## How to behave

- **Keep going.** When a step succeeds, start the next one. Never ask "Continue?", "Shall I
  check…?", "Do you want to test…?" or "Would you like to customize…?".
- **Report, don't quiz.** One or two plain-language lines per section: what was done and what was
  verified. No command output or jargon unless something went wrong.
- **Stop only at the user moments below.** Each is one message that says exactly where to click or
  what to type, with their real values filled in (their project, their domain — never a
  placeholder to copy literally). When the user answers, resume without re-confirming.
- **One approval covers everything it named.** An approval names the destination (the exact
  project or repository) and every operation; then carry them out in order. Ask again only for
  something it did not name, or when a check turns up something unexpected.
- **No homework.** Never ask the user to add vehicles, customers, rentals or payments, refresh
  pages or otherwise test the app — Pevvy's automated tests cover those workflows. Anything no
  check has proven is **not verified**; never claim it passed.
- **Keep Pevvy's defaults.** Do not ask about name, tagline, colours or logo. Customize only when
  the user asks (end of this file).
- **Never display secrets**: access tokens, database password, secret / service_role keys,
  invitation links. The publishable key is public; show it only when the user must paste it into
  Hostinger.
- **Stop on the first unexpected result.** Explain it plainly, propose one fix, wait. Never retry
  a migration blindly or finish one by hand in the SQL editor.
- **One project.** Before every command that reaches Supabase, `supabase/.temp/project-ref` must
  equal the ref the user confirmed.
- Run commands from the Pevvy folder with `npx supabase …` (the CLI is a dev dependency). When you
  run them, `projects list` and `migration list` print JSON; do not add `-o json` to
  `migration list` — that prints a table there.
- Do not start `npm run dev`, open localhost, or ask for localhost Auth URLs — unless the user asks
  to run Pevvy on their computer (see "Running Pevvy locally").

## The user moments — the only times you stop

1. **Supabase project:** create one and paste its ID (plus `npx supabase login`, only if the CLI is
   not signed in).
2. **App Authenticator:** switch on TOTP in that project, then answer whether it is on. This is its
   own question; a yes to anything else never stands in for it.
3. **Install approval:** one yes to install Pevvy into that exact project.
4. **GitHub:** an empty private repository, then one yes to publish to it (plus a Git sign-in or
   name/email only if Git asks).
5. **Hostinger:** the hPanel steps, then paste the live address.
6. **Live sign-in settings:** the Auth URLs for that address.
7. **First agency:** sign up on the live site and confirm the email.

## Resuming

Start every session with `npm run setup:check`, then find the furthest completed step without
asking and say in one line where things stand:

- Linked, every migration applied (`npx supabase migration list --linked`), functions ACTIVE,
  `.env.local` written → B is done.
- An `origin` remote that is not the upstream repository, and `git ls-remote origin main` equals
  `git rev-parse HEAD` → D is done.
- If D is done, ask once for the live address if you do not have it, then run
  `npm run setup:site -- <address>` → E1-E2 are done when it passes.
- `public/sitemap.xml` exists and `public/robots.txt` names it on their live address → E3 is done.
  A robots.txt with no `Sitemap:` line means E3 has not run yet.
- The Owner query in G returns their agency → setup is complete; go to H.

Resuming in a folder already linked to the project chosen earlier: skip the B4 state check — users
and files there are the owner's own.

---

## A. The computer — no user action unless something is missing

1. `node --version`, `git --version`; `npm ci` if `node_modules` is missing; `npm run setup:check`;
   `npx supabase projects list -o json` (read-only — only to learn whether the CLI is signed in).
2. Only if Node is missing or older than 20.19, or Git is missing: say what to install (Node.js LTS
   from nodejs.org, Git from git-scm.com) and wait. An old Git only matters in section D.
3. In your first status line, say once what the journey needs: their own **Supabase**, **GitHub**
   and **Hostinger** accounts — Hostinger hosting that can run a **Web App** (Node.js / Git
   deployment). Hosting is needed only in section E; if they do not have it yet, they can get it
   while you install the database. Do not ask whether they have it — say it, and go on.

## B. Supabase

1. **User moment 1 — one message:** create a **new** project at supabase.com/dashboard (a Free
   organization is fine; keep the database password somewhere safe) and paste its **Project ID**
   (Project Settings → General, or the part before `.supabase.co`). If the CLI is not signed in,
   add: run `npx supabase login` in the terminal panel and finish the sign-in in the browser.
   Never pick a project yourself, even though you can see every project in their account.
2. Find the ref in `npx supabase projects list -o json`. Not there → they are signed in to another
   account: say so and stop. Otherwise **user moment 2 — one message, about TOTP and nothing
   else:** show the project's name and ask them to open, in that project, **Authentication →
   Multi-Factor Authentication** and turn on the **App Authenticator (TOTP)**. Explain that Pevvy
   requires two-factor sign-in for every user, so without it nobody — including them — can finish
   creating their account. Ask: "Have you switched on the App Authenticator in this project?"
   Do not mention installing in this message, and stop.
   - They answer that it is on → append `SUPABASE_TOTP_ENABLED_FOR=<ref>` to `.env.local`
     (create the file if it does not exist; `setup:env` keeps the line later). That is what
     `npm run setup:check` reads.
   - Anything else — not yet, unsure, a question, or silence → record nothing, help them find the
     setting, and ask again.
   - Only an answer to this question counts. Never write the line because they approved
     something else, because the project looks ready, or because `.env.local` already holds the
     line for another project. Never write it yourself to get past the check.

   Do not push migrations without it: the enforcement migration makes a second factor mandatory,
   so applying it to a project where enrolment is switched off leaves every user unable to enrol
   and unable to reach anything, with no way back from inside Pevvy.

   **User moment 3 — one message:** show the project's name, region and creation date and ask:
   "Install Pevvy into this project? I'll connect this folder to it, make sure it is empty,
   create the Pevvy database (every migration in `supabase/migrations/`) and install its 4
   background services. If it is not empty, or anything differs from that plan, I'll stop and
   change nothing." A yes approves exactly that, and nothing about the App Authenticator.

3. Then, without asking again:
   - Before anything reaches Supabase, run `npm run setup:check`: the App Authenticator check must
     pass. If it blocks, go back to user moment 2; do not edit the file to clear it.
   - `npx supabase link --project-ref <ref>` (if it asks for the database password, ask the user
     to run the same command in the terminal panel); confirm `supabase/.temp/project-ref`.
4. Read-only state check:
   `npx supabase db query --linked "select (select count(*) from information_schema.tables where table_schema = 'public') as public_tables, (select count(*) from auth.users) as users, (select count(*) from storage.objects) as files"`
   and `npx supabase migration list --linked`.
   - 0 tables, 0 users, 0 files, no history → **empty**: continue.
   - 0 users, 0 files, a history made only of Pevvy's own migration files → **an earlier install
     stopped**: say so and continue (the push applies only what is missing).
   - Anything else → **in use**: stop, change nothing, run `npx supabase unlink`, and explain that
     Pevvy goes into a new, empty project. A live Pevvy with users is never touched by setup.
5. `npx supabase db push --dry-run` → exactly the Pevvy migrations not yet applied. On an empty
   project that is every file in `supabase/migrations/`; count them rather than trusting a number
   written here, which goes stale each time Pevvy ships a migration. Any file that is not one of
   them is unexpected: stop.
6. `npx supabase db push --yes` (a few minutes; a Docker warning is harmless). Verify:
   - `npx supabase migration list --linked` shows every local migration remotely;
   - with `npx supabase db query --linked "<sql>"`:
     - `select count(*) filter (where not c.relrowsecurity) as rls_off from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r','p')` → 0
     - `select id, public from storage.buckets order by id` → 7 buckets, none public
     - `select tgname from pg_trigger where tgrelid = 'auth.users'::regclass and not tgisinternal` → includes `on_auth_user_created`
   - A push that stops part-way: report the failing migration and wait. After the fix (or a
     dropped connection) `--dry-run` shows only what is left; applying that is covered by the same
     approval.
7. `npx supabase functions deploy --project-ref <ref>`, then
   `npx supabase functions list --project-ref <ref> -o json` → `team-invitations`, `gps-provider`,
   `billing`, `billing-webhook`, `pricing` all ACTIVE. A missing `pricing` leaves the live site
   without its pricing section, silently.
8. `npm run setup:env -- <ref>` writes `.env.local` with the browser-safe values (it prints only
   the kind of key). Never run `supabase projects api-keys` yourself — its output holds secret
   keys. It updates an existing `.env.local` in place and keeps every other key in it, including
   the TOTP confirmation. Only if the file already holds a different Supabase URL or key does it
   refuse; ask before adding `--force`, which replaces just those two values.

## C. Internal checks — automatic, nothing remote, nothing for the user

- `npm run setup:check` passes.
- `npm run build` succeeds with the new `.env.local` (the same build Hostinger will run).
- `npx vitest run supabase/tests` — replays every migration on a throw-away local Postgres and runs
  Pevvy's database tests: tenant isolation, roles, vehicles, rentals and overlaps, payments,
  expenses, financing, reports.

One status line ("database installed and verified; app builds; automated tests pass"), then
straight to D.

## D. Their own GitHub repository

1. Prepare locally, no approval needed: `git --version`, `npm run setup:check`, and work out:
   - Cloned from the original (`origin` is `github.com/salhiworks/atlas-car-rental-saas`) →
     `origin` will become `upstream` with pushing disabled.
   - Downloaded as a ZIP (no `.git`) → a repository will be created (`git init` then
     `git checkout -b main`; `git init -b` needs Git 2.28+).
2. **User moment 4 — one message:** create an **empty, private** repository at github.com/new (no
   README, licence or .gitignore) and paste its URL. If it is the upstream repository or not
   a GitHub URL, say so and ask again — never publish there. Otherwise show in one short block: the
   repository, branch `main`, that `.env.local` and the Supabase link stay on this computer, that
   nothing can be pushed to the upstream repository — and ask "Publish Pevvy to this
   repository?" A yes approves all of step 3.
3. Then, without asking again:
   - Clone: `git remote rename origin upstream`;
     `git remote set-url --push upstream DISABLED--never-push-to-original-atlas`.
     ZIP: `git init`; `git checkout -b main`.
   - `git check-ignore -q .env.local` must succeed. `git remote add origin <url>`; `git add -A`;
     `git status --short` must list no `.env*` (except `.env.example`), `.claude/settings.local.json`,
     `dist/`, `node_modules/` or `supabase/.temp/`, and `git diff --cached | grep -E 'sb_secret_[A-Za-z0-9_-]{24,}|sbp_[a-f0-9]{20,}'` must find
     nothing (Pevvy's tests contain short fake `sb_secret_…` strings; those are fine).
     Otherwise unstage and stop.
   - `git commit -m "Set up Pevvy"`. If Git asks who they are, ask once for the name and email for
     their commits and set them for this folder only (`git config user.name/user.email`).
   - `git push -u origin main`.
     - `RPC failed; HTTP 400` (old Git): retry once with
       `git -c http.postBuffer=157286400 push -u origin main`.
     - Git needs a sign-in: ask the user to run the same push in the terminal panel and sign in
       when asked (GitHub refuses account passwords — use the browser sign-in or a personal access
       token).
     - Rejected because the repository is not empty: stop. Never force-push.
   - Verify `git ls-remote origin main` equals `git rev-parse HEAD`. Then straight to E.

## E. Hostinger

1. **User moment 5 — one message** with their real values: **Hostinger → Websites → Add Website →
   Web App → Import Git Repository**; connect GitHub (**Only select repositories** → theirs);
   branch **main**; the free temporary domain or their own; **Node.js 22** (or the newest offered);
   build command **`npm run build`**; output directory **`dist`**; exactly two environment
   variables, `VITE_SUPABASE_URL` = `https://<ref>.supabase.co` and
   `VITE_SUPABASE_PUBLISHABLE_KEY` = the publishable key from `.env.local` (show it; it is public),
   ignoring any other suggestions; **Deploy**; when the build finishes, paste the site address.
   Never use the Hostinger MCP, FTP, a VPS or another platform, and never change an existing site.
2. When they paste it: `npm run setup:site -- <address>`. It fetches public pages only and checks
   the site is online over HTTPS, that sign-up, the four sign-in link pages and a deep link load,
   and that the build points at this project with its publishable key and no secret key. On a
   failure, give its one-line fix (usually a variable or the output directory, then **Redeploy**)
   and run it again when they say it is done. Deployment is complete only when it passes.
3. **The Help Centre's sitemap** — it comes last because the live address is only known now.
   `npm run help:sitemap -- <address>` writes `public/sitemap.xml` (the help index plus one URL
   per page) and adds the `Sitemap:` line to `public/robots.txt`. Both are committed files; an
   unconfigured checkout holds the honest empty state — no sitemap, and a robots.txt naming none —
   so until this runs `/help` is served but never indexed. Then, without asking again (the same
   repository and branch the user approved in D): `git add public/robots.txt public/sitemap.xml`,
   `git commit -m "Point the Help Centre sitemap at the live address"`, `git push`. That push
   redeploys Hostinger; when it finishes, `https://<address>/robots.txt` must name the sitemap and
   `https://<address>/sitemap.xml` must load. Use the address the site will keep — on Hostinger's
   free temporary domain, say in one line that moving to their own domain means running this again.

## F. Sign-in settings for the live address

**User moment 6 — one message**, with their domain filled in: Supabase → **Authentication → URL
Configuration**:

- **Site URL**: `https://<their domain>`
- **Redirect URLs** (add all four): `https://<their domain>/auth/callback`,
  `https://<their domain>/accept-invite`, `https://<their domain>/auth/reset-password`,
  `https://<their domain>/confirm-email`
- Save, and reply "done".

Do not ask for localhost URLs. Leave **Confirm email** on.

## G. The first agency, on the live site

1. **User moment 7 — one message:** open `https://<their domain>/sign-up`, create the agency, then
   open the confirmation email **in the same browser** and sign in. Use the **same email as their
   Supabase account**: until they set up their own email provider, Supabase only sends to its
   project's team members, about two emails an hour. Reply when the dashboard shows the agency.
2. Verify, read-only:
   `npx supabase db query --linked "select o.name, m.role, u.email_confirmed_at is not null as confirmed from public.organizations o join public.organization_members m on m.organization_id = o.id join auth.users u on u.id = m.user_id"`
   → their agency, role `owner`, confirmed. If it is missing: an "email not authorized" error means
   a non-team email; a link that opens the wrong site means the Site URL; a link that fails means
   a different browser. Fix and retry before suspecting Pevvy.

## H. Done

Short summary, then stop — no QA, no branding interview:

- Pevvy is live at `https://<their domain>`, connected to their own Supabase project; their first
  agency is set up with them as Owner.
- The Help Centre is at `https://<their domain>/help` — public, no sign-in — and search engines
  are pointed at it.
- Their GitHub repository controls the site: every push to `main` redeploys on Hostinger.
- They can ask Claude to customize Pevvy whenever they like.
- **Before accepting real customer sign-ups:** set up their own email provider (Supabase →
  Authentication → Emails → SMTP Settings).
- Optional any time: Stripe subscriptions, Wialon GPS, team invitation emails (Resend), map tiles —
  README.md → "Optional configuration" and "Edge Function secrets". Secrets go into Supabase (Edge
  Functions → Secrets), never `.env.local` or Hostinger.

## Running Pevvy locally — only on request

For someone who wants to work on Pevvy on their computer: `npm run dev`, then in Supabase → URL
Configuration **add** `http://localhost:5173/auth/callback`, `/accept-invite`,
`/auth/reset-password` and `/confirm-email` (with `http://localhost:5173` in front) as Redirect
URLs — keep the live Site URL. They sign in with their live account; no second agency is needed.

## Customization — only on request

Product name and tagline: `src/lib/config/brand.ts` (`name`, `fullName`, `tagline`; keep
`creator`, `creatorUrl` and the MIT notice). Colours: the `--color-brand-*` variables in
`src/styles/index.css`. Icon: `public/favicon-32.png` and `public/apple-touch-icon.png`. Agency details, logo, currency and contract
wording are in the app under **Settings**. Never touch migrations, RLS, authorization or payment
logic while customizing; `npm run build` must pass, and a push to `main` publishes the change.

## Later updates

Every push to `main` redeploys on Hostinger. A Pevvy update that adds a migration:
`npx supabase db push --dry-run`, then apply it with the owner's approval.

A Pevvy update that adds or removes Help Centre pages: rerun
`npm run help:sitemap -- <their address>` and commit `public/sitemap.xml` and `public/robots.txt`
with it, or the sitemap goes stale and `npm run verify` fails on `help-sitemap.test.ts`.

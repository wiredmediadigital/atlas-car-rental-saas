# Pevvy — notes for Claude

Pevvy is a multi-tenant car rental SaaS: Vite + React 19 + TypeScript in `src/`, a Supabase
backend in `supabase/` (61 ordered migrations, five Edge Functions), deployed as a static
build from `dist/`.

## Setting Pevvy up

When someone asks to install, set up, connect, publish or deploy Pevvy, follow the
**atlas-setup** skill (`.claude/skills/atlas-setup/SKILL.md`). It is deployment-first and
agent-led. Supabase comes first, then their own GitHub repository, then Hostinger. Sign-in
settings use the live address, and the first agency is created on the live site; setup never
runs Pevvy on localhost. You do every safe step yourself and keep going without "continue?"
questions. You stop only when the user must act in their own accounts or approve a change
outside this folder. Then you ask once, naming the exact destination and operations, and that
approval covers them. Don't hand out manual testing. Keep Pevvy's default name, logo and
colours unless asked.

`npm run setup:check` is a read-only checklist of where the folder stands. Run it at the
start of a session and between stages. `npm run setup:site -- <domain>` checks a deployed
site, read-only.

## Rules that always apply

- **Secrets never go in `VITE_` variables.** Everything prefixed `VITE_` is compiled into
  the browser bundle. The frontend needs exactly `VITE_SUPABASE_URL` and
  `VITE_SUPABASE_PUBLISHABLE_KEY` (`VITE_SUPABASE_ANON_KEY` still works as the older name).
  Never print a secret key, access token, database password or invitation link back to
  the user.
- **The database schema is the migration history.** Never edit an existing file in
  `supabase/migrations/`; a schema change is a new, later-dated migration. Apply
  migrations with `npx supabase db push` after a `--dry-run` and the user's approval.
  Do not apply them through the SQL editor or an MCP `apply_migration`: that records a
  different history, and several migrations are not safe to run twice.
- **Pushing and applying migrations does not deploy Edge Functions.** A change that adds
  or modifies a function in `supabase/functions/` needs `npx supabase functions deploy <slug>`;
  a function nobody deployed fails at runtime as "could not reach the server". `npm run
setup:site` verifies every local function is deployed and ACTIVE.
- **The App Authenticator must be on before migrations are pushed.** Pevvy requires a
  verified second factor for every user, enforced in the database. Pushing that schema to
  a project where Authentication → Multi-Factor Authentication has TOTP switched off
  leaves every user of every agency unable to enrol and unable to read anything, with no
  way back from inside Pevvy. `npm run setup:check` blocks on this; it reads
  `SUPABASE_TOTP_ENABLED_FOR=<ref>` in `.env.local`, which records the user confirming it.
  You write that line, but only after the user has answered a question about TOTP
  specifically and said they have switched it on in their dashboard. Never infer it, assume
  it, or carry it over from another approval — a yes to installing, publishing or anything
  else is not that answer.
- **Confirm the Supabase project before every remote command.** `supabase/.temp/project-ref`
  must equal the project in `.env.local` and the one the user confirmed. `npm run setup:check`
  fails when they differ — stop and ask.
- **Never run against a project you were not explicitly given.** Do not run
  `supabase config push`, `supabase db reset --linked` or `npm run smoke:live` for a user;
  the smoke test is a developer tool for disposable projects only.
- **Never push to the original repository** (`github.com/salhiworks/atlas-car-rental-saas`).
  Publishing goes to the user's own repository, after they approve the remote and branch.
  Never force-push or rewrite history.
- **Do not change security boundaries as a side effect.** Row Level Security policies,
  authorization functions, migrations and payment logic are out of scope for setup and
  rebranding.

## Checking work

- `npm run verify` — format, lint, typecheck, unit + database tests (PGlite), build.
- `npm run build` — enough to confirm a configuration change.
- Database tests in `supabase/tests/` replay every migration on a fresh in-memory Postgres.

# Environment and deployment

- Staging Supabase: `yeklucfthspvejlkffln`, `https://yeklucfthspvejlkffln.supabase.co`.
- Production Supabase: `ysnumxtzcgzyabrghxwq`; do not access for this handoff or unapproved work.
- Staging frontend: `https://quantum-lavenderblush-buffalo-97.hostingersite.com`.
- Production frontend: `https://pevvy.io`.
- Established Hostinger staging configuration: branch `staging`, build `npm run build`, output `dist-staging`; guarded repository command `npm run build:staging`.

Corrected 2026-11-26 from a credentialed read. Git authentication works and `SEC_E_NO_CREDENTIALS` does not reproduce. The live references are `origin/main=31383a97` and `origin/staging=977e32eb`; the `112cc994` recorded here previously was the base of the maintenance branch, not its tip. `origin/main` is an ancestor of `origin/staging`, which is 19 commits ahead with no divergence, so the maintenance reports' claimed pushes through `ac78cf1` and `977e32e` are confirmed by the remote itself.

Use Node >=20.19.0 and npm. Commands include `npm ci`, `npm run dev`, `npm run typecheck`, `npm run lint`, `npm run test`, `npm run build`, `npm run build:staging`, and `npm run verify`. PGlite tests do not prove two independent hosted PostgreSQL transactions.

Record names only, never values: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, legacy `VITE_SUPABASE_ANON_KEY`, `SUPABASE_PROJECT_REF`, `SUPABASE_DB_PASSWORD`, `SUPABASE_STAGING_DB_URL`, `SUPABASE_ACCESS_TOKEN`, and `SUPABASE_TOTP_ENABLED_FOR`.

No deployment occurred during this handoff. The guarded build previously failed closed when approved staging URL/browser key configuration was absent; never substitute production configuration. HTTP 200 does not prove commit, assets, authentication, or acceptance. Production requires explicit authorization and a completed release checklist.

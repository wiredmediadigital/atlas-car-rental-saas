-- -----------------------------------------------------------------------------
-- Each legal document gets its own date; the Terms version follows the Terms
-- -----------------------------------------------------------------------------
--
-- The Terms of service, the privacy policy and the data processing terms used
-- to share one `lastUpdated` date in src/pages/legal/legal-config.ts, and
-- app.current_terms_version() returned that same string. Amending the privacy
-- policy would therefore have changed the version of the Terms every agency
-- had accepted.
--
-- legal-config.ts now holds three dates: termsUpdated, privacyUpdated and
-- dataProcessingUpdated. This function tracks termsUpdated alone.
--
-- The value is unchanged today (all three dates are still 12 November 2026),
-- so no agency is asked to accept again. Signature, return type, volatility
-- and grants are kept as they were; only what the constant is documented to
-- equal changes. supabase/tests/terms-acceptance.test.ts pins the function to
-- LEGAL().termsUpdated so the two cannot drift.

create or replace function app.current_terms_version()
returns text
language sql
stable
set search_path = ''
as $$
  select '12 November 2026'::text;
$$;

comment on function app.current_terms_version() is
  'The current Terms of Service version, as a constant. Stable rather than immutable: the constant changes when the Terms do. Tracks the Terms only, not the privacy policy or the data processing terms. Must equal termsUpdated in src/pages/legal/legal-config.ts.';

revoke all on function app.current_terms_version() from public;

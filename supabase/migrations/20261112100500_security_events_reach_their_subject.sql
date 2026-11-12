-- =============================================================================
-- 20261112100500_security_events_reach_their_subject.sql
--
-- The audit table recorded three of its five event types and surfaced one.
--
--   factor_enrolled          nothing wrote it
--   factor_reset_by_operator nothing wrote it (it is a runbook, not a feature:
--                            docs/security/second-factor-recovery.md)
--   recovery_code_used       written with organization_id => null
--   factor_removed           written with organization_id => null
--   factor_reset_by_owner    the only one anybody could read
--
-- The select policy from 20261112100000 is has_min_role(organization_id,
-- 'owner'), so a row with a null organization_id is readable by nobody at all.
-- Two things are fixed here, and 20261112100000 is not edited.
--
-- 1. public.mfa_record_enrolment() gives factor_enrolled a writer. The client
--    calls it once the first code from a new authenticator has been verified.
--
--    NOT emitted from mfa_generate_recovery_codes, which also runs when somebody
--    regenerates their codes from Settings. That is not an enrolment, and
--    conflating the two would make the trail say something untrue.
--
-- 2. A user may read the events about themselves. recovery_code_used and
--    factor_removed belong to a person rather than an agency, so without this
--    they are written and never read by anyone — which is not an audit trail,
--    it is a write-only table.
--
--    That policy is NOT gated on app.has_second_factor(), for the same reason
--    the `id = auth.uid()` half of profiles_select is not: these are the events
--    of somebody whose second factor has just been removed, and a session that
--    cannot reach aal2 is exactly the session that needs to see them. The rows
--    are the user's own, and a policy is a union — this one widens nothing for
--    anybody else.
--
-- BILLING: mfa_record_enrolment does not ask app.billing_require_write, for the
-- reason 20261112100100 gives for mfa_generate_recovery_codes — sign-in security
-- belongs to a person, not to an agency, so a suspended or closing organization
-- must never stop somebody protecting their own account. It is listed as exempt
-- in billing-restricted-access.test.ts.
-- =============================================================================

set search_path = public, extensions, pg_temp;

-- -----------------------------------------------------------------------------
-- A writer for factor_enrolled
-- -----------------------------------------------------------------------------

create or replace function public.mfa_record_enrolment()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
begin
  if v_user_id is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  -- Reachable directly over PostgREST, and the second factor is enforced here
  -- for the same reason it is in mfa_generate_recovery_codes: only a session
  -- that has verified a factor can honestly claim to have enrolled one. GoTrue
  -- raises the session to aal2 when the first code is verified, so the caller —
  -- the enrolment screen, immediately after that verification — is already
  -- there.
  if coalesce((select auth.jwt()) ->> 'aal', '') <> 'aal2' then
    raise exception 'recording an enrolment requires a verified second factor'
      using errcode = '42501';
  end if;

  -- organization_id is null: an authenticator belongs to the person, not to one
  -- of their agencies. The policy added below is what makes it readable.
  perform app.record_security_event(
    'factor_enrolled',
    v_user_id,
    null,
    jsonb_build_object('factor_type', 'totp'),
    v_user_id
  );
end;
$$;

comment on function public.mfa_record_enrolment() is
  'Records a factor_enrolled event for the caller. Called once a new authenticator''s first code has been verified; not emitted when recovery codes are merely regenerated.';

revoke all on function public.mfa_record_enrolment() from public, anon;
grant execute on function public.mfa_record_enrolment() to authenticated;

-- -----------------------------------------------------------------------------
-- A person may read their own security history
-- -----------------------------------------------------------------------------

drop policy if exists security_events_select_self on public.security_events;
create policy security_events_select_self on public.security_events
  for select to authenticated
  using (subject_user_id = (select auth.uid()));

comment on table public.security_events is
  'Append-only audit trail of second-factor changes. Written only by app.record_security_event; readable by owners of the organization and by the person each event is about.';

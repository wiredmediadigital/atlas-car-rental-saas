-- =============================================================================
-- Public booking: how long a lead lives
-- =============================================================================
--
-- Twelve months from creation for anything not converted, then deleted. Long
-- enough that an agency can say "you enquired last spring"; short enough that
-- strangers' contact details are not held indefinitely by a business they never
-- became a customer of.
--
-- CONVERTED LEADS ARE KEPT AT ANY AGE. They are no longer an enquiry: they are
-- the provenance of a customer and a rental the agency has, and deleting one
-- would leave a contract whose origin is unexplained. The personal data in a
-- converted lead has a copy in the customer record anyway, under that record's
-- own retention.
--
-- NOTHING IN THIS DEPLOYMENT SWEEPS ON A SCHEDULE. pg_cron is deliberately not
-- installed, so this is called by the daily account-closure drain -- the one
-- scheduler Pevvy has (.github/workflows/account-closure.yml) -- rather than by
-- a second one introduced for a housekeeping job.
--
-- IT IS BATCHED. The drain has a time budget and a purge of a large agency can
-- use most of it. A bounded delete cannot be the step that makes the daily run
-- time out; what it does not reach today it reaches tomorrow.

create or replace function app.purge_expired_booking_leads(p_limit integer default 1000)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  -- Stated here rather than in a settings table: changing a retention period is
  -- a decision with a paper trail, which is what a migration is.
  c_retention constant interval := interval '12 months';
  v_deleted   integer;
begin
  with expired as (
    select l.id
    from public.booking_leads l
    where l.status <> 'converted'
      and l.created_at < now() - c_retention
    order by l.created_at
    limit greatest(coalesce(p_limit, 1000), 0)
  )
  delete from public.booking_leads l
  using expired e
  where l.id = e.id;

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

comment on function app.purge_expired_booking_leads(integer) is
  'Deletes unconverted booking leads older than twelve months, up to p_limit per call, and returns how many went. Converted leads are kept at any age: they are the provenance of a customer and a rental. Called by the daily account-closure drain; pg_cron is not installed.';

revoke all on function app.purge_expired_booking_leads(integer) from public, anon, authenticated;
grant execute on function app.purge_expired_booking_leads(integer) to service_role;

do $assert$
begin
  if has_function_privilege('anon', 'app.purge_expired_booking_leads(integer)', 'EXECUTE')
     or has_function_privilege('authenticated', 'app.purge_expired_booking_leads(integer)', 'EXECUTE') then
    raise exception 'A browser role may run the booking lead retention sweep.';
  end if;
end;
$assert$;

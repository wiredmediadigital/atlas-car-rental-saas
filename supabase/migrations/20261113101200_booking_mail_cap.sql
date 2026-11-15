-- =============================================================================
-- Public booking: how many requests an agency has had this hour
-- =============================================================================
--
-- app.public_booking_lead_notice restated whole with one more column:
-- recent_requests, the number of booking requests this agency has received in
-- the last hour, the one being announced included.
--
-- WHAT IT IS FOR. A burst of requests becomes a burst of email: one
-- acknowledgement per request, to an address whoever sent it chose, plus one
-- notification per owner and administrator. The acknowledgements are the
-- dangerous half -- they go to addresses this deployment did not pick, so the
-- spam complaints land against the one domain every agency here sends from.
--
-- IT CAPS THE MAIL AND NEVER THE LEAD. The decision about what to do with this
-- number lives in supabase/functions/_shared/booking-lead-email.ts, and what it
-- does is stop sending, not stop recording. A request over the cap is still
-- written, still notifies in-app, and still appears in the agency's queue --
-- so somebody who floods an agency silences its email for an hour and achieves
-- nothing else. Refusing the requests instead would hand them a way to switch a
-- competitor's booking page off, which is worse than the burst.
--
-- COUNTED FROM booking_leads rather than from a record of what was sent. One
-- fewer table, one fewer write on the path a stranger can reach, and the number
-- is the one that matters: a request is what causes an acknowledgement.

drop function if exists app.public_booking_lead_notice(uuid);

create or replace function app.public_booking_lead_notice(p_lead_id uuid)
returns table (
  reference          text,
  vehicle_label      text,
  starts_at          timestamptz,
  ends_at            timestamptz,
  currency           public.currency_code,
  quoted_total_minor bigint,
  renter_name        text,
  renter_email       text,
  agency_name        text,
  agency_phone       text,
  agency_email       text,
  time_zone          text,
  recipients         text[],
  recent_requests    integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    l.reference,
    btrim(coalesce(v.make, '') || ' ' || coalesce(v.model, '')),
    l.starts_at,
    l.ends_at,
    l.currency,
    l.quoted_total_minor,
    l.full_name,
    l.email::text,
    o.name,
    o.phone,
    o.email::text,
    o.time_zone,
    coalesce(
      (
        select array_agg(u.email order by u.email)
        from public.organization_members m
        join auth.users u on u.id = m.user_id
        where m.organization_id = l.organization_id
          and m.status = 'active'
          and app.role_rank(m.role) >= app.role_rank('admin')
          and u.email is not null
      ),
      array[]::text[]
    ),
    (
      select count(*)::integer
      from public.booking_leads recent
      where recent.organization_id = l.organization_id
        and recent.created_at > now() - interval '1 hour'
    )
  from public.booking_leads l
  join public.organizations o on o.id = l.organization_id
  left join public.vehicles v on v.id = l.vehicle_id
  where l.id = p_lead_id;
$$;

comment on function app.public_booking_lead_notice(uuid) is
  'Everything one booking-request message needs: the request, the agency, the agency''s own address for Reply-To, the active owners and administrators to notify, and how many requests this agency has had in the last hour. Raw values, because formatting and the cap are decisions and belong where a test can reach them. Service role only; none of this is in the public page projection.';

revoke all on function app.public_booking_lead_notice(uuid) from public, anon, authenticated;
grant execute on function app.public_booking_lead_notice(uuid) to service_role;

do $assert$
begin
  if has_function_privilege('anon', 'app.public_booking_lead_notice(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'app.public_booking_lead_notice(uuid)', 'EXECUTE') then
    raise exception 'A browser role may read booking lead notice details.';
  end if;
end;
$assert$;

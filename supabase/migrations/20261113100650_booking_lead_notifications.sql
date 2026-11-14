-- =============================================================================
-- Public booking: telling the agency a request arrived
-- =============================================================================
--
-- One notification_events row per lead, reaching the people who can act on it.
--
-- THE EVENT CARRIES NO RENTER PERSONAL DATA, and that is the whole design.
-- Pevvy requires a verified second factor to read a customer record; piping a
-- stranger's name, email, telephone number and free-text note into whatever
-- inbox an agency happens to use would undo that for every request that ever
-- arrives. The event says a request came in and names the car -- which is the
-- agency's own information -- and the person is inside Pevvy, behind the
-- second factor, where the rest of the identity data already lives.
--
-- IT HANGS OFF THE ROW, NOT OFF THE PUBLIC WRITE PATH. A trigger on
-- booking_leads means a lead a staff member types in from a telephone call
-- notifies exactly as one from the page does, and app.public_booking_create_lead
-- stays a function about accepting a request.
--
-- OWNERS AND ADMINISTRATORS ONLY, which is a decision about who an enquiry is
-- for rather than about who may see it: every member can read the Leads
-- section. Mail is the scarce thing, and a request that nobody with authority
-- sees is the failure this notification exists to prevent. It is also not
-- organizations.email, which is frequently a shared address nobody watches.

create or replace function app.notify_booking_lead_received()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_vehicle public.vehicles;
  v_event   uuid;
begin
  select * into v_vehicle
  from public.vehicles v
  where v.id = new.vehicle_id;

  insert into public.notification_events (
    organization_id, kind, severity, occurred_at,
    actor_user_id, actor_label, subject_user_id, subject_label,
    context, source_table, source_id
  ) values (
    new.organization_id,
    'booking_lead_received',
    -- Not a warning: a request is good news with a clock on it. The urgency
    -- belongs to how quickly staff answer, not to how loudly this shouts.
    'info',
    new.created_at,
    -- A stranger is not a user of this product and never will be, so there is
    -- no actor. An empty label is what the column means by "nobody".
    null,
    '',
    null,
    left(btrim(coalesce(v_vehicle.make, '') || ' ' || coalesce(v_vehicle.model, '')), 200),
    -- Facts about the request, none of them about the person who made it. The
    -- lead id is in source_id, which is what opens it.
    jsonb_build_object(
      'reference', new.reference,
      'vehicle_id', new.vehicle_id,
      'starts_at', new.starts_at,
      'ends_at', new.ends_at,
      'currency', new.currency,
      'quoted_total_minor', new.quoted_total_minor
    ),
    'booking_leads',
    new.id
  )
  returning id into v_event;

  insert into public.notification_event_recipients (event_id, user_id)
  select v_event, m.user_id
  from public.organization_members m
  where m.organization_id = new.organization_id
    and m.status = 'active'
    and app.role_rank(m.role) >= app.role_rank('admin')
  on conflict do nothing;

  return null;
end;
$$;

comment on function app.notify_booking_lead_received() is
  'AFTER INSERT trigger on booking_leads: records one booking_lead_received event for the agency''s active owners and administrators. Carries the car, the dates and the quote, and nothing about the person who asked -- their details stay inside Pevvy, behind the second factor.';

revoke all on function app.notify_booking_lead_received() from public, anon, authenticated;

drop trigger if exists booking_leads_notify_received on public.booking_leads;
create trigger booking_leads_notify_received
  after insert on public.booking_leads
  for each row execute function app.notify_booking_lead_received();

-- -----------------------------------------------------------------------------
-- Assertions
-- -----------------------------------------------------------------------------

do $assert$
declare
  v_body constant text :=
    pg_get_functiondef('app.notify_booking_lead_received()'::regprocedure);
begin
  -- The columns holding what a renter typed must never be read by this
  -- function. Naming one of them is how the personal data would get out.
  if v_body ~* '\mnew\.(full_name|email|phone|note)\M' then
    raise exception 'The booking lead notification must not carry the renter''s own details.';
  end if;

  if v_body not like '%role_rank%' then
    raise exception 'The booking lead notification must choose its recipients by role.';
  end if;
end;
$assert$;

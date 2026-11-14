-- =============================================================================
-- Public booking: the same request twice
-- =============================================================================
--
-- app.public_booking_create_lead restated whole, with one addition: an
-- identical request from the same person inside the hour is answered with the
-- reference it was already given, and writes nothing.
--
-- WHY THIS AND NOT A PER-AGENCY CEILING. The obvious defence against a flood is
-- to refuse an agency more than N requests an hour. It is also weaponisable: an
-- attacker who pushes an agency past the ceiling has not spammed them, they
-- have switched the agency's booking page off for every real customer behind
-- it, and the agency cannot see it happening. A rule that only collapses a
-- request into its own repeat cannot be turned on anyone -- the worst an
-- attacker achieves by sending the same thing twice is sending it once.
--
-- The mail side of the same worry belongs to the notification work, where a
-- per-agency cap on messages per hour protects the inbox without refusing
-- anybody's enquiry.
--
-- The lookup is served by booking_leads_vehicle_period_idx (20261113100200).

create or replace function app.public_booking_create_lead(
  p_organization_id uuid,
  p_vehicle_id      uuid,
  p_from            timestamptz,
  p_to              timestamptz,
  p_full_name       text,
  p_email           text,
  p_phone           text default null,
  p_note            text default null
)
returns table (lead_id uuid, reference text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  -- Longest hire this will record. Matches the booking_leads.billable_days
  -- check, so a request can never be accepted here and refused by the table.
  c_max_days constant integer := 370;
  -- A visitor whose clock, or whose time zone, puts "this morning" slightly in
  -- the past is asking for something reasonable. A year ago is not.
  c_past_grace constant interval := interval '1 day';

  v_name     text := btrim(coalesce(p_full_name, ''));
  v_email    text := btrim(coalesce(p_email, ''));
  v_phone    text := nullif(btrim(coalesce(p_phone, '')), '');
  v_note     text := nullif(btrim(coalesce(p_note, '')), '');
  -- How long an identical request counts as the same one. Long enough to
  -- cover a double click, a retried submission and a browser resubmitting on
  -- back; short enough that somebody genuinely asking again tomorrow is heard.
  c_duplicate_window constant interval := interval '1 hour';

  v_vehicle   public.vehicles;
  v_days      integer;
  v_duplicate public.booking_leads;
begin
  -- 1. Is this agency publishing a page at all? Same question the reads ask.
  if not app.public_booking_is_open(p_organization_id) then
    raise exception 'This agency is not accepting booking requests.' using errcode = '42501';
  end if;

  -- 2. Leads are not billing-exempt. An agency that has stopped paying is
  -- read-only, and a page still taking requests it cannot act on would be a
  -- promise nobody is keeping. Raises 42501.
  perform app.billing_require_write(p_organization_id);

  -- 3. The dates. The Edge Function says this better to the visitor; the
  -- database refuses the absurd regardless of who calls it.
  if p_from is null or p_to is null then
    raise exception 'A booking request needs a start and an end.' using errcode = '22023';
  end if;
  if p_to <= p_from then
    raise exception 'The period must end after it starts.' using errcode = '22023';
  end if;
  if p_from < now() - c_past_grace then
    raise exception 'A booking request cannot start in the past.' using errcode = '22023';
  end if;
  if public.rental_billable_days(p_from, p_to) > c_max_days then
    raise exception 'A booking request cannot run for more than % days.', c_max_days
      using errcode = '22023';
  end if;

  -- 4. The person. The email_address domain checks the shape of the address on
  -- insert; an empty name has to be refused here, because btrim made it empty.
  if v_name = '' then
    raise exception 'A booking request needs a name.' using errcode = '22023';
  end if;

  -- 5. The vehicle, as it is NOW: this agency's, opted in, not archived, and
  -- still existing. One lookup answers all four, and the single message covers
  -- them so that a refusal cannot be used to probe which one it was.
  select v.* into v_vehicle
  from public.vehicles v
  where v.id = p_vehicle_id
    and v.organization_id = p_organization_id
    and v.public_booking_enabled
    and v.archived_at is null;

  if not found then
    raise exception 'That vehicle is no longer available to request.' using errcode = '22023';
  end if;

  /*
   * DELIBERATELY NOT CHECKED: whether the vehicle is free for these dates.
   *
   * A request holds nothing. The page marks an unavailable car "not free for
   * these dates" and offers no form for it, but a request that arrives anyway
   * -- because someone else booked the car thirty seconds ago, or because the
   * car went into the workshop this morning -- is still a real person asking a
   * real question. Refusing it would throw their details away to protect an
   * invariant nothing depends on. Availability is decided once, at conversion
   * (20261113100500), where the rental either takes the car or does not.
   */

  /*
   * 6. The same request again.
   *
   * A double click, a connection retried, a browser resubmitting on back: all
   * of them send the identical payload within seconds. The second one is
   * ANSWERED WITH THE FIRST ONE'S REFERENCE rather than refused, because the
   * person did nothing wrong -- an error here would show a failure to someone
   * whose request worked, and invite them to send a third.
   *
   * Identical means: same agency, same car, same two instants, same address
   * ignoring case, and still untouched. Once staff have contacted, declined or
   * converted it, the agency has acted, and the same person asking again is
   * saying something new rather than clicking twice.
   *
   * It is deliberately narrow. A blunt per-agency ceiling would be
   * weaponisable: flooding an agency past it would stop their real customers
   * getting through, which is a worse outcome than the duplicates it prevents.
   * This refuses nothing that was not already a repeat of itself.
   */
  select l.* into v_duplicate
  from public.booking_leads l
  where l.organization_id = p_organization_id
    and l.vehicle_id = p_vehicle_id
    and l.starts_at = p_from
    and l.ends_at = p_to
    and lower(l.email) = lower(v_email)
    and l.status = 'new'
    and l.created_at > now() - c_duplicate_window
  order by l.created_at desc
  limit 1;

  if found then
    return query select v_duplicate.id, v_duplicate.reference;
    return;
  end if;

  -- 7. The price snapshot, taken here from the vehicle rather than accepted
  -- from the caller. rental_billable_days is the same function the rental will
  -- use, so the estimate and the eventual price are counted the same way.
  v_days := public.rental_billable_days(p_from, p_to);

  return query
  insert into public.booking_leads (
    organization_id, vehicle_id, starts_at, ends_at,
    full_name, email, phone, note,
    currency, daily_rate_minor, billable_days, quoted_total_minor
  )
  values (
    p_organization_id, p_vehicle_id, p_from, p_to,
    v_name, v_email, v_phone, v_note,
    v_vehicle.currency, v_vehicle.daily_rate_minor, v_days,
    v_vehicle.daily_rate_minor * v_days
  )
  returning booking_leads.id, booking_leads.reference;
end;
$$;

comment on function app.public_booking_create_lead(uuid, uuid, timestamptz, timestamptz, text, text, text, text) is
  'Records a booking request from an agency''s public page and returns its id and reference. Takes no price: the rate and currency are read from the vehicle here, and every condition the page was built from is re-asked at the moment of the write. An identical request from the same address within the hour is answered with the reference it already has. Granted to service_role alone; its error messages are for the log, not for the browser.';

do $assert$
declare
  v_signature constant text :=
    'app.public_booking_create_lead(uuid, uuid, timestamptz, timestamptz, text, text, text, text)';
  v_body text;
begin
  if has_function_privilege('anon', v_signature, 'EXECUTE')
     or has_function_privilege('authenticated', v_signature, 'EXECUTE') then
    raise exception 'A browser role may create booking leads, which is the one write a stranger can cause.';
  end if;

  v_body := pg_get_functiondef(v_signature::regprocedure);

  -- Unchanged from 20261113100400, repeated because this file redefines it.
  if v_body ~* 'p_(daily_rate|rate|total|amount|price|currency|billable)' then
    raise exception 'public_booking_create_lead must not take a price from its caller.';
  end if;
  if v_body not like '%public_booking_is_open%' or v_body not like '%billing_require_write%' then
    raise exception 'public_booking_create_lead must re-ask whether the page is open and whether the agency may write.';
  end if;

  -- And the duplicate rule must stay narrow: matching on the address is what
  -- keeps it from becoming a ceiling anybody could push an agency past.
  if v_body not like '%lower(l.email) = lower(v_email)%' then
    raise exception 'The duplicate rule must match on the requester, not on the agency alone.';
  end if;
end;
$assert$;

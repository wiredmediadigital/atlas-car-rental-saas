-- =============================================================================
-- Public booking: the same request twice, at the same instant
-- =============================================================================
--
-- 20261113100800 collapses an identical request into the one already sent: same
-- agency, same car, same two instants, same address, still untouched, inside
-- the hour. It reads for that row and then inserts if it found none, which is a
-- check and a write with nothing between them.
--
-- The double click it was written for is exactly the thing that defeats it. Two
-- submissions a few milliseconds apart both read, both find nothing, and both
-- insert. The agency gets the two leads the rule exists to prevent, and the
-- visitor gets two references for one question.
--
-- This is the most exposed read-then-write in the product: the only one a
-- stranger reaches without signing in, and the only one where the person
-- supplying the timing is also the person clicking twice.
--
-- WHY NOT A UNIQUE INDEX, which is the usual answer. The rule is "identical AND
-- untouched AND inside the hour", and an index cannot hold the third part --
-- `created_at > now() - interval '1 hour'` is not a value, it is a question
-- asked at read time. A partial unique index on the rest would forbid the
-- second request FOREVER rather than for an hour, so a lead nobody ever touched
-- would silently block the same person asking again next month. That is a
-- behaviour change dressed as a bug fix, and the wrong one: somebody asking
-- again weeks later is saying something new, which is the distinction
-- 20261113100800 was careful to draw.
--
-- An advisory lock holds what the index cannot. It is keyed on the five values
-- that make two requests identical, so only requests that are already each
-- other's duplicate ever wait.
--
-- THE FUNCTION IS OTHERWISE UNCHANGED, and is reproduced from
-- 20261113101100 -- the current definition, which added `created` to the
-- return type -- with the lock spliced in above the duplicate check. Not
-- restated by hand: the first attempt at this file was typed from the version
-- two migrations back and silently dropped billing_require_write, changed four
-- error codes and rewrote six refusals. The window, what counts as identical,
-- what a repeat is answered with, and the refusal to impose a weaponisable
-- per-agency ceiling all stand exactly as they were.
--
-- A single-connection PGlite cannot open the two transactions this is about, so
-- the test asserts the lock is taken before the check rather than racing it.
-- =============================================================================

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
returns table (lead_id uuid, reference text, created boolean)
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
   * One identical request at a time.
   *
   * The check below reads and then writes, and the double click it exists for
   * is precisely what slips between the two. This makes two requests that are
   * already each other's duplicate take turns; nothing else waits on anything,
   * and the lock is released when this transaction ends either way.
   *
   * The key is the five values that make two requests identical, so a second
   * caller arrives at the check with the first caller's row committed and
   * leaves down the path that was always there.
   */
  perform pg_advisory_xact_lock(
    hashtext('booking_lead_duplicate'),
    hashtext(
      p_organization_id::text || '|' || p_vehicle_id::text || '|' ||
      p_from::text || '|' || p_to::text || '|' || lower(v_email)
    )
  );

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
    -- created = false, which is what stops a retry sending the renter a second
    -- acknowledgement and the agency a second notification.
    return query select v_duplicate.id, v_duplicate.reference, false;
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
  returning booking_leads.id, booking_leads.reference, true;
end;
$$;

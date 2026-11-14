-- =============================================================================
-- Public booking: accepting a request from outside the product
-- =============================================================================
--
-- The one write a stranger can cause, and the only one there will ever be.
-- SECURITY DEFINER, granted to service_role alone, so the caller is the
-- public-booking Edge Function holding the service key.
--
-- NOTHING THE RENTER SENDS IS TRUSTED. Every argument is a fact about what they
-- asked for, never about what it costs or what is on offer: there is no price
-- parameter at all, so there is no field a forged request could put a rate in.
-- The rate and currency are read from the vehicle inside this function and the
-- total is computed here.
--
-- EVERY CONDITION IS RE-ASKED AT THE MOMENT OF THE WRITE. The page a visitor is
-- looking at was built from a read that may be minutes old: in between, the
-- agency can switch the page off, start closing, stop paying, opt the vehicle
-- out, archive it as sold, or delete it. Each of those is checked again here,
-- because the page is a cache and this is the record.
--
-- THE MESSAGES BELOW ARE FOR THE LOG, NOT FOR THE INTERNET. They name the
-- reason so an operator can tell a refusal from a bug; several of them would
-- tell a stranger something about the agency (that it stopped paying, that a
-- car exists but was withdrawn). The Edge Function answers the browser with one
-- neutral sentence and never echoes these.

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
  v_vehicle  public.vehicles;
  v_days     integer;
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

  -- 6. The price snapshot, taken here from the vehicle rather than accepted
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
  'Records a booking request from an agency''s public page and returns its id and reference. Takes no price: the rate and currency are read from the vehicle here, and every condition the page was built from is re-asked at the moment of the write. Granted to service_role alone; its error messages are for the log, not for the browser.';

revoke all on function app.public_booking_create_lead(uuid, uuid, timestamptz, timestamptz, text, text, text, text) from public, anon, authenticated;
grant execute on function app.public_booking_create_lead(uuid, uuid, timestamptz, timestamptz, text, text, text, text) to service_role;

-- -----------------------------------------------------------------------------
-- Assertions
-- -----------------------------------------------------------------------------

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

  -- The price is read, never received. Any parameter whose name suggests
  -- otherwise means the snapshot stopped being the database's own answer.
  if v_body ~* 'p_(daily_rate|rate|total|amount|price|currency|billable)' then
    raise exception 'public_booking_create_lead must not take a price from its caller.';
  end if;

  if v_body not like '%public_booking_is_open%' or v_body not like '%billing_require_write%' then
    raise exception 'public_booking_create_lead must re-ask whether the page is open and whether the agency may write.';
  end if;
end;
$assert$;

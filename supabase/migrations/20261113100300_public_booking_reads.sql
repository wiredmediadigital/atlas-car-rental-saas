-- =============================================================================
-- Public booking: what a visitor who is not signed in may learn
-- =============================================================================
--
-- Two reads, and they are the entire public surface of the database. Both are
-- SECURITY DEFINER and granted to `service_role` alone, so the only caller is
-- the public-booking Edge Function holding the service key. `anon` keeps having
-- no grant on anything, which is what makes the product's existing self-checks
-- still true.
--
-- THE PROJECTION IS THE SECURITY BOUNDARY. A definer function hands back
-- whatever it selects, so what is absent here is absent from the internet:
-- registration_plate, vin, odometer, every cost and acquisition field, every
-- compliance date, documents, customers and rentals. Adding a column to either
-- function publishes it. The tests pin the column list for exactly that reason.
--
-- AN AGENCY THAT SHOULD NOT BE FOUND IS NOT AN ERROR. A slug nobody owns, a
-- master switch that is off, and an agency winding down all answer with no rows
-- and no exception, so the page cannot be used to discover who is a customer of
-- Pevvy.

-- -----------------------------------------------------------------------------
-- 1. The availability predicate, without the membership question
--
-- public.vehicles_available_between already answers "which vehicles are free
-- between these instants", and its body mirrors the rentals_no_vehicle_overlap
-- exclusion constraint. It also asks app.is_org_member first, which the service
-- role can never satisfy: it holds a key, not a membership.
--
-- Rather than copy the predicate into the public read -- where it would drift
-- from the constraint the moment either changed -- the predicate moves into one
-- function and both reads call it. One copy, two doors, and the browser's door
-- is exactly where it was.
--
-- THE PREDICATE IS SECURITY INVOKER, which is what keeps this honest. A
-- signed-in caller runs it as `authenticated`, so row-level security answers the
-- tenant question exactly as it does for a direct select on vehicles -- naming
-- another agency's id returns nothing rather than its fleet. The public read is
-- SECURITY DEFINER and therefore runs it as the owner, which is how the one
-- caller holding the service key sees the agency it asked about. That is the
-- same owner-bypasses-RLS every definer read here already relies on; it would
-- need revisiting only if these tables were put under FORCE ROW LEVEL SECURITY,
-- which none of them are.
--
-- Making the predicate definer and service-role-only was tried first and is
-- wrong twice over: it denies the member-facing read outright, and the fix for
-- that -- promoting public.vehicles_available_between to SECURITY DEFINER --
-- breaks the rule that definer functions in `public` are reserved for places
-- where the application holds no privilege of its own
-- (supabase/tests/analytics-security.test.ts enumerates every one of them).
-- This read is one a member could perform directly, so it stays invoker.
--
-- The drift is not hypothetical. This function had been redefined in five
-- migrations by the time this one was written, and the body below is the
-- 20261107100000 one, including the overdue-hire clause that a straight copy of
-- the original 20260814100100 body would have silently reverted.
-- -----------------------------------------------------------------------------

create or replace function app.vehicles_free_between(
  p_organization_id   uuid,
  p_from              timestamptz,
  p_to                timestamptz,
  p_exclude_rental_id uuid default null
)
returns setof uuid
language sql
stable
security invoker
set search_path = ''
as $$
  select v.id
  from public.vehicles v
  where v.organization_id = p_organization_id
    and v.archived_at is null
    and v.status = 'available'
    -- Mirrors the rentals_no_vehicle_overlap exclusion constraint exactly, so a
    -- vehicle offered here is one the database will actually accept a booking
    -- for. The constraint remains the authority; this only avoids offering
    -- choices that would be rejected.
    and not exists (
      select 1
      from public.rentals r
      where r.vehicle_id = v.id
        and r.status in ('reserved', 'active')
        and (p_exclude_rental_id is null or r.id <> p_exclude_rental_id)
        and tstzrange(r.starts_at, r.ends_at, '[)') && tstzrange(p_from, p_to, '[)')
    )
    -- Narrower than the constraint, never wider: this withholds vehicles the
    -- constraint would have accepted, so the guarantee above still holds in the
    -- direction that matters -- nothing is offered that would be rejected.
    -- (20261107100000: an overdue hire has an unknown real end date, so no
    -- later period can be promised. vehicle_fleet already calls that 'rented'.)
    and not exists (
      select 1
      from public.rentals r
      where r.vehicle_id = v.id
        and r.status = 'active'
        and r.returned_at is null
        and r.ends_at <= now()
    )
  order by v.id;
$$;

comment on function app.vehicles_free_between(uuid, timestamptz, timestamptz, uuid) is
  'Vehicles bookable for a period: the predicate alone, so the member-facing read and the public page cannot drift apart. SECURITY INVOKER, so a signed-in caller sees only their own agency through RLS, and a definer caller (the public page) sees the agency it was asked about.';

revoke all on function app.vehicles_free_between(uuid, timestamptz, timestamptz, uuid) from public, anon;
grant execute on function app.vehicles_free_between(uuid, timestamptz, timestamptz, uuid) to authenticated, service_role;

-- Same signature, same grants, same refusals, same SECURITY INVOKER as before:
-- only the body is now a delegation. Restated here rather than edited in
-- 20261107100000, which is where the current body came from.
create or replace function public.vehicles_available_between(
  p_organization_id   uuid,
  p_from              timestamptz,
  p_to                timestamptz,
  p_exclude_rental_id uuid default null
)
returns setof uuid
language plpgsql
stable
set search_path = public, pg_temp
as $$
begin
  if not app.is_org_member(p_organization_id) then
    raise exception 'Not a member of this organization.' using errcode = '42501';
  end if;

  if p_to <= p_from then
    raise exception 'The period must end after it starts.' using errcode = '22023';
  end if;

  return query
  select app.vehicles_free_between(p_organization_id, p_from, p_to, p_exclude_rental_id);
end;
$$;

comment on function public.vehicles_available_between(uuid, timestamptz, timestamptz, uuid) is
  'Vehicles bookable for a period, for a member of the agency. p_exclude_rental_id lets an existing contract be rescheduled without conflicting with itself. The predicate lives in app.vehicles_free_between; this is the membership-gated door to it.';

-- -----------------------------------------------------------------------------
-- 2. Is this agency's page open at all?
--
-- Asked by both reads and by the write (20261113100400), so that "open" has one
-- definition rather than three that drift.
--
-- DELIBERATELY NOT A BILLING QUESTION. A billing-restricted agency keeps its
-- page, its fleet and its prices; what it loses is the form, which the page
-- replaces with a telephone number. Folding app.billing_may_write in here would
-- blank the fleet for exactly those agencies and break that.
-- -----------------------------------------------------------------------------

create or replace function app.public_booking_is_open(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organizations o
    where o.id = p_organization_id
      and o.public_booking_enabled
      and o.closure_requested_at is null
  );
$$;

comment on function app.public_booking_is_open(uuid) is
  'Whether an agency is publishing a booking page: the master switch on and no closure requested. Not a billing question -- a restricted agency still has a page, with a telephone number where the form was.';

revoke all on function app.public_booking_is_open(uuid) from public, anon, authenticated;
grant execute on function app.public_booking_is_open(uuid) to service_role;

-- -----------------------------------------------------------------------------
-- 3. The agency behind a slug
-- -----------------------------------------------------------------------------

/**
 * One row for an agency whose public booking page is open, or no rows.
 *
 * NO ROWS, NOT AN ERROR, in all three cases: the slug belongs to nobody, the
 * agency has the master switch off, or closure has been requested. A visitor
 * must not be able to tell which, because the second and third would otherwise
 * confirm that an agency exists and is leaving.
 *
 * CLOSURE STOPS THE PAGE AT THE REQUEST, not at the purge. The thirty days
 * before data is deleted are a window for the agency to change its mind, not a
 * window in which strangers keep sending it enquiries it will never answer.
 *
 * accepts_requests IS SEPARATE FROM EXISTING. A billing-restricted agency keeps
 * its page -- the fleet is still theirs and a visitor looking them up should
 * find them -- but the form is replaced with a telephone number. A page that
 * went on quietly accepting requests for an agency that has stopped paying
 * would be a promise nobody is keeping.
 */
create or replace function app.public_booking_agency(p_slug text)
returns table (
  organization_id  uuid,
  name             text,
  logo_path        text,
  phone            text,
  time_zone        text,
  default_currency public.currency_code,
  accepts_requests boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    o.id,
    o.name,
    o.logo_path,
    o.phone,
    o.time_zone,
    o.default_currency,
    app.billing_may_write(o.id) and app.plan_includes_public_booking(o.id) is not false
  from public.organizations o
  where o.slug = p_slug
    and app.public_booking_is_open(o.id);
$$;

comment on function app.public_booking_agency(text) is
  'The agency behind a public booking slug, or no rows when the slug is unknown, the page is switched off, or closure has been requested -- indistinguishable on purpose. accepts_requests is false for a billing-restricted agency, whose page says to telephone instead.';

revoke all on function app.public_booking_agency(text) from public, anon, authenticated;
grant execute on function app.public_booking_agency(text) to service_role;

-- -----------------------------------------------------------------------------
-- 4. The fleet for a pair of dates
-- -----------------------------------------------------------------------------

/**
 * Every opted-in vehicle, free or not, with its quote for the period.
 *
 * UNAVAILABLE VEHICLES ARE RETURNED, not hidden: a left join of the opted-in
 * fleet onto the free set. An agency's page showing three of its eight cars on
 * a busy weekend looks like an agency with three cars. One rule, one
 * appearance: a vehicle in maintenance, a vehicle someone else has reserved and
 * a vehicle whose status is unavailable all come back with is_available false
 * and nothing to say which. A renter has no business knowing that a particular
 * car is in the workshop.
 *
 * THE QUOTE USES public.rental_billable_days, the same function the rental
 * itself will use. It counts elapsed 24-hour days rather than calendar dates on
 * purpose (20260815100200), so it is immune to time zones and to DST. Counting
 * the agency's local calendar days here instead would make the estimate on the
 * page disagree with the price in the conversion dialog for every request that
 * crosses a local midnight -- manufacturing exactly the drift staff are warned
 * about. The agency's time zone belongs to the DEFAULT WINDOW the page offers,
 * not to the arithmetic.
 *
 * IT ASKS WHETHER THE PAGE IS OPEN ITSELF rather than trusting the caller to
 * have resolved a slug first. The Edge Function's submit path carries an
 * organization id the browser sent back, so "the caller must have come through
 * app.public_booking_agency" is an assumption about code not yet written. A
 * switched-off or closing agency answers with no rows, which is what the page
 * would render for an agency with nothing opted in -- no error, nothing learnt.
 */
create or replace function app.public_booking_vehicles(
  p_organization_id uuid,
  p_from            timestamptz,
  p_to              timestamptz
)
returns table (
  vehicle_id         uuid,
  make               text,
  model              text,
  model_year         smallint,
  category           text,
  transmission       public.transmission_type,
  fuel_type          public.fuel_type,
  seats              smallint,
  doors              smallint,
  image_path         text,
  currency           public.currency_code,
  daily_rate_minor   bigint,
  billable_days      integer,
  quoted_total_minor bigint,
  is_available       boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_days integer;
begin
  if p_to <= p_from then
    raise exception 'The period must end after it starts.' using errcode = '22023';
  end if;

  if not app.public_booking_is_open(p_organization_id) then
    return;
  end if;

  v_days := public.rental_billable_days(p_from, p_to);

  return query
  select
    v.id,
    v.make,
    v.model,
    v.model_year,
    v.category,
    v.transmission,
    v.fuel_type,
    v.seats,
    v.doors,
    (
      select i.storage_path
        from public.vehicle_images i
       where i.vehicle_id = v.id
       order by i.is_primary desc, i.sort_order, i.created_at
       limit 1
    ),
    v.currency,
    v.daily_rate_minor,
    v_days,
    v.daily_rate_minor * v_days,
    free.id is not null
  from public.vehicles v
  left join app.vehicles_free_between(p_organization_id, p_from, p_to) as free(id)
    on free.id = v.id
  where v.organization_id = p_organization_id
    and v.public_booking_enabled
    and v.archived_at is null
  order by v.make, v.model, v.id;
end;
$$;

comment on function app.public_booking_vehicles(uuid, timestamptz, timestamptz) is
  'The opted-in fleet for a period, with the quote a visitor is shown. Unavailable vehicles are returned with is_available false and nothing saying why. The projection is the security boundary: no plate, no VIN, no odometer, no cost, no compliance date.';

revoke all on function app.public_booking_vehicles(uuid, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function app.public_booking_vehicles(uuid, timestamptz, timestamptz) to service_role;

-- -----------------------------------------------------------------------------
-- 5. Assertions
-- -----------------------------------------------------------------------------

do $assert$
declare
  v_function text;
begin
  foreach v_function in array array[
    'app.public_booking_agency(text)',
    'app.public_booking_vehicles(uuid, timestamptz, timestamptz)',
    'app.public_booking_is_open(uuid)'
  ] loop
    if has_function_privilege('anon', v_function, 'EXECUTE')
       or has_function_privilege('authenticated', v_function, 'EXECUTE') then
      raise exception 'A browser role may execute %, which is the public surface.', v_function;
    end if;
  end loop;

  -- The member-facing door keeps both of the things that make it safe: it is
  -- SECURITY INVOKER, so RLS still applies to the caller, and it asks the
  -- membership question itself. analytics-security.test.ts enumerates every
  -- definer function in `public`; this one must never join that list.
  if (select p.prosecdef
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'vehicles_available_between') then
    raise exception 'vehicles_available_between must stay SECURITY INVOKER: it reads what its caller may already read.';
  end if;
  if pg_get_functiondef('public.vehicles_available_between(uuid, timestamptz, timestamptz, uuid)'::regprocedure)
       not like '%is_org_member%' then
    raise exception 'vehicles_available_between lost the membership check it carries for everyone.';
  end if;

  -- The projection is the boundary: these columns must not appear in either
  -- read, whatever a later edit intends.
  foreach v_function in array array[
    'app.public_booking_agency(text)',
    'app.public_booking_vehicles(uuid, timestamptz, timestamptz)'
  ] loop
    if pg_get_functiondef(v_function::regprocedure) ~* '\m(registration_plate|vin|odometer|acquisition_price_minor|insurance_expires_on|inspection_expires_on|registration_expires_on|next_service_on)\M' then
      raise exception '% names a column the public page must never carry.', v_function;
    end if;
  end loop;
end;
$assert$;

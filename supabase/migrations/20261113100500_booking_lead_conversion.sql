-- =============================================================================
-- Public booking: turning a lead into a customer and a rental
-- =============================================================================
--
-- The one button on a lead that creates business. In one transaction it makes a
-- customer, a reserved rental with its base charge, and marks the lead
-- converted naming both -- or it makes none of them.
--
-- WHY IT IS A FUNCTION AND NOT THREE CLIENT WRITES. PostgREST has no
-- multi-table transaction, which is why public.createRental in the client
-- writes its parts in order and deletes the rental again if a later part fails
-- (src/features/rentals/api.ts). That is tolerable there because a draft holds
-- no vehicle. Here it is not: the rental is RESERVED, which does hold the
-- vehicle, so a half-written conversion would block a car nobody has actually
-- booked. One function, one transaction, no compensating delete.
--
-- WHY RESERVED AND NOT DRAFT. A draft is outside rentals_no_vehicle_overlap,
-- so two leads for the same car and dates could both convert and neither would
-- be refused. Converting is the agency saying yes; the exclusion constraint is
-- what makes that answer exclusive.
--
-- TWO CLICKS. The lead's row is taken FOR UPDATE before its status is read, so
-- a second click waits for the first transaction and then sees `converted`. A
-- status check without the lock is a check both clicks pass.
--
-- SECURITY INVOKER, with an explicit app.has_min_role(..., 'staff') for the
-- early, legible refusal. Atomicity is not a reason to be SECURITY DEFINER:
-- a plpgsql function is one transaction whichever it is. Every write below is
-- one staff already hold the privilege for, so running as the caller keeps
-- row-level security applying to each of them -- tenancy enforced by the
-- policies rather than by this function remembering to. Definer in `public` is
-- reserved for places where the application holds no privilege of its own, and
-- supabase/tests/analytics-security.test.ts enumerates every one of them; this
-- is not such a place.

create or replace function public.convert_booking_lead(
  p_lead_id            uuid,
  p_customer_overrides jsonb default '{}'::jsonb
)
returns table (customer_id uuid, rental_id uuid)
language plpgsql
volatile
set search_path = public, pg_temp
as $$
declare
  v_lead      public.booking_leads;
  v_vehicle   public.vehicles;
  v_overrides jsonb := coalesce(p_customer_overrides, '{}'::jsonb);
  v_first     text;
  v_last      text;
  v_space     integer;
  v_days      integer;
  v_tax_bps   integer;
  v_tax_label text;
  v_customer  uuid;
  v_rental    uuid;
begin
  -- 1. The lead. A lead nobody may see is a lead that does not exist, so a
  -- non-member, a session that has not passed its second factor, and a bad id
  -- all get the one sentence.
  select * into v_lead
  from public.booking_leads l
  where l.id = p_lead_id;

  if not found or not app.has_min_role(v_lead.organization_id, 'staff') then
    raise exception 'That booking request could not be found.' using errcode = '42501';
  end if;

  -- The write policies on customers, rentals and rental_line_items all carry
  -- app.billing_may_write, so a restricted agency is refused by row-level
  -- security whatever happens here. This turns that into a sentence rather than
  -- a policy violation. app.billing_require_write, which is how a SECURITY
  -- DEFINER write path asks the same question, is granted to service_role alone
  -- and an invoker function cannot call it -- hence the wording below, which is
  -- its sentence verbatim because src/lib/supabase/errors.ts matches on it.
  if not app.billing_may_write(v_lead.organization_id) then
    raise exception 'This agency has no active subscription, so its records are read-only.'
      using errcode = '42501';
  end if;

  -- Now take the row, and re-read it under the lock: between the select above
  -- and this line another click may have converted it. The status check that
  -- matters is the one below, on the locked row. The read is split from the
  -- lock so that a billing-restricted agency gets the sentence about billing --
  -- the update policy carries billing_may_write, so locking first would merely
  -- have filtered the row away and said it could not be found.
  select * into v_lead
  from public.booking_leads l
  where l.id = p_lead_id
  for update;

  if not found then
    raise exception 'That booking request could not be found.' using errcode = '42501';
  end if;

  if v_lead.status = 'converted' then
    raise exception 'That booking request has already been converted.' using errcode = '23505';
  end if;

  -- 2. The vehicle, as it is now. Deliberately NOT checking
  -- public_booking_enabled: withdrawing a car from the page stops it being
  -- offered, it does not cancel the requests already received for it.
  select * into v_vehicle
  from public.vehicles v
  where v.id = v_lead.vehicle_id
    and v.organization_id = v_lead.organization_id
    and v.archived_at is null;

  if not found then
    raise exception 'That vehicle is no longer in the fleet.' using errcode = '22023';
  end if;

  -- 3. Is the car still free? The exclusion constraint on rentals is the
  -- authority and would refuse the insert below anyway; this turns that into a
  -- sentence staff can act on, and it runs inside the same transaction, so
  -- nothing can slip in between the question and the answer.
  if exists (
    select 1 from public.rental_period_conflicts(v_lead.vehicle_id, v_lead.starts_at, v_lead.ends_at)
  ) then
    raise exception 'That vehicle is no longer free for those dates.' using errcode = '23P01';
  end if;

  -- 4. The customer. What the renter typed, with whatever staff corrected on
  -- the way through. A name is split on the last space, which is wrong for some
  -- names in some countries -- hence the override, which is the field staff
  -- actually fix it in.
  v_space := length(v_lead.full_name) - position(' ' in reverse(v_lead.full_name));
  if position(' ' in v_lead.full_name) = 0 then
    v_first := v_lead.full_name;
    v_last  := null;
  else
    v_first := btrim(substr(v_lead.full_name, 1, v_space));
    v_last  := btrim(substr(v_lead.full_name, v_space + 2));
  end if;

  insert into public.customers (
    organization_id, customer_type, first_name, last_name, email, phone
  )
  values (
    v_lead.organization_id,
    coalesce((v_overrides ->> 'customer_type')::public.customer_type, 'individual'),
    coalesce(nullif(btrim(v_overrides ->> 'first_name'), ''), v_first),
    coalesce(nullif(btrim(v_overrides ->> 'last_name'), ''), v_last),
    coalesce(nullif(btrim(v_overrides ->> 'email'), ''), v_lead.email)::public.email_address,
    coalesce(nullif(btrim(v_overrides ->> 'phone'), ''), v_lead.phone)
  )
  returning id into v_customer;

  -- 5. The rental, priced from the vehicle as it is today rather than from the
  -- snapshot. The snapshot stays on the lead so the two can be compared, and
  -- the dialog warns staff when they differ: an estimate from three weeks ago
  -- is not a price the agency is bound by, and silently honouring it -- or
  -- silently replacing it -- are both worse than saying so.
  v_days := public.rental_billable_days(v_lead.starts_at, v_lead.ends_at);

  select s.tax_rate_bps, s.tax_label into v_tax_bps, v_tax_label
  from public.organization_settings s
  where s.organization_id = v_lead.organization_id;

  insert into public.rentals (
    organization_id, vehicle_id, customer_id, status,
    starts_at, ends_at, currency, daily_rate_minor, billable_days,
    tax_rate_bps, tax_label, notes
  )
  values (
    v_lead.organization_id, v_vehicle.id, v_customer, 'reserved',
    v_lead.starts_at, v_lead.ends_at, v_vehicle.currency, v_vehicle.daily_rate_minor, v_days,
    coalesce(v_tax_bps, 0), v_tax_label,
    case
      when v_lead.note is null then null
      else 'From booking request ' || v_lead.reference || ': ' || v_lead.note
    end
  )
  returning id into v_rental;

  -- 6. The charge. Totals are derived from the lines by
  -- app.recalculate_rental_totals, so this insert is what gives the rental its
  -- subtotal and total; writing those columns directly would be reverted by the
  -- freeze trigger.
  insert into public.rental_line_items (
    organization_id, rental_id, kind, description, quantity, unit_amount_minor,
    amount_minor, currency
  )
  values (
    v_lead.organization_id, v_rental, 'base_rental',
    v_days || ' day hire', v_days, v_vehicle.daily_rate_minor,
    v_vehicle.daily_rate_minor * v_days, v_vehicle.currency
  );

  insert into public.rental_drivers (organization_id, rental_id, customer_id, driver_role)
  values (v_lead.organization_id, v_rental, v_customer, 'primary');

  -- 7. The lead, closed.
  update public.booking_leads l
     set status = 'converted',
         converted_customer_id = v_customer,
         converted_rental_id = v_rental
   where l.id = v_lead.id;

  return query select v_customer, v_rental;
end;
$$;

comment on function public.convert_booking_lead(uuid, jsonb) is
  'Turns a booking lead into a customer and a reserved rental in one transaction, and marks the lead converted naming both. Prices the rental from the vehicle as it is today; the lead keeps the estimate it quoted so the two can be compared. Locks the lead before reading its status, so two clicks produce one rental. SECURITY INVOKER: every write is one staff already hold, and row-level security applies to each.';

revoke all on function public.convert_booking_lead(uuid, jsonb) from public, anon;
grant execute on function public.convert_booking_lead(uuid, jsonb) to authenticated;

-- -----------------------------------------------------------------------------
-- Assertions
-- -----------------------------------------------------------------------------

do $assert$
declare
  v_body constant text :=
    pg_get_functiondef('public.convert_booking_lead(uuid, jsonb)'::regprocedure);
begin
  if has_function_privilege('anon', 'public.convert_booking_lead(uuid, jsonb)', 'EXECUTE') then
    raise exception 'anon may convert booking leads.';
  end if;

  -- The lock is the whole defence against a double click, and it only works
  -- before the status is read.
  if position('for update' in lower(v_body)) = 0
     or position('for update' in lower(v_body)) > position('status = ''converted''' in lower(v_body))
  then
    raise exception 'convert_booking_lead must lock the lead row before it checks the status.';
  end if;

  -- The billing sentence has to stay the one the client maps
  -- (src/lib/supabase/errors.ts), or a restricted agency gets a raw error.
  if v_body not like '%no active subscription, so its records are read-only%' then
    raise exception 'convert_booking_lead must refuse a billing-restricted agency in words the client knows.';
  end if;

  if v_body not like '%has_min_role%' then
    raise exception 'convert_booking_lead must refuse a caller who is not staff of the agency.';
  end if;

  -- It must stay invoker, so that row-level security keeps applying to the four
  -- tables it writes. analytics-security.test.ts enumerates every definer
  -- function in `public` and this one has no business joining that list.
  if (select p.prosecdef
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'convert_booking_lead') then
    raise exception 'convert_booking_lead must stay SECURITY INVOKER: one transaction does not require definer.';
  end if;
end;
$assert$;

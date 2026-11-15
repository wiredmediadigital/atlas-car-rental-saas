-- =============================================================================
-- Repricing has to leave the extension's days to the extension
-- =============================================================================
--
-- public.rental_reprice wrote `billable_days` worth of hire into the base
-- charge. On a booking that has been extended, that double-charges.
--
-- WHAT WENT WRONG, in the numbers it went wrong in. A five day hire at $102 is
-- a base line of $510. Extending it by a day does two things: it adds the day
-- to billable_days, making six, AND it writes its own `Extension -- 1 day` line
-- of $102, because the extra days and what they cost are deliberately one
-- record. The contract is then $612 for six days, which is right.
--
-- Repricing it rewrote the base line as six days at $102 -- $612 -- and left
-- the extension alone, exactly as this function promised to. The contract came
-- to $714: seven days charged on a six day hire.
--
-- THE MISTAKE WAS IN THE ARITHMETIC, NOT THE INTENT. `billable_days` counts the
-- whole hire, extensions included. The base line covers only the part before
-- them. Comparing one against the other, or writing one into the other, is
-- measuring two different periods.
--
-- The base charge now covers billable_days MINUS the days already charged by
-- every later base_rental line. An extension is still never touched: whatever
-- was agreed for those days stands, which is the whole reason it is its own
-- line.
--
-- src/features/rentals/pricing.ts carries the same correction, because the
-- warning that offers this button was comparing the same two periods.

create or replace function public.rental_reprice(p_rental_id uuid)
returns public.rentals
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_rental     public.rentals;
  v_vehicle    public.vehicles;
  v_total_days integer;
  v_extra_days integer;
  v_days       integer;
  v_amount     bigint;
  v_line       public.rental_line_items;
begin
  select * into v_rental from public.rentals where id = p_rental_id for update;

  if v_rental.id is null then
    raise exception 'Rental not found.' using errcode = 'P0002';
  end if;

  -- Once a customer has driven away, what they were charged is a fact rather
  -- than a plan. Extending an active hire has its own function and its own
  -- charge; this is for a booking that has not started.
  if v_rental.status not in ('draft', 'reserved') then
    raise exception 'Only a draft or a confirmed reservation can be repriced.'
      using errcode = '23514';
  end if;

  select * into v_vehicle from public.vehicles where id = v_rental.vehicle_id;
  if v_vehicle.id is null then
    raise exception 'That vehicle is no longer in the fleet.' using errcode = 'P0002';
  end if;
  if v_vehicle.currency <> v_rental.currency then
    raise exception 'That vehicle is priced in %, and this rental is in %.',
      v_vehicle.currency, v_rental.currency
      using errcode = '23514';
  end if;

  v_total_days := coalesce(
    nullif(v_rental.billable_days, 0),
    public.rental_billable_days(v_rental.starts_at, v_rental.ends_at)
  );

  -- The earliest base_rental line is the original charge; every later one is an
  -- extension, and each states its own days in `quantity`.
  select * into v_line
  from public.rental_line_items l
  where l.rental_id = p_rental_id and l.kind = 'base_rental'
  order by l.sort_order, l.created_at
  limit 1;

  select coalesce(sum(l.quantity), 0)::integer into v_extra_days
  from public.rental_line_items l
  where l.rental_id = p_rental_id
    and l.kind = 'base_rental'
    and (v_line.id is null or l.id <> v_line.id);

  v_days := v_total_days - v_extra_days;

  -- Extensions covering the entire hire means the day count and the lines have
  -- drifted apart in a way no arithmetic here can settle. Refusing says so;
  -- writing a zero or negative charge would not.
  if v_days <= 0 then
    raise exception
      'The extensions on this booking already cover % of its % days. Adjust the charges by hand.',
      v_extra_days, v_total_days
      using errcode = '23514';
  end if;

  v_amount := v_vehicle.daily_rate_minor * v_days;

  if v_line.id is not null then
    update public.rental_line_items
       set description = v_days || ' day hire',
           quantity = v_days,
           unit_amount_minor = v_vehicle.daily_rate_minor,
           amount_minor = v_amount
     where id = v_line.id;
  else
    insert into public.rental_line_items (
      organization_id, rental_id, kind, description, quantity,
      unit_amount_minor, amount_minor, currency, sort_order, created_by
    )
    values (
      v_rental.organization_id, p_rental_id, 'base_rental',
      v_days || ' day hire', v_days,
      v_vehicle.daily_rate_minor, v_amount, v_rental.currency, 0,
      (select auth.uid())
    );
  end if;

  -- The day rate is restated; billable_days is NOT, because it counts the whole
  -- hire and this only rewrote part of it.
  update public.rentals
     set daily_rate_minor = v_vehicle.daily_rate_minor
   where id = p_rental_id;

  select * into v_rental from public.rentals where id = p_rental_id;
  return v_rental;
end;
$$;

comment on function public.rental_reprice(uuid) is
  'Rewrites a draft or reservation''s base charge from the vehicle''s current day rate and the days the base charge covers -- the booking''s day count less the days its extensions already charge for. Extensions, extras and discounts are left alone. An explicit act: changing the dates or the car deliberately does not do this on its own.';

revoke all on function public.rental_reprice(uuid) from public, anon;
grant execute on function public.rental_reprice(uuid) to authenticated;

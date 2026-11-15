-- =============================================================================
-- Repricing a booking after its car or its dates change
-- =============================================================================
--
-- Two gaps, one deliberate and one not.
--
-- public.rental_reschedule moves the dates and updates billable_days, and says
-- in its own comment that the charges deliberately do not follow: repricing
-- somebody's contract because a block was nudged on a calendar would be a worse
-- surprise than a day count that no longer matches its lines, "which the
-- interface shows and the desk can correct". The interface never showed it.
--
-- public.rental_substitute_vehicle changed vehicle_id and nothing else, with no
-- comment claiming that was intended. A premium car swapped for a small one
-- left the customer on the premium rate, and left rentals.daily_rate_minor
-- holding a figure that belonged to a car this booking no longer involves.
--
-- WHAT CHANGES HERE.
--
--   1. Substituting a vehicle now updates daily_rate_minor to the new car's
--      rate, because that column is a fact about the booking and was simply
--      wrong. It does NOT touch the charge lines: see below.
--   2. public.rental_reprice rewrites the base charge from the rate and the day
--      count the booking now carries. It is an explicit act, performed by a
--      person who can see both figures first.
--
-- REPRICING STAYS A DECISION, NOT A SIDE EFFECT. The original author's
-- reasoning holds: a reservation is something a customer has been quoted, and
-- rewriting that quote silently -- because a car was swapped or a booking
-- nudged -- is how an agency ends up arguing with somebody at a counter. What
-- was missing was not automation but the prompt, and the prompt belongs with a
-- button rather than instead of one.

-- -----------------------------------------------------------------------------
-- 1. Substituting a vehicle carries its rate across
-- -----------------------------------------------------------------------------

create or replace function public.rental_substitute_vehicle(
  p_rental_id  uuid,
  p_vehicle_id uuid
)
returns public.rentals
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_rental  public.rentals;
  v_vehicle public.vehicles;
begin
  select * into v_rental from public.rentals where id = p_rental_id for update;

  if v_rental.id is null then
    raise exception 'Rental not found.' using errcode = 'P0002';
  end if;
  if v_rental.status not in ('draft', 'reserved') then
    raise exception 'The vehicle can only be changed before the customer collects it.'
      using errcode = '23514';
  end if;

  select * into v_vehicle from public.vehicles where id = p_vehicle_id;

  -- RLS already scopes this select; the explicit check turns "invisible" into a
  -- clear message rather than a confusing null.
  if v_vehicle.id is null or v_vehicle.organization_id <> v_rental.organization_id then
    raise exception 'Vehicle not found.' using errcode = 'P0002';
  end if;
  if v_vehicle.archived_at is not null then
    raise exception 'That vehicle has been retired from the fleet.' using errcode = '23514';
  end if;
  if v_vehicle.status <> 'available' then
    raise exception 'That vehicle is not in service.' using errcode = '23514';
  end if;

  /*
   * A rental is denominated in one currency, and a vehicle carries its own.
   * Swapping in a car priced in another would leave the day rate reading in one
   * currency and every charge line in another, with nothing to say which the
   * customer owes. Refused rather than converted: this product does not hold an
   * exchange rate and must not invent one.
   */
  if v_vehicle.currency <> v_rental.currency then
    raise exception 'That vehicle is priced in %, and this rental is in %.',
      v_vehicle.currency, v_rental.currency
      using errcode = '23514';
  end if;

  /*
   * The day rate follows the car. It is a fact about what this booking now
   * involves, not a price anybody agreed, and leaving the old car's figure in
   * place made the contract state something untrue.
   *
   * The CHARGE LINES are deliberately left alone, which is why this and
   * rental_reprice are two functions. Substituting a car because the first one
   * is off the road should not rewrite what a customer was quoted without
   * somebody seeing both numbers.
   */
  update public.rentals
     set vehicle_id = p_vehicle_id,
         daily_rate_minor = v_vehicle.daily_rate_minor
   where id = p_rental_id
  returning * into v_rental;

  return v_rental;
end;
$$;

comment on function public.rental_substitute_vehicle(uuid, uuid) is
  'Replaces the vehicle on a draft or reservation and carries the new car''s day rate onto the booking. Refuses a car priced in another currency. Does not reprice the charge lines: see public.rental_reprice, which is a deliberate act rather than a side effect.';

revoke all on function public.rental_substitute_vehicle(uuid, uuid) from public, anon;
grant execute on function public.rental_substitute_vehicle(uuid, uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 2. Repricing the base charge
-- -----------------------------------------------------------------------------

/**
 * Rewrites the base charge from the rate and the day count the booking carries.
 *
 * WHICH LINE IS "THE BASE CHARGE". A rental can hold several `base_rental`
 * lines: an extension adds one, by design, so that the extra days and what they
 * cost are one record. The original charge is the earliest of them -- lowest
 * sort_order, then oldest -- and it is the only one this touches. An extension
 * somebody negotiated is not repriced by changing the dates of the booking it
 * extends, and nor are extras, discounts or anything else on the contract.
 *
 * A rental with no base charge at all gets one. That is the honest reading of
 * "reprice" for a booking somebody built out of extras.
 *
 * SECURITY INVOKER. Every write here is one staff already hold -- the line
 * items policy and the rentals policy both admit them -- so row-level security
 * applies to each, and this adds a legible refusal in front of it rather than a
 * privilege around it.
 */
create or replace function public.rental_reprice(p_rental_id uuid)
returns public.rentals
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_rental  public.rentals;
  v_vehicle public.vehicles;
  v_days    integer;
  v_amount  bigint;
  v_line    public.rental_line_items;
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

  v_days := coalesce(
    nullif(v_rental.billable_days, 0),
    public.rental_billable_days(v_rental.starts_at, v_rental.ends_at)
  );
  v_amount := v_vehicle.daily_rate_minor * v_days;

  select * into v_line
  from public.rental_line_items l
  where l.rental_id = p_rental_id and l.kind = 'base_rental'
  order by l.sort_order, l.created_at
  limit 1;

  if found then
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

  -- The day rate and the day count are restated from what was just charged, so
  -- the booking cannot go on reporting a mismatch it no longer has.
  update public.rentals
     set daily_rate_minor = v_vehicle.daily_rate_minor,
         billable_days = v_days
   where id = p_rental_id
  returning * into v_rental;

  -- The totals follow the lines, through app.recalculate_rental_totals on the
  -- line trigger. Nothing here writes them, and the freeze trigger would put
  -- them back if it tried.
  select * into v_rental from public.rentals where id = p_rental_id;
  return v_rental;
end;
$$;

comment on function public.rental_reprice(uuid) is
  'Rewrites a draft or reservation''s base charge from the vehicle''s current day rate and the booking''s day count, leaving extensions, extras and discounts alone. An explicit act: changing the dates or the car deliberately does not do this on its own.';

revoke all on function public.rental_reprice(uuid) from public, anon;
grant execute on function public.rental_reprice(uuid) to authenticated;

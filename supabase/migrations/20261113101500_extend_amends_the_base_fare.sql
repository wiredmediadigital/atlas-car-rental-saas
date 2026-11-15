-- =============================================================================
-- Extending a hire lengthens the hire, rather than adding a second one
-- =============================================================================
--
-- public.rental_extend wrote a separate `Extension -- N day` line. The extra
-- days and their charge being one record was the point, and it reads perfectly
-- well on a booking that only ever grows.
--
-- IT STOPS READING AT ALL THE MOMENT ANYBODY MOVES THE DATES. A nine day hire
-- extended twice, then rescheduled to three days, showed:
--
--     7 day hire                  $714.00
--     Extension -- 1 day          $102.00
--     Extension -- 1 day          $102.00
--
-- on a contract whose own header said three days. Repricing it was arithmetic
-- nobody could defend to a customer: one base day plus two extension days is
-- three days and $306, and the document still said "1 day hire" with two
-- extensions attached to a hire that was never extended any more. The
-- extension lines had become a ghost of a length the booking no longer had.
--
-- A hire is now ONE line, and it always says what the dates say. Extending
-- adds its days and its charge to that line.
--
-- WHAT IS LOST, stated plainly: an extension agreed at something other than the
-- day rate no longer has its own row. The amount is unchanged -- it is added to
-- the base -- but the per-day figure becomes the blend, and the contract no
-- longer itemises what those particular days cost. Against a document a renter
-- cannot read, that is the better trade. extension_count and original_ends_at
-- still record that an extension happened and what the return was before it.
--
-- LINES WRITTEN BEFORE THIS ARE LEFT WHERE THEY ARE. public.rental_reprice
-- still discounts the days that later base_rental lines charge for, so an older
-- booking keeps totalling correctly; a new one simply never grows a second
-- line for the subtraction to find.

create or replace function public.rental_extend(
  p_rental_id uuid,
  p_new_ends_at timestamptz,
  p_charge_minor bigint default 0,
  p_charge_description text default null,
  p_additional_days integer default null
)
returns public.rentals
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_rental   public.rentals;
  v_added    integer;
  v_line     public.rental_line_items;
  v_quantity numeric(10, 2);
  v_amount   bigint;
begin
  select * into v_rental from public.rentals where id = p_rental_id for update;

  if v_rental.id is null then
    raise exception 'Rental not found.' using errcode = 'P0002';
  end if;
  if v_rental.status not in ('reserved', 'active') then
    raise exception 'Only a reservation or an active rental can be extended.' using errcode = '23514';
  end if;
  if p_new_ends_at <= v_rental.ends_at then
    raise exception 'An extension must end after the current return date.' using errcode = '23514';
  end if;

  -- A caller that does not say how many days it added is asking the same
  -- question the rest of the product answers with rental_billable_days.
  -- Before, such a call left billable_days untouched and the booking reported
  -- fewer days than it held the car for.
  v_added := greatest(
    coalesce(p_additional_days, public.rental_billable_days(v_rental.ends_at, p_new_ends_at)),
    0
  );

  -- Extending is one event, so the extra days and their charge are one
  -- transaction. Otherwise a failure between the two leaves the vehicle
  -- committed for longer with nothing billed for it.
  update public.rentals
     set ends_at = p_new_ends_at,
         original_ends_at = coalesce(original_ends_at, v_rental.ends_at),
         extension_count = extension_count + 1,
         billable_days = coalesce(billable_days, 0) + v_added
   where id = p_rental_id
  returning * into v_rental;

  select * into v_line
  from public.rental_line_items l
  where l.rental_id = p_rental_id and l.kind = 'base_rental'
  order by l.sort_order, l.created_at
  limit 1;

  if v_line.id is not null then
    v_quantity := v_line.quantity + v_added;
    v_amount   := v_line.amount_minor + coalesce(p_charge_minor, 0);

    /*
     * The amount is authoritative and the unit is derived from it, not the
     * other way round. An extension agreed at the day rate divides evenly; one
     * agreed at anything else leaves a blended figure, which is the honest
     * reading of a single line covering both.
     */
    update public.rental_line_items
       set quantity = v_quantity,
           amount_minor = v_amount,
           unit_amount_minor = case
             when v_quantity > 0 then round(v_amount / v_quantity)::bigint
             else v_amount
           end,
           description = round(v_quantity)::integer || ' day hire'
     where id = v_line.id;
  elsif coalesce(p_charge_minor, 0) > 0 or v_added > 0 then
    -- A booking with no hire line yet gets one, described the same way.
    insert into public.rental_line_items (
      organization_id, rental_id, kind, description, quantity,
      unit_amount_minor, amount_minor, currency, sort_order, created_by
    )
    values (
      v_rental.organization_id, p_rental_id, 'base_rental',
      greatest(v_added, 1) || ' day hire',
      greatest(v_added, 1),
      case
        when v_added > 0 then round(coalesce(p_charge_minor, 0)::numeric / v_added)::bigint
        else coalesce(p_charge_minor, 0)
      end,
      coalesce(p_charge_minor, 0), v_rental.currency,
      0, (select auth.uid())
    );
  end if;

  -- p_charge_description is accepted and no longer used for a line of its own.
  -- Kept in the signature so existing callers are not broken by a rename; the
  -- hire line describes itself by its days.
  perform p_charge_description;

  select * into v_rental from public.rentals where id = p_rental_id;
  return v_rental;
end;
$$;

comment on function public.rental_extend(uuid, timestamptz, bigint, text, integer) is
  'Lengthens a reservation or an active hire: moves the return, counts the extra days, and adds them and their charge to the hire line. One line per hire, always saying what the dates say -- a separate extension line becomes unreadable as soon as the booking is rescheduled. p_charge_description is accepted and unused.';

revoke all on function public.rental_extend(uuid, timestamptz, bigint, text, integer) from public, anon;
grant execute on function public.rental_extend(uuid, timestamptz, bigint, text, integer) to authenticated;

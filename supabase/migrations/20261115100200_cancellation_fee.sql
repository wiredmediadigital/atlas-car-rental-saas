-- =============================================================================
-- Keeping something when a booking is called off
-- =============================================================================
--
-- 20261115100000 stopped a cancelled booking being counted as a charge, and
-- left one thing it could not say: an agency that keeps a cancellation fee had
-- nowhere to record it, so every penny taken against a cancelled booking was
-- reported as refundable in full. An agency with a fee in its terms had to
-- choose between a customer record that overstated the refund and not using
-- the field at all.
--
-- A FEE IS A CHARGE, AND CHARGES ARE LINE ITEMS. There is no new concept here
-- and no new column: cancelling writes a `cancellation_fee` line, which the
-- existing recalculation turns into the booking's total exactly as it does for
-- every other charge. The contract then reads
--
--     7 day hire              0.00
--     Cancellation fee       50.00
--
-- which is the document the customer can be shown.
--
-- CANCELLING NOW SETTLES THE BOOKING. The hire lines are zeroed rather than
-- deleted: a cancelled booking's lines described a hire that was not
-- happening, and totalling them was what put $714 against an outstanding of
-- nothing in the first place. Zeroing keeps the record of what was booked --
-- the description, the days, the dates, the vehicle and the agreed day rate
-- all survive -- while the amount says what it now is.
--
-- A DISCOUNT IS REMOVED RATHER THAN ZEROED, because it cannot be zeroed:
-- rental_line_items_discount_is_negative requires a discount line to stay
-- strictly negative, so settling one to nothing is not a legal row. Leaving it
-- is not an option either -- a negative line with nothing left to reduce makes
-- app.recalculate_rental_totals refuse the whole contract as discounted below
-- zero. A discount off a hire that is not happening has nothing to reduce, so
-- it goes.
--
-- BOOKINGS CANCELLED BEFORE THIS ARE LEFT ALONE. Nothing here rewrites a
-- record somebody already has: an older cancelled booking keeps its lines
-- until somebody settles it, which public.rental_set_cancellation_fee does on
-- any cancelled booking, at any time, including with a fee of nothing. Until
-- then it charges nothing and refunds everything taken, exactly as it does
-- today.
--
-- WHAT "CHARGED" MEANS FOR A CANCELLED BOOKING, therefore: its total if it has
-- been settled, and nothing if it has not. Having a `cancellation_fee` line is
-- what settled means, because both functions below write that line and zero
-- the rest in the same statement -- one cannot happen without the other.

-- -----------------------------------------------------------------------------
-- Settling: the charge becomes the fee, and nothing else
-- -----------------------------------------------------------------------------

create or replace function app.settle_cancelled_rental(
  p_rental_id  uuid,
  p_fee_minor  bigint
)
returns void
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_rental public.rentals;
begin
  select * into v_rental from public.rentals where id = p_rental_id;

  /*
   * The discount goes FIRST, and the order is load-bearing. The recalculation
   * runs per row, so zeroing the hire while a discount is still on the
   * contract leaves a moment where the discount exceeds the charges -- which
   * the recalculation refuses, failing the whole cancellation.
   */
  delete from public.rental_line_items
   where rental_id = p_rental_id and kind = 'discount';

  -- Zeroed, not deleted. The unit amount goes with it so the line still
  -- multiplies out: a quantity times a rate that does not give the amount is
  -- the kind of document nobody can read.
  update public.rental_line_items
     set unit_amount_minor = 0,
         amount_minor = 0
   where rental_id = p_rental_id
     and kind <> 'cancellation_fee'
     and (unit_amount_minor <> 0 or amount_minor <> 0);

  delete from public.rental_line_items
   where rental_id = p_rental_id and kind = 'cancellation_fee';

  if coalesce(p_fee_minor, 0) > 0 then
    /*
     * Outside the tax base by default. What a cancellation fee is for tax
     * purposes differs by country -- compensation in many, a supply in some --
     * and the flag is per line precisely so the agency can say. Charging tax
     * nobody owes is the worse of the two mistakes to make silently.
     */
    insert into public.rental_line_items (
      organization_id, rental_id, kind, description, quantity,
      unit_amount_minor, amount_minor, currency, is_taxable, sort_order, created_by
    )
    values (
      v_rental.organization_id, p_rental_id, 'cancellation_fee', 'Cancellation fee', 1,
      p_fee_minor, p_fee_minor, v_rental.currency, false, 100, (select auth.uid())
    );
  end if;
end;
$$;

comment on function app.settle_cancelled_rental(uuid, bigint) is
  'Makes a cancelled booking charge its cancellation fee and nothing else: zeroes every other line and writes the fee as a line of its own. Shared by rental_cancel and rental_set_cancellation_fee so the two cannot drift.';

-- Reached from the body of a SECURITY INVOKER function in `public`, so the
-- caller's own privileges decide and 20260821100500's revoke would otherwise
-- lock every signed-in user out of cancelling. Granted explicitly rather than
-- left to the PUBLIC default that file deliberately removed.
revoke all on function app.settle_cancelled_rental(uuid, bigint) from public, anon;
grant execute on function app.settle_cancelled_rental(uuid, bigint) to authenticated;

-- -----------------------------------------------------------------------------
-- Cancelling, now with what is kept
-- -----------------------------------------------------------------------------
--
-- The signature gains a parameter. A default would make the two-argument call
-- ambiguous against the function that is already there, so this drops and
-- recreates; the grants went with it and are restated below.

drop function if exists public.rental_cancel(uuid, text);

create function public.rental_cancel(
  p_rental_id uuid,
  p_reason    text default null,
  p_fee_minor bigint default 0
)
returns public.rentals
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_rental public.rentals;
begin
  select * into v_rental from public.rentals where id = p_rental_id for update;

  if v_rental.id is null then
    raise exception 'Rental not found.' using errcode = 'P0002';
  end if;
  if v_rental.status not in ('draft', 'reserved') then
    raise exception 'Only a draft or a reservation can be cancelled.' using errcode = '23514';
  end if;
  if coalesce(p_fee_minor, 0) < 0 then
    raise exception 'A cancellation fee cannot be negative.' using errcode = '23514';
  end if;

  -- Payments already taken stay exactly where they are. Refunding them is a
  -- separate, deliberate financial act; what this decides is how much of them
  -- there is anything to refund.
  update public.rentals
     set status = 'cancelled',
         cancelled_at = now(),
         cancelled_by = (select auth.uid()),
         cancellation_reason = p_reason
   where id = p_rental_id
  returning * into v_rental;

  perform app.settle_cancelled_rental(p_rental_id, coalesce(p_fee_minor, 0));

  select * into v_rental from public.rentals where id = p_rental_id;
  return v_rental;
end;
$$;

comment on function public.rental_cancel(uuid, text, bigint) is
  'Calls off a draft or a reservation, releasing the vehicle. The booking is settled as it is cancelled: the hire is zeroed and whatever the agency keeps is written as a cancellation fee. The record, the payments and what was booked all stay.';

-- -----------------------------------------------------------------------------
-- Changing what is kept, afterwards
-- -----------------------------------------------------------------------------

create or replace function public.rental_set_cancellation_fee(
  p_rental_id uuid,
  p_fee_minor bigint
)
returns public.rentals
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_rental public.rentals;
begin
  select * into v_rental from public.rentals where id = p_rental_id for update;

  if v_rental.id is null then
    raise exception 'Rental not found.' using errcode = 'P0002';
  end if;
  if v_rental.status <> 'cancelled' then
    raise exception 'Only a cancelled booking can carry a cancellation fee.'
      using errcode = '23514';
  end if;
  if coalesce(p_fee_minor, 0) < 0 then
    raise exception 'A cancellation fee cannot be negative.' using errcode = '23514';
  end if;

  -- A fee of nothing is a decision too, and the one that settles a booking
  -- cancelled before settling existed: it zeroes the hire that is not
  -- happening and leaves the whole payment refundable.
  perform app.settle_cancelled_rental(p_rental_id, coalesce(p_fee_minor, 0));

  select * into v_rental from public.rentals where id = p_rental_id;
  return v_rental;
end;
$$;

comment on function public.rental_set_cancellation_fee(uuid, bigint) is
  'Sets what the agency keeps from a cancelled booking, at any time after it was cancelled. Zero settles the booking with nothing kept, which is also how a booking cancelled before fees existed is brought up to date.';

revoke all on function public.rental_cancel(uuid, text, bigint) from public, anon;
revoke all on function public.rental_set_cancellation_fee(uuid, bigint) from public, anon;
grant execute on function public.rental_cancel(uuid, text, bigint) to authenticated;
grant execute on function public.rental_set_cancellation_fee(uuid, bigint) to authenticated;

-- -----------------------------------------------------------------------------
-- The account, with the fee in it
-- -----------------------------------------------------------------------------
--
-- Charged, paid and outstanding described the bookings that stand. A kept fee
-- is a charge that stands on a booking that does not, so each of the three
-- gains the cancelled side of it, and `to_refund_minor` becomes what was taken
-- over and above it rather than everything that was taken.
--
-- Charged less paid is still the outstanding figure printed beside them: on a
-- cancelled booking the three terms are the fee, the part of it covered, and
-- the part not covered.

drop function if exists public.customer_financial_summary(uuid);

create function public.customer_financial_summary(p_customer_id uuid)
returns table (
  currency            public.currency_code,
  rental_count        bigint,
  charged_minor       bigint,
  paid_minor          bigint,
  outstanding_minor   bigint,
  deposits_held_minor bigint,
  cancelled_count     bigint,
  to_refund_minor     bigint
)
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_organization_id uuid;
begin
  select c.organization_id into v_organization_id
  from public.customers c
  where c.id = p_customer_id;

  -- Indistinguishable from "does not exist", so a probe cannot confirm that an
  -- identifier belongs to some other agency.
  if v_organization_id is null or not app.is_org_member(v_organization_id) then
    raise exception 'Customer not found.' using errcode = 'P0002';
  end if;

  return query
  with booking as (
    select
      r.currency,
      r.status,
      r.total_minor,
      r.amount_paid_minor,
      r.balance_due_minor,
      r.deposit_minor,
      -- What a cancelled booking charges: its total once it has been settled,
      -- and nothing until then. A settled booking is one carrying a
      -- cancellation fee line, which is written only alongside zeroing the
      -- rest, so the total is the fee and whatever tax the agency puts on it.
      case
        when r.status <> 'cancelled' then r.total_minor
        when exists (
          select 1 from public.rental_line_items l
          where l.rental_id = r.id and l.kind = 'cancellation_fee'
        ) then r.total_minor
        else 0
      end as charge_minor
    from public.rentals r
    where r.customer_id = p_customer_id
      and r.status <> 'draft'
  )
  select
    b.currency,
    -- Every booking in this currency, cancelled ones included: the count is
    -- history, and history includes what fell through.
    count(*),
    coalesce(sum(b.charge_minor), 0)::bigint,
    -- Against a cancelled booking only the part of the payment the fee
    -- accounts for is money paid for something; the rest is held, not earned.
    coalesce(sum(b.amount_paid_minor) filter (where b.status <> 'cancelled'), 0)::bigint
      + coalesce(sum(least(b.amount_paid_minor, b.charge_minor))
                 filter (where b.status = 'cancelled'), 0)::bigint,
    coalesce(sum(b.balance_due_minor) filter (
      where b.balance_due_minor > 0 and b.status in ('reserved', 'active', 'completed')
    ), 0)::bigint
      + coalesce(sum(greatest(b.charge_minor - b.amount_paid_minor, 0))
                 filter (where b.status = 'cancelled'), 0)::bigint,
    coalesce(sum(b.deposit_minor) filter (where b.status in ('reserved', 'active')), 0)::bigint,
    count(*) filter (where b.status = 'cancelled'),
    coalesce(sum(greatest(b.amount_paid_minor - b.charge_minor, 0))
             filter (where b.status = 'cancelled'), 0)::bigint
  from booking b
  group by b.currency
  order by b.currency;
end;
$$;

comment on function public.customer_financial_summary(uuid) is
  'A customer''s money, one row per currency. A cancelled booking charges its cancellation fee and nothing else: the fee counts as charged, the part of a payment covering it counts as paid, the part not covered is outstanding, and anything taken beyond it is refundable.';

revoke all on function public.customer_financial_summary(uuid) from public, anon;
grant execute on function public.customer_financial_summary(uuid) to authenticated;

-- =============================================================================
-- Settling up on a booking that was called off
-- =============================================================================
--
-- public.rental_record_payment refused every inbound payment on a cancelled
-- reservation:
--
--     if v_rental.status = 'cancelled' and p_direction = 'inbound' then
--       raise exception 'This reservation was cancelled. Record a refund instead.';
--
-- That was right when a cancelled booking could not charge for anything. It
-- stopped being right the moment 20261115100200 let an agency keep a
-- cancellation fee: the fee lands in what the customer owes, and this refused
-- the payment that would settle it. A receivable nobody can pay is worse than
-- no receivable at all.
--
-- The refusal is narrowed from "no money may come in" to "no more may come in
-- than is owed". A cancelled booking has no hire left to pay for, so anything
-- above what it charges is refundable the instant it is taken -- which is
-- somebody making a mistake at a counter, not a transaction to record quietly.
--
-- A DEPOSIT IS STILL REFUSED, for the reason it always was: a deposit is
-- security against damage to a car that is not going anywhere.
--
-- WHAT THIS DOES NOT CHANGE: refunds. Outbound payments on a cancelled booking
-- were always allowed and the old message said so -- "record a refund instead"
-- -- but the Rentals screen hid every payment control on a cancelled booking,
-- so there was no way to reach one. That half is fixed in the client.
--
-- ALSO CLOSED HERE, while this function is open: a refund larger than the
-- receipts it is refunding. app.sync_rental_payment_totals clamps the rolled
-- up figure at zero rather than violating the non-negative check -- the right
-- call for a trigger, which cannot refuse without aborting somebody else's
-- write, and silent where this can simply say so.

create or replace function public.rental_record_payment(
  p_rental_id uuid,
  p_amount_minor bigint,
  p_direction public.payment_direction,
  p_purpose public.payment_purpose,
  p_method public.payment_method default 'cash',
  p_paid_at timestamptz default null,
  p_reference text default null,
  p_notes text default null
)
returns public.payments
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_rental  public.rentals;
  v_payment public.payments;
begin
  select * into v_rental from public.rentals where id = p_rental_id for update;

  if v_rental.id is null then
    raise exception 'Rental not found.' using errcode = 'P0002';
  end if;
  if p_amount_minor is null or p_amount_minor <= 0 then
    raise exception 'A payment must be for a positive amount.' using errcode = '23514';
  end if;

  if v_rental.status = 'cancelled' and p_direction = 'inbound' then
    if p_purpose = 'deposit' then
      raise exception 'A cancelled reservation cannot take a deposit.' using errcode = '23514';
    end if;
    if v_rental.balance_due_minor <= 0 then
      raise exception
        'Nothing is owed on this cancelled reservation. Record a refund instead.'
        using errcode = '23514';
    end if;
    if p_amount_minor > v_rental.balance_due_minor then
      raise exception 'Only % is owed on this cancelled reservation.',
        v_rental.balance_due_minor
        using errcode = '23514';
    end if;
  end if;

  if p_direction = 'outbound' and p_purpose = 'deposit'
     and p_amount_minor > v_rental.deposit_held_minor then
    raise exception 'Only % is held as a deposit on this contract.', v_rental.deposit_held_minor
      using errcode = '23514';
  end if;

  -- The same sentence the deposit has always had, for the other kind of money.
  if p_direction = 'outbound' and p_purpose = 'rental_charge'
     and p_amount_minor > v_rental.amount_paid_minor then
    raise exception 'Only % has been received on this contract.', v_rental.amount_paid_minor
      using errcode = '23514';
  end if;

  insert into public.payments (
    organization_id, rental_id, customer_id, direction, purpose, method,
    amount_minor, currency, paid_at, reference, notes, recorded_by
  )
  values (
    v_rental.organization_id, p_rental_id, v_rental.customer_id, p_direction, p_purpose, p_method,
    p_amount_minor, v_rental.currency, coalesce(p_paid_at, now()), p_reference, p_notes,
    (select auth.uid())
  )
  returning * into v_payment;

  return v_payment;
end;
$$;

comment on function public.rental_record_payment(
  uuid, bigint, public.payment_direction, public.payment_purpose, public.payment_method,
  timestamptz, text, text
) is
  'Records money received from or returned to the customer on one contract. A cancelled booking can take what it still charges -- a cancellation fee -- and nothing more, never a deposit, and can always be refunded. Neither kind of refund may exceed what was received.';

-- =============================================================================
-- Moving money off a booking without it passing through the till
-- =============================================================================
--
-- 20261115100500 gave a customer an account and three ways to move money
-- around it, and left the case that motivated the whole thing half built.
--
-- Carrying an overpayment forward -- they paid 120, the cancelled booking kept
-- 50, and rather than handing 70 back the agency holds it against their next
-- hire -- took TWO unrelated actions: a refund on the booking, and then taking
-- the same amount on account. Nothing tied them together, nothing required
-- both, and the obvious half is the wrong one to do first.
--
-- WHAT THAT COSTS, in the ledger it produced:
--
--     Booking A   inbound 120      <- still holding 70 of their money
--     Account     inbound  70      <- nothing took it off A
--     Account     outbound 70
--     Booking B   inbound  70
--
-- An agency that has recorded 190 received from somebody who handed over 120,
-- and a cancelled booking still reporting 70 to refund because, as far as it
-- knows, it still has it. Both halves were individually reasonable and the
-- product never asked for the other one.
--
-- One function, one transaction, both entries. The money leaves the booking
-- and arrives on the account or neither happens.
--
-- The booking side goes through public.rental_record_payment, as applying a
-- credit does, so "you cannot refund more than has been received" is enforced
-- in the one place that sentence lives.
--
-- Each entry says where the other one went. There is no column joining a
-- payment to its pair and this does not add one: two notes that name each
-- other are enough to follow a transfer by reading, which is what somebody
-- with a customer on the phone is doing.

create or replace function public.rental_move_to_account(
  p_rental_id    uuid,
  p_amount_minor bigint
)
returns public.payments
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_rental     public.rentals;
  v_refundable bigint;
  v_payment    public.payments;
begin
  select * into v_rental from public.rentals where id = p_rental_id for update;

  if v_rental.id is null then
    raise exception 'Rental not found.' using errcode = 'P0002';
  end if;
  if v_rental.customer_id is null then
    raise exception 'This booking has no customer to hold the money for.' using errcode = '23514';
  end if;
  if p_amount_minor is null or p_amount_minor <= 0 then
    raise exception 'A payment must be for a positive amount.' using errcode = '23514';
  end if;

  -- What the booking is holding beyond what it charges. On a cancelled
  -- booking that is everything above the cancellation fee; on any other it is
  -- an overpayment.
  v_refundable := greatest(-v_rental.balance_due_minor, 0);

  if v_refundable <= 0 then
    raise exception 'This booking is not holding anything over what it charges.'
      using errcode = '23514';
  end if;
  if p_amount_minor > v_refundable then
    raise exception 'Only % is held over what this booking charges.', v_refundable
      using errcode = '23514';
  end if;

  perform public.rental_record_payment(
    p_rental_id, p_amount_minor, 'outbound', 'rental_charge', 'other', now(), null,
    'Moved to the customer''s account'
  );

  insert into public.payments (
    organization_id, rental_id, customer_id, direction, purpose, method,
    amount_minor, currency, paid_at, notes, recorded_by
  )
  values (
    v_rental.organization_id, null, v_rental.customer_id, 'inbound', 'rental_charge', 'other',
    p_amount_minor, v_rental.currency, now(),
    'Moved from ' || v_rental.reference, (select auth.uid())
  )
  returning * into v_payment;

  return v_payment;
end;
$$;

comment on function public.rental_move_to_account(uuid, bigint) is
  'Moves money a booking is holding over what it charges onto the customer''s account, as one transaction: off the booking and onto the account, or neither. The alternative to refunding it, for a customer who would rather it went against their next hire.';

revoke all on function public.rental_move_to_account(uuid, bigint) from public, anon;
grant execute on function public.rental_move_to_account(uuid, bigint) to authenticated;

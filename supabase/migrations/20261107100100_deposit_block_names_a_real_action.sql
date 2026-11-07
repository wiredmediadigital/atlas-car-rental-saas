-- The held-deposit block names an action that exists.
--
-- rental_complete refused with "Refund or retain it before completing the
-- rental." There is no retain action. deposit_held_minor is derived by
-- app.sync_rental_payment_totals as the net of payments with purpose
-- 'deposit', and app.guard_rental_derived_amounts refuses any direct write to
-- it, so the only thing that can bring it back to zero is an outbound
-- 'deposit' payment — the refund. Staff following the other half of that
-- sentence were looking for a button that was never built, on a contract they
-- could not close until they stopped looking.
--
-- Only the message changes. Signature, volatility, search_path, the guards and
-- their order, the errcode and the update are as before. The text still opens
-- with "A deposit of % is still held." so existing callers that match on that
-- phrase keep working.

/**
 * Closes the contract.
 *
 * An outstanding balance does not block completion. Operational completion and
 * financial settlement are different facts, and an agency that has taken the
 * car back needs to say so even when the customer still owes money. The debt
 * stays visible and keeps counting toward receivables.
 */
create or replace function public.rental_complete(p_rental_id uuid)
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
  if v_rental.status <> 'active' then
    raise exception 'Only an active rental can be completed.' using errcode = '23514';
  end if;
  if v_rental.returned_at is null or v_rental.return_odometer is null then
    raise exception 'Record the vehicle''s return before completing this rental.'
      using errcode = '23514';
  end if;
  if v_rental.deposit_held_minor > 0 then
    raise exception
      'A deposit of % is still held. Refund it before completing the rental.',
      v_rental.deposit_held_minor
      using errcode = '23514';
  end if;

  update public.rentals
     set status = 'completed',
         completed_at = now()
   where id = p_rental_id
  returning * into v_rental;

  return v_rental;
end;
$$;

revoke all on function public.rental_complete(uuid) from public, anon;
grant execute on function public.rental_complete(uuid) to authenticated;

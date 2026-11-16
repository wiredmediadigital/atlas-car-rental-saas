-- =============================================================================
-- Voiding has to leave the books standing
-- =============================================================================
--
-- Found by a question rather than a failure: "voiding a payment you already
-- received should trigger some type of warning, is that correct?"
--
-- Half of that is not answerable. Whether money actually arrived is not a fact
-- this database holds -- every payment row claims it did, and voiding is the
-- assertion that the claim was false. There is no signal to warn on.
--
-- The other half is exactly answerable, and was not being asked at all:
--
--     A hire charging 247.50, paid 330, refunded 82.50.
--     Entries: +330, -82.50. The contract reads 247.50 paid. Correct.
--     Void the +330. What is left sums to -82.50.
--     app.sync_rental_payment_totals clamps it to 0.
--
-- The refund is still on the ledger, paid out against money the system now
-- believes was never received. The customer owes the whole 247.50 again, the
-- books are out by 82.50, and nothing anywhere said a word. The clamp exists
-- so a trigger need not abort somebody else's write, and its own comment calls
-- the situation a data error -- it identified this correctly and then absorbed
-- it, which is the quietest way to be wrong.
--
-- So: refused, not warned, and on the knowable question. A void that would
-- leave refunds exceeding receipts, a deposit return exceeding the deposit, or
-- a customer's account holding less than nothing, is not undoing an entry. It
-- is breaking the arithmetic around one.
--
-- DELIBERATELY NARROW. Voiding a genuinely mistaken extra payment still works
-- whenever the remaining entries still cover what went out -- which is the
-- case the function exists for. Only the void that cannot be made to add up is
-- refused, and the message says which entry to deal with first.
--
-- The account branch is here because money with no booking has no rollup to
-- clamp it: public.customer_account_balance simply sums, so the balance would
-- read as a negative number on the customer's own page.
--
-- Spliced from the definition in 20260815100100, which is still the current
-- one, with the declarations widened and the guard inserted after the
-- already-voided check. Nothing else is touched.
-- =============================================================================

create or replace function public.rental_void_payment(p_payment_id uuid, p_reason text default null)
returns public.payments
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_payment       public.payments;
  v_paid_after    bigint;
  v_deposit_after bigint;
begin
  select * into v_payment from public.payments where id = p_payment_id for update;

  if v_payment.id is null then
    raise exception 'Payment not found.' using errcode = 'P0002';
  end if;
  if v_payment.voided_at is not null then
    raise exception 'That payment has already been voided.' using errcode = '23514';
  end if;

  /*
   * Would this leave the arithmetic standing?
   *
   * app.sync_rental_payment_totals recomputes the rolled up figures from the
   * entries that are not voided, and clamps them at zero -- the right call for
   * a trigger, which cannot refuse without aborting somebody else's write.
   * Nothing refused on its behalf, so voiding the receipt that a refund was
   * drawn from left the contract reporting that the money was never received,
   * the refund still sitting on the ledger, and the books out by the
   * difference. The clamp's own comment calls that a data error and then
   * absorbs it.
   *
   * This is the detectable half of "was that payment real". Whether money
   * arrived is not knowable here; whether the ledger still adds up without
   * this entry is exactly knowable, and is refused when it does not.
   */
  if v_payment.rental_id is not null then
    select
      coalesce(sum(
        case p.direction when 'inbound' then p.amount_minor else -p.amount_minor end
      ) filter (where p.purpose = 'rental_charge'), 0),
      coalesce(sum(
        case p.direction when 'inbound' then p.amount_minor else -p.amount_minor end
      ) filter (where p.purpose = 'deposit'), 0)
      into v_paid_after, v_deposit_after
    from public.payments p
    where p.rental_id = v_payment.rental_id
      and p.voided_at is null
      and p.id <> p_payment_id;

    if v_paid_after < 0 then
      raise exception
        'Refunds on this contract would be % more than was received. Void the refund first, or record a correcting payment instead.',
        -v_paid_after
        using errcode = '23514';
    end if;
    if v_deposit_after < 0 then
      raise exception
        'Deposit returns on this contract would be % more than was taken. Void the return first.',
        -v_deposit_after
        using errcode = '23514';
    end if;

  elsif v_payment.customer_id is not null then
    -- Money on the account, which has no rollup to clamp it: the balance
    -- would simply read less than nothing.
    select coalesce(sum(
             case p.direction when 'inbound' then p.amount_minor else -p.amount_minor end
           ), 0)
      into v_paid_after
    from public.payments p
    where p.customer_id = v_payment.customer_id
      and p.rental_id is null
      and p.currency = v_payment.currency
      and p.voided_at is null
      and p.id <> p_payment_id;

    if v_paid_after < 0 then
      raise exception
        'This customer''s account would be left holding % less than nothing. The money has already been spent or paid out.',
        -v_paid_after
        using errcode = '23514';
    end if;
  end if;

  update public.payments
     set voided_at = now(),
         voided_by = (select auth.uid()),
         void_reason = p_reason
   where id = p_payment_id
  returning * into v_payment;

  return v_payment;
end;
$$;

comment on function public.rental_void_payment(uuid, text) is
  'Reverses a payment without erasing it: the entry stays on the ledger, marked, and counts nowhere. Refused when the reversal would leave refunds exceeding receipts, a deposit return exceeding the deposit, or a customer account holding less than nothing -- the cases where voiding does not undo an entry so much as break the arithmetic around it.';

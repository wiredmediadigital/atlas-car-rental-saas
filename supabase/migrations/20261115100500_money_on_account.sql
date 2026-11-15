-- =============================================================================
-- Money held for a customer rather than for a booking
-- =============================================================================
--
-- `payments.rental_id` has been nullable since the schema was written, and
-- nothing has ever put a row there. A customer who overpaid a booking that was
-- then called off had exactly one option -- take the money back out of the
-- till -- when the thing both sides usually want is to leave it where it is
-- and put it against the next hire.
--
-- No new table. A credit is a payment with no booking attached, which is what
-- the column was always for, and the ledger view added in 20261115100400
-- already renders those rows as "On account".
--
-- THREE OPERATIONS, because fewer would leave a trap:
--
--   customer_record_credit   money onto the account, or back out of it
--   customer_apply_credit    money from the account onto one booking
--   customer_account_balance what is left, per currency
--
-- Recording without applying would be a balance nobody could spend; applying
-- without paying out would be a balance nobody could leave with.
--
-- APPLYING IS TWO ENTRIES, NOT A MOVED ONE. Re-pointing the original row at a
-- booking would be tidier by one row and would quietly rewrite history: the
-- money did arrive on a day, on the account, and that is what the receipt
-- says. It is also the only way a partial application can work -- half a
-- payment row cannot be re-pointed.
--
-- The booking side goes through public.rental_record_payment rather than
-- inserting directly, so every rule about what a booking may take -- a
-- cancelled one takes its cancellation fee and nothing else, a deposit is
-- refused there -- is enforced in one place and cannot drift.
--
-- Per currency throughout, like everything else on a customer's record. An
-- agency that once billed in USD and now bills in EUR holds two balances and
-- no single balance, and this product has no exchange rate.

-- -----------------------------------------------------------------------------
-- What is on the account
-- -----------------------------------------------------------------------------

create or replace function public.customer_account_balance(p_customer_id uuid)
returns table (
  currency         public.currency_code,
  on_account_minor bigint
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

  -- Indistinguishable from "does not exist", as everywhere else a customer is
  -- read by id, so a probe cannot confirm one belongs to another agency.
  if v_organization_id is null or not app.is_org_member(v_organization_id) then
    raise exception 'Customer not found.' using errcode = 'P0002';
  end if;

  return query
  select
    p.currency,
    sum(
      case p.direction
        when 'inbound'  then p.amount_minor
        when 'outbound' then -p.amount_minor
      end
    )::bigint
  from public.payments p
  where p.customer_id = p_customer_id
    and p.rental_id is null
    -- A voided entry was reversed; it stays on the ledger and counts nowhere,
    -- exactly as it does in the figures rolled up onto a rental.
    and p.voided_at is null
  group by p.currency
  having sum(
    case p.direction
      when 'inbound'  then p.amount_minor
      when 'outbound' then -p.amount_minor
    end
  ) <> 0
  order by p.currency;
end;
$$;

comment on function public.customer_account_balance(uuid) is
  'What the agency is holding for this customer that is not against any booking, one row per currency. Voided entries count nowhere, and a currency that nets to nothing is not reported.';

-- -----------------------------------------------------------------------------
-- Money onto the account, and back off it
-- -----------------------------------------------------------------------------

create or replace function public.customer_record_credit(
  p_customer_id  uuid,
  p_amount_minor bigint,
  p_currency     public.currency_code,
  p_direction    public.payment_direction default 'inbound',
  p_method       public.payment_method default 'cash',
  p_paid_at      timestamptz default null,
  p_reference    text default null,
  p_notes        text default null
)
returns public.payments
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_organization_id uuid;
  v_held            bigint;
  v_payment         public.payments;
begin
  select c.organization_id into v_organization_id
  from public.customers c
  where c.id = p_customer_id;

  if v_organization_id is null then
    raise exception 'Customer not found.' using errcode = 'P0002';
  end if;
  if p_amount_minor is null or p_amount_minor <= 0 then
    raise exception 'A payment must be for a positive amount.' using errcode = '23514';
  end if;

  if p_direction = 'outbound' then
    select coalesce(b.on_account_minor, 0) into v_held
    from public.customer_account_balance(p_customer_id) b
    where b.currency = p_currency;

    if coalesce(v_held, 0) <= 0 then
      raise exception 'Nothing is held on this customer''s account in %.', p_currency
        using errcode = '23514';
    end if;
    if p_amount_minor > v_held then
      raise exception 'Only % is held on this customer''s account.', v_held
        using errcode = '23514';
    end if;
  end if;

  /*
   * `purpose` is rental_charge rather than deposit, and the distinction still
   * means what it always did: this is money towards what the customer owes,
   * not security held against damage to a particular car. A deposit without a
   * car to secure is not a thing, so it is not offered.
   */
  insert into public.payments (
    organization_id, rental_id, customer_id, direction, purpose, method,
    amount_minor, currency, paid_at, reference, notes, recorded_by
  )
  values (
    v_organization_id, null, p_customer_id, p_direction, 'rental_charge', p_method,
    p_amount_minor, p_currency, coalesce(p_paid_at, now()), p_reference, p_notes,
    (select auth.uid())
  )
  returning * into v_payment;

  return v_payment;
end;
$$;

comment on function public.customer_record_credit(
  uuid, bigint, public.currency_code, public.payment_direction, public.payment_method,
  timestamptz, text, text
) is
  'Takes money onto a customer''s account, or pays it back out. A credit belongs to no booking; paying out more than is held is refused.';

-- -----------------------------------------------------------------------------
-- Money from the account onto a booking
-- -----------------------------------------------------------------------------

create or replace function public.customer_apply_credit(
  p_customer_id  uuid,
  p_rental_id    uuid,
  p_amount_minor bigint
)
returns public.payments
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_rental  public.rentals;
  v_held    bigint;
  v_payment public.payments;
begin
  select * into v_rental from public.rentals where id = p_rental_id for update;

  if v_rental.id is null then
    raise exception 'Rental not found.' using errcode = 'P0002';
  end if;
  if v_rental.customer_id is distinct from p_customer_id then
    raise exception 'That booking belongs to somebody else.' using errcode = '23514';
  end if;
  if p_amount_minor is null or p_amount_minor <= 0 then
    raise exception 'A payment must be for a positive amount.' using errcode = '23514';
  end if;

  select coalesce(b.on_account_minor, 0) into v_held
  from public.customer_account_balance(p_customer_id) b
  where b.currency = v_rental.currency;

  if coalesce(v_held, 0) <= 0 then
    raise exception 'Nothing is held on this customer''s account in %.', v_rental.currency
      using errcode = '23514';
  end if;
  if p_amount_minor > v_held then
    raise exception 'Only % is held on this customer''s account.', v_held
      using errcode = '23514';
  end if;

  -- Off the account first, so a booking that refuses the money leaves the
  -- balance exactly where it was rather than taking it twice.
  insert into public.payments (
    organization_id, rental_id, customer_id, direction, purpose, method,
    amount_minor, currency, paid_at, notes, recorded_by
  )
  values (
    v_rental.organization_id, null, p_customer_id, 'outbound', 'rental_charge', 'other',
    p_amount_minor, v_rental.currency, now(),
    'Applied to ' || v_rental.reference, (select auth.uid())
  );

  -- And onto the booking through the one function that knows what a booking
  -- may take. A cancelled one takes its cancellation fee and no more.
  v_payment := public.rental_record_payment(
    p_rental_id, p_amount_minor, 'inbound', 'rental_charge', 'other', now(), null,
    'Applied from the customer''s account'
  );

  return v_payment;
end;
$$;

comment on function public.customer_apply_credit(uuid, uuid, bigint) is
  'Puts money the agency holds for a customer against one of their bookings, as two entries rather than by moving one: the money did arrive on the account, and a part of a payment cannot be re-pointed. The booking side goes through rental_record_payment, so every rule about what a booking may take applies.';

revoke all on function public.customer_account_balance(uuid) from public, anon;
revoke all on function public.customer_record_credit(
  uuid, bigint, public.currency_code, public.payment_direction, public.payment_method,
  timestamptz, text, text
) from public, anon;
revoke all on function public.customer_apply_credit(uuid, uuid, bigint) from public, anon;

grant execute on function public.customer_account_balance(uuid) to authenticated;
grant execute on function public.customer_record_credit(
  uuid, bigint, public.currency_code, public.payment_direction, public.payment_method,
  timestamptz, text, text
) to authenticated;
grant execute on function public.customer_apply_credit(uuid, uuid, bigint) to authenticated;

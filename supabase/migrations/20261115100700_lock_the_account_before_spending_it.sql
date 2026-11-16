-- =============================================================================
-- Reading a balance and then spending it is two statements
-- =============================================================================
--
-- public.customer_record_credit and public.customer_apply_credit both refuse to
-- take more off a customer's account than is held. Both work it out like this:
--
--     select ... into v_held from public.customer_account_balance(...);
--     if p_amount_minor > v_held then raise ...
--     insert into public.payments ...
--
-- which is a check and a write with nothing holding the thing being checked.
-- Two requests at once -- two people at two terminals, or one person retrying
-- after a timeout -- both read 250, both find their 250 allowed, and both
-- write. The account goes to minus 250 and no rule was broken on the way.
--
-- customer_apply_credit took `for update` on the RENTAL, which looks like a
-- guard and is not: the row being overspent is the customer's balance, and two
-- applications against two different bookings never contend for the same
-- rental at all.
--
-- The customer row is now locked before the balance is read, in both. It holds
-- nothing interesting; it is the mutex, and the balance is what it protects.
-- A second caller waits, re-reads a balance that now includes the first
-- caller's write, and is refused on the arithmetic exactly as it should be.
--
-- WHAT IS NOT CHANGED, and why:
--
-- rental_move_to_account only ever ADDS to the account, so there is no cap to
-- race against. A payout running beside it either sees the money or does not,
-- and both readings refuse correctly -- conservatively if it reads first.
--
-- The booking side was never exposed. Every function that caps against a
-- rental already locks that rental, and the cap comes from the locked row.
--
-- LOCK ORDER, since customer_apply_credit now takes two: customer, then
-- rental. Nothing in the schema takes that pair the other way round -- the
-- rental-side functions take no customer lock at all -- so there is no cycle
-- to deadlock on. A later function that needs both must take them in this
-- order.
--
-- A single-connection PGlite cannot open two real transactions, so the test
-- for this asserts the lock is present in the function body rather than
-- racing it. The race itself belongs to scripts/live-smoke-test.mjs, which
-- fires overlapping requests over separate connections.

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
  -- The mutex. Taken for an inbound payment too, which needs no cap of its
  -- own: one rule about when this row is held is easier to keep true than two.
  select c.organization_id into v_organization_id
  from public.customers c
  where c.id = p_customer_id
  for update;

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
  v_customer_id uuid;
  v_rental      public.rentals;
  v_held        bigint;
  v_payment     public.payments;
begin
  -- Customer first, then rental. See the lock order note above.
  select c.id into v_customer_id
  from public.customers c
  where c.id = p_customer_id
  for update;

  select * into v_rental from public.rentals where id = p_rental_id for update;

  if v_rental.id is null then
    raise exception 'Rental not found.' using errcode = 'P0002';
  end if;
  if v_rental.customer_id is distinct from p_customer_id or v_customer_id is null then
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

comment on function public.customer_record_credit(
  uuid, bigint, public.currency_code, public.payment_direction, public.payment_method,
  timestamptz, text, text
) is
  'Takes money onto a customer''s account, or pays it back out. A credit belongs to no booking; paying out more than is held is refused, under a lock on the customer row so two callers cannot each be told the same money is theirs to spend.';

comment on function public.customer_apply_credit(uuid, uuid, bigint) is
  'Puts money the agency holds for a customer against one of their bookings, as two entries rather than by moving one. Locks the customer before reading the balance, then the rental; the booking side goes through rental_record_payment, so every rule about what a booking may take applies.';

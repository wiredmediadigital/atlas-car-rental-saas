-- =============================================================================
-- A payment is recorded once, however many times it is sent
-- =============================================================================
--
-- Nothing in this product distinguishes "the customer paid 300 twice" from
-- "the request was sent twice". Both are two rows that look identical, and both
-- are legal, because somebody really can hand over 100 twice in a day. A
-- uniqueness rule over the amount would be wrong.
--
-- What is missing is the sender saying which it is. A client that generates a
-- key when its form opens, and sends that key with every attempt, has said
-- "these are all one payment" -- and a retry after a dropped connection, a
-- refresh mid-submit, or a mobile signal flapping is then a no-op that returns
-- the payment already recorded.
--
-- The buttons already disable while a request is in flight, which covers an
-- ordinary double click. What they cannot cover is a connection that drops
-- after the insert committed but before the answer got home, which is the case
-- that leaves an agency explaining a double charge to somebody who clicked
-- once, and cannot reproduce it, and is right.
--
-- SCOPED TO THE AGENCY, not global. A global unique index would let one
-- agency's key collide with another's, and the fallback read below -- "the
-- insert did nothing, so fetch the row that won" -- would then be reaching for
-- a row belonging to a different tenant. Row level security would refuse it and
-- the function would return nothing rather than a payment: a confusing failure
-- built out of a design that did not need to exist. Scoping the index means the
-- collision cannot happen across agencies at all.
--
-- NULLABLE, so nothing that exists has to change. Direct SQL, the Edge
-- Functions, and every caller that sends no key behave exactly as now: the
-- partial index ignores them and the early return never fires.
--
-- TWO FUNCTIONS, NOT FOUR. customer_apply_credit and rental_move_to_account are
-- already idempotent by their caps -- each spends a balance that its own first
-- call reduced, so a second attempt is refused rather than doubled. They fail
-- closed, which is safe; what they do not do is report the original success, so
-- a retry there shows an error for something that worked. Worth fixing, not
-- money, and not fixed here.
--
-- Both functions gain a parameter, which would make the existing signature
-- ambiguous against the new one, so both are dropped and recreated and their
-- grants restated at the foot of this file. The bodies are spliced from their
-- current definitions rather than retyped: 20261115100800 is the file where
-- retyping one from memory dropped a billing check and rewrote six refusals.
-- =============================================================================

alter table public.payments
  add column if not exists idempotency_key uuid;

comment on column public.payments.idempotency_key is
  'Supplied by the client, one per payment the person is making rather than one per attempt. Two requests carrying the same key are the same payment; null means the caller is claiming nothing.';

create unique index if not exists payments_idempotency_key_idx
  on public.payments (organization_id, idempotency_key)
  where idempotency_key is not null;

-- Identity, like id and organization_id. A key that could be edited onto a
-- different payment afterwards would be no guarantee at all.
drop trigger if exists payments_freeze_columns on public.payments;
create trigger payments_freeze_columns
  before update on public.payments
  for each row execute function app.freeze_columns(
    'id', 'organization_id', 'created_at', 'recorded_by', 'idempotency_key'
  );

drop function if exists public.rental_record_payment(
  uuid, bigint, public.payment_direction, public.payment_purpose, public.payment_method,
  timestamptz, text, text
);

create function public.rental_record_payment(
  p_rental_id uuid,
  p_amount_minor bigint,
  p_direction public.payment_direction,
  p_purpose public.payment_purpose,
  p_method public.payment_method default 'cash',
  p_paid_at timestamptz default null,
  p_reference text default null,
  p_notes text default null,
  p_idempotency_key uuid default null
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

  /*
   * A request that already succeeded.
   *
   * Returning what it wrote -- rather than writing again, or raising -- is the
   * whole point: a client that lost the connection and retried, or a person
   * who refreshed mid-submit, gets the success it already had. Raising there
   * would show a failure for money that is on the record, which is how one
   * payment becomes three.
   *
   * Before the caps below, deliberately. A retried refund would otherwise be
   * refused by a ceiling its own first attempt had already lowered.
   *
   * A key that comes back attached to a DIFFERENT payment is a different
   * matter: the caller has reused one, and answering with somebody else's
   * money would make a second booking look paid by the first one's payment.
   * That is refused rather than answered.
   */
  if p_idempotency_key is not null then
    select * into v_payment
    from public.payments p
    where p.organization_id = v_rental.organization_id
      and p.idempotency_key = p_idempotency_key;

    if found then
      if v_payment.rental_id is distinct from p_rental_id
         or v_payment.amount_minor <> p_amount_minor
         or v_payment.direction <> p_direction
         or v_payment.purpose <> p_purpose then
        raise exception
          'That payment key has already been used for a different payment.'
          using errcode = '23505';
      end if;
      return v_payment;
    end if;
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
    amount_minor, currency, paid_at, reference, notes, recorded_by, idempotency_key
  )
  values (
    v_rental.organization_id, p_rental_id, v_rental.customer_id, p_direction, p_purpose, p_method,
    p_amount_minor, v_rental.currency, coalesce(p_paid_at, now()), p_reference, p_notes,
    (select auth.uid()), p_idempotency_key
  )
  on conflict (organization_id, idempotency_key) where idempotency_key is not null
  do nothing
  returning * into v_payment;

  -- Two copies of the same request arriving together, rather than one after
  -- the other: the one that loses the insert reads what the winner wrote, and
  -- holds it to the same test.
  if v_payment.id is null then
    select * into v_payment
    from public.payments p
    where p.organization_id = v_rental.organization_id
      and p.idempotency_key = p_idempotency_key;

    if v_payment.rental_id is distinct from p_rental_id
       or v_payment.amount_minor <> p_amount_minor
       or v_payment.direction <> p_direction
       or v_payment.purpose <> p_purpose then
      raise exception
        'That payment key has already been used for a different payment.'
        using errcode = '23505';
    end if;
  end if;

  return v_payment;
end;
$$;

drop function if exists public.customer_record_credit(
  uuid, bigint, public.currency_code, public.payment_direction, public.payment_method,
  timestamptz, text, text
);

create function public.customer_record_credit(
  p_customer_id  uuid,
  p_amount_minor bigint,
  p_currency     public.currency_code,
  p_direction    public.payment_direction default 'inbound',
  p_method       public.payment_method default 'cash',
  p_paid_at      timestamptz default null,
  p_reference    text default null,
  p_notes        text default null,
  p_idempotency_key uuid default null
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

  /*
   * A request that already succeeded.
   *
   * Returning what it wrote -- rather than writing again, or raising -- is the
   * whole point: a client that lost the connection and retried, or a person
   * who refreshed mid-submit, gets the success it already had. Raising there
   * would show a failure for money that is on the record, which is how one
   * payment becomes three.
   *
   * Before the caps below, deliberately. A retried refund would otherwise be
   * refused by a ceiling its own first attempt had already lowered.
   *
   * A key that comes back attached to a DIFFERENT payment is a different
   * matter: the caller has reused one, and answering with somebody else's
   * money would make a second booking look paid by the first one's payment.
   * That is refused rather than answered.
   */
  if p_idempotency_key is not null then
    select * into v_payment
    from public.payments p
    where p.organization_id = v_organization_id
      and p.idempotency_key = p_idempotency_key;

    if found then
      if v_payment.customer_id is distinct from p_customer_id
         or v_payment.rental_id is not null
         or v_payment.amount_minor <> p_amount_minor
         or v_payment.direction <> p_direction
         or v_payment.currency <> p_currency then
        raise exception
          'That payment key has already been used for a different payment.'
          using errcode = '23505';
      end if;
      return v_payment;
    end if;
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
    amount_minor, currency, paid_at, reference, notes, recorded_by, idempotency_key
  )
  values (
    v_organization_id, null, p_customer_id, p_direction, 'rental_charge', p_method,
    p_amount_minor, p_currency, coalesce(p_paid_at, now()), p_reference, p_notes,
    (select auth.uid()), p_idempotency_key
  )
  on conflict (organization_id, idempotency_key) where idempotency_key is not null
  do nothing
  returning * into v_payment;

  -- Two copies of the same request arriving together, rather than one after
  -- the other: the one that loses the insert reads what the winner wrote, and
  -- holds it to the same test.
  if v_payment.id is null then
    select * into v_payment
    from public.payments p
    where p.organization_id = v_organization_id
      and p.idempotency_key = p_idempotency_key;

    if v_payment.customer_id is distinct from p_customer_id
       or v_payment.rental_id is not null
       or v_payment.amount_minor <> p_amount_minor
       or v_payment.direction <> p_direction
       or v_payment.currency <> p_currency then
      raise exception
        'That payment key has already been used for a different payment.'
        using errcode = '23505';
    end if;
  end if;

  return v_payment;
end;
$$;

revoke all on function public.rental_record_payment(
  uuid, bigint, public.payment_direction, public.payment_purpose, public.payment_method,
  timestamptz, text, text, uuid
) from public, anon;
revoke all on function public.customer_record_credit(
  uuid, bigint, public.currency_code, public.payment_direction, public.payment_method,
  timestamptz, text, text, uuid
) from public, anon;

grant execute on function public.rental_record_payment(
  uuid, bigint, public.payment_direction, public.payment_purpose, public.payment_method,
  timestamptz, text, text, uuid
) to authenticated;
grant execute on function public.customer_record_credit(
  uuid, bigint, public.currency_code, public.payment_direction, public.payment_method,
  timestamptz, text, text, uuid
) to authenticated;

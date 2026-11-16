-- =============================================================================
-- Two findings from reviewing tonight's work
-- =============================================================================
--
-- Neither of these has bitten. Both are the kind that would not announce
-- themselves if they did, which is the reason for closing them now rather than
-- when something goes wrong.
--
-- ONE: THE ADVISORY LOCK KEY WAS TIMEZONE-DEPENDENT.
--
-- 20261115100800 keys the lock on the five values that make two booking
-- requests identical, and rendered two of them with `::text`:
--
--     p_from::text || '|' || p_to::text
--
-- timestamptz::text renders through the session's TimeZone setting. The same
-- instant therefore produces different text on two connections configured
-- differently -- different text, different hash, different lock, and the race
-- the lock exists to close is open again between them.
--
-- The duplicate check four lines below compares `l.starts_at = p_from`, which
-- is timezone-independent: timestamptz comparison is absolute. So the lock and
-- the check disagreed about what makes two requests identical, in a lock whose
-- only job is to be keyed on the identity of a request.
--
-- Today every request arrives through one Edge Function on one pooler, so the
-- setting is constant and the lock works. What this is really about is the
-- second caller -- a worker, an admin session, a psql prompt -- which would
-- silently stop sharing locks with the first and leave nothing in any log to
-- connect the duplicates to the change that caused them. An epoch is an
-- absolute number of seconds and reads the same from every session.
--
-- TWO: A VOIDED PAYMENT WAS REPORTED AS A SUCCESS.
--
-- 20261115100900 answers a repeated idempotency key with the payment it
-- already wrote, matching on agency and key alone. A payment that was recorded
-- and then voided still matches, so the answer is "recorded" for money that
-- counts nowhere -- voided entries are excluded from every rollup by design.
--
-- Reaching it takes a deliberate void inside the seconds a network retry
-- takes, which is why it is being fixed on its own terms rather than urgently.
-- It is refused rather than ignored: ignoring voided rows would send the
-- insert into the unique index, whose conflict path reads the same voided row
-- back, which is a loop. Refusing says the true thing and puts a person on it.
--
-- Neither signature changes, so these are `create or replace` and the grants
-- stand. All three bodies are spliced from their current definitions and the
-- diff line counts are checked, because restating one of these by hand is the
-- mistake 20261115100800 was nearly shipped with.
-- =============================================================================

create or replace function app.public_booking_create_lead(
  p_organization_id uuid,
  p_vehicle_id      uuid,
  p_from            timestamptz,
  p_to              timestamptz,
  p_full_name       text,
  p_email           text,
  p_phone           text default null,
  p_note            text default null
)
returns table (lead_id uuid, reference text, created boolean)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  -- Longest hire this will record. Matches the booking_leads.billable_days
  -- check, so a request can never be accepted here and refused by the table.
  c_max_days constant integer := 370;
  -- A visitor whose clock, or whose time zone, puts "this morning" slightly in
  -- the past is asking for something reasonable. A year ago is not.
  c_past_grace constant interval := interval '1 day';

  v_name     text := btrim(coalesce(p_full_name, ''));
  v_email    text := btrim(coalesce(p_email, ''));
  v_phone    text := nullif(btrim(coalesce(p_phone, '')), '');
  v_note     text := nullif(btrim(coalesce(p_note, '')), '');
  -- How long an identical request counts as the same one. Long enough to
  -- cover a double click, a retried submission and a browser resubmitting on
  -- back; short enough that somebody genuinely asking again tomorrow is heard.
  c_duplicate_window constant interval := interval '1 hour';

  v_vehicle   public.vehicles;
  v_days      integer;
  v_duplicate public.booking_leads;
begin
  -- 1. Is this agency publishing a page at all? Same question the reads ask.
  if not app.public_booking_is_open(p_organization_id) then
    raise exception 'This agency is not accepting booking requests.' using errcode = '42501';
  end if;

  -- 2. Leads are not billing-exempt. An agency that has stopped paying is
  -- read-only, and a page still taking requests it cannot act on would be a
  -- promise nobody is keeping. Raises 42501.
  perform app.billing_require_write(p_organization_id);

  -- 3. The dates. The Edge Function says this better to the visitor; the
  -- database refuses the absurd regardless of who calls it.
  if p_from is null or p_to is null then
    raise exception 'A booking request needs a start and an end.' using errcode = '22023';
  end if;
  if p_to <= p_from then
    raise exception 'The period must end after it starts.' using errcode = '22023';
  end if;
  if p_from < now() - c_past_grace then
    raise exception 'A booking request cannot start in the past.' using errcode = '22023';
  end if;
  if public.rental_billable_days(p_from, p_to) > c_max_days then
    raise exception 'A booking request cannot run for more than % days.', c_max_days
      using errcode = '22023';
  end if;

  -- 4. The person. The email_address domain checks the shape of the address on
  -- insert; an empty name has to be refused here, because btrim made it empty.
  if v_name = '' then
    raise exception 'A booking request needs a name.' using errcode = '22023';
  end if;

  -- 5. The vehicle, as it is NOW: this agency's, opted in, not archived, and
  -- still existing. One lookup answers all four, and the single message covers
  -- them so that a refusal cannot be used to probe which one it was.
  select v.* into v_vehicle
  from public.vehicles v
  where v.id = p_vehicle_id
    and v.organization_id = p_organization_id
    and v.public_booking_enabled
    and v.archived_at is null;

  if not found then
    raise exception 'That vehicle is no longer available to request.' using errcode = '22023';
  end if;

  /*
   * DELIBERATELY NOT CHECKED: whether the vehicle is free for these dates.
   *
   * A request holds nothing. The page marks an unavailable car "not free for
   * these dates" and offers no form for it, but a request that arrives anyway
   * -- because someone else booked the car thirty seconds ago, or because the
   * car went into the workshop this morning -- is still a real person asking a
   * real question. Refusing it would throw their details away to protect an
   * invariant nothing depends on. Availability is decided once, at conversion
   * (20261113100500), where the rental either takes the car or does not.
   */

  /*
   * One identical request at a time.
   *
   * The check below reads and then writes, and the double click it exists for
   * is precisely what slips between the two. This makes two requests that are
   * already each other's duplicate take turns; nothing else waits on anything,
   * and the lock is released when this transaction ends either way.
   *
   * The key is the five values that make two requests identical, so a second
   * caller arrives at the check with the first caller's row committed and
   * leaves down the path that was always there.
   */
  perform pg_advisory_xact_lock(
    hashtext('booking_lead_duplicate'),
    hashtext(
      p_organization_id::text || '|' || p_vehicle_id::text || '|' ||
      extract(epoch from p_from)::text || '|' ||
      extract(epoch from p_to)::text || '|' || lower(v_email)
    )
  );

  /*
   * 6. The same request again.
   *
   * A double click, a connection retried, a browser resubmitting on back: all
   * of them send the identical payload within seconds. The second one is
   * ANSWERED WITH THE FIRST ONE'S REFERENCE rather than refused, because the
   * person did nothing wrong -- an error here would show a failure to someone
   * whose request worked, and invite them to send a third.
   *
   * Identical means: same agency, same car, same two instants, same address
   * ignoring case, and still untouched. Once staff have contacted, declined or
   * converted it, the agency has acted, and the same person asking again is
   * saying something new rather than clicking twice.
   *
   * It is deliberately narrow. A blunt per-agency ceiling would be
   * weaponisable: flooding an agency past it would stop their real customers
   * getting through, which is a worse outcome than the duplicates it prevents.
   * This refuses nothing that was not already a repeat of itself.
   */
  select l.* into v_duplicate
  from public.booking_leads l
  where l.organization_id = p_organization_id
    and l.vehicle_id = p_vehicle_id
    and l.starts_at = p_from
    and l.ends_at = p_to
    and lower(l.email) = lower(v_email)
    and l.status = 'new'
    and l.created_at > now() - c_duplicate_window
  order by l.created_at desc
  limit 1;

  if found then
    -- created = false, which is what stops a retry sending the renter a second
    -- acknowledgement and the agency a second notification.
    return query select v_duplicate.id, v_duplicate.reference, false;
    return;
  end if;

  -- 7. The price snapshot, taken here from the vehicle rather than accepted
  -- from the caller. rental_billable_days is the same function the rental will
  -- use, so the estimate and the eventual price are counted the same way.
  v_days := public.rental_billable_days(p_from, p_to);

  return query
  insert into public.booking_leads (
    organization_id, vehicle_id, starts_at, ends_at,
    full_name, email, phone, note,
    currency, daily_rate_minor, billable_days, quoted_total_minor
  )
  values (
    p_organization_id, p_vehicle_id, p_from, p_to,
    v_name, v_email, v_phone, v_note,
    v_vehicle.currency, v_vehicle.daily_rate_minor, v_days,
    v_vehicle.daily_rate_minor * v_days
  )
  returning booking_leads.id, booking_leads.reference, true;
end;
$$;

create or replace function public.rental_record_payment(
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
      if v_payment.voided_at is not null then
        raise exception
          'That payment was recorded and then voided. Record it again as a new payment.'
          using errcode = '23505';
      end if;

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

    if v_payment.voided_at is not null then
      raise exception
        'That payment was recorded and then voided. Record it again as a new payment.'
        using errcode = '23505';
    end if;

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

create or replace function public.customer_record_credit(
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
      if v_payment.voided_at is not null then
        raise exception
          'That payment was recorded and then voided. Record it again as a new payment.'
          using errcode = '23505';
      end if;

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

    if v_payment.voided_at is not null then
      raise exception
        'That payment was recorded and then voided. Record it again as a new payment.'
        using errcode = '23505';
    end if;

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

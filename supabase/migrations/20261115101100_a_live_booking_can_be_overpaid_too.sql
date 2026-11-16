-- =============================================================================
-- A booking that is still standing can be overpaid too
-- =============================================================================
--
-- Reported from live use, with the arithmetic already done:
--
--   A three day hire at 100 a day, 300 plus 10% tax, paid in full at 330.
--   Switched to a 155 a day car: 511.50 charged, and the account correctly
--   says 181.50 is owed.
--   Switched again to an 85 a day car: 280.50 charged against 330 paid, so
--   49.50 has to go back -- and the account said nothing at all.
--
-- `to_refund_minor` was filtered to `status = 'cancelled'`. It was written
-- while thinking about cancellations, and a cancelled booking is simply not
-- the only way to end up holding more than you charge: repricing downwards,
-- removing a charge, or a customer overpaying at the counter all do it.
--
-- WORSE THAN ONE MISSING FIGURE. The account showed charged 280.50 against
-- paid 330.00 with nothing outstanding, so charged less paid came to minus
-- 49.50 and did not equal the outstanding figure printed beside it. That is
-- the identity 20261115100000 was written to restore and 20261115100200
-- claimed to keep. A test asserted it and passed, because the customer it ran
-- against had only cancelled bookings on it -- the one shape already in mind.
--
-- The four figures now derive from the same two numbers for every status:
--
--     charged     sum(charge)
--     paid        sum(amount_paid)
--     outstanding sum(greatest(charge - paid, 0))
--     to refund   sum(greatest(paid - charge, 0))
--
-- Outstanding and to-refund are one quantity split by sign, taken per booking
-- and then added up: an overpayment on one booking does not quietly settle a
-- debt on another, because nobody has moved that money. The identity is
--
--     charged - paid = outstanding - to refund
--
-- and it now holds whatever mixture of bookings a customer has.
--
-- PAID CHANGES MEANING, slightly and deliberately. It was "what the charges
-- have been paid" for a cancelled booking, via least(paid, charge), and
-- "everything received" for every other. It is now everything received,
-- throughout. A cancelled booking that took 120 against a 50 fee used to read
-- paid 50; it now reads paid 120 with 70 to refund, which is what happened.
-- It is also the only column that answers "how much has this person actually
-- given us", which is the question somebody reconciling a bank statement has.
--
-- The return type is unchanged, so this is a replace and the grants stand.
-- =============================================================================

create or replace function public.customer_financial_summary(p_customer_id uuid)
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
    -- Everything received, whatever became of the booking it was taken
    -- against. This is the figure somebody reconciling a bank statement is
    -- looking for, and the only column that answers it.
    coalesce(sum(b.amount_paid_minor), 0)::bigint,
    coalesce(sum(greatest(b.charge_minor - b.amount_paid_minor, 0)), 0)::bigint,
    coalesce(sum(b.deposit_minor) filter (where b.status in ('reserved', 'active')), 0)::bigint,
    count(*) filter (where b.status = 'cancelled'),
    coalesce(sum(greatest(b.amount_paid_minor - b.charge_minor, 0)), 0)::bigint
  from booking b
  group by b.currency
  order by b.currency;
end;
$$;

comment on function public.customer_financial_summary(uuid) is
  'A customer''s money, one row per currency. Charged is what the bookings charge, paid is everything received, and the two figures beside them are the per-booking difference split by sign: what is still owed, and what is held over and must go back. Charged less paid equals outstanding less to refund.';

revoke all on function public.customer_financial_summary(uuid) from public, anon;
grant execute on function public.customer_financial_summary(uuid) to authenticated;

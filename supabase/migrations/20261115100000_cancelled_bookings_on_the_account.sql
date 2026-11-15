-- =============================================================================
-- A cancelled booking is not a charge
-- =============================================================================
--
-- public.customer_financial_summary added every non-draft rental into
-- `charged_minor` and `paid_minor`, and then left cancelled ones out of
-- `outstanding_minor`. The customer's account therefore read:
--
--     Charged  $714.00    Paid  $0.00    Outstanding  $0.00
--
-- for somebody who owes nothing and was never going to be asked for anything.
-- Staff reading it had two reasonable conclusions available -- that the money
-- had been written off, or that the balance was wrong -- and no way to tell
-- which. The arithmetic the rest of the table invites, charged less paid, gave
-- $714 against an outstanding of nothing.
--
-- CANCELLING DOES NOT TOUCH THE CHARGES. public.rental_cancel deliberately
-- leaves the lines and the payments where they are, so a cancelled booking's
-- `total_minor` is the hire that is not happening rather than a claim on
-- anybody. Summing it into `charged_minor` states a demand that does not exist.
--
-- Cancelled bookings are now left out of `charged_minor` and `paid_minor`, so
-- those two cover exactly the bookings `outstanding_minor` already covered and
-- charged less paid is the outstanding figure beside them.
--
-- WHAT REPLACES THEM, so that nothing is merely hidden:
--
--   cancelled_count  -- the cancelled bookings in this currency, as a count
--   to_refund_minor  -- money taken against them, which the agency is holding
--                       with no charge to set it against
--
-- Both are per currency, like everything else this function returns: an agency
-- that billed in USD and now bills in EUR has two true numbers and no single
-- true number, and this product holds no exchange rate.
--
-- KNOWN LIMIT, stated rather than papered over: an agency that keeps a
-- cancellation fee has nowhere to say so yet. Whatever was paid against a
-- cancelled booking is reported as refundable in full, because the booking's
-- own lines still describe the hire that did not happen. Recording a kept fee
-- means settling those lines down to the fee, and the figure here should then
-- be the surplus over it. That is a change to cancelling, not to this read.
--
-- The return type gains two columns, which `create or replace` cannot do, so
-- this drops and recreates. The grants go with the old function and are
-- restated below.

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
  select
    r.currency,
    -- Every booking this customer has in this currency, cancelled ones
    -- included: the count is history, and history includes what fell through.
    count(*),
    coalesce(sum(r.total_minor) filter (where r.status <> 'cancelled'), 0)::bigint,
    coalesce(sum(r.amount_paid_minor) filter (where r.status <> 'cancelled'), 0)::bigint,
    coalesce(sum(r.balance_due_minor) filter (
      where r.balance_due_minor > 0 and r.status in ('reserved', 'active', 'completed')
    ), 0)::bigint,
    coalesce(sum(r.deposit_minor) filter (where r.status in ('reserved', 'active')), 0)::bigint,
    count(*) filter (where r.status = 'cancelled'),
    coalesce(sum(r.amount_paid_minor) filter (
      where r.status = 'cancelled' and r.amount_paid_minor > 0
    ), 0)::bigint
  from public.rentals r
  where r.customer_id = p_customer_id
    and r.status <> 'draft'
  group by r.currency
  order by r.currency;
end;
$$;

comment on function public.customer_financial_summary(uuid) is
  'A customer''s money, one row per currency. Charged, paid and outstanding describe the bookings that stand; a cancelled booking is not a charge, and appears instead as a count and as whatever was taken against it and is still held.';

revoke all on function public.customer_financial_summary(uuid) from public, anon;
grant execute on function public.customer_financial_summary(uuid) to authenticated;

-- =============================================================================
-- Every payment a customer has made, in one place
-- =============================================================================
--
-- Money could only ever be looked at one contract at a time. `payments` has
-- carried `customer_id` since the beginning and nothing has ever read it:
-- answering "what has this person actually paid us, and what have we given
-- back" meant opening their bookings one by one and adding up by eye.
--
-- A view rather than a function, like every other read model here, so that
-- ordering, filtering and paging stay the caller's business. security_invoker
-- means RLS on `payments` and `rentals` decides what comes back, exactly as it
-- does when the Rentals screen reads the same rows.
--
-- The join to the booking is a LEFT join on purpose. `payments.rental_id` is
-- nullable and always has been -- money held against a customer rather than a
-- contract is expressible in the schema today even though nothing writes it --
-- and a ledger that silently dropped those rows would be a ledger that does
-- not add up.
--
-- Voided payments are included, carrying `voided_at`. They are part of what
-- happened, and the screen says so rather than quietly removing them; the
-- rolled up figures on the rental already exclude them.

create or replace view public.customer_payment_ledger
with (security_invoker = true) as
select
  p.id,
  p.organization_id,
  p.customer_id,
  p.rental_id,

  p.direction,
  p.purpose,
  p.method,
  p.amount_minor,
  p.currency,
  p.paid_at,
  p.reference,
  p.notes,

  p.voided_at,
  p.void_reason,

  r.reference as rental_reference,
  r.status    as rental_status
from public.payments p
left join public.rentals r on r.id = p.rental_id;

comment on view public.customer_payment_ledger is
  'Every payment and refund on one customer''s record, across all of their contracts, with the booking each one belongs to. Voided entries are included and marked.';

revoke all on public.customer_payment_ledger from anon, authenticated;
grant select on public.customer_payment_ledger to authenticated;

-- =============================================================================
-- Public booking: deleting a lead is a manager's decision
-- =============================================================================
--
-- booking_leads_delete moves from staff to manager. Everything else staff do to
-- a lead -- contact it, decline it, convert it -- is additive or recoverable.
-- Deleting one destroys a real person's enquiry, with their name, their address
-- and whatever they wrote, and there is nothing to undo it with.
--
-- It matches the shape of the rest of the product, where the irreversible
-- actions sit above the people doing the day's work: rentals_delete and
-- customer_documents_delete are both manager, and customers_delete and
-- vehicles_delete are administrator. A lead is lighter than a customer record
-- -- an enquiry is not financial history -- so manager, not administrator.
--
-- IT DOES NOT WEAKEN THE PROMISE IN THE DPA. An agency can still act on a
-- renter's request to be forgotten; it takes a manager rather than anyone at
-- the front desk, which is the same shape as every other erasure here.
--
-- STILL NOT GATED ON BILLING, for the reason 20261113100200 gives: a restricted
-- agency is read-only for new work, and still owes a renter an erasure.

drop policy if exists booking_leads_delete on public.booking_leads;
create policy booking_leads_delete on public.booking_leads
  for delete to authenticated
  using (app.has_min_role(organization_id, 'manager'));

comment on policy booking_leads_delete on public.booking_leads is
  'Deleting an enquiry is irreversible and destroys a stranger''s personal data, so it sits with a manager rather than with staff. Deliberately not gated on billing: a restricted agency still owes a renter an erasure.';

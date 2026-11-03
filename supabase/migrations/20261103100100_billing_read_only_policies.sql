-- =============================================================================
-- Billing: the write policies learn to ask
--
-- The previous migration decided what `restricted` means. This one is what
-- makes a write actually stop.
--
-- 54 policies across 20 tables, every one of them an INSERT, UPDATE or DELETE
-- policy whose predicate was exactly `app.has_min_role(organization_id, <role>)`
-- and is now that AND `app.billing_may_write(organization_id)`. The role rules
-- are not touched. Nothing is dropped, nothing is renamed, and no policy
-- changes which command or which role it applies to.
--
-- WHAT IS DELIBERATELY NOT HERE, AND WHY
--
-- THE 44 SELECT POLICIES. Untouched, on purpose. They are the whole reason this
-- is a wind-down rather than a blackout: a restricted agency can still open
-- every customer, rental, contract, expense and document it ever recorded, run
-- every report, and export what it finds. Taking that away was considered and
-- rejected.
--
-- profiles (2 policies). A person's own name and avatar. Not agency data, not
-- bound to an organization, and a user who belongs to two agencies would
-- otherwise lose their own profile because one of them stopped paying.
--
-- organizations and organization_settings (1 policy each). An owner must keep
-- being able to correct the agency's name, address, contact details and billing
-- address while restricted -- several of those are exactly what somebody fixes
-- in order to start paying again. Locking the settings screen would be locking
-- the door on the way out.
--
-- gps_provider_credentials and gps_rate_limits (1 policy each). Already
-- `using (false) with check (false)` for every client. There is nothing to
-- restrict; they are reachable only through the service role.
--
-- organization_members, organization_invitations and the notification tables
-- have NO table-level write policies at all -- every write to them goes through
-- a SECURITY DEFINER function. Policies cannot gate what never consults them;
-- that is the next migration's job.
--
-- WHAT A BLOCKED WRITE LOOKS LIKE
--
-- An INSERT raises 42501, "new row violates row-level security policy". An
-- UPDATE or a DELETE simply matches no rows and reports zero affected, which
-- the client surfaces as "that record could not be found". Neither is a good
-- sentence to show somebody. That is a known and accepted property of gating in
-- RLS, and the reason the interface layer disables the actions and explains the
-- state before anybody can reach one of these messages. The policies are the
-- enforcement; they were never meant to be the explanation.
-- =============================================================================

set search_path = public, extensions, pg_temp;

-- ---------------------------------------------------------------------------
-- Fleet -- vehicles, their photographs, their documents, their trackers
-- ---------------------------------------------------------------------------

alter policy vehicles_insert on public.vehicles
  with check (app.has_min_role(organization_id, 'manager'::public.org_role)
              and app.billing_may_write(organization_id));

alter policy vehicles_update on public.vehicles
  using (app.has_min_role(organization_id, 'manager'::public.org_role)
         and app.billing_may_write(organization_id))
  with check (app.has_min_role(organization_id, 'manager'::public.org_role)
              and app.billing_may_write(organization_id));

alter policy vehicles_delete on public.vehicles
  using (app.has_min_role(organization_id, 'admin'::public.org_role)
         and app.billing_may_write(organization_id));

alter policy vehicle_images_insert on public.vehicle_images
  with check (app.has_min_role(organization_id, 'manager'::public.org_role)
              and app.billing_may_write(organization_id));

alter policy vehicle_images_update on public.vehicle_images
  using (app.has_min_role(organization_id, 'manager'::public.org_role)
         and app.billing_may_write(organization_id))
  with check (app.has_min_role(organization_id, 'manager'::public.org_role)
              and app.billing_may_write(organization_id));

alter policy vehicle_images_delete on public.vehicle_images
  using (app.has_min_role(organization_id, 'manager'::public.org_role)
         and app.billing_may_write(organization_id));

alter policy vehicle_documents_insert on public.vehicle_documents
  with check (app.has_min_role(organization_id, 'manager'::public.org_role)
              and app.billing_may_write(organization_id));

alter policy vehicle_documents_update on public.vehicle_documents
  using (app.has_min_role(organization_id, 'manager'::public.org_role)
         and app.billing_may_write(organization_id))
  with check (app.has_min_role(organization_id, 'manager'::public.org_role)
              and app.billing_may_write(organization_id));

alter policy vehicle_documents_delete on public.vehicle_documents
  using (app.has_min_role(organization_id, 'admin'::public.org_role)
         and app.billing_may_write(organization_id));

alter policy gps_unit_assignments_insert on public.gps_unit_assignments
  with check (app.has_min_role(organization_id, 'admin'::public.org_role)
              and app.billing_may_write(organization_id));

alter policy gps_unit_assignments_update on public.gps_unit_assignments
  using (app.has_min_role(organization_id, 'admin'::public.org_role)
         and app.billing_may_write(organization_id))
  with check (app.has_min_role(organization_id, 'admin'::public.org_role)
              and app.billing_may_write(organization_id));

-- ---------------------------------------------------------------------------
-- Customers and the identity documents held against them
-- ---------------------------------------------------------------------------

alter policy customers_insert on public.customers
  with check (app.has_min_role(organization_id, 'staff'::public.org_role)
              and app.billing_may_write(organization_id));

alter policy customers_update on public.customers
  using (app.has_min_role(organization_id, 'staff'::public.org_role)
         and app.billing_may_write(organization_id))
  with check (app.has_min_role(organization_id, 'staff'::public.org_role)
              and app.billing_may_write(organization_id));

alter policy customers_delete on public.customers
  using (app.has_min_role(organization_id, 'admin'::public.org_role)
         and app.billing_may_write(organization_id));

alter policy customer_documents_insert on public.customer_documents
  with check (app.has_min_role(organization_id, 'staff'::public.org_role)
              and app.billing_may_write(organization_id));

alter policy customer_documents_update on public.customer_documents
  using (app.has_min_role(organization_id, 'staff'::public.org_role)
         and app.billing_may_write(organization_id))
  with check (app.has_min_role(organization_id, 'staff'::public.org_role)
              and app.billing_may_write(organization_id));

alter policy customer_documents_delete on public.customer_documents
  using (app.has_min_role(organization_id, 'manager'::public.org_role)
         and app.billing_may_write(organization_id));

-- ---------------------------------------------------------------------------
-- Rentals: the agreement, what it charges, who drives, the contract, the money
-- ---------------------------------------------------------------------------

alter policy rentals_insert on public.rentals
  with check (app.has_min_role(organization_id, 'staff'::public.org_role)
              and app.billing_may_write(organization_id));

alter policy rentals_update on public.rentals
  using (app.has_min_role(organization_id, 'staff'::public.org_role)
         and app.billing_may_write(organization_id))
  with check (app.has_min_role(organization_id, 'staff'::public.org_role)
              and app.billing_may_write(organization_id));

alter policy rentals_delete on public.rentals
  using (app.has_min_role(organization_id, 'manager'::public.org_role)
         and app.billing_may_write(organization_id));

alter policy rental_line_items_insert on public.rental_line_items
  with check (app.has_min_role(organization_id, 'staff'::public.org_role)
              and app.billing_may_write(organization_id));

alter policy rental_line_items_update on public.rental_line_items
  using (app.has_min_role(organization_id, 'staff'::public.org_role)
         and app.billing_may_write(organization_id))
  with check (app.has_min_role(organization_id, 'staff'::public.org_role)
              and app.billing_may_write(organization_id));

alter policy rental_line_items_delete on public.rental_line_items
  using (app.has_min_role(organization_id, 'staff'::public.org_role)
         and app.billing_may_write(organization_id));

alter policy rental_drivers_insert on public.rental_drivers
  with check (app.has_min_role(organization_id, 'staff'::public.org_role)
              and app.billing_may_write(organization_id));

alter policy rental_drivers_update on public.rental_drivers
  using (app.has_min_role(organization_id, 'staff'::public.org_role)
         and app.billing_may_write(organization_id))
  with check (app.has_min_role(organization_id, 'staff'::public.org_role)
              and app.billing_may_write(organization_id));

alter policy rental_drivers_delete on public.rental_drivers
  using (app.has_min_role(organization_id, 'staff'::public.org_role)
         and app.billing_may_write(organization_id));

alter policy rental_contracts_insert on public.rental_contracts
  with check (app.has_min_role(organization_id, 'staff'::public.org_role)
              and app.billing_may_write(organization_id));

alter policy rental_contracts_update on public.rental_contracts
  using (app.has_min_role(organization_id, 'staff'::public.org_role)
         and app.billing_may_write(organization_id))
  with check (app.has_min_role(organization_id, 'staff'::public.org_role)
              and app.billing_may_write(organization_id));

alter policy rental_condition_photos_insert on public.rental_condition_photos
  with check (app.has_min_role(organization_id, 'staff'::public.org_role)
              and app.billing_may_write(organization_id));

alter policy rental_condition_photos_delete on public.rental_condition_photos
  using (app.has_min_role(organization_id, 'manager'::public.org_role)
         and app.billing_may_write(organization_id));

alter policy payments_insert on public.payments
  with check (app.has_min_role(organization_id, 'staff'::public.org_role)
              and app.billing_may_write(organization_id));

alter policy payments_update on public.payments
  using (app.has_min_role(organization_id, 'manager'::public.org_role)
         and app.billing_may_write(organization_id))
  with check (app.has_min_role(organization_id, 'manager'::public.org_role)
              and app.billing_may_write(organization_id));

alter policy payments_delete on public.payments
  using (app.has_min_role(organization_id, 'admin'::public.org_role)
         and app.billing_may_write(organization_id));

-- ---------------------------------------------------------------------------
-- Expenses and the vocabulary they are recorded against
-- ---------------------------------------------------------------------------

alter policy expenses_insert on public.expenses
  with check (app.has_min_role(organization_id, 'manager'::public.org_role)
              and app.billing_may_write(organization_id));

alter policy expenses_update on public.expenses
  using (app.has_min_role(organization_id, 'manager'::public.org_role)
         and app.billing_may_write(organization_id))
  with check (app.has_min_role(organization_id, 'manager'::public.org_role)
              and app.billing_may_write(organization_id));

alter policy expenses_delete on public.expenses
  using (app.has_min_role(organization_id, 'admin'::public.org_role)
         and app.billing_may_write(organization_id));

alter policy expense_categories_insert on public.expense_categories
  with check (app.has_min_role(organization_id, 'admin'::public.org_role)
              and app.billing_may_write(organization_id));

alter policy expense_categories_update on public.expense_categories
  using (app.has_min_role(organization_id, 'admin'::public.org_role)
         and app.billing_may_write(organization_id))
  with check (app.has_min_role(organization_id, 'admin'::public.org_role)
              and app.billing_may_write(organization_id));

alter policy expense_categories_delete on public.expense_categories
  using (app.has_min_role(organization_id, 'admin'::public.org_role)
         and app.billing_may_write(organization_id));

alter policy expense_vendors_insert on public.expense_vendors
  with check (app.has_min_role(organization_id, 'manager'::public.org_role)
              and app.billing_may_write(organization_id));

alter policy expense_vendors_update on public.expense_vendors
  using (app.has_min_role(organization_id, 'manager'::public.org_role)
         and app.billing_may_write(organization_id))
  with check (app.has_min_role(organization_id, 'manager'::public.org_role)
              and app.billing_may_write(organization_id));

alter policy expense_vendors_delete on public.expense_vendors
  using (app.has_min_role(organization_id, 'admin'::public.org_role)
         and app.billing_may_write(organization_id));

alter policy expense_attachments_insert on public.expense_attachments
  with check (app.has_min_role(organization_id, 'manager'::public.org_role)
              and app.billing_may_write(organization_id));

alter policy expense_attachments_delete on public.expense_attachments
  using (app.has_min_role(organization_id, 'manager'::public.org_role)
         and app.billing_may_write(organization_id));

-- ---------------------------------------------------------------------------
-- Vehicle financing: lenders, agreements, instalments paid, paperwork
-- ---------------------------------------------------------------------------

alter policy lenders_insert on public.lenders
  with check (app.has_min_role(organization_id, 'admin'::public.org_role)
              and app.billing_may_write(organization_id));

alter policy lenders_update on public.lenders
  using (app.has_min_role(organization_id, 'admin'::public.org_role)
         and app.billing_may_write(organization_id))
  with check (app.has_min_role(organization_id, 'admin'::public.org_role)
              and app.billing_may_write(organization_id));

alter policy lenders_delete on public.lenders
  using (app.has_min_role(organization_id, 'admin'::public.org_role)
         and app.billing_may_write(organization_id));

alter policy financing_agreements_insert on public.financing_agreements
  with check (app.has_min_role(organization_id, 'admin'::public.org_role)
              and app.billing_may_write(organization_id));

alter policy financing_agreements_update on public.financing_agreements
  using (app.has_min_role(organization_id, 'admin'::public.org_role)
         and app.billing_may_write(organization_id))
  with check (app.has_min_role(organization_id, 'admin'::public.org_role)
              and app.billing_may_write(organization_id));

alter policy financing_agreements_delete on public.financing_agreements
  using (app.has_min_role(organization_id, 'owner'::public.org_role)
         and app.billing_may_write(organization_id));

alter policy financing_payments_insert on public.financing_payments
  with check (app.has_min_role(organization_id, 'admin'::public.org_role)
              and app.billing_may_write(organization_id));

alter policy financing_payments_update on public.financing_payments
  using (app.has_min_role(organization_id, 'admin'::public.org_role)
         and app.billing_may_write(organization_id))
  with check (app.has_min_role(organization_id, 'admin'::public.org_role)
              and app.billing_may_write(organization_id));

alter policy financing_documents_insert on public.financing_documents
  with check (app.has_min_role(organization_id, 'admin'::public.org_role)
              and app.billing_may_write(organization_id));

alter policy financing_documents_delete on public.financing_documents
  using (app.has_min_role(organization_id, 'admin'::public.org_role)
         and app.billing_may_write(organization_id));
-- -----------------------------------------------------------------------------
-- Assertions
--
-- Counting is the only way to catch the failure this migration is most likely
-- to suffer: a policy added to one of these tables by a later migration, which
-- would silently be a hole in the gate. The count is checked against the write
-- policies that exist, not against a number written here, so a new policy fails
-- the migration run rather than quietly going ungated.
-- -----------------------------------------------------------------------------

do $$
declare
  v_tables      constant text[] := array[
    'vehicles', 'vehicle_images', 'vehicle_documents', 'gps_unit_assignments',
    'customers', 'customer_documents',
    'rentals', 'rental_line_items', 'rental_drivers', 'rental_contracts',
    'rental_condition_photos', 'payments',
    'expenses', 'expense_categories', 'expense_vendors', 'expense_attachments',
    'lenders', 'financing_agreements', 'financing_payments', 'financing_documents'
  ];
  v_total       integer;
  v_gated       integer;
  v_ungated     text;
begin
  select count(*) into v_total
  from pg_policies
  where schemaname = 'public'
    and tablename = any (v_tables)
    and cmd <> 'SELECT';

  select count(*) into v_gated
  from pg_policies
  where schemaname = 'public'
    and tablename = any (v_tables)
    and cmd <> 'SELECT'
    and coalesce(qual, '') || coalesce(with_check, '') like '%billing_may_write%';

  if v_total <> v_gated then
    select string_agg(tablename || '.' || policyname, ', ' order by tablename, policyname)
      into v_ungated
    from pg_policies
    where schemaname = 'public'
      and tablename = any (v_tables)
      and cmd <> 'SELECT'
      and coalesce(qual, '') || coalesce(with_check, '') not like '%billing_may_write%';

    raise exception
      'Every write policy on a tenant data table must carry the billing gate. Ungated: %', v_ungated;
  end if;

  if v_total < 54 then
    raise exception
      'Expected at least 54 gated write policies, found %. A policy has been dropped.', v_total;
  end if;

  /*
   * The other half of the same guarantee, and the more important one: NO read
   * policy may have picked the gate up. A restricted agency that cannot read is
   * the outcome this whole design exists to avoid, and it would be invisible
   * until somebody stopped paying.
   */
  if exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and cmd = 'SELECT'
      and coalesce(qual, '') like '%billing_may_write%'
  ) then
    raise exception
      'A SELECT policy carries the billing gate. The wind-down is read-only, not a blackout.';
  end if;
end;
$$;

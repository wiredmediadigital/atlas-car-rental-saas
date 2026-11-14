-- =============================================================================
-- Public booking: the table a request lands in
-- =============================================================================
--
-- A booking lead is a stranger's enquiry: their name, email, phone and a note,
-- against one vehicle and a pair of dates. It is deliberately NOT a customer and
-- NOT a draft rental. A rental cannot exist without a customer_id, and an
-- enquiry from someone an agency has never spoken to should not mint a
-- half-filled customer record carrying nobody's consent.
--
-- It therefore holds personal data about a person who is not a user of this
-- product, which decides nearly everything below: tenant isolation by composite
-- foreign key, the second factor on every read, a staff delete, a place in the
-- closure purge lists, and a retention sweep (20261113100700).
--
-- Rows arrive two ways. Staff may write one by hand under RLS. The public page
-- writes through a definer function granted to service_role alone
-- (20261113100400) -- `anon` has no grant on this table and never will.

-- -----------------------------------------------------------------------------
-- 1. The status
-- -----------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_type where typname = 'booking_lead_status' and typnamespace = 'public'::regnamespace
  ) then
    -- Enough to work a queue, fewer than a CRM. `lapsed` is for a request whose
    -- dates have passed without an answer; the retention sweep deletes, it does
    -- not relabel.
    create type public.booking_lead_status as enum (
      'new',
      'contacted',
      'converted',
      'declined',
      'lapsed'
    );
  end if;
end
$$;

-- -----------------------------------------------------------------------------
-- 2. The table
-- -----------------------------------------------------------------------------

create table if not exists public.booking_leads (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  vehicle_id      uuid not null,

  -- What the renter is told to quote back. Random, not a counter taken from
  -- organization_settings the way a contract number is: that counter is claimed
  -- with UPDATE ... RETURNING, so an unauthenticated page writing through it
  -- would serialise against every contract confirmation, and a sequential
  -- reference would publish how many requests an agency receives. Base32
  -- without the characters that are misread aloud (I, L, O, U).
  reference text not null,
  status    public.booking_lead_status not null default 'new',

  starts_at timestamptz not null,
  ends_at   timestamptz not null,

  full_name text not null check (char_length(btrim(full_name)) between 1 and 120),
  email     public.email_address not null,
  phone     text check (char_length(btrim(phone)) between 3 and 40),
  note      text check (char_length(note) <= 2000),

  -- The price as it was quoted, frozen. The rental is priced fresh at
  -- conversion from the vehicle's current rate and staff are warned when the
  -- two differ; without the snapshot there is nothing to compare, and adding
  -- these columns later is awkward under the append-only migration rule.
  currency           public.currency_code not null,
  daily_rate_minor   bigint not null check (daily_rate_minor >= 0),
  billable_days      integer not null check (billable_days between 1 and 370),
  quoted_total_minor bigint not null check (quoted_total_minor >= 0),

  converted_customer_id uuid,
  converted_rental_id   uuid,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint booking_leads_reference_key unique (organization_id, reference),

  constraint booking_leads_period_ordered check (ends_at > starts_at),

  /*
   * The tenant-carrying composite foreign keys this schema uses everywhere, so
   * that a lead in agency A is physically incapable of pointing at a vehicle,
   * customer or rental in agency B (20260813090300).
   *
   * ON DELETE RESTRICT on the vehicle, like rentals: a car with enquiries
   * against it cannot be deleted out from under them. Archiving is the ordinary
   * way a vehicle leaves the fleet and leaves leads untouched.
   *
   * The conversion pointers clear the one column rather than the whole
   * reference, so deleting a rental leaves the lead -- and its record that a
   * request was once converted -- standing. Postgres 15 and later allow naming
   * the columns a SET NULL touches, which is what makes this expressible
   * alongside a not-null organization_id.
   */
  constraint booking_leads_vehicle_fkey
    foreign key (vehicle_id, organization_id)
    references public.vehicles (id, organization_id)
    on delete restrict,

  constraint booking_leads_customer_fkey
    foreign key (converted_customer_id, organization_id)
    references public.customers (id, organization_id)
    on delete set null (converted_customer_id),

  constraint booking_leads_rental_fkey
    foreign key (converted_rental_id, organization_id)
    references public.rentals (id, organization_id)
    on delete set null (converted_rental_id),

  /*
   * `converted` is a claim about two records existing. Enforced here as well as
   * in the conversion function (20261113100500), so that a direct UPDATE cannot
   * produce a lead that says it became a rental and names none.
   */
  constraint booking_leads_converted_names_its_records check (
    case
      when status = 'converted' then converted_customer_id is not null and converted_rental_id is not null
      else true
    end
  )
);

comment on table public.booking_leads is
  'A request from an agency''s public booking page: one stranger, one vehicle, one pair of dates, and the price as quoted. Not a customer and not a rental until staff convert it. Holds personal data about a non-user, so: tenant-isolated, second-factor gated, purged with the agency, and swept after twelve months.';

comment on column public.booking_leads.reference is
  'The short code the renter is told to quote. Random, unique within the agency; deliberately not a counter, which would publish how many requests the agency receives.';
comment on column public.booking_leads.status is
  'new -> contacted -> converted | declined, or lapsed when the dates passed unanswered.';
comment on column public.booking_leads.quoted_total_minor is
  'The estimate shown to the renter: daily_rate_minor * billable_days at the moment of the request. The rental is priced fresh at conversion.';
comment on column public.booking_leads.converted_rental_id is
  'The rental this lead became, if any. Cleared rather than cascading if that rental is later deleted.';

-- The Leads list: newest first within a status, per agency.
create index if not exists booking_leads_organization_status_idx
  on public.booking_leads (organization_id, status, created_at desc);

-- The collision flag: other live leads on the same vehicle over the same dates.
create index if not exists booking_leads_vehicle_period_idx
  on public.booking_leads (organization_id, vehicle_id, starts_at, ends_at);

drop trigger if exists booking_leads_set_updated_at on public.booking_leads;
create trigger booking_leads_set_updated_at
  before update on public.booking_leads
  for each row execute function app.set_updated_at();

-- -----------------------------------------------------------------------------
-- 3. The reference
-- -----------------------------------------------------------------------------

/**
 * Fills in a missing reference with a random eight-character code.
 *
 * Crockford-style alphabet with I, L, O and U removed: 32^8 is about 1.1e12, so
 * a collision inside one agency is vanishingly unlikely, and the unique
 * constraint is what actually decides. A caller supplying its own reference
 * (the conversion tests, a migration) keeps it.
 */
create or replace function app.assign_booking_lead_reference()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_alphabet constant text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  v_code     text := '';
  v_index    integer;
begin
  if new.reference is not null and btrim(new.reference) <> '' then
    return new;
  end if;

  for v_index in 1..8 loop
    v_code := v_code || substr(v_alphabet, 1 + floor(random() * 32)::integer, 1);
  end loop;

  new.reference := 'REQ-' || v_code;
  return new;
end;
$$;

comment on function app.assign_booking_lead_reference() is
  'BEFORE INSERT trigger: gives a lead a random REQ-XXXXXXXX reference when the caller supplied none. Random rather than sequential; see the column comment.';

revoke all on function app.assign_booking_lead_reference() from public, anon, authenticated;

drop trigger if exists booking_leads_assign_reference on public.booking_leads;
create trigger booking_leads_assign_reference
  before insert on public.booking_leads
  for each row execute function app.assign_booking_lead_reference();

-- -----------------------------------------------------------------------------
-- 4. Privileges and policies
--
-- Shaped like rental_line_items: every member of the agency may read, and staff
-- and above may write. A lead is work to be done, and staff are who do it.
--
-- `anon` is granted nothing. The public page reaches this table only through a
-- definer function held by the Edge Function.
--
-- The write policies carry app.billing_may_write, like every other write policy
-- (20261103100100). A restricted agency is read-only, and that includes not
-- receiving new leads: a page still taking requests for an agency that has
-- stopped paying is a promise nobody is keeping.
-- -----------------------------------------------------------------------------

revoke all on table public.booking_leads from anon, authenticated;
grant select, insert, update, delete on table public.booking_leads to authenticated;

alter table public.booking_leads enable row level security;

drop policy if exists booking_leads_select on public.booking_leads;
create policy booking_leads_select on public.booking_leads
  for select to authenticated
  using (app.is_org_member(organization_id));

drop policy if exists booking_leads_insert on public.booking_leads;
create policy booking_leads_insert on public.booking_leads
  for insert to authenticated
  with check (app.has_min_role(organization_id, 'staff')
              and app.billing_may_write(organization_id));

drop policy if exists booking_leads_update on public.booking_leads;
create policy booking_leads_update on public.booking_leads
  for update to authenticated
  using (app.has_min_role(organization_id, 'staff')
         and app.billing_may_write(organization_id))
  with check (app.has_min_role(organization_id, 'staff')
              and app.billing_may_write(organization_id));

-- Deliberately not gated on billing: the DPA promises an agency can act on a
-- renter's erasure request, and a restricted agency still owes that.
drop policy if exists booking_leads_delete on public.booking_leads;
create policy booking_leads_delete on public.booking_leads
  for delete to authenticated
  using (app.has_min_role(organization_id, 'staff'));

-- -----------------------------------------------------------------------------
-- 5. Account closure: booking_leads is PURGED with the organization
--
-- It carries organization_id, so the purge lists must account for it or every
-- due agency's claim is refused (app.organization_purge_lists_agree). Purged,
-- not retained: it is a stranger's contact details, held for the agency's work,
-- and when the agency is gone so is the reason to hold them.
--
-- organization_purge_tables() is restated whole below with 'booking_leads'
-- added; the earlier migrations are not edited. Position matters -- the purge
-- deletes children first, and a lead references vehicles, customers and
-- rentals, so it must go before all three.
-- -----------------------------------------------------------------------------
create or replace function app.organization_purge_tables()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array[
    -- GPS
    'gps_positions', 'gps_unit_assignments', 'gps_sync_runs', 'gps_units',
    'gps_provider_credentials', 'gps_provider_connections',
    -- notifications
    'notification_preferences', 'notification_states', 'notification_events',
    -- team
    'organization_team_events', 'organization_invitations', 'organization_members',
    -- expenses
    'expense_attachments', 'expense_change_events', 'expenses',
    'expense_categories', 'expense_vendors',
    -- financing
    'financing_documents', 'financing_change_events', 'financing_payments',
    'financing_installments', 'financing_agreements', 'lenders',
    -- public booking (references vehicles, customers and rentals)
    'booking_leads',
    -- rentals and customers
    'customer_documents', 'rental_condition_photos', 'rental_contracts',
    'rental_line_items', 'rental_drivers', 'payments', 'rentals', 'customers',
    -- fleet
    'vehicle_documents', 'vehicle_images', 'vehicles',
    -- settings
    'organization_settings',
    -- security
    'security_events'
  ];
$$;

comment on function app.organization_purge_tables() is
  'Every table the account purge empties, children first. Explicit on purpose: a table added without being listed here (or in organization_retained_tables) stops the purge before it deletes anything.';

do $assert$
begin
  if not app.organization_purge_lists_agree() then
    raise exception 'booking_leads left the purge lists disagreeing with the schema: %',
      app.organization_purge_list_disagreement();
  end if;
end;
$assert$;

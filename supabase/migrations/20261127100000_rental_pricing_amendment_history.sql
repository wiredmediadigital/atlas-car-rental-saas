/**
 * Financial amendment history for the base hire.
 *
 * THE DEFECT THIS CLOSES. A charge on a committed rental could already not be
 * edited or deleted -- 20261126130000 saw to that -- but the hire itself is
 * legitimately restated by repricing and by extension, through two privileged
 * functions. Where an issued contract existed, the superseded contract version
 * preserved what the hire used to be. Where none existed, nothing did: a
 * confirmed reservation could be repriced from 1 to 15,000 and the earlier
 * figure was simply gone.
 *
 * Contract issuance is a manual act. Making financial history depend on it
 * means history exists only when somebody happened to press a button, which is
 * not a property a financial record can have. So history is recorded by the
 * pricing operation itself, and the database refuses to commit a restated hire
 * that did not record one.
 *
 * WHAT THIS IS NOT. Not a parallel ledger: the money still lives in
 * rental_line_items and rentals, and nothing here is summed, balanced or shown
 * as a total. Not an activity log: only an authorized restatement of a
 * finalized hire is recorded, by the two functions that can perform one. Not a
 * contract: no document is issued, no version is manufactured, no PDF exists.
 */

-- -----------------------------------------------------------------------------
-- What kind of amendment it was
--
-- Derived from the operation that performed it, never from inspecting the
-- numbers afterwards. A reprice that happens to add days is still a reprice.
-- -----------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_type where typname = 'rental_amendment_kind') then
    create type public.rental_amendment_kind as enum ('reprice', 'extension');
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- The record
--
-- Shaped after public.expense_change_events, which is this schema's existing
-- answer to "what changed, from what, to what, by whom and when": one row per
-- act, with the detail as a single jsonb object rather than a row per field.
--
-- The two hire amounts are real columns rather than jsonb keys because they are
-- the figures the screen reads and the ones anybody asking about this record is
-- asking about. Everything else that moved -- the dates, the duration, the day
-- rate, the tax treatment, the contract total -- lives in `changes`, in the
-- {from, to} shape expense_change_events already uses.
-- -----------------------------------------------------------------------------

create table if not exists public.rental_pricing_amendments (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  rental_id       uuid not null,

  /**
   * The hire line that was restated.
   *
   * Null where the rental had no hire line and the operation created the first
   * one, which an extension of a booking that never carried a hire charge can
   * legitimately do. The amendment is still worth recording: the previous
   * amount was nothing, and that is a fact about the contract.
   */
  line_item_id uuid,

  kind public.rental_amendment_kind not null,

  previous_amount_minor bigint not null,
  revised_amount_minor  bigint not null,

  /** Stored, not computed in the browser, so every reader gets the same sign. */
  difference_minor bigint
    generated always as (revised_amount_minor - previous_amount_minor) stored,

  currency char(3) not null,

  /**
   * `{ "ends_at": { "from": "...", "to": "..." }, "quantity": { … }, … }`
   *
   * Only the keys that actually moved. An amendment that changed the amount and
   * nothing else says so by carrying one key, which is more honest than a row
   * of nulls claiming the dates were considered.
   */
  changes jsonb not null default '{}'::jsonb,

  /**
   * The issued contract version in force when the amendment happened, or null
   * where none had been issued.
   *
   * This is the join back to the existing contract architecture. It is NOT a
   * requirement: the whole point of this table is that history no longer waits
   * for a contract.
   */
  contract_version integer,

  reason text check (reason is null or char_length(reason) <= 500),

  amended_by uuid references auth.users (id) on delete set null,

  /**
   * `clock_timestamp()`, not `now()`.
   *
   * `now()` is the transaction timestamp, so two amendments recorded in one
   * transaction would share it exactly and could not be put in order -- and
   * the order of a financial history is part of what it says. This is the wall
   * clock at the moment the row was written, which is the honest answer to
   * "when did this happen" for a record of one act.
   */
  amended_at timestamptz not null default clock_timestamp(),

  /**
   * The transaction that wrote this row.
   *
   * Not financial information. It exists so the deferred constraint below can
   * answer one question at commit time -- "did the operation that restated this
   * hire also record what it did?" -- without guessing from timestamps.
   */
  recorded_in_xact xid8 not null default pg_current_xact_id(),

  constraint rental_pricing_amendments_rental_fkey
    foreign key (rental_id, organization_id)
    references public.rentals (id, organization_id)
    on delete cascade,

  /**
   * ON DELETE SET NULL, not CASCADE. A charge line can be removed while the
   * rental is still a draft; the amendment history of a later, finalized
   * restatement must not disappear with it.
   */
  constraint rental_pricing_amendments_line_fkey
    foreign key (line_item_id, organization_id)
    references public.rental_line_items (id, organization_id)
    on delete set null,

  constraint rental_pricing_amendments_amounts_are_real
    check (previous_amount_minor >= 0 and revised_amount_minor >= 0)
);

comment on table public.rental_pricing_amendments is
  'What an authorized restatement of a finalized base hire changed, from what, to what, by whom and when. Written only by app.record_rental_pricing_amendment, which only the privileged pricing functions can call; nobody holds insert, update or delete on this table.';

create index if not exists rental_pricing_amendments_rental_idx
  on public.rental_pricing_amendments (rental_id, amended_at desc);

create index if not exists rental_pricing_amendments_organization_idx
  on public.rental_pricing_amendments (organization_id, amended_at desc);

create index if not exists rental_pricing_amendments_xact_idx
  on public.rental_pricing_amendments (rental_id, recorded_in_xact);

-- -----------------------------------------------------------------------------
-- Privileges
--
-- Read only, exactly as expense_change_events does it. There is no insert,
-- update or delete grant for any browser role, so unauthorized creation,
-- modification and deletion are refused because the privilege does not exist --
-- not because a policy declines. A policy can be loosened by a later migration
-- without anybody noticing; a missing grant cannot be used at all.
-- -----------------------------------------------------------------------------

revoke all on table public.rental_pricing_amendments from anon, authenticated;
grant select on table public.rental_pricing_amendments to authenticated;

alter table public.rental_pricing_amendments enable row level security;

drop policy if exists rental_pricing_amendments_select on public.rental_pricing_amendments;
create policy rental_pricing_amendments_select on public.rental_pricing_amendments
  for select to authenticated
  using (app.is_org_member(organization_id));

-- -----------------------------------------------------------------------------
-- Recording an amendment
--
-- Takes whole rows rather than two dozen scalars: the caller already holds the
-- rental and the hire line before and after, and passing them whole means a
-- field added to either is carried here without changing this signature.
-- -----------------------------------------------------------------------------

create or replace function app.record_rental_pricing_amendment(
  p_before_rental public.rentals,
  p_before_line   public.rental_line_items,
  p_after_rental  public.rentals,
  p_after_line    public.rental_line_items,
  p_kind          public.rental_amendment_kind,
  p_reason        text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_changes jsonb := '{}'::jsonb;
  v_version integer;
begin
  if p_after_rental.id is null then
    raise exception 'An amendment needs the rental it amended.' using errcode = '23502';
  end if;

  -- Only what moved. See the column comment on `changes`.
  if p_after_rental.starts_at is distinct from p_before_rental.starts_at then
    v_changes := v_changes || jsonb_build_object('starts_at',
      jsonb_build_object('from', p_before_rental.starts_at, 'to', p_after_rental.starts_at));
  end if;
  if p_after_rental.ends_at is distinct from p_before_rental.ends_at then
    v_changes := v_changes || jsonb_build_object('ends_at',
      jsonb_build_object('from', p_before_rental.ends_at, 'to', p_after_rental.ends_at));
  end if;
  if p_after_rental.billable_days is distinct from p_before_rental.billable_days then
    v_changes := v_changes || jsonb_build_object('billable_days',
      jsonb_build_object('from', p_before_rental.billable_days, 'to', p_after_rental.billable_days));
  end if;
  if p_after_line.quantity is distinct from p_before_line.quantity then
    v_changes := v_changes || jsonb_build_object('quantity',
      jsonb_build_object('from', p_before_line.quantity, 'to', p_after_line.quantity));
  end if;
  if p_after_line.unit_amount_minor is distinct from p_before_line.unit_amount_minor then
    v_changes := v_changes || jsonb_build_object('unit_amount_minor',
      jsonb_build_object('from', p_before_line.unit_amount_minor, 'to', p_after_line.unit_amount_minor));
  end if;
  if p_after_line.is_taxable is distinct from p_before_line.is_taxable then
    v_changes := v_changes || jsonb_build_object('is_taxable',
      jsonb_build_object('from', p_before_line.is_taxable, 'to', p_after_line.is_taxable));
  end if;
  if p_after_rental.total_minor is distinct from p_before_rental.total_minor then
    v_changes := v_changes || jsonb_build_object('total_minor',
      jsonb_build_object('from', p_before_rental.total_minor, 'to', p_after_rental.total_minor));
  end if;

  -- The contract in force, if one was ever issued. Read, never written.
  select max(c.version) into v_version
    from public.rental_contracts c
   where c.rental_id = p_after_rental.id;

  insert into public.rental_pricing_amendments (
    organization_id, rental_id, line_item_id, kind,
    previous_amount_minor, revised_amount_minor, currency,
    changes, contract_version, reason, amended_by)
  values (
    p_after_rental.organization_id,
    p_after_rental.id,
    coalesce(p_after_line.id, p_before_line.id),
    p_kind,
    coalesce(p_before_line.amount_minor, 0),
    coalesce(p_after_line.amount_minor, 0),
    p_after_rental.currency,
    v_changes,
    v_version,
    nullif(btrim(coalesce(p_reason, '')), ''),
    (select auth.uid()));
end;
$$;

comment on function app.record_rental_pricing_amendment(
  public.rentals, public.rental_line_items, public.rentals,
  public.rental_line_items, public.rental_amendment_kind, text) is
  'Records what an authorized pricing operation did to a finalized base hire. Callable only by the table owner, which in practice means only the privileged pricing functions.';

revoke all on function app.record_rental_pricing_amendment(
  public.rentals, public.rental_line_items, public.rentals,
  public.rental_line_items, public.rental_amendment_kind, text) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- The evidence requirement
--
-- A DEFERRED constraint trigger, checked at commit rather than mid-statement.
--
-- That is the whole reason it works. The pricing functions update the hire line
-- first and record the amendment immediately afterwards; an immediate check
-- would fire between the two and refuse every legitimate amendment. Deferring
-- it to commit asks the only question that matters -- did this transaction, by
-- the time it finished, leave a record of what it did to this hire? -- and a
-- future pricing path that forgets cannot commit.
--
-- Deliberately NOT folded into app.guard_rental_line_item_integrity. That guard
-- is the accepted base-hire protection from 20261126130000 and is left exactly
-- as it is.
-- -----------------------------------------------------------------------------

create or replace function app.require_rental_pricing_amendment_evidence()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Only a finalized hire whose money actually moved needs evidence. A draft
  -- is still being written; a description change is not a financial amendment.
  if new.kind <> 'base_rental'
     or new.reverses_line_item_id is not null
     or not app.rental_is_finalized(new.rental_id)
     or (new.amount_minor is not distinct from old.amount_minor
         and new.quantity is not distinct from old.quantity
         and new.unit_amount_minor is not distinct from old.unit_amount_minor
         and new.is_taxable is not distinct from old.is_taxable) then
    return new;
  end if;

  /*
   * The evidence has to describe THIS mutation, not merely exist.
   *
   * Matching on rental and transaction alone was not enough: one amendment
   * row then satisfied every hire restatement in the same transaction, so a
   * function that recorded its first change and then quietly made a second
   * committed happily. The record now has to agree with what actually
   * happened -- same rental, same agency, same charge line, and the same
   * before and after on every field that qualifies a mutation.
   *
   * `changes` carries only the keys that moved, so a key's absence is itself
   * a claim: the amendment is asserting that field did not change, and the
   * mutation has to agree.
   */
  if not exists (
    select 1 from public.rental_pricing_amendments a
     where a.recorded_in_xact  = pg_current_xact_id()
       and a.rental_id         = new.rental_id
       and a.organization_id   = new.organization_id
       and a.line_item_id      = new.id
       and a.previous_amount_minor = old.amount_minor
       and a.revised_amount_minor  = new.amount_minor
       and (case when a.changes ? 'quantity'
                 then (a.changes #>> '{quantity,from}')::numeric = old.quantity
                  and (a.changes #>> '{quantity,to}')::numeric   = new.quantity
                 else old.quantity is not distinct from new.quantity end)
       and (case when a.changes ? 'unit_amount_minor'
                 then (a.changes #>> '{unit_amount_minor,from}')::bigint = old.unit_amount_minor
                  and (a.changes #>> '{unit_amount_minor,to}')::bigint   = new.unit_amount_minor
                 else old.unit_amount_minor is not distinct from new.unit_amount_minor end)
       and (case when a.changes ? 'is_taxable'
                 then (a.changes #>> '{is_taxable,from}')::boolean = old.is_taxable
                  and (a.changes #>> '{is_taxable,to}')::boolean   = new.is_taxable
                 else old.is_taxable is not distinct from new.is_taxable end)
  ) then
    raise exception
      'The hire on a committed rental was restated without recording what changed.'
      using errcode = '23514',
            hint = 'Use public.rental_reprice or public.rental_extend, which record the amendment.';
  end if;

  return new;
end;
$$;

revoke all on function app.require_rental_pricing_amendment_evidence() from public, anon, authenticated;

drop trigger if exists rental_line_items_amendment_evidence on public.rental_line_items;
create constraint trigger rental_line_items_amendment_evidence
  after update on public.rental_line_items
  deferrable initially deferred
  for each row
  execute function app.require_rental_pricing_amendment_evidence();

-- -----------------------------------------------------------------------------
-- Account closure
--
-- app.organization_purge_tables() is explicit on purpose: its own comment warns
-- that a table added without being listed here stops the purge before it
-- deletes anything. This table references rental_line_items and rentals, so it
-- is emptied before both.
--
-- Restated from the effective definition in 20261125130000, not from the
-- original in 20261108100200, which is five tables out of date.
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
    -- expenses (expenses.maintenance_id points at a record emptied below)
    'expense_attachments', 'expense_change_events', 'expenses',
    'expense_categories', 'expense_vendors',
    -- financing
    'financing_documents', 'financing_change_events', 'financing_payments',
    'financing_installments', 'financing_agreements', 'lenders',
    -- public booking (references vehicles, customers and rentals)
    'booking_leads',
    -- maintenance and incidents: both reference vehicles with on delete
    -- restrict, so they are emptied before the fleet
    'maintenance_documents', 'maintenance_records',
    'incident_attachments', 'incidents',
    -- assignment children and assignment-scoped evidence
    'rental_assignment_corrections', 'rental_vehicle_inspections',
    'rental_assignment_backfill_anomalies',
    'rental_vehicle_assignments',
    -- rentals and customers; pricing amendments reference the charge lines
    'rental_pricing_amendments',
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

-- -----------------------------------------------------------------------------
-- The two authorized pricing paths now record what they did
--
-- Both are restated from their EFFECTIVE definitions in 20261126130000, which
-- is itself the form 20261120100000 left them in. The assignment gate below is
-- reproduced word for word: that migration rewrites every function mentioning
-- the old session GUC, in place, and a later migration restating the original
-- wording silently reverts the feature to a flag nobody sets. It has already
-- run and will not run again, so the rewritten form is the one to carry
-- forward.
--
-- Nothing else about either function changes: same signatures, same membership,
-- role, billing and state rules, same arithmetic, same refusals.
-- -----------------------------------------------------------------------------

create or replace function public.rental_extend(
  p_rental_id uuid,
  p_new_ends_at timestamptz,
  p_charge_minor bigint default 0,
  p_charge_description text default null,
  p_additional_days integer default null
)
returns public.rentals
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_rental   public.rentals;
  v_before   public.rentals;
  v_added    integer;
  v_line     public.rental_line_items;
  v_after    public.rental_line_items;
  v_quantity numeric(10, 2);
  v_amount   bigint;
begin
  select * into v_rental from public.rentals where id = p_rental_id for update;

  -- Membership and role together, and a refusal that does not confirm the
  -- rental exists: telling another agency that an id is real is itself a leak.
  if v_rental.id is null
     or (current_setting('role', true) = 'authenticated'
         and not app.has_min_role(v_rental.organization_id, 'staff'::public.org_role)) then
    raise exception 'Rental not found.' using errcode = 'P0002';
  end if;

  -- RLS used to apply this through rental_line_items_update. It does not any
  -- more, so it is asked for directly.
  perform app.billing_require_write(v_rental.organization_id);

  if v_rental.status not in ('reserved', 'active') then
    raise exception 'Only a reservation or an active rental can be extended.' using errcode = '23514';
  end if;
  if p_new_ends_at <= v_rental.ends_at then
    raise exception 'An extension must end after the current return date.' using errcode = '23514';
  end if;

  -- The rental as it stood, kept before anything moves it.
  v_before := v_rental;

  v_added := greatest(
    coalesce(p_additional_days, public.rental_billable_days(v_rental.ends_at, p_new_ends_at)), 0);

  /*
   * `app.assignment_lifecycle_active`, NOT the session GUC the original text
   * carried. 20261120100000 rewrites every function mentioning that GUC into
   * this per-organization check, in place, with a `do` block -- so a later
   * migration that re-states the old wording silently reverts the feature to a
   * session flag nobody sets, and the assignment row a reservation needs stops
   * being opened. The rewrite has already run by the time this migration does;
   * it will not run again.
   */
  if v_rental.status = 'reserved'
     and app.assignment_lifecycle_active(v_rental.organization_id) then
    perform app.sync_rental_assignment_schedule(
      p_rental_id, v_rental.vehicle_id, v_rental.starts_at, p_new_ends_at);
  end if;

  update public.rentals
     set ends_at = p_new_ends_at,
         original_ends_at = coalesce(original_ends_at, v_rental.ends_at),
         extension_count = extension_count + 1,
         billable_days = coalesce(billable_days, 0) + v_added
   where id = p_rental_id
  returning * into v_rental;

  select * into v_line from public.rental_line_items l
   where l.rental_id = p_rental_id and l.kind = 'base_rental'
   order by l.sort_order, l.created_at limit 1;

  if v_line.id is not null then
    v_quantity := v_line.quantity + v_added;
    v_amount   := v_line.amount_minor + coalesce(p_charge_minor, 0);
    update public.rental_line_items
       set quantity = v_quantity,
           amount_minor = v_amount,
           unit_amount_minor = case
             when v_quantity > 0 then round(v_amount / v_quantity)::bigint else v_amount end,
           description = round(v_quantity)::integer || ' day hire'
     where id = v_line.id
    returning * into v_after;
  elsif coalesce(p_charge_minor, 0) > 0 or v_added > 0 then
    insert into public.rental_line_items (
      organization_id, rental_id, kind, description, quantity,
      unit_amount_minor, amount_minor, currency, sort_order, created_by)
    values (
      v_rental.organization_id, p_rental_id, 'base_rental',
      greatest(v_added, 1) || ' day hire', greatest(v_added, 1),
      case when v_added > 0
        then round(coalesce(p_charge_minor, 0)::numeric / v_added)::bigint
        else coalesce(p_charge_minor, 0) end,
      coalesce(p_charge_minor, 0), v_rental.currency, 0, (select auth.uid()))
    returning * into v_after;
  end if;

  select * into v_rental from public.rentals where id = p_rental_id;

  /*
   * An extension only ever runs on a reserved or active rental, both of which
   * are past the finalization boundary, so this is unconditional.
   *
   * p_charge_description was accepted and discarded by every previous version
   * of this function. It is the reason the desk already types, so it is the
   * reason the record keeps -- no signature change, nothing new to pass.
   */
  if v_after.id is not null then
    perform app.record_rental_pricing_amendment(
      v_before, v_line, v_rental, v_after, 'extension'::public.rental_amendment_kind,
      p_charge_description);
  end if;

  return v_rental;
end;
$$;

create or replace function public.rental_reprice(p_rental_id uuid)
returns public.rentals
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_rental     public.rentals;
  v_before     public.rentals;
  v_vehicle    public.vehicles;
  v_total_days integer;
  v_extra_days integer;
  v_days       integer;
  v_amount     bigint;
  v_line       public.rental_line_items;
  v_after      public.rental_line_items;
  v_finalized  boolean;
begin
  select * into v_rental from public.rentals where id = p_rental_id for update;

  if v_rental.id is null
     or (current_setting('role', true) = 'authenticated'
         and not app.has_min_role(v_rental.organization_id, 'staff'::public.org_role)) then
    raise exception 'Rental not found.' using errcode = 'P0002';
  end if;

  perform app.billing_require_write(v_rental.organization_id);

  if v_rental.status not in ('draft', 'reserved') then
    raise exception 'Only a draft or a confirmed reservation can be repriced.'
      using errcode = '23514';
  end if;

  select * into v_vehicle from public.vehicles where id = v_rental.vehicle_id;
  if v_vehicle.id is null then
    raise exception 'That vehicle is no longer in the fleet.' using errcode = 'P0002';
  end if;
  if v_vehicle.currency <> v_rental.currency then
    raise exception 'That vehicle is priced in %, and this rental is in %.',
      v_vehicle.currency, v_rental.currency using errcode = '23514';
  end if;

  -- Asked before the hire moves, because afterwards a draft that was confirmed
  -- in the same transaction would answer differently.
  v_before    := v_rental;
  v_finalized := app.rental_is_finalized(p_rental_id);

  v_total_days := coalesce(
    nullif(v_rental.billable_days, 0),
    public.rental_billable_days(v_rental.starts_at, v_rental.ends_at));

  select * into v_line from public.rental_line_items l
   where l.rental_id = p_rental_id and l.kind = 'base_rental'
   order by l.sort_order, l.created_at limit 1;

  select coalesce(sum(l.quantity), 0)::integer into v_extra_days
    from public.rental_line_items l
   where l.rental_id = p_rental_id and l.kind = 'base_rental'
     and (v_line.id is null or l.id <> v_line.id);

  v_days := v_total_days - v_extra_days;

  if v_days <= 0 then
    raise exception
      'The extensions on this booking already cover % of its % days. Adjust the charges by hand.',
      v_extra_days, v_total_days using errcode = '23514';
  end if;

  v_amount := v_vehicle.daily_rate_minor * v_days;

  if v_line.id is not null then
    update public.rental_line_items
       set description = v_days || ' day hire',
           quantity = v_days,
           unit_amount_minor = v_vehicle.daily_rate_minor,
           amount_minor = v_amount
     where id = v_line.id
    returning * into v_after;
  else
    insert into public.rental_line_items (
      organization_id, rental_id, kind, description, quantity,
      unit_amount_minor, amount_minor, currency, sort_order, created_by)
    values (
      v_rental.organization_id, p_rental_id, 'base_rental',
      v_days || ' day hire', v_days,
      v_vehicle.daily_rate_minor, v_amount, v_rental.currency, 0, (select auth.uid()))
    returning * into v_after;
  end if;

  update public.rentals set daily_rate_minor = v_vehicle.daily_rate_minor
   where id = p_rental_id;

  select * into v_rental from public.rentals where id = p_rental_id;

  /*
   * A draft is still being written and records no amendment history, which is
   * the existing business rule and is left alone. A confirmed reservation is
   * past the finalization boundary, and this is precisely the case that had no
   * history before: no contract need exist for the previous hire to survive.
   */
  if v_finalized and v_after.id is not null then
    perform app.record_rental_pricing_amendment(
      v_before, v_line, v_rental, v_after, 'reprice'::public.rental_amendment_kind, null);
  end if;

  return v_rental;
end;
$$;

revoke all on function public.rental_extend(uuid, timestamptz, bigint, text, integer)
  from public, anon;
grant execute on function public.rental_extend(uuid, timestamptz, bigint, text, integer)
  to authenticated, service_role;

revoke all on function public.rental_reprice(uuid) from public, anon;
grant execute on function public.rental_reprice(uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- The pricing inputs of a committed rental
--
-- The charge LINES have been protected since 20261126130000. The figures those
-- charges are computed FROM were not. A staff member could PATCH
-- public.rentals directly and, on a completed rental, change the day rate, the
-- tax rate, the currency, the deposit, the billable days, the return date and
-- even the customer the hire belongs to. Nothing refused it, because
-- rentals_update asks only for a role and a billing entitlement and says
-- nothing about the state of the rental.
--
-- That does not move money by itself -- the charge lines still say what was
-- charged -- which is precisely why it is worth closing. It desynchronises the
-- booking from the contract silently, and the screen that compares them only
-- looks while the rental is a draft or a reservation.
--
-- WHO IS WRITING, AGAIN. The same discriminator as the charge guard: a
-- SECURITY DEFINER function owned by the table's owner runs with `current_user`
-- set to that owner, and a signed-in role cannot become the owner. So this
-- trigger is SECURITY INVOKER -- as a definer it would run as its own owner
-- whoever wrote the row, and `current_user` would be a constant that said
-- nothing.
--
-- WHY THE EXEMPTION IS SAFE HERE, which had to be checked rather than assumed.
-- Only five rental functions are SECURITY DEFINER: rental_extend,
-- rental_reprice, rental_reschedule, rental_substitute_vehicle and
-- rental_swap_vehicle. Each takes the rental row FOR UPDATE and checks tenant
-- membership, the staff role and app.billing_require_write before it writes.
-- Every other lifecycle RPC -- confirm, check-out, check-in, complete, cancel --
-- is SECURITY INVOKER and runs as the caller, so an owner-only exemption would
-- have broken all of them. They are unaffected because they write only status,
-- picked_up_at, returned_at and original_ends_at, none of which is frozen here.
-- -----------------------------------------------------------------------------

create or replace function app.guard_rental_pricing_inputs()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_owner text;
  v_field text;
begin
  select pg_catalog.pg_get_userbyid(c.relowner) into v_owner
    from pg_catalog.pg_class c
   where c.oid = 'public.rentals'::regclass;

  -- An authorized pricing or scheduling function, running as the table owner.
  if current_user = v_owner then
    return new;
  end if;

  -- A draft is still being written. Editing one is the normal way to build a
  -- booking, and nothing has been agreed with anybody yet.
  if old.status = 'draft' then
    return new;
  end if;

  /*
   * An agency being purged is allowed to take its records apart. The purge
   * runs as the caller, so without this it would be refused halfway.
   */
  if app.rental_charges_purge_exempt(old.id) then
    return new;
  end if;

  v_field := case
    when new.starts_at        is distinct from old.starts_at        then 'collection date'
    when new.ends_at          is distinct from old.ends_at          then 'return date'
    when new.billable_days    is distinct from old.billable_days    then 'number of days charged'
    when new.daily_rate_minor is distinct from old.daily_rate_minor then 'day rate'
    when new.tax_rate_bps     is distinct from old.tax_rate_bps     then 'tax rate'
    when new.currency         is distinct from old.currency         then 'currency'
    when new.deposit_minor    is distinct from old.deposit_minor    then 'deposit'
    when new.customer_id      is distinct from old.customer_id      then 'customer'
    when new.vehicle_id       is distinct from old.vehicle_id       then 'vehicle'
    else null
  end;

  if v_field is not null then
    raise exception
      'The % of a committed rental cannot be changed directly.', v_field
      using errcode = '42501',
            hint = 'Reschedule, substitute the vehicle, extend or reprice the rental instead.';
  end if;

  /*
   * A finished rental's hand-over record is history too.
   *
   * Only checked in the terminal states, because that is the whole point:
   * rental_check_out and rental_check_in are SECURITY INVOKER and legitimately
   * write these columns -- but they do so on a reserved or active rental. Once
   * the hire is completed or called off, the odometer and fuel readings are
   * what the vehicle was handed over at, and nothing should be quietly
   * rewriting them.
   */
  if old.status in ('completed', 'cancelled') then
    v_field := case
      when new.picked_up_at           is distinct from old.picked_up_at           then 'collection time'
      when new.returned_at            is distinct from old.returned_at            then 'return time'
      when new.pickup_odometer        is distinct from old.pickup_odometer        then 'odometer out'
      when new.return_odometer        is distinct from old.return_odometer        then 'odometer in'
      when new.pickup_fuel_percent    is distinct from old.pickup_fuel_percent    then 'fuel out'
      when new.return_fuel_percent    is distinct from old.return_fuel_percent    then 'fuel in'
      else null
    end;

    if v_field is not null then
      raise exception
        'The % of a finished rental cannot be changed directly.', v_field
        using errcode = '42501',
              hint = 'The hand-over record of a completed or cancelled rental is history.';
    end if;
  end if;

  return new;
end;
$$;

comment on function app.guard_rental_pricing_inputs() is
  'Refuses a direct client change to the figures a committed rental is priced from. SECURITY INVOKER on purpose: current_user has to name the real writer, so that the authorized SECURITY DEFINER pricing functions are the only exemption.';

revoke all on function app.guard_rental_pricing_inputs() from public, anon, authenticated;

/*
 * Fires before rentals_freeze_columns, which restores rather than refuses.
 * Trigger order is alphabetical, and "guard_pricing_inputs" sorts before
 * "rentals_freeze_columns" only by accident of naming, so the name is chosen
 * deliberately: both run, and a refusal is a refusal whichever fires first.
 */
drop trigger if exists rentals_guard_pricing_inputs on public.rentals;
create trigger rentals_guard_pricing_inputs
  before update on public.rentals
  for each row
  execute function app.guard_rental_pricing_inputs();

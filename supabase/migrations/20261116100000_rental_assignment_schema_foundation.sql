-- =============================================================================
-- 20261116100000_rental_assignment_schema_foundation.sql
--
-- Phase 1B-01: additive schema foundation for historical vehicle assignments.
--
-- This migration deliberately does not backfill rentals, alter lifecycle RPCs,
-- alter the existing rentals_no_vehicle_overlap constraint, or enable active
-- swaps. Assignment writes are introduced in a later slice.
-- =============================================================================

set search_path = public, extensions, pg_temp;

-- -----------------------------------------------------------------------------
-- Controlled assignment and inspection vocabulary
-- -----------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_type
    where typname = 'rental_assignment_state'
      and typnamespace = 'public'::regnamespace
  ) then
    create type public.rental_assignment_state as enum (
      'planned',
      'reserved',
      'in_custody',
      'swap_pending',
      'released',
      'superseded_before_pickup',
      'cancelled'
    );
  end if;

  if not exists (
    select 1 from pg_type
    where typname = 'rental_assignment_reason'
      and typnamespace = 'public'::regnamespace
  ) then
    create type public.rental_assignment_reason as enum (
      'initial',
      'pre_checkout_swap',
      'active_swap',
      'breakdown',
      'damage',
      'customer_request',
      'maintenance',
      'availability',
      'other'
    );
  end if;

  if not exists (
    select 1 from pg_type
    where typname = 'rental_inspection_phase'
      and typnamespace = 'public'::regnamespace
  ) then
    create type public.rental_inspection_phase as enum (
      'pickup',
      'swap_out',
      'swap_in',
      'return'
    );
  end if;
end
$$;

-- -----------------------------------------------------------------------------
-- Historical vehicle assignments
-- -----------------------------------------------------------------------------

create table if not exists public.rental_vehicle_assignments (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid not null references public.organizations (id) on delete cascade,
  rental_id            uuid not null,
  vehicle_id           uuid not null,

  sequence_no          integer not null check (sequence_no >= 1),
  state                public.rental_assignment_state not null default 'planned',
  reason               public.rental_assignment_reason not null default 'initial',
  reason_notes         text check (reason_notes is null or char_length(reason_notes) <= 2000),

  -- The scheduled commitment protects availability. It is not physical custody.
  scheduled_starts_at  timestamptz not null,
  scheduled_ends_at    timestamptz not null,

  -- Actual custody may be null for a planned/reserved or legacy assignment.
  started_at           timestamptz,
  ended_at             timestamptz,

  pickup_odometer      integer check (pickup_odometer is null or pickup_odometer >= 0),
  return_odometer      integer check (return_odometer is null or return_odometer >= 0),
  pickup_fuel_percent  smallint check (pickup_fuel_percent is null or pickup_fuel_percent between 0 and 100),
  return_fuel_percent  smallint check (return_fuel_percent is null or return_fuel_percent between 0 and 100),

  assigned_by          uuid references auth.users (id) on delete set null,
  released_by          uuid references auth.users (id) on delete set null,

  -- Row-local derived state used by the assignment exclusion constraint.
  -- It is not client writable and is intentionally not inferred from custody.
  blocks_availability  boolean not null default false,

  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  constraint rental_vehicle_assignments_tenant_key
    unique (id, organization_id),
  constraint rental_vehicle_assignments_rental_key
    unique (id, organization_id, rental_id),
  constraint rental_vehicle_assignments_sequence_key
    unique (rental_id, sequence_no),
  constraint rental_vehicle_assignments_period_valid
    check (scheduled_ends_at > scheduled_starts_at),
  constraint rental_vehicle_assignments_actual_period_valid
    check (ended_at is null or started_at is null or ended_at >= started_at),
  constraint rental_vehicle_assignments_odometer_progression
    check (return_odometer is null or pickup_odometer is null or return_odometer >= pickup_odometer),
  constraint rental_vehicle_assignments_state_shape
    check (
      (state = 'in_custody' and started_at is not null and ended_at is null)
      or (state = 'swap_pending' and started_at is not null and ended_at is null)
      or (state in ('planned', 'reserved', 'superseded_before_pickup', 'cancelled'))
      or state = 'released'
    ),
  constraint rental_vehicle_assignments_nonblocking_terminal
    check (
      state not in ('cancelled', 'superseded_before_pickup')
      or not blocks_availability
    ),
  constraint rental_vehicle_assignments_rental_fkey
    foreign key (rental_id, organization_id)
    references public.rentals (id, organization_id)
    on delete cascade,
  constraint rental_vehicle_assignments_vehicle_fkey
    foreign key (vehicle_id, organization_id)
    references public.vehicles (id, organization_id)
    on delete restrict
);

comment on table public.rental_vehicle_assignments is
  'Append-only operational history of vehicles committed to or physically used by a rental.';
comment on column public.rental_vehicle_assignments.scheduled_starts_at is
  'Start of the vehicle commitment interval used for availability; not necessarily physical handover.';
comment on column public.rental_vehicle_assignments.started_at is
  'Actual physical custody start. Null means the vehicle was not handed over or the legacy fact is absent.';
comment on column public.rental_vehicle_assignments.blocks_availability is
  'Protected row-local predicate input for the assignment availability exclusion constraint.';

create index if not exists rental_vehicle_assignments_rental_idx
  on public.rental_vehicle_assignments (rental_id, sequence_no);
create index if not exists rental_vehicle_assignments_vehicle_schedule_idx
  on public.rental_vehicle_assignments (organization_id, vehicle_id, scheduled_starts_at, scheduled_ends_at);
create index if not exists rental_vehicle_assignments_open_custody_idx
  on public.rental_vehicle_assignments (rental_id)
  where state in ('in_custody', 'swap_pending');

-- btree_gist is installed by the foundation migration and supplies the UUID
-- equality operator needed by this exclusion constraint.
create extension if not exists btree_gist with schema extensions;

alter table public.rental_vehicle_assignments
  add constraint rental_vehicle_assignments_no_overlap
  exclude using gist (
    vehicle_id with =,
    tstzrange(scheduled_starts_at, scheduled_ends_at, '[)') with &&
  ) where (blocks_availability);

-- -----------------------------------------------------------------------------
-- Assignment mutation protection
--
-- Ordinary clients receive no assignment write grants in this slice. This
-- trigger also prevents an accidental future direct update from rewriting
-- protected history. Later lifecycle RPCs may use SET LOCAL app.assignment_write
-- only after their own tenant/role checks; the session setting is not the
-- authorization boundary.
-- -----------------------------------------------------------------------------

create or replace function app.guard_rental_vehicle_assignment_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
     or new.organization_id is distinct from old.organization_id
     or new.rental_id is distinct from old.rental_id
     or new.vehicle_id is distinct from old.vehicle_id
     or new.sequence_no is distinct from old.sequence_no
     or new.created_at is distinct from old.created_at then
    raise exception 'Assignment identity is immutable.' using errcode = '23514';
  end if;

  if coalesce(current_setting('app.assignment_write', true), '') <> 'on'
     and (
       new.state is distinct from old.state
       or new.reason is distinct from old.reason
       or new.reason_notes is distinct from old.reason_notes
       or new.scheduled_starts_at is distinct from old.scheduled_starts_at
       or new.scheduled_ends_at is distinct from old.scheduled_ends_at
       or new.started_at is distinct from old.started_at
       or new.ended_at is distinct from old.ended_at
       or new.pickup_odometer is distinct from old.pickup_odometer
       or new.return_odometer is distinct from old.return_odometer
       or new.pickup_fuel_percent is distinct from old.pickup_fuel_percent
       or new.return_fuel_percent is distinct from old.return_fuel_percent
       or new.assigned_by is distinct from old.assigned_by
       or new.released_by is distinct from old.released_by
       or new.blocks_availability is distinct from old.blocks_availability
     ) then
    raise exception 'Assignment history is writable only through an authorized lifecycle path.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists rental_vehicle_assignments_set_updated_at
  on public.rental_vehicle_assignments;
create trigger rental_vehicle_assignments_set_updated_at
  before update on public.rental_vehicle_assignments
  for each row execute function app.set_updated_at();

drop trigger if exists rental_vehicle_assignments_guard_update
  on public.rental_vehicle_assignments;
create trigger rental_vehicle_assignments_guard_update
  before update on public.rental_vehicle_assignments
  for each row execute function app.guard_rental_vehicle_assignment_update();

revoke all on table public.rental_vehicle_assignments from anon, authenticated;
grant select on table public.rental_vehicle_assignments to authenticated;

alter table public.rental_vehicle_assignments enable row level security;

drop policy if exists rental_vehicle_assignments_select
  on public.rental_vehicle_assignments;
create policy rental_vehicle_assignments_select
  on public.rental_vehicle_assignments
  for select to authenticated
  using (app.is_org_member(organization_id));

-- -----------------------------------------------------------------------------
-- Assignment-linked inspections
-- -----------------------------------------------------------------------------

create table if not exists public.rental_vehicle_inspections (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  rental_id       uuid not null,
  assignment_id   uuid not null,
  phase           public.rental_inspection_phase not null,
  inspected_at    timestamptz not null default now(),
  odometer       integer check (odometer is null or odometer >= 0),
  fuel_percent   smallint check (fuel_percent is null or fuel_percent between 0 and 100),
  notes          text check (notes is null or char_length(notes) <= 4000),
  recorded_by    uuid references auth.users (id) on delete set null,
  created_at     timestamptz not null default now(),

  constraint rental_vehicle_inspections_tenant_key
    unique (id, organization_id),
  constraint rental_vehicle_inspections_photo_key
    unique (id, organization_id, rental_id, assignment_id),
  constraint rental_vehicle_inspections_rental_fkey
    foreign key (rental_id, organization_id)
    references public.rentals (id, organization_id)
    on delete cascade,
  constraint rental_vehicle_inspections_assignment_fkey
    foreign key (assignment_id, organization_id, rental_id)
    references public.rental_vehicle_assignments (id, organization_id, rental_id)
    on delete restrict,
  constraint rental_vehicle_inspections_immutable_key
    unique (assignment_id, phase)
);

comment on table public.rental_vehicle_inspections is
  'Assignment-owned inspection headers. Existing rental-level condition phases remain unchanged.';

create index if not exists rental_vehicle_inspections_assignment_idx
  on public.rental_vehicle_inspections (assignment_id, inspected_at);

revoke all on table public.rental_vehicle_inspections from anon, authenticated;
grant select on table public.rental_vehicle_inspections to authenticated;

alter table public.rental_vehicle_inspections enable row level security;

drop policy if exists rental_vehicle_inspections_select
  on public.rental_vehicle_inspections;
create policy rental_vehicle_inspections_select
  on public.rental_vehicle_inspections
  for select to authenticated
  using (app.is_org_member(organization_id));

-- -----------------------------------------------------------------------------
-- Append-only correction/anomaly records. No client write path is enabled here.
-- -----------------------------------------------------------------------------

create table if not exists public.rental_assignment_corrections (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.organizations (id) on delete cascade,
  assignment_id      uuid not null,
  field_name         text not null check (char_length(btrim(field_name)) between 1 and 80),
  original_value     jsonb not null,
  proposed_value     jsonb not null,
  reason             text not null check (char_length(btrim(reason)) between 1 and 2000),
  evidence_reference text check (evidence_reference is null or char_length(evidence_reference) <= 512),
  recorded_by        uuid references auth.users (id) on delete set null,
  approved_by        uuid references auth.users (id) on delete set null,
  created_at         timestamptz not null default now(),

  constraint rental_assignment_corrections_assignment_fkey
    foreign key (assignment_id, organization_id)
    references public.rental_vehicle_assignments (id, organization_id)
    on delete restrict
);

comment on table public.rental_assignment_corrections is
  'Append-only proposals for correcting assignment facts; no operational correction RPC exists in Phase 1B-01.';

revoke all on table public.rental_assignment_corrections from anon, authenticated;
grant select on table public.rental_assignment_corrections to authenticated;

alter table public.rental_assignment_corrections enable row level security;

drop policy if exists rental_assignment_corrections_select
  on public.rental_assignment_corrections;
create policy rental_assignment_corrections_select
  on public.rental_assignment_corrections
  for select to authenticated
  using (app.is_org_member(organization_id));

-- -----------------------------------------------------------------------------
-- Backward-compatible condition-photo links
-- -----------------------------------------------------------------------------

alter table public.rental_condition_photos
  add column if not exists assignment_id uuid,
  add column if not exists inspection_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'rental_condition_photos_assignment_fkey'
      and conrelid = 'public.rental_condition_photos'::regclass
  ) then
    alter table public.rental_condition_photos
      add constraint rental_condition_photos_assignment_fkey
      foreign key (assignment_id, organization_id, rental_id)
      references public.rental_vehicle_assignments (id, organization_id, rental_id)
      on delete restrict;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'rental_condition_photos_inspection_fkey'
      and conrelid = 'public.rental_condition_photos'::regclass
  ) then
    alter table public.rental_condition_photos
      add constraint rental_condition_photos_inspection_fkey
      foreign key (inspection_id, organization_id, rental_id, assignment_id)
      references public.rental_vehicle_inspections (id, organization_id, rental_id, assignment_id)
      on delete restrict;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'rental_condition_photos_link_shape'
      and conrelid = 'public.rental_condition_photos'::regclass
  ) then
    alter table public.rental_condition_photos
      add constraint rental_condition_photos_link_shape
      check (inspection_id is null or assignment_id is not null);
  end if;
end
$$;

-- Existing rental photos remain valid with both new references null. If a photo
-- is linked to an inspection, its legacy pickup/return phase must match the
-- inspection phase. Swap inspections intentionally cannot receive a legacy
-- rental_condition_phase photo until a later additive photo-phase migration.
create or replace function app.guard_rental_condition_photo_links()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_phase public.rental_inspection_phase;
begin
  if new.inspection_id is null then
    return new;
  end if;

  select i.phase
    into v_phase
  from public.rental_vehicle_inspections i
  where i.id = new.inspection_id
    and i.organization_id = new.organization_id
    and i.rental_id = new.rental_id
    and i.assignment_id = new.assignment_id;

  if v_phase is null then
    raise exception 'Inspection does not belong to this organization, rental, and assignment.'
      using errcode = '23503';
  end if;

  if v_phase::text <> new.phase::text then
    raise exception 'Condition photo phase does not match the inspection phase.'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists rental_condition_photos_guard_links
  on public.rental_condition_photos;
create trigger rental_condition_photos_guard_links
  before insert or update of organization_id, rental_id, phase, assignment_id, inspection_id
  on public.rental_condition_photos
  for each row execute function app.guard_rental_condition_photo_links();

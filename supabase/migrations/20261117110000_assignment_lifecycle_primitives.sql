-- =============================================================================
-- 20261117110000_assignment_lifecycle_primitives.sql
--
-- Phase 1B-03 Slice 1: shared assignment lifecycle primitives only.
-- Public rental lifecycle RPCs are intentionally unchanged in this slice.
-- =============================================================================

set search_path = public, extensions, pg_temp;

-- A private idempotency ledger gives future active-swap and amendment RPCs a
-- durable request key without making the historical assignment row mutable.
create table if not exists app.rental_assignment_operations (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  rental_id       uuid not null,
  operation_kind  text not null check (char_length(btrim(operation_kind)) between 1 and 80),
  operation_key   uuid not null,
  assignment_id   uuid,
  created_at      timestamptz not null default now(),

  primary key (organization_id, operation_kind, operation_key),
  constraint rental_assignment_operations_rental_fkey
    foreign key (rental_id, organization_id)
    references public.rentals (id, organization_id)
    on delete cascade,
  constraint rental_assignment_operations_assignment_fkey
    foreign key (assignment_id, organization_id)
    references public.rental_vehicle_assignments (id, organization_id)
    on delete restrict
);

revoke all on table app.rental_assignment_operations from public, anon, authenticated;
alter table app.rental_assignment_operations enable row level security;

comment on table app.rental_assignment_operations is
  'Private idempotency ledger for future assignment lifecycle mutations; accessed only by validated app primitives.';

-- A rental pointer may move only to the current assignment selected by the
-- rental state. The transaction-local setting is a write-path marker, not an
-- authorization boundary: the primitive still validates tenant, role, locks,
-- assignment ownership, and state before changing the pointer.
create or replace function app.guard_rental_vehicle_pointer_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current_assignment_id uuid;
begin
  if new.vehicle_id is not distinct from old.vehicle_id then
    return new;
  end if;

  -- Slice 1 installs the guard but leaves it disabled by default so existing
  -- public lifecycle RPCs remain backward-compatible until Slice 2 dual-write
  -- paths are deployed. Assignment-aware transactions enable it locally.
  if coalesce(pg_catalog.current_setting('app.assignment_lifecycle_enabled', true), '') <> 'on' then
    return new;
  end if;

  if coalesce(pg_catalog.current_setting('app.assignment_write', true), '') <> 'on' then
    raise exception 'Rental vehicle changes are writable only through an assignment-aware lifecycle path.'
      using errcode = '42501';
  end if;

  select a.id
    into v_current_assignment_id
  from public.rental_vehicle_assignments a
  where a.rental_id = new.id
    and a.organization_id = new.organization_id
    and a.vehicle_id = new.vehicle_id
    and (
      (new.status = 'draft' and a.state = 'planned')
      or (new.status = 'reserved' and a.state = 'reserved')
      or (new.status = 'active' and a.state in ('in_custody', 'swap_pending', 'released'))
      or (new.status = 'completed' and a.state = 'released')
      or (new.status = 'cancelled' and a.state in ('planned', 'reserved', 'cancelled', 'superseded_before_pickup'))
    )
  order by a.sequence_no desc
  limit 1;

  if v_current_assignment_id is null then
    raise exception 'Rental vehicle pointer must match the current assignment.'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists rentals_guard_vehicle_pointer on public.rentals;
create trigger rentals_guard_vehicle_pointer
  before update of vehicle_id on public.rentals
  for each row execute function app.guard_rental_vehicle_pointer_update();

-- Resolve the current assignment using the rental state and highest sequence.
-- This is SECURITY INVOKER so authenticated callers remain subject to RLS.
create or replace function app.resolve_current_rental_assignment(p_rental_id uuid)
returns public.rental_vehicle_assignments
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_rental     public.rentals;
  v_assignment public.rental_vehicle_assignments;
begin
  select * into v_rental
  from public.rentals
  where id = p_rental_id;

  if v_rental.id is null or not app.is_org_member(v_rental.organization_id) then
    raise exception 'Rental not found.' using errcode = 'P0002';
  end if;

  select a.* into v_assignment
  from public.rental_vehicle_assignments a
  where a.rental_id = v_rental.id
    and a.organization_id = v_rental.organization_id
    and (
      (v_rental.status = 'draft' and a.state = 'planned')
      or (v_rental.status = 'reserved' and a.state = 'reserved')
      or (v_rental.status = 'active' and a.state in ('in_custody', 'swap_pending', 'released'))
      or (v_rental.status = 'completed' and a.state = 'released')
      or (v_rental.status = 'cancelled' and a.state in ('planned', 'reserved', 'cancelled', 'superseded_before_pickup'))
    )
  order by a.sequence_no desc
  limit 1;

  if v_assignment.id is null then
    raise exception 'Current rental assignment not found.' using errcode = 'P0002';
  end if;
  return v_assignment;
end;
$$;

-- The rental row is the serialization point for sequence allocation. This
-- prevents two concurrent lifecycle calls for one rental from choosing the
-- same next sequence number.
create or replace function app.allocate_rental_assignment_sequence(p_rental_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rental public.rentals;
  v_next   integer;
begin
  select * into v_rental
  from public.rentals
  where id = p_rental_id
  for update;

  if v_rental.id is null or not app.has_min_role(v_rental.organization_id, 'staff'::public.org_role) then
    raise exception 'Rental not found.' using errcode = 'P0002';
  end if;

  select coalesce(max(a.sequence_no), 0) + 1
    into v_next
  from public.rental_vehicle_assignments a
  where a.rental_id = v_rental.id
    and a.organization_id = v_rental.organization_id;

  return v_next;
end;
$$;

-- Open a planned/reserved assignment. The operation key is optional for
-- compatibility but future mutating paths should always provide one.
create or replace function app.open_rental_assignment(
  p_rental_id     uuid,
  p_vehicle_id    uuid,
  p_state         public.rental_assignment_state,
  p_reason        public.rental_assignment_reason,
  p_reason_notes  text default null,
  p_operation_key uuid default null
)
returns public.rental_vehicle_assignments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rental     public.rentals;
  v_vehicle    public.vehicles;
  v_assignment public.rental_vehicle_assignments;
  v_existing   app.rental_assignment_operations;
  v_sequence   integer;
begin
  select * into v_rental
  from public.rentals
  where id = p_rental_id
  for update;

  if v_rental.id is null or not app.has_min_role(v_rental.organization_id, 'staff'::public.org_role) then
    raise exception 'Rental not found.' using errcode = 'P0002';
  end if;
  if p_state not in ('planned', 'reserved') then
    raise exception 'Only planned or reserved assignments can be opened.' using errcode = '23514';
  end if;
  if (v_rental.status = 'draft' and p_state <> 'planned')
     or (v_rental.status = 'reserved' and p_state <> 'reserved') then
    raise exception 'Assignment state must match the rental lifecycle state.' using errcode = '23514';
  end if;
  if v_rental.status not in ('draft', 'reserved') then
    raise exception 'Only draft or reserved rentals can open an assignment.' using errcode = '23514';
  end if;

  if p_operation_key is not null then
    select * into v_existing
    from app.rental_assignment_operations o
    where o.organization_id = v_rental.organization_id
      and o.operation_kind = 'assignment_open'
      and o.operation_key = p_operation_key;
    if v_existing.assignment_id is not null then
      select * into v_assignment
      from public.rental_vehicle_assignments
      where id = v_existing.assignment_id
        and organization_id = v_rental.organization_id;
      if v_assignment.id is null then
        raise exception 'Idempotency record has no assignment.' using errcode = '23514';
      end if;
      if v_assignment.rental_id <> p_rental_id
         or v_assignment.vehicle_id <> p_vehicle_id
         or v_assignment.state <> p_state
         or v_assignment.reason <> p_reason
         or v_assignment.reason_notes is distinct from p_reason_notes then
        raise exception 'Idempotency key payload does not match the original assignment request.'
          using errcode = '23505';
      end if;
      return v_assignment;
    elsif v_existing.rental_id is not null and v_existing.rental_id <> p_rental_id then
      raise exception 'Idempotency key is already used for another rental.' using errcode = '23505';
    end if;
  end if;

  select * into v_vehicle
  from public.vehicles
  where id = p_vehicle_id
    and organization_id = v_rental.organization_id
  for update;

  if v_vehicle.id is null then
    raise exception 'Vehicle not found.' using errcode = 'P0002';
  end if;
  if v_vehicle.archived_at is not null or v_vehicle.status <> 'available' then
    raise exception 'Vehicle is not available.' using errcode = '23514';
  end if;

  select coalesce(max(a.sequence_no), 0) + 1 into v_sequence
  from public.rental_vehicle_assignments a
  where a.rental_id = v_rental.id
    and a.organization_id = v_rental.organization_id;

  insert into public.rental_vehicle_assignments (
    organization_id, rental_id, vehicle_id, sequence_no, state, reason,
    reason_notes, scheduled_starts_at, scheduled_ends_at, blocks_availability
  )
  values (
    v_rental.organization_id, v_rental.id, v_vehicle.id, v_sequence, p_state,
    p_reason, p_reason_notes, v_rental.starts_at, v_rental.ends_at,
    p_state = 'reserved'
  )
  returning * into v_assignment;

  if p_operation_key is not null then
    insert into app.rental_assignment_operations (
      organization_id, rental_id, operation_kind, operation_key, assignment_id
    ) values (
      v_rental.organization_id, v_rental.id, 'assignment_open', p_operation_key, v_assignment.id
    );
  end if;

  return v_assignment;
end;
$$;

-- Apply a legal state transition and its custody readings. Availability is
-- deliberately true for released assignments: checked-in active rentals stay
-- unavailable until completion clears the flag in a later lifecycle slice.
create or replace function app.transition_rental_assignment(
  p_assignment_id       uuid,
  p_to_state            public.rental_assignment_state,
  p_at                  timestamptz default now(),
  p_pickup_odometer     integer default null,
  p_pickup_fuel_percent smallint default null,
  p_return_odometer     integer default null,
  p_return_fuel_percent smallint default null
)
returns public.rental_vehicle_assignments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_assignment public.rental_vehicle_assignments;
  v_rental     public.rentals;
  v_allowed    boolean := false;
begin
  -- Every mutating primitive locks the rental first. The assignment identifier
  -- is used only to locate the rental; the second query acquires the assignment
  -- lock after the rental serialization point is held.
  select r.* into v_rental
  from public.rentals r
  join public.rental_vehicle_assignments a
    on a.rental_id = r.id
   and a.organization_id = r.organization_id
  where a.id = p_assignment_id
  for update of r;
  if v_rental.id is null then
    raise exception 'Assignment not found.' using errcode = 'P0002';
  end if;

  select * into v_assignment
  from public.rental_vehicle_assignments
  where id = p_assignment_id
  for update;
  if v_assignment.id is null then
    raise exception 'Assignment not found.' using errcode = 'P0002';
  end if;

  if v_rental.organization_id <> v_assignment.organization_id
     or not app.has_min_role(v_assignment.organization_id, 'staff'::public.org_role) then
    raise exception 'Assignment not found.' using errcode = 'P0002';
  end if;

  v_allowed :=
    (v_assignment.state = p_to_state)
    or (v_assignment.state = 'planned' and p_to_state in ('reserved', 'cancelled', 'superseded_before_pickup'))
    or (v_assignment.state = 'reserved' and p_to_state in ('in_custody', 'cancelled', 'superseded_before_pickup'))
    or (v_assignment.state = 'in_custody' and p_to_state in ('swap_pending', 'released'))
    or (v_assignment.state = 'swap_pending' and p_to_state in ('in_custody', 'released'));

  if not v_allowed then
    raise exception 'Invalid assignment transition from % to %.', v_assignment.state, p_to_state
      using errcode = '23514';
  end if;

  if p_to_state = 'in_custody' and p_pickup_odometer is null then
    raise exception 'Pickup odometer is required for custody.' using errcode = '23514';
  end if;
  if p_to_state = 'released' and v_assignment.state in ('in_custody', 'swap_pending')
     and p_return_odometer is null then
    raise exception 'Return odometer is required to release custody.' using errcode = '23514';
  end if;
  if p_pickup_odometer is not null and p_pickup_odometer < 0
     or p_return_odometer is not null and p_return_odometer < 0 then
    raise exception 'Assignment odometer readings must be nonnegative.' using errcode = '23514';
  end if;

  perform pg_catalog.set_config('app.assignment_write', 'on', true);
  update public.rental_vehicle_assignments
     set state = p_to_state,
         started_at = case when p_to_state = 'in_custody' then coalesce(started_at, p_at) else started_at end,
         ended_at = case when p_to_state = 'released' then coalesce(ended_at, p_at) else ended_at end,
         pickup_odometer = coalesce(p_pickup_odometer, pickup_odometer),
         pickup_fuel_percent = coalesce(p_pickup_fuel_percent, pickup_fuel_percent),
         return_odometer = coalesce(p_return_odometer, return_odometer),
         return_fuel_percent = coalesce(p_return_fuel_percent, return_fuel_percent),
         blocks_availability = case
           when p_to_state in ('planned', 'cancelled', 'superseded_before_pickup') then false
           when p_to_state in ('reserved', 'in_custody', 'swap_pending', 'released') then true
           else blocks_availability
         end
   where id = v_assignment.id
   returning * into v_assignment;
  perform pg_catalog.set_config('app.assignment_write', 'off', true);

  return v_assignment;
end;
$$;

-- Synchronize the legacy pointer to a validated current assignment.
create or replace function app.sync_rental_vehicle_pointer(
  p_rental_id    uuid,
  p_assignment_id uuid
)
returns public.rentals
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rental     public.rentals;
  v_assignment public.rental_vehicle_assignments;
  v_current    uuid;
begin
  select * into v_rental from public.rentals where id = p_rental_id for update;
  if v_rental.id is null or not app.has_min_role(v_rental.organization_id, 'staff'::public.org_role) then
    raise exception 'Rental not found.' using errcode = 'P0002';
  end if;

  select * into v_assignment
  from public.rental_vehicle_assignments
  where id = p_assignment_id
    and rental_id = v_rental.id
    and organization_id = v_rental.organization_id
  for update;
  if v_assignment.id is null then
    raise exception 'Assignment does not belong to rental.' using errcode = '23503';
  end if;

  select a.id into v_current
  from public.rental_vehicle_assignments a
  where a.rental_id = v_rental.id
    and a.organization_id = v_rental.organization_id
    and (
      (v_rental.status = 'draft' and a.state = 'planned')
      or (v_rental.status = 'reserved' and a.state = 'reserved')
      or (v_rental.status = 'active' and a.state in ('in_custody', 'swap_pending', 'released'))
      or (v_rental.status = 'completed' and a.state = 'released')
      or (v_rental.status = 'cancelled' and a.state in ('planned', 'reserved', 'cancelled', 'superseded_before_pickup'))
    )
  order by a.sequence_no desc
  limit 1;
  if v_current is null or v_current <> v_assignment.id then
    raise exception 'Assignment is not the current rental assignment.' using errcode = '23514';
  end if;

  perform pg_catalog.set_config('app.assignment_write', 'on', true);
  update public.rentals
     set vehicle_id = v_assignment.vehicle_id
   where id = v_rental.id
   returning * into v_rental;
  perform pg_catalog.set_config('app.assignment_write', 'off', true);
  return v_rental;
end;
$$;

revoke all on function app.resolve_current_rental_assignment(uuid) from public, anon;
revoke all on function app.allocate_rental_assignment_sequence(uuid) from public, anon;
revoke all on function app.open_rental_assignment(uuid, uuid, public.rental_assignment_state, public.rental_assignment_reason, text, uuid) from public, anon;
revoke all on function app.transition_rental_assignment(uuid, public.rental_assignment_state, timestamptz, integer, smallint, integer, smallint) from public, anon;
revoke all on function app.sync_rental_vehicle_pointer(uuid, uuid) from public, anon;
revoke all on function app.guard_rental_vehicle_pointer_update() from public, anon, authenticated;

grant execute on function app.resolve_current_rental_assignment(uuid) to authenticated, service_role;
grant execute on function app.allocate_rental_assignment_sequence(uuid) to authenticated, service_role;
grant execute on function app.open_rental_assignment(uuid, uuid, public.rental_assignment_state, public.rental_assignment_reason, text, uuid) to authenticated, service_role;
grant execute on function app.transition_rental_assignment(uuid, public.rental_assignment_state, timestamptz, integer, smallint, integer, smallint) to authenticated, service_role;
grant execute on function app.sync_rental_vehicle_pointer(uuid, uuid) to authenticated, service_role;

comment on function app.resolve_current_rental_assignment(uuid) is
  'Resolves the tenant-visible current assignment from rental state and sequence.';
comment on function app.allocate_rental_assignment_sequence(uuid) is
  'Allocates the next assignment sequence while serializing on the rental row.';
comment on function app.open_rental_assignment(uuid, uuid, public.rental_assignment_state, public.rental_assignment_reason, text, uuid) is
  'Opens a validated planned/reserved assignment and records an optional idempotency key.';
comment on function app.transition_rental_assignment(uuid, public.rental_assignment_state, timestamptz, integer, smallint, integer, smallint) is
  'Applies only legal assignment state/custody transitions and preserves checked-in availability blocking.';
comment on function app.sync_rental_vehicle_pointer(uuid, uuid) is
  'Synchronizes rentals.vehicle_id to the validated current assignment.';

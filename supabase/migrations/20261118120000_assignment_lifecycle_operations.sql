-- Phase 1B-03 Slices 3-5: assignment-aware custody, completion, and active swaps.
-- All behavior remains opt-in through app.assignment_lifecycle_enabled.
set search_path = public, extensions, pg_temp;

alter table app.rental_assignment_operations
  add column if not exists operation_payload text;

create or replace function app.record_rental_assignment_inspection(
  p_assignment_id uuid,
  p_phase public.rental_inspection_phase,
  p_inspected_at timestamptz,
  p_odometer integer,
  p_fuel_percent smallint,
  p_notes text
)
returns public.rental_vehicle_inspections
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_assignment public.rental_vehicle_assignments;
  v_inspection public.rental_vehicle_inspections;
begin
  select a.* into v_assignment
  from public.rental_vehicle_assignments a
  join public.rentals r on r.id = a.rental_id and r.organization_id = a.organization_id
  where a.id = p_assignment_id
    and app.has_min_role(a.organization_id, 'staff'::public.org_role)
  for update of a;
  if v_assignment.id is null then raise exception 'Assignment not found.' using errcode = 'P0002'; end if;

  select * into v_inspection
  from public.rental_vehicle_inspections i
  where i.assignment_id = v_assignment.id and i.phase = p_phase;
  if v_inspection.id is not null then return v_inspection; end if;

  insert into public.rental_vehicle_inspections (
    organization_id, rental_id, assignment_id, phase, inspected_at,
    odometer, fuel_percent, notes, recorded_by
  ) values (
    v_assignment.organization_id, v_assignment.rental_id, v_assignment.id,
    p_phase, coalesce(p_inspected_at, now()), p_odometer, p_fuel_percent,
    p_notes, (select auth.uid())
  ) returning * into v_inspection;
  return v_inspection;
end;
$$;

create or replace function app.complete_rental_assignment(p_rental_id uuid)
returns public.rental_vehicle_assignments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rental public.rentals;
  v_assignment public.rental_vehicle_assignments;
begin
  select r.* into v_rental from public.rentals r where r.id = p_rental_id for update;
  if v_rental.id is null or not app.has_min_role(v_rental.organization_id, 'staff'::public.org_role) then
    raise exception 'Rental not found.' using errcode = 'P0002';
  end if;
  select a.* into v_assignment
  from public.rental_vehicle_assignments a
  where a.rental_id = v_rental.id and a.organization_id = v_rental.organization_id
    and a.state = 'released'
  order by a.sequence_no desc limit 1 for update;
  if v_assignment.id is null then raise exception 'Released rental assignment not found.' using errcode = 'P0002'; end if;

  perform pg_catalog.set_config('app.assignment_write', 'on', true);
  update public.rental_vehicle_assignments
     set blocks_availability = false
   where id = v_assignment.id
   returning * into v_assignment;
  perform pg_catalog.set_config('app.assignment_write', 'off', true);
  return v_assignment;
end;
$$;

revoke all on function app.record_rental_assignment_inspection(uuid, public.rental_inspection_phase, timestamptz, integer, smallint, text) from public, anon;
revoke all on function app.complete_rental_assignment(uuid) from public, anon;
grant execute on function app.record_rental_assignment_inspection(uuid, public.rental_inspection_phase, timestamptz, integer, smallint, text) to authenticated, service_role;
grant execute on function app.complete_rental_assignment(uuid) to authenticated, service_role;

create or replace function public.rental_check_out(
  p_rental_id uuid,
  p_odometer integer,
  p_fuel_percent smallint default null,
  p_notes text default null,
  p_picked_up_at timestamptz default null
)
returns public.rentals language plpgsql set search_path = public, pg_temp as $$
declare
  v_rental public.rentals;
  v_vehicle public.vehicles;
  v_assignment public.rental_vehicle_assignments;
  v_at timestamptz := coalesce(p_picked_up_at, now());
begin
  select * into v_rental from public.rentals where id = p_rental_id for update;
  if v_rental.id is null then raise exception 'Rental not found.' using errcode = 'P0002'; end if;
  if v_rental.status <> 'reserved' then raise exception 'Only a confirmed reservation can be checked out.' using errcode = '23514'; end if;
  if p_odometer is null or p_odometer < 0 then raise exception 'Record the odometer reading at hand-over.' using errcode = '23514'; end if;
  select * into v_vehicle from public.vehicles where id = v_rental.vehicle_id for update;
  if p_odometer < v_vehicle.odometer then raise exception 'The odometer reading (%) is below the vehicle''s recorded mileage (%). Correct the vehicle''s odometer first if it is wrong.', p_odometer, v_vehicle.odometer using errcode = '23514'; end if;
  if coalesce(current_setting('app.assignment_lifecycle_enabled', true), '') = 'on' then
    select a.* into v_assignment from public.rental_vehicle_assignments a where a.rental_id=p_rental_id and a.organization_id=v_rental.organization_id and a.state='reserved' order by a.sequence_no desc limit 1;
    if v_assignment.id is null then raise exception 'Current reserved rental assignment not found.' using errcode='P0002'; end if;
    perform app.transition_rental_assignment(v_assignment.id, 'in_custody', v_at, p_odometer, p_fuel_percent);
  end if;
  update public.vehicles set odometer=p_odometer, odometer_updated_at=now() where id=v_rental.vehicle_id;
  update public.rentals set status='active', picked_up_at=v_at, pickup_odometer=p_odometer, pickup_fuel_percent=p_fuel_percent, pickup_condition_notes=p_notes, pickup_recorded_by=(select auth.uid()) where id=p_rental_id returning * into v_rental;
  if coalesce(current_setting('app.assignment_lifecycle_enabled', true), '') = 'on' then
    perform app.record_rental_assignment_inspection(v_assignment.id, 'pickup', v_at, p_odometer, p_fuel_percent, p_notes);
  end if;
  return v_rental;
end; $$;

create or replace function public.rental_check_in(
  p_rental_id uuid,
  p_odometer integer,
  p_fuel_percent smallint default null,
  p_notes text default null,
  p_returned_at timestamptz default null
)
returns public.rentals language plpgsql set search_path = public, pg_temp as $$
declare
  v_rental public.rentals;
  v_assignment public.rental_vehicle_assignments;
  v_at timestamptz := coalesce(p_returned_at, now());
begin
  select * into v_rental from public.rentals where id=p_rental_id for update;
  if v_rental.id is null then raise exception 'Rental not found.' using errcode='P0002'; end if;
  if v_rental.status <> 'active' then raise exception 'Only a rental that is out with a customer can be returned.' using errcode='23514'; end if;
  if p_odometer is null or p_odometer < 0 then raise exception 'Record the odometer reading at return.' using errcode='23514'; end if;
  if p_odometer < v_rental.pickup_odometer then raise exception 'The return reading (%) is below the reading at hand-over (%).',p_odometer,v_rental.pickup_odometer using errcode='23514'; end if;
  if coalesce(current_setting('app.assignment_lifecycle_enabled',true),'')='on' then
    select a.* into v_assignment from public.rental_vehicle_assignments a where a.rental_id=p_rental_id and a.organization_id=v_rental.organization_id and a.state in ('in_custody','swap_pending') order by a.sequence_no desc limit 1;
    if v_assignment.id is null then raise exception 'Current custody assignment not found.' using errcode='P0002'; end if;
    perform app.transition_rental_assignment(v_assignment.id,'released',v_at,null,null,p_odometer,p_fuel_percent);
  end if;
  update public.vehicles set odometer=greatest(odometer,p_odometer),odometer_updated_at=now() where id=v_rental.vehicle_id;
  update public.rentals set returned_at=v_at,return_odometer=p_odometer,return_fuel_percent=p_fuel_percent,return_condition_notes=p_notes,return_recorded_by=(select auth.uid()) where id=p_rental_id returning * into v_rental;
  if coalesce(current_setting('app.assignment_lifecycle_enabled',true),'')='on' then perform app.record_rental_assignment_inspection(v_assignment.id,'return',v_at,p_odometer,p_fuel_percent,p_notes); end if;
  return v_rental;
end; $$;

create or replace function public.rental_complete(p_rental_id uuid)
returns public.rentals language plpgsql set search_path = public, pg_temp as $$
declare v_rental public.rentals;
begin
  select * into v_rental from public.rentals where id=p_rental_id for update;
  if v_rental.id is null then raise exception 'Rental not found.' using errcode='P0002'; end if;
  if v_rental.status <> 'active' then raise exception 'Only an active rental can be completed.' using errcode='23514'; end if;
  if v_rental.returned_at is null or v_rental.return_odometer is null then raise exception 'Record the vehicle''s return before completing this rental.' using errcode='23514'; end if;
  if v_rental.deposit_held_minor > 0 then raise exception 'A deposit of % is still held. Refund it before completing the rental.',v_rental.deposit_held_minor using errcode='23514'; end if;
  if coalesce(current_setting('app.assignment_lifecycle_enabled',true),'')='on' then perform app.complete_rental_assignment(p_rental_id); end if;
  update public.rentals set status='completed',completed_at=now() where id=p_rental_id returning * into v_rental;
  return v_rental;
end; $$;

create or replace function public.rental_swap_vehicle(
  p_rental_id uuid,
  p_vehicle_id uuid,
  p_reason public.rental_assignment_reason,
  p_reason_notes text,
  p_swap_at timestamptz,
  p_odometer integer,
  p_fuel_percent smallint,
  p_consent_reference text,
  p_operation_key uuid
)
returns public.rentals
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_rental public.rentals;
  v_current public.rental_vehicle_assignments;
  v_new public.rental_vehicle_assignments;
  v_vehicle public.vehicles;
  v_existing app.rental_assignment_operations;
  v_payload text;
  v_sequence integer;
  v_at timestamptz := coalesce(p_swap_at, now());
begin
  select * into v_rental from public.rentals where id=p_rental_id for update;
  if v_rental.id is null or (current_setting('role',true)='authenticated' and not app.has_min_role(v_rental.organization_id,'manager'::public.org_role)) then raise exception 'Rental not found.' using errcode='P0002'; end if;
  if v_rental.status <> 'active' then raise exception 'Only an active rental can be swapped.' using errcode='23514'; end if;
  if p_reason is null or p_reason = 'initial' or p_reason = 'pre_checkout_swap' then raise exception 'An active swap reason is required.' using errcode='23514'; end if;
  if nullif(btrim(p_reason_notes),'') is null then raise exception 'Active swap reason notes are required.' using errcode='23514'; end if;
  if p_consent_reference is null and p_reason not in ('breakdown','damage','maintenance') then raise exception 'Customer consent evidence is required.' using errcode='23514'; end if;
  if p_odometer is null or p_odometer < 0 then raise exception 'Record the swap odometer.' using errcode='23514'; end if;

  v_payload := p_vehicle_id::text || '|' || p_reason::text || '|' || p_reason_notes || '|' || v_at::text || '|' || p_odometer::text || '|' || coalesce(p_fuel_percent::text,'') || '|' || coalesce(p_consent_reference,'');
  select * into v_existing from app.rental_assignment_operations o where o.organization_id=v_rental.organization_id and o.operation_kind='active_swap' and o.operation_key=p_operation_key;
  if v_existing.assignment_id is not null then
    if v_existing.rental_id<>p_rental_id or v_existing.operation_payload is distinct from v_payload then raise exception 'Idempotency key payload does not match the original active swap.' using errcode='23505'; end if;
    return v_rental;
  end if;
  if p_vehicle_id = v_rental.vehicle_id then raise exception 'The replacement vehicle must differ from the current vehicle.' using errcode='23514'; end if;

  select a.* into v_current from public.rental_vehicle_assignments a where a.rental_id=p_rental_id and a.organization_id=v_rental.organization_id and a.state in ('in_custody','swap_pending') order by a.sequence_no desc limit 1 for update;
  if v_current.id is null then raise exception 'Current custody assignment not found.' using errcode='P0002'; end if;
  select v.* into v_vehicle from public.vehicles v where v.id=p_vehicle_id and v.organization_id=v_rental.organization_id for update;
  if v_vehicle.id is null then raise exception 'Vehicle not found.' using errcode='P0002'; end if;
  if v_vehicle.archived_at is not null or v_vehicle.status<>'available' then raise exception 'Replacement vehicle is not available.' using errcode='23514'; end if;
  if v_vehicle.currency<>v_rental.currency then raise exception 'Replacement vehicle currency does not match the rental.' using errcode='23514'; end if;
  if p_odometer < v_vehicle.odometer then raise exception 'The swap odometer is below the replacement vehicle mileage.' using errcode='23514'; end if;

  perform pg_catalog.set_config('app.assignment_write','on',true);
  update public.rental_vehicle_assignments set state='released', ended_at=v_at, return_odometer=p_odometer, return_fuel_percent=p_fuel_percent, blocks_availability=false, released_by=(select auth.uid()) where id=v_current.id;
  select coalesce(max(a.sequence_no), 0) + 1 into v_sequence
  from public.rental_vehicle_assignments a
  where a.rental_id = p_rental_id and a.organization_id = v_rental.organization_id;
  insert into public.rental_vehicle_assignments (
    organization_id, rental_id, vehicle_id, sequence_no, state, reason,
    reason_notes, scheduled_starts_at, scheduled_ends_at, started_at,
    pickup_odometer, pickup_fuel_percent, blocks_availability, assigned_by
  ) values (
    v_rental.organization_id, p_rental_id, p_vehicle_id, v_sequence,
    'in_custody', 'active_swap', p_reason::text || ': ' || p_reason_notes,
    v_rental.starts_at, v_rental.ends_at, v_at, p_odometer,
    p_fuel_percent, true, (select auth.uid())
  ) returning * into v_new;
  perform pg_catalog.set_config('app.assignment_write','off',true);
  insert into app.rental_assignment_operations (organization_id,rental_id,operation_kind,operation_key,assignment_id,operation_payload)
  values (v_rental.organization_id,p_rental_id,'active_swap',p_operation_key,v_new.id,v_payload);
  perform app.sync_rental_vehicle_pointer(p_rental_id,v_new.id);
  perform app.record_rental_assignment_inspection(v_current.id,'swap_out',v_at,p_odometer,p_fuel_percent,p_reason_notes);
  perform app.record_rental_assignment_inspection(v_new.id,'swap_in',v_at,p_odometer,p_fuel_percent,p_reason_notes);
  update public.vehicles set odometer=greatest(odometer,p_odometer),odometer_updated_at=now() where id=p_vehicle_id;
  update public.rentals set vehicle_id=p_vehicle_id where id=p_rental_id returning * into v_rental;
  return v_rental;
end;
$$;

revoke all on function public.rental_swap_vehicle(uuid,uuid,public.rental_assignment_reason,text,timestamptz,integer,smallint,text,uuid) from public, anon;
grant execute on function public.rental_swap_vehicle(uuid,uuid,public.rental_assignment_reason,text,timestamptz,integer,smallint,text,uuid) to authenticated;

create or replace function public.rental_assignment_history(p_rental_id uuid)
returns table (
  assignment_id uuid,
  vehicle_id uuid,
  registration_plate text,
  state public.rental_assignment_state,
  reason public.rental_assignment_reason,
  scheduled_starts_at timestamptz,
  scheduled_ends_at timestamptz,
  started_at timestamptz,
  ended_at timestamptz,
  blocks_availability boolean,
  inspection_count bigint
)
language sql
security invoker
set search_path = public, pg_temp
as $$
  select a.id, a.vehicle_id, v.registration_plate, a.state, a.reason,
         a.scheduled_starts_at, a.scheduled_ends_at, a.started_at, a.ended_at,
         a.blocks_availability,
         (select count(*) from public.rental_vehicle_inspections i where i.assignment_id = a.id)
  from public.rental_vehicle_assignments a
  join public.rentals r on r.id = a.rental_id and r.organization_id = a.organization_id
  join public.vehicles v on v.id = a.vehicle_id and v.organization_id = a.organization_id
  where a.rental_id = p_rental_id
  order by a.sequence_no;
$$;

revoke all on function public.rental_assignment_history(uuid) from public, anon;
grant execute on function public.rental_assignment_history(uuid) to authenticated, service_role;

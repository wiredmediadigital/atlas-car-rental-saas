-- =============================================================================
-- 20261120220000_rental_lifecycle_billing_authorization.sql
--
-- STG-03: close the SECURITY DEFINER billing bypass in the three assignment-era
-- rental mutation RPCs. Billing is checked only after the rental is found and
-- the caller's role is authorized, so a cross-tenant identifier still returns
-- the existing not-found response rather than disclosing billing state.
-- =============================================================================

set search_path = public, extensions, pg_temp;

create or replace function public.rental_substitute_vehicle(
  p_rental_id uuid,
  p_vehicle_id uuid
)
returns public.rentals
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_rental public.rentals;
  v_vehicle public.vehicles;
  v_old public.rental_vehicle_assignments;
  v_new public.rental_vehicle_assignments;
  v_state public.rental_assignment_state;
begin
  select * into v_rental from public.rentals where id = p_rental_id for update;
  if v_rental.id is null
     or (current_setting('role', true) = 'authenticated'
         and not app.has_min_role(v_rental.organization_id, 'staff'::public.org_role)) then
    raise exception 'Rental not found.' using errcode = 'P0002';
  end if;
  perform app.billing_require_write(v_rental.organization_id);
  if v_rental.status not in ('draft', 'reserved') then
    raise exception 'The vehicle can only be changed before the customer collects it.' using errcode = '23514';
  end if;
  select * into v_vehicle from public.vehicles where id = p_vehicle_id;
  if v_vehicle.id is null or v_vehicle.organization_id <> v_rental.organization_id then
    raise exception 'Vehicle not found.' using errcode = 'P0002';
  end if;
  if v_vehicle.archived_at is not null then
    raise exception 'That vehicle has been retired from the fleet.' using errcode = '23514';
  end if;
  if v_vehicle.status <> 'available' then
    raise exception 'That vehicle is not in service.' using errcode = '23514';
  end if;
  if v_vehicle.currency <> v_rental.currency then
    raise exception 'That vehicle is priced in %, and this rental is in %.', v_vehicle.currency, v_rental.currency using errcode = '23514';
  end if;
  if coalesce(current_setting('app.assignment_lifecycle_enabled', true), '') = 'on' then
    v_state := case when v_rental.status = 'draft' then 'planned'::public.rental_assignment_state else 'reserved'::public.rental_assignment_state end;
    select * into v_old from public.rental_vehicle_assignments
      where rental_id = p_rental_id and organization_id = v_rental.organization_id and state = v_state
      order by sequence_no desc limit 1 for update;
    if v_old.id is not null and v_old.vehicle_id <> p_vehicle_id then
      perform app.transition_rental_assignment(v_old.id, 'superseded_before_pickup', now());
    end if;
    if v_old.id is null or v_old.vehicle_id <> p_vehicle_id then
      v_new := app.open_rental_assignment(p_rental_id, p_vehicle_id, v_state, 'pre_checkout_swap', 'Vehicle substituted');
      perform app.sync_rental_vehicle_pointer(p_rental_id, v_new.id);
    end if;
  end if;
  update public.rentals
     set vehicle_id = p_vehicle_id, daily_rate_minor = v_vehicle.daily_rate_minor
   where id = p_rental_id
  returning * into v_rental;
  return v_rental;
end;
$$;

create or replace function public.rental_reschedule(
  p_rental_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_vehicle_id uuid default null,
  p_amend_contract boolean default false
)
returns public.rentals
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_rental public.rentals;
  v_vehicle public.vehicles;
  v_target uuid;
  v_contract public.rental_contracts;
begin
  select * into v_rental from public.rentals where id = p_rental_id for update;
  if v_rental.id is null
     or (current_setting('role', true) = 'authenticated'
         and not app.has_min_role(v_rental.organization_id, 'staff'::public.org_role)) then
    raise exception 'Rental not found.' using errcode = 'P0002';
  end if;
  perform app.billing_require_write(v_rental.organization_id);
  if v_rental.status not in ('draft', 'reserved') then
    raise exception 'Only a draft or a confirmed reservation can be rescheduled. Extend or return this rental instead.' using errcode = '23514';
  end if;
  if p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at then
    raise exception 'The return must be after the collection.' using errcode = '23514';
  end if;
  v_target := coalesce(p_vehicle_id, v_rental.vehicle_id);
  if v_target <> v_rental.vehicle_id then
    select * into v_vehicle from public.vehicles where id = v_target;
    if v_vehicle.id is null or v_vehicle.organization_id <> v_rental.organization_id then
      raise exception 'Vehicle not found.' using errcode = 'P0002';
    end if;
    if v_vehicle.archived_at is not null then
      raise exception 'That vehicle has been retired from the fleet.' using errcode = '23514';
    end if;
    if v_vehicle.status <> 'available' then
      raise exception 'That vehicle is not in service.' using errcode = '23514';
    end if;
  end if;
  select * into v_contract from public.rental_contracts
    where rental_id = p_rental_id and status in ('issued', 'signed')
    order by version desc limit 1;
  if v_contract.id is not null and not p_amend_contract then
    raise exception 'Contract % states this booking. Rescheduling it requires issuing a new version.', v_contract.contract_number using errcode = '23514';
  end if;
  if coalesce(current_setting('app.assignment_lifecycle_enabled', true), '') = 'on' then
    perform app.sync_rental_assignment_schedule(p_rental_id, v_target, p_starts_at, p_ends_at);
  end if;
  update public.rentals
     set starts_at = p_starts_at, ends_at = p_ends_at, vehicle_id = v_target,
         original_ends_at = p_ends_at,
         billable_days = public.rental_billable_days(p_starts_at, p_ends_at)
   where id = p_rental_id
  returning * into v_rental;
  if v_contract.id is not null then
    perform public.rental_issue_contract(p_rental_id, 'Rescheduled');
  end if;
  return v_rental;
end;
$$;

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
  select * into v_rental from public.rentals where id = p_rental_id for update;
  if v_rental.id is null
     or (current_setting('role', true) = 'authenticated'
         and not app.has_min_role(v_rental.organization_id, 'manager'::public.org_role)) then
    raise exception 'Rental not found.' using errcode = 'P0002';
  end if;
  perform app.billing_require_write(v_rental.organization_id);
  if v_rental.status <> 'active' then
    raise exception 'Only an active rental can be swapped.' using errcode = '23514';
  end if;
  if p_reason is null or p_reason in ('initial', 'pre_checkout_swap') then
    raise exception 'An active swap reason is required.' using errcode = '23514';
  end if;
  if nullif(btrim(p_reason_notes), '') is null then
    raise exception 'Active swap reason notes are required.' using errcode = '23514';
  end if;
  if p_consent_reference is null and p_reason not in ('breakdown', 'damage', 'maintenance') then
    raise exception 'Customer consent evidence is required.' using errcode = '23514';
  end if;
  if p_odometer is null or p_odometer < 0 then
    raise exception 'Record the swap odometer.' using errcode = '23514';
  end if;
  v_payload := p_vehicle_id::text || '|' || p_reason::text || '|' || p_reason_notes || '|' || v_at::text || '|' || p_odometer::text || '|' || coalesce(p_fuel_percent::text, '') || '|' || coalesce(p_consent_reference, '');
  select * into v_existing from app.rental_assignment_operations
    where organization_id = v_rental.organization_id and operation_kind = 'active_swap' and operation_key = p_operation_key;
  if v_existing.assignment_id is not null then
    if v_existing.rental_id <> p_rental_id or v_existing.operation_payload is distinct from v_payload then
      raise exception 'Idempotency key payload does not match the original active swap.' using errcode = '23505';
    end if;
    return v_rental;
  end if;
  if p_vehicle_id = v_rental.vehicle_id then
    raise exception 'The replacement vehicle must differ from the current vehicle.' using errcode = '23514';
  end if;
  select a.* into v_current from public.rental_vehicle_assignments a
    where a.rental_id = p_rental_id and a.organization_id = v_rental.organization_id
      and a.state in ('in_custody', 'swap_pending')
    order by a.sequence_no desc limit 1 for update;
  if v_current.id is null then
    raise exception 'Current custody assignment not found.' using errcode = 'P0002';
  end if;
  select v.* into v_vehicle from public.vehicles v
    where v.id = p_vehicle_id and v.organization_id = v_rental.organization_id for update;
  if v_vehicle.id is null then raise exception 'Vehicle not found.' using errcode = 'P0002'; end if;
  if v_vehicle.archived_at is not null or v_vehicle.status <> 'available' then
    raise exception 'Replacement vehicle is not available.' using errcode = '23514';
  end if;
  if v_vehicle.currency <> v_rental.currency then
    raise exception 'Replacement vehicle currency does not match the rental.' using errcode = '23514';
  end if;
  if p_odometer < v_vehicle.odometer then
    raise exception 'The swap odometer is below the replacement vehicle mileage.' using errcode = '23514';
  end if;
  perform pg_catalog.set_config('app.assignment_write', 'on', true);
  update public.rental_vehicle_assignments
     set state = 'released', ended_at = v_at, return_odometer = p_odometer,
         return_fuel_percent = p_fuel_percent, blocks_availability = false,
         released_by = (select auth.uid())
   where id = v_current.id;
  select coalesce(max(a.sequence_no), 0) + 1 into v_sequence
    from public.rental_vehicle_assignments a
   where a.rental_id = p_rental_id and a.organization_id = v_rental.organization_id;
  insert into public.rental_vehicle_assignments
    (organization_id, rental_id, vehicle_id, sequence_no, state, reason,
     reason_notes, scheduled_starts_at, scheduled_ends_at, started_at,
     pickup_odometer, pickup_fuel_percent, blocks_availability, assigned_by)
  values
    (v_rental.organization_id, p_rental_id, p_vehicle_id, v_sequence,
     'in_custody', 'active_swap', p_reason::text || ': ' || p_reason_notes,
     v_rental.starts_at, v_rental.ends_at, v_at, p_odometer,
     p_fuel_percent, true, (select auth.uid()))
  returning * into v_new;
  perform pg_catalog.set_config('app.assignment_write', 'off', true);
  insert into app.rental_assignment_operations
    (organization_id, rental_id, operation_kind, operation_key, assignment_id, operation_payload)
  values (v_rental.organization_id, p_rental_id, 'active_swap', p_operation_key, v_new.id, v_payload);
  perform app.sync_rental_vehicle_pointer(p_rental_id, v_new.id);
  perform app.record_rental_assignment_inspection(v_current.id, 'swap_out', v_at, p_odometer, p_fuel_percent, p_reason_notes);
  perform app.record_rental_assignment_inspection(v_new.id, 'swap_in', v_at, p_odometer, p_fuel_percent, p_reason_notes);
  update public.vehicles set odometer = greatest(odometer, p_odometer), odometer_updated_at = now() where id = p_vehicle_id;
  update public.rentals set vehicle_id = p_vehicle_id where id = p_rental_id returning * into v_rental;
  return v_rental;
end;
$$;

revoke all on function public.rental_substitute_vehicle(uuid, uuid) from public, anon;
grant execute on function public.rental_substitute_vehicle(uuid, uuid) to authenticated;
revoke all on function public.rental_reschedule(uuid, timestamptz, timestamptz, uuid, boolean) from public, anon;
grant execute on function public.rental_reschedule(uuid, timestamptz, timestamptz, uuid, boolean) to authenticated;
revoke all on function public.rental_swap_vehicle(uuid, uuid, public.rental_assignment_reason, text, timestamptz, integer, smallint, text, uuid) from public, anon;
grant execute on function public.rental_swap_vehicle(uuid, uuid, public.rental_assignment_reason, text, timestamptz, integer, smallint, text, uuid) to authenticated;

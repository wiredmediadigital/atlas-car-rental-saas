-- =============================================================================
-- 20261118100000_rental_pointer_security_remediation.sql
--
-- Phase 1B-03 Slice 1 pointer security remediation.
-- Authenticated clients retain the existing rental RPCs and all non-pointer
-- rental column updates, but cannot update rentals.vehicle_id directly.
-- This does not enable assignment-aware lifecycle behavior or dual writes.
-- =============================================================================

set search_path = public, extensions, pg_temp;

-- The pointer is writable only by controlled RPCs. Preserve the existing
-- client update surface for every non-generated, non-pointer column.
revoke update on table public.rentals from anon, authenticated;

do $$
declare
  v_columns text;
begin
  select string_agg(format('%I', c.column_name), ', ' order by c.ordinal_position)
    into v_columns
  from information_schema.columns c
  where c.table_schema = 'public'
    and c.table_name = 'rentals'
    and c.column_name <> 'vehicle_id'
    and c.is_generated = 'NEVER';

  if v_columns is null then
    raise exception 'No writable rental columns were found.';
  end if;

  execute format(
    'grant update (%s) on table public.rentals to authenticated',
    v_columns
  );
end
$$;

-- Existing public signatures remain unchanged. These two legacy RPCs are the
-- existing vehicle-pointer write paths, so they become controlled definer
-- functions after the client column privilege is removed. Explicit membership
-- and staff checks replace the RLS protection they previously received as
-- invoker functions.
create or replace function public.rental_substitute_vehicle(
  p_rental_id  uuid,
  p_vehicle_id uuid
)
returns public.rentals
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_rental  public.rentals;
  v_vehicle public.vehicles;
begin
  select * into v_rental
  from public.rentals
  where id = p_rental_id
  for update;

  if v_rental.id is null
     or (
       pg_catalog.current_setting('role', true) = 'authenticated'
       and not app.has_min_role(v_rental.organization_id, 'staff'::public.org_role)
     ) then
    raise exception 'Rental not found.' using errcode = 'P0002';
  end if;
  if v_rental.status not in ('draft', 'reserved') then
    raise exception 'The vehicle can only be changed before the customer collects it.'
      using errcode = '23514';
  end if;

  select * into v_vehicle
  from public.vehicles
  where id = p_vehicle_id;

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
    raise exception 'That vehicle is priced in %, and this rental is in %.',
      v_vehicle.currency, v_rental.currency
      using errcode = '23514';
  end if;

  update public.rentals
     set vehicle_id = p_vehicle_id,
         daily_rate_minor = v_vehicle.daily_rate_minor
   where id = p_rental_id
  returning * into v_rental;

  return v_rental;
end;
$$;

create or replace function public.rental_reschedule(
  p_rental_id uuid,
  p_starts_at timestamptz,
  p_ends_at   timestamptz,
  p_vehicle_id uuid default null,
  p_amend_contract boolean default false
)
returns public.rentals
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_rental   public.rentals;
  v_vehicle  public.vehicles;
  v_target   uuid;
  v_contract public.rental_contracts;
begin
  select * into v_rental
  from public.rentals
  where id = p_rental_id
  for update;

  if v_rental.id is null
     or (
       pg_catalog.current_setting('role', true) = 'authenticated'
       and not app.has_min_role(v_rental.organization_id, 'staff'::public.org_role)
     ) then
    raise exception 'Rental not found.' using errcode = 'P0002';
  end if;
  if v_rental.status not in ('draft', 'reserved') then
    raise exception
      'Only a draft or a confirmed reservation can be rescheduled. Extend or return this rental instead.'
      using errcode = '23514';
  end if;
  if p_starts_at is null or p_ends_at is null then
    raise exception 'A rental needs both a collection and a return time.' using errcode = '22004';
  end if;
  if p_ends_at <= p_starts_at then
    raise exception 'The return must be after the collection.' using errcode = '23514';
  end if;

  v_target := coalesce(p_vehicle_id, v_rental.vehicle_id);
  if v_target <> v_rental.vehicle_id then
    select * into v_vehicle
    from public.vehicles
    where id = v_target;

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

  select * into v_contract
  from public.rental_contracts
  where rental_id = p_rental_id and status in ('issued', 'signed')
  order by version desc
  limit 1;

  if v_contract.id is not null and not p_amend_contract then
    raise exception
      'Contract % states this booking. Rescheduling it requires issuing a new version.',
      v_contract.contract_number
      using errcode = '23514';
  end if;

  update public.rentals
     set starts_at = p_starts_at,
         ends_at = p_ends_at,
         vehicle_id = v_target,
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

revoke all on function public.rental_substitute_vehicle(uuid, uuid) from public, anon;
grant execute on function public.rental_substitute_vehicle(uuid, uuid) to authenticated;
revoke all on function public.rental_reschedule(uuid, timestamptz, timestamptz, uuid, boolean)
  from public, anon;
grant execute on function public.rental_reschedule(uuid, timestamptz, timestamptz, uuid, boolean)
  to authenticated;

comment on table public.rentals is
  'A rental contract. Authenticated clients cannot directly update vehicle_id; pointer changes use authorized RPCs.';

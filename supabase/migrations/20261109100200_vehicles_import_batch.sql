-- public.vehicles_import_batch: the bulk import as ONE transaction.
--
-- The client-side importer inserted one vehicle per call, so an agency near its
-- limit got a half-loaded fleet. This function counts the batch against the
-- agency's free slots BEFORE writing any row and refuses the whole batch if it
-- does not fit, so the message the user sees is this one and not the
-- single-vehicle sentence of app.enforce_vehicle_limit().
--
-- That trigger still fires for every row inserted here. It is the backstop
-- beneath this check and is deliberately neither detected nor bypassed: the
-- caller's auth.uid() is preserved inside this definer function, so a member is
-- gated exactly as on a direct insert.
--
-- Row shape: a JSON array of objects keyed by the vehicles column names that
-- src/features/vehicles/api.ts toRow() produces. Only the keys listed in the
-- column definition list below are read; id, organization_id, archived_at and
-- created_by cannot be supplied by the caller. A missing 'status' becomes
-- 'available' and a missing 'daily_rate_minor' becomes 0. Any row that violates
-- a table constraint aborts the whole call, so nothing half-applies.
--
-- The limit is never retroactive: an agency already over its limit simply has no
-- free slots; nothing is archived or hidden.

create or replace function public.vehicles_import_batch(p_organization_id uuid, p_rows jsonb)
returns setof public.vehicles
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer;
  v_count integer;
  v_free  integer;
  v_rows  integer;
begin
  if not app.has_min_role(p_organization_id, 'manager'::public.org_role) then
    raise exception 'You need the manager role to import vehicles.' using errcode = '42501';
  end if;

  perform app.billing_require_write(p_organization_id);

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'p_rows must be a JSON array of vehicles.' using errcode = '22023';
  end if;

  v_rows := jsonb_array_length(p_rows);
  if v_rows = 0 then
    return;
  end if;

  v_limit := app.vehicle_limit_of(p_organization_id);
  if v_limit is not null then
    -- Same lock the trigger takes, held to the end of this transaction, so the
    -- count below cannot be raced by another session adding a vehicle.
    perform 1
      from public.organizations o
     where o.id = p_organization_id
       for update;

    v_count := app.vehicle_count_of(p_organization_id);
    v_free := greatest(v_limit - v_count, 0);
    if v_rows > v_free then
      raise exception
        'This import has % vehicles but your plan has room for % more (limit %, in use %). Nothing was imported.',
        v_rows, v_free, v_limit, v_count
        using errcode = '55000';
    end if;
  end if;

  return query
  insert into public.vehicles (
    organization_id, make, model, model_year, registration_plate, vin, color,
    category, fuel_type, transmission, seats, odometer, daily_rate_minor,
    currency, status, insurance_expires_on, inspection_expires_on,
    registration_expires_on, next_service_on, notes, created_by
  )
  select
    p_organization_id, r.make, r.model, r.model_year, r.registration_plate, r.vin, r.color,
    r.category, r.fuel_type, r.transmission, r.seats, coalesce(r.odometer, 0),
    coalesce(r.daily_rate_minor, 0), r.currency, coalesce(r.status, 'available'),
    r.insurance_expires_on, r.inspection_expires_on, r.registration_expires_on,
    r.next_service_on, r.notes, (select auth.uid())
  from jsonb_to_recordset(p_rows) as r(
    make text, model text, model_year smallint, registration_plate text, vin text,
    color text, category text, fuel_type public.fuel_type,
    transmission public.transmission_type, seats smallint, odometer integer,
    daily_rate_minor bigint, currency public.currency_code,
    status public.vehicle_status, insurance_expires_on date,
    inspection_expires_on date, registration_expires_on date,
    next_service_on date, notes text
  )
  returning *;
end;
$$;

comment on function public.vehicles_import_batch(uuid, jsonb) is
  'Imports an array of vehicles in one transaction. Refuses the whole batch (errcode 55000, naming the free slots) when it does not fit the agency''s vehicle limit, before writing any row. The per-row trigger remains the backstop.';

revoke all on function public.vehicles_import_batch(uuid, jsonb) from public, anon;
grant execute on function public.vehicles_import_batch(uuid, jsonb) to authenticated;

set search_path = public, extensions, pg_temp;

-- Maintenance records, not the legacy manual enum, are the source of truth for
-- an active maintenance restriction. Existing legacy status values remain
-- visible until an authorized operator explicitly resolves them.
create or replace function app.guard_vehicle_maintenance_status()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.status = 'maintenance' and old.status <> 'maintenance' then
    raise exception 'Use Maintenance Management to start maintenance.' using errcode = '42501';
  end if;
  if old.status = 'maintenance' and new.status = 'available' and exists (
    select 1 from public.maintenance_records m
    where m.organization_id = new.organization_id and m.vehicle_id = new.id
      and m.status in ('scheduled','in_progress')
      and (m.status = 'in_progress' or (m.scheduled_start is null or m.scheduled_start <= now()))
  ) then
    raise exception 'Resolve active maintenance before returning this vehicle to service.' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists vehicles_maintenance_status_guard on public.vehicles;
create trigger vehicles_maintenance_status_guard before update of status on public.vehicles for each row execute function app.guard_vehicle_maintenance_status();

-- Preserve the established vehicle_fleet column order and append maintenance
-- context, so existing consumers remain compatible while all fleet surfaces can
-- use the same effective status calculation.
create or replace view public.vehicle_fleet
with (security_invoker = true)
as
select
  v.id as vehicle_id, v.organization_id, v.make, v.model, v.model_year,
  v.registration_plate, v.vin, v.color, v.category, v.fuel_type,
  v.transmission, v.seats, v.odometer, v.daily_rate_minor, v.currency,
  v.insurance_expires_on, v.inspection_expires_on, v.registration_expires_on,
  v.next_service_on, v.notes, v.created_at, v.updated_at, v.archived_at,
  v.status as operational_status,
  current_rental.id as current_rental_id,
  current_rental.reference as current_rental_reference,
  current_rental.customer_id as current_customer_id,
  current_rental.ends_at as current_rental_ends_at,
  next_rental.id as next_rental_id,
  next_rental.reference as next_rental_reference,
  next_rental.customer_id as next_customer_id,
  next_rental.starts_at as next_rental_starts_at,
  case
    when v.archived_at is not null then 'unavailable'::public.vehicle_status
    when v.status <> 'available' then v.status
    when maintenance.active_id is not null then 'maintenance'::public.vehicle_status
    when current_rental.id is not null then 'rented'::public.vehicle_status
    when next_rental.id is not null and next_rental.starts_at <= now() then 'reserved'::public.vehicle_status
    else 'available'::public.vehicle_status
  end as effective_status,
  (v.archived_at is null and v.status = 'available' and maintenance.active_id is null
    and current_rental.id is null and (next_rental.id is null or next_rental.starts_at > now())) as is_available_now,
  v.acquisition_method, v.acquired_on, v.acquisition_price_minor,
  v.acquisition_currency, v.acquisition_supplier, v.acquisition_notes,
  v.public_booking_enabled,
  maintenance.active_id as maintenance_id,
  maintenance.active_reference as maintenance_reference,
  maintenance.active_title as maintenance_title,
  maintenance.active_start as maintenance_scheduled_start,
  maintenance.active_expected_completion as maintenance_expected_completion,
  maintenance.active_actual_start as maintenance_actual_start,
  maintenance.active_overdue as maintenance_overdue,
  maintenance.upcoming_id as upcoming_maintenance_id,
  maintenance.upcoming_reference as upcoming_maintenance_reference,
  maintenance.upcoming_start as upcoming_maintenance_start,
  maintenance.upcoming_expected_completion as upcoming_maintenance_expected_completion
from public.vehicles v
left join lateral (
  select r.id, r.reference, r.customer_id, r.ends_at
  from public.rentals r where r.vehicle_id=v.id and r.status='active'
  order by (r.returned_at is not null), r.starts_at limit 1
) current_rental on true
left join lateral (
  select r.id, r.reference, r.customer_id, r.starts_at
  from public.rentals r where r.vehicle_id=v.id and r.status='reserved' and r.ends_at > now()
  order by r.starts_at limit 1
) next_rental on true
left join lateral (
  select
    (array_agg(m.id order by (m.status='in_progress') desc, m.scheduled_start nulls first) filter (where m.status='in_progress' or (m.status='scheduled' and m.scheduled_start <= now() and (m.expected_completion is null or m.expected_completion > now()))))[1] as active_id,
    (array_agg(m.reference order by (m.status='in_progress') desc, m.scheduled_start nulls first) filter (where m.status='in_progress' or (m.status='scheduled' and m.scheduled_start <= now() and (m.expected_completion is null or m.expected_completion > now()))))[1] as active_reference,
    (array_agg(m.title order by (m.status='in_progress') desc, m.scheduled_start nulls first) filter (where m.status='in_progress' or (m.status='scheduled' and m.scheduled_start <= now() and (m.expected_completion is null or m.expected_completion > now()))))[1] as active_title,
    (array_agg(m.scheduled_start order by (m.status='in_progress') desc, m.scheduled_start nulls first) filter (where m.status='in_progress' or (m.status='scheduled' and m.scheduled_start <= now() and (m.expected_completion is null or m.expected_completion > now()))))[1] as active_start,
    (array_agg(m.expected_completion order by (m.status='in_progress') desc, m.scheduled_start nulls first) filter (where m.status='in_progress' or (m.status='scheduled' and m.scheduled_start <= now() and (m.expected_completion is null or m.expected_completion > now()))))[1] as active_expected_completion,
    (array_agg(m.actual_start order by (m.status='in_progress') desc, m.scheduled_start nulls first) filter (where m.status='in_progress' or (m.status='scheduled' and m.scheduled_start <= now() and (m.expected_completion is null or m.expected_completion > now()))))[1] as active_actual_start,
    bool_or(m.status='in_progress' and m.expected_completion is not null and m.expected_completion < now()) as active_overdue,
    (array_agg(m.id order by m.scheduled_start) filter (where m.status='scheduled' and m.scheduled_start > now()))[1] as upcoming_id,
    (array_agg(m.reference order by m.scheduled_start) filter (where m.status='scheduled' and m.scheduled_start > now()))[1] as upcoming_reference,
    (array_agg(m.scheduled_start order by m.scheduled_start) filter (where m.status='scheduled' and m.scheduled_start > now()))[1] as upcoming_start,
    (array_agg(m.expected_completion order by m.scheduled_start) filter (where m.status='scheduled' and m.scheduled_start > now()))[1] as upcoming_expected_completion
  from public.maintenance_records m where m.organization_id=v.organization_id and m.vehicle_id=v.id
) maintenance on true;

revoke all on public.vehicle_fleet from anon, authenticated;
grant select on public.vehicle_fleet to authenticated;

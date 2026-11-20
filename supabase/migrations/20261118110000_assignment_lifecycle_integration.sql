-- Phase 1B-03 Slice 2: opt-in dual writes for the existing pre-checkout RPCs.
-- The feature flag is deliberately off unless a trusted lifecycle caller opts in.
set search_path = public, extensions, pg_temp;

create or replace function app.sync_rental_assignment_schedule(
  p_rental_id uuid,
  p_vehicle_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rental public.rentals;
  v_assignment public.rental_vehicle_assignments;
  v_vehicle public.vehicles;
begin
  select r.* into v_rental from public.rentals r where r.id = p_rental_id for update;
  if v_rental.id is null or not app.has_min_role(v_rental.organization_id, 'staff'::public.org_role) then
    raise exception 'Rental not found.' using errcode = 'P0002';
  end if;
  select a.* into v_assignment
  from public.rental_vehicle_assignments a
  where a.rental_id = v_rental.id and a.organization_id = v_rental.organization_id
    and ((v_rental.status = 'draft' and a.state = 'planned') or (v_rental.status = 'reserved' and a.state = 'reserved'))
  order by a.sequence_no desc limit 1 for update;
  if v_assignment.id is null then raise exception 'Current rental assignment not found.' using errcode = 'P0002'; end if;
  select v.* into v_vehicle from public.vehicles v where v.id = p_vehicle_id and v.organization_id = v_rental.organization_id for update;
  if v_vehicle.id is null then raise exception 'Vehicle not found.' using errcode = 'P0002'; end if;
  if v_vehicle.archived_at is not null or v_vehicle.status <> 'available' then raise exception 'Vehicle is not available.' using errcode = '23514'; end if;
  if p_ends_at <= p_starts_at then raise exception 'The return must be after the collection.' using errcode = '23514'; end if;
  perform pg_catalog.set_config('app.assignment_write', 'on', true);
  update public.rental_vehicle_assignments
     set vehicle_id = p_vehicle_id, scheduled_starts_at = p_starts_at, scheduled_ends_at = p_ends_at
   where id = v_assignment.id;
  perform pg_catalog.set_config('app.assignment_write', 'off', true);
end;
$$;

revoke all on function app.sync_rental_assignment_schedule(uuid, uuid, timestamptz, timestamptz) from public, anon;
grant execute on function app.sync_rental_assignment_schedule(uuid, uuid, timestamptz, timestamptz) to authenticated, service_role;

create or replace function public.rental_confirm(p_rental_id uuid)
returns public.rentals language plpgsql set search_path = public, pg_temp as $$
declare v_rental public.rentals; v_assignment public.rental_vehicle_assignments;
begin
  select * into v_rental from public.rentals where id = p_rental_id for update;
  if v_rental.id is null then raise exception 'Rental not found.' using errcode = 'P0002'; end if;
  if v_rental.status <> 'draft' then raise exception 'Only a draft can be confirmed.' using errcode = '23514'; end if;
  if not exists (select 1 from public.rental_drivers d where d.rental_id = p_rental_id and d.driver_role = 'primary') then
    raise exception 'Name the primary driver before confirming this reservation.' using errcode = '23514';
  end if;
  if coalesce(current_setting('app.assignment_lifecycle_enabled', true), '') = 'on' then
    select a.* into v_assignment from public.rental_vehicle_assignments a where a.rental_id = p_rental_id and a.organization_id = v_rental.organization_id and a.state = 'planned' order by a.sequence_no desc limit 1;
    if v_assignment.id is null then
      v_assignment := app.open_rental_assignment(p_rental_id, v_rental.vehicle_id, 'planned', 'initial');
    end if;
  end if;
  update public.rentals set status = 'reserved', confirmed_at = now(), original_ends_at = coalesce(original_ends_at, ends_at) where id = p_rental_id returning * into v_rental;
  if coalesce(current_setting('app.assignment_lifecycle_enabled', true), '') = 'on' then
    perform app.transition_rental_assignment(v_assignment.id, 'reserved', now());
  end if;
  return v_rental;
end; $$;

create or replace function public.rental_extend(p_rental_id uuid, p_new_ends_at timestamptz, p_charge_minor bigint default 0, p_charge_description text default null, p_additional_days integer default null)
returns public.rentals language plpgsql set search_path = public, pg_temp as $$
declare v_rental public.rentals; v_added integer; v_line public.rental_line_items; v_quantity numeric(10,2); v_amount bigint;
begin
  select * into v_rental from public.rentals where id = p_rental_id for update;
  if v_rental.id is null then raise exception 'Rental not found.' using errcode = 'P0002'; end if;
  if v_rental.status not in ('reserved','active') then raise exception 'Only a reservation or an active rental can be extended.' using errcode = '23514'; end if;
  if p_new_ends_at <= v_rental.ends_at then raise exception 'An extension must end after the current return date.' using errcode = '23514'; end if;
  v_added := greatest(coalesce(p_additional_days, public.rental_billable_days(v_rental.ends_at, p_new_ends_at)), 0);
  if v_rental.status = 'reserved' and coalesce(current_setting('app.assignment_lifecycle_enabled', true), '') = 'on' then
    perform app.sync_rental_assignment_schedule(p_rental_id, v_rental.vehicle_id, v_rental.starts_at, p_new_ends_at);
  end if;
  update public.rentals set ends_at = p_new_ends_at, original_ends_at = coalesce(original_ends_at, v_rental.ends_at), extension_count = extension_count + 1, billable_days = coalesce(billable_days,0) + v_added where id = p_rental_id returning * into v_rental;
  select * into v_line from public.rental_line_items l where l.rental_id = p_rental_id and l.kind = 'base_rental' order by l.sort_order, l.created_at limit 1;
  if v_line.id is not null then
    v_quantity := v_line.quantity + v_added; v_amount := v_line.amount_minor + coalesce(p_charge_minor,0);
    update public.rental_line_items set quantity=v_quantity, amount_minor=v_amount, unit_amount_minor=case when v_quantity>0 then round(v_amount/v_quantity)::bigint else v_amount end, description=round(v_quantity)::integer || ' day hire' where id=v_line.id;
  elsif coalesce(p_charge_minor,0)>0 or v_added>0 then
    insert into public.rental_line_items (organization_id,rental_id,kind,description,quantity,unit_amount_minor,amount_minor,currency,sort_order,created_by)
    values (v_rental.organization_id,p_rental_id,'base_rental',greatest(v_added,1)||' day hire',greatest(v_added,1),case when v_added>0 then round(coalesce(p_charge_minor,0)::numeric/v_added)::bigint else coalesce(p_charge_minor,0) end,coalesce(p_charge_minor,0),v_rental.currency,0,(select auth.uid()));
  end if;
  perform p_charge_description;
  select * into v_rental from public.rentals where id=p_rental_id; return v_rental;
end; $$;

create or replace function public.rental_substitute_vehicle(p_rental_id uuid, p_vehicle_id uuid)
returns public.rentals language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v_rental public.rentals; v_vehicle public.vehicles; v_old public.rental_vehicle_assignments; v_new public.rental_vehicle_assignments; v_state public.rental_assignment_state;
begin
  select * into v_rental from public.rentals where id=p_rental_id for update;
  if v_rental.id is null or (current_setting('role',true)='authenticated' and not app.has_min_role(v_rental.organization_id,'staff'::public.org_role)) then raise exception 'Rental not found.' using errcode='P0002'; end if;
  if v_rental.status not in ('draft','reserved') then raise exception 'The vehicle can only be changed before the customer collects it.' using errcode='23514'; end if;
  select * into v_vehicle from public.vehicles where id=p_vehicle_id;
  if v_vehicle.id is null or v_vehicle.organization_id<>v_rental.organization_id then raise exception 'Vehicle not found.' using errcode='P0002'; end if;
  if v_vehicle.archived_at is not null then raise exception 'That vehicle has been retired from the fleet.' using errcode='23514'; end if;
  if v_vehicle.status<>'available' then raise exception 'That vehicle is not in service.' using errcode='23514'; end if;
  if v_vehicle.currency<>v_rental.currency then raise exception 'That vehicle is priced in %, and this rental is in %.',v_vehicle.currency,v_rental.currency using errcode='23514'; end if;
  if coalesce(current_setting('app.assignment_lifecycle_enabled',true),'')='on' then
    v_state := case when v_rental.status='draft' then 'planned'::public.rental_assignment_state else 'reserved'::public.rental_assignment_state end;
    select * into v_old from public.rental_vehicle_assignments where rental_id=p_rental_id and organization_id=v_rental.organization_id and state=v_state order by sequence_no desc limit 1 for update;
    if v_old.id is not null and v_old.vehicle_id<>p_vehicle_id then perform app.transition_rental_assignment(v_old.id,'superseded_before_pickup',now()); end if;
    if v_old.id is null or v_old.vehicle_id<>p_vehicle_id then v_new := app.open_rental_assignment(p_rental_id,p_vehicle_id,v_state,'pre_checkout_swap','Vehicle substituted'); perform app.sync_rental_vehicle_pointer(p_rental_id,v_new.id); end if;
  end if;
  update public.rentals set vehicle_id=p_vehicle_id,daily_rate_minor=v_vehicle.daily_rate_minor where id=p_rental_id returning * into v_rental; return v_rental;
end; $$;

revoke all on function public.rental_substitute_vehicle(uuid,uuid) from public, anon;
grant execute on function public.rental_substitute_vehicle(uuid,uuid) to authenticated;

create or replace function public.rental_reschedule(p_rental_id uuid, p_starts_at timestamptz, p_ends_at timestamptz, p_vehicle_id uuid default null, p_amend_contract boolean default false)
returns public.rentals language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v_rental public.rentals; v_vehicle public.vehicles; v_target uuid; v_contract public.rental_contracts;
begin
  select * into v_rental from public.rentals where id=p_rental_id for update;
  if v_rental.id is null or (current_setting('role',true)='authenticated' and not app.has_min_role(v_rental.organization_id,'staff'::public.org_role)) then raise exception 'Rental not found.' using errcode='P0002'; end if;
  if v_rental.status not in ('draft','reserved') then raise exception 'Only a draft or a confirmed reservation can be rescheduled. Extend or return this rental instead.' using errcode='23514'; end if;
  if p_starts_at is null or p_ends_at is null or p_ends_at<=p_starts_at then raise exception 'The return must be after the collection.' using errcode='23514'; end if;
  v_target:=coalesce(p_vehicle_id,v_rental.vehicle_id);
  if v_target<>v_rental.vehicle_id then
    select * into v_vehicle from public.vehicles where id=v_target;
    if v_vehicle.id is null or v_vehicle.organization_id<>v_rental.organization_id then raise exception 'Vehicle not found.' using errcode='P0002'; end if;
    if v_vehicle.archived_at is not null then raise exception 'That vehicle has been retired from the fleet.' using errcode='23514'; end if;
    if v_vehicle.status<>'available' then raise exception 'That vehicle is not in service.' using errcode='23514'; end if;
  end if;
  select * into v_contract from public.rental_contracts where rental_id=p_rental_id and status in ('issued','signed') order by version desc limit 1;
  if v_contract.id is not null and not p_amend_contract then raise exception 'Contract % states this booking. Rescheduling it requires issuing a new version.',v_contract.contract_number using errcode='23514'; end if;
  if coalesce(current_setting('app.assignment_lifecycle_enabled',true),'')='on' then perform app.sync_rental_assignment_schedule(p_rental_id,v_target,p_starts_at,p_ends_at); end if;
  update public.rentals set starts_at=p_starts_at,ends_at=p_ends_at,vehicle_id=v_target,original_ends_at=p_ends_at,billable_days=public.rental_billable_days(p_starts_at,p_ends_at) where id=p_rental_id returning * into v_rental;
  if v_contract.id is not null then perform public.rental_issue_contract(p_rental_id,'Rescheduled'); end if;
  return v_rental;
end; $$;

revoke all on function public.rental_reschedule(uuid,timestamptz,timestamptz,uuid,boolean) from public, anon;
grant execute on function public.rental_reschedule(uuid,timestamptz,timestamptz,uuid,boolean) to authenticated;

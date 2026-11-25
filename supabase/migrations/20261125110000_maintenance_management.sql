set search_path = public, extensions, pg_temp;

do $$ begin create type public.maintenance_category as enum ('preventive','oil_filter','tire_service','brake_service','battery_electrical','mechanical_repair','bodywork_collision','vehicle_inspection','recall','cleaning_detailing','other'); exception when duplicate_object then null; end $$;
do $$ begin create type public.maintenance_priority as enum ('low','normal','high','urgent'); exception when duplicate_object then null; end $$;
do $$ begin create type public.maintenance_status as enum ('scheduled','in_progress','completed','cancelled'); exception when duplicate_object then null; end $$;

create sequence if not exists public.maintenance_reference_seq;

create table if not exists public.maintenance_records (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  vehicle_id uuid not null,
  reference text not null,
  title text not null check (char_length(btrim(title)) between 1 and 160),
  category public.maintenance_category not null,
  priority public.maintenance_priority not null default 'normal',
  status public.maintenance_status not null default 'scheduled',
  scheduled_start timestamptz,
  expected_completion timestamptz,
  actual_start timestamptz,
  actual_completion timestamptz,
  start_odometer integer check (start_odometer is null or start_odometer >= 0),
  completion_odometer integer check (completion_odometer is null or completion_odometer >= 0),
  description text,
  reported_issue text,
  work_performed text,
  service_provider text,
  technician text,
  provider_reference text,
  notes text,
  completion_notes text,
  estimated_cost_minor bigint check (estimated_cost_minor is null or estimated_cost_minor >= 0),
  currency public.currency_code not null,
  incident_id uuid,
  created_by uuid not null references auth.users(id),
  completed_by uuid references auth.users(id),
  cancelled_by uuid references auth.users(id),
  cancellation_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint maintenance_tenant_key unique (id, organization_id),
  constraint maintenance_vehicle_fkey foreign key (vehicle_id, organization_id) references public.vehicles(id, organization_id) on delete restrict,
  constraint maintenance_incident_fkey foreign key (incident_id, organization_id) references public.incidents(id, organization_id) on delete set null,
  constraint maintenance_schedule_order check (expected_completion is null or scheduled_start is null or expected_completion > scheduled_start),
  constraint maintenance_actual_order check (actual_completion is null or actual_start is null or actual_completion >= actual_start)
);
create unique index if not exists maintenance_reference_key on public.maintenance_records(organization_id, reference);
create index if not exists maintenance_org_status_idx on public.maintenance_records(organization_id, status, scheduled_start);
create index if not exists maintenance_org_vehicle_idx on public.maintenance_records(organization_id, vehicle_id, status, scheduled_start);
create index if not exists maintenance_org_incident_idx on public.maintenance_records(organization_id, incident_id) where incident_id is not null;

alter table public.expenses add column if not exists maintenance_id uuid;
do $$ begin
  alter table public.expenses add constraint expenses_maintenance_fkey foreign key (maintenance_id, organization_id) references public.maintenance_records(id, organization_id) on delete set null;
exception when duplicate_object then null; end $$;
create index if not exists expenses_maintenance_idx on public.expenses(organization_id, maintenance_id) where maintenance_id is not null;

create or replace function app.set_maintenance_reference() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.reference is null or btrim(new.reference) = '' then
    new.reference := 'MNT-' || to_char(coalesce(new.created_at, now()), 'YYYY') || '-' || lpad(nextval('public.maintenance_reference_seq')::text, 5, '0');
  end if;
  return new;
end $$;
drop trigger if exists maintenance_reference on public.maintenance_records;
create trigger maintenance_reference before insert on public.maintenance_records for each row execute function app.set_maintenance_reference();
drop trigger if exists maintenance_updated_at on public.maintenance_records;
create trigger maintenance_updated_at before update on public.maintenance_records for each row execute function app.set_updated_at();

create or replace function app.validate_maintenance_window() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.status in ('scheduled','in_progress') and new.priority <> 'urgent' then
    perform pg_advisory_xact_lock(hashtextextended('pevvy-maintenance:' || new.organization_id::text || ':' || new.vehicle_id::text, 0));
    if new.status = 'in_progress' and exists (select 1 from public.rentals r where r.organization_id = new.organization_id and r.vehicle_id = new.vehicle_id and r.status = 'active') then
      raise exception 'Vehicle is unavailable because it has an active rental.' using errcode = 'P0001';
    end if;
    if new.scheduled_start is not null and new.expected_completion is not null and exists (
      select 1 from public.rentals r where r.organization_id = new.organization_id and r.vehicle_id = new.vehicle_id
        and r.status in ('reserved','active') and r.starts_at < new.expected_completion and r.ends_at > new.scheduled_start
    ) then
      raise exception 'Vehicle is unavailable during the scheduled maintenance window.' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists maintenance_window_guard on public.maintenance_records;
create trigger maintenance_window_guard before insert or update of vehicle_id, status, priority, scheduled_start, expected_completion on public.maintenance_records for each row execute function app.validate_maintenance_window();

create or replace function app.validate_rental_maintenance() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.status in ('reserved','active') then
    if exists (select 1 from public.maintenance_records m where m.organization_id = new.organization_id and m.vehicle_id = new.vehicle_id and m.status = 'in_progress') then
      raise exception 'Vehicle is unavailable because it is in maintenance.' using errcode = 'P0001';
    end if;
    if exists (select 1 from public.maintenance_records m where m.organization_id = new.organization_id and m.vehicle_id = new.vehicle_id and m.status = 'scheduled' and m.priority <> 'urgent' and m.scheduled_start is not null and m.expected_completion is not null and new.starts_at < m.expected_completion and new.ends_at > m.scheduled_start) then
      raise exception 'Vehicle is unavailable during scheduled maintenance.' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists rentals_maintenance_guard on public.rentals;
create trigger rentals_maintenance_guard before insert or update of vehicle_id, status, starts_at, ends_at on public.rentals for each row execute function app.validate_rental_maintenance();

revoke all on table public.maintenance_records from anon, authenticated;
grant select on table public.maintenance_records to authenticated;
alter table public.maintenance_records enable row level security;
drop policy if exists maintenance_select on public.maintenance_records;
create policy maintenance_select on public.maintenance_records for select to authenticated using (app.is_org_member(organization_id));

create or replace function public.maintenance_create(
  p_organization_id uuid, p_vehicle_id uuid, p_title text,
  p_category public.maintenance_category, p_priority public.maintenance_priority default 'normal',
  p_scheduled_start timestamptz default null, p_expected_completion timestamptz default null,
  p_description text default null, p_reported_issue text default null, p_service_provider text default null,
  p_technician text default null, p_provider_reference text default null, p_estimated_cost_minor bigint default null,
  p_currency public.currency_code default null, p_incident_id uuid default null, p_notes text default null,
  p_start_immediately boolean default false, p_start_odometer integer default null
) returns public.maintenance_records language plpgsql security definer set search_path = public, pg_temp as $$
declare v_row public.maintenance_records; v_currency public.currency_code;
begin
  if not app.has_min_role(p_organization_id, 'manager') then raise exception 'Not permitted.' using errcode = '42501'; end if;
  if not exists (select 1 from public.vehicles where id = p_vehicle_id and organization_id = p_organization_id and archived_at is null) then raise exception 'Vehicle not found.' using errcode = 'P0002'; end if;
  if p_incident_id is not null and not exists (select 1 from public.incidents where id = p_incident_id and organization_id = p_organization_id and vehicle_id = p_vehicle_id) then raise exception 'Incident not found for vehicle.' using errcode = 'P0002'; end if;
  select currency into v_currency from public.vehicles where id = p_vehicle_id and organization_id = p_organization_id;
  insert into public.maintenance_records(organization_id, vehicle_id, title, category, priority, status, scheduled_start, expected_completion, actual_start, start_odometer, description, reported_issue, service_provider, technician, provider_reference, estimated_cost_minor, currency, incident_id, notes, created_by)
  values (p_organization_id, p_vehicle_id, btrim(p_title), p_category, p_priority, case when p_start_immediately then 'in_progress' else 'scheduled' end, p_scheduled_start, p_expected_completion, case when p_start_immediately then now() end, p_start_odometer, nullif(btrim(p_description),''), nullif(btrim(p_reported_issue),''), nullif(btrim(p_service_provider),''), nullif(btrim(p_technician),''), nullif(btrim(p_provider_reference),''), p_estimated_cost_minor, coalesce(p_currency, v_currency), p_incident_id, nullif(btrim(p_notes),''), auth.uid()) returning * into v_row;
  return v_row;
end $$;

create or replace function public.maintenance_start(p_maintenance_id uuid, p_actual_start timestamptz default now(), p_start_odometer integer default null) returns public.maintenance_records language plpgsql security definer set search_path = public, pg_temp as $$
declare v_row public.maintenance_records;
begin
  select * into v_row from public.maintenance_records where id = p_maintenance_id for update;
  if v_row.id is null or not app.has_min_role(v_row.organization_id, 'manager') then raise exception 'Maintenance record not found.' using errcode = 'P0002'; end if;
  if v_row.status <> 'scheduled' then raise exception 'Only scheduled maintenance can be started.' using errcode = '22023'; end if;
  update public.maintenance_records set status='in_progress', actual_start=coalesce(p_actual_start,now()), start_odometer=coalesce(p_start_odometer,start_odometer) where id=p_maintenance_id returning * into v_row;
  return v_row;
end $$;

create or replace function public.maintenance_complete(p_maintenance_id uuid, p_actual_completion timestamptz default now(), p_completion_notes text default null, p_work_performed text default null, p_completion_odometer integer default null) returns public.maintenance_records language plpgsql security definer set search_path = public, pg_temp as $$
declare v_row public.maintenance_records;
begin
  select * into v_row from public.maintenance_records where id=p_maintenance_id for update;
  if v_row.id is null or not app.has_min_role(v_row.organization_id,'manager') then raise exception 'Maintenance record not found.' using errcode='P0002'; end if;
  if v_row.status <> 'in_progress' then raise exception 'Only in-progress maintenance can be completed.' using errcode='22023'; end if;
  update public.maintenance_records set status='completed', actual_completion=coalesce(p_actual_completion,now()), completion_notes=nullif(btrim(p_completion_notes),''), work_performed=coalesce(nullif(btrim(p_work_performed),''),work_performed), completion_odometer=coalesce(p_completion_odometer,completion_odometer), completed_by=auth.uid() where id=p_maintenance_id returning * into v_row;
  return v_row;
end $$;

create or replace function public.maintenance_cancel(p_maintenance_id uuid, p_reason text) returns public.maintenance_records language plpgsql security definer set search_path = public, pg_temp as $$
declare v_row public.maintenance_records;
begin
  select * into v_row from public.maintenance_records where id=p_maintenance_id for update;
  if v_row.id is null or not app.has_min_role(v_row.organization_id,'manager') then raise exception 'Maintenance record not found.' using errcode='P0002'; end if;
  if v_row.status not in ('scheduled','in_progress') then raise exception 'Only scheduled or in-progress maintenance can be cancelled.' using errcode='22023'; end if;
  update public.maintenance_records set status='cancelled', cancellation_reason=nullif(btrim(p_reason),''), cancelled_by=auth.uid() where id=p_maintenance_id returning * into v_row;
  return v_row;
end $$;

create or replace function public.maintenance_reschedule(p_maintenance_id uuid, p_scheduled_start timestamptz, p_expected_completion timestamptz) returns public.maintenance_records language plpgsql security definer set search_path = public, pg_temp as $$
declare v_row public.maintenance_records;
begin
  select * into v_row from public.maintenance_records where id=p_maintenance_id for update;
  if v_row.id is null or not app.has_min_role(v_row.organization_id,'manager') then raise exception 'Maintenance record not found.' using errcode='P0002'; end if;
  if v_row.status <> 'scheduled' then raise exception 'Only scheduled maintenance can be rescheduled.' using errcode='22023'; end if;
  update public.maintenance_records set scheduled_start=p_scheduled_start, expected_completion=p_expected_completion where id=p_maintenance_id returning * into v_row;
  return v_row;
end $$;

create or replace function public.maintenance_conflicts(p_maintenance_id uuid) returns table(rental_id uuid, rental_reference text, rental_status public.rental_status, starts_at timestamptz, ends_at timestamptz) language sql security definer set search_path = public, pg_temp as $$
  select r.id, r.reference, r.status, r.starts_at, r.ends_at from public.maintenance_records m join public.rentals r on r.organization_id=m.organization_id and r.vehicle_id=m.vehicle_id where m.id=p_maintenance_id and r.status in ('reserved','active') and (m.status='in_progress' or (m.scheduled_start is not null and m.expected_completion is not null and r.starts_at < m.expected_completion and r.ends_at > m.scheduled_start));
$$;

create or replace function public.maintenance_link_expense(p_maintenance_id uuid, p_expense_id uuid) returns public.expenses language plpgsql security definer set search_path = public, pg_temp as $$
declare v_m public.maintenance_records; v_e public.expenses;
begin
  select * into v_m from public.maintenance_records where id=p_maintenance_id;
  if v_m.id is null or not app.has_min_role(v_m.organization_id,'manager') then raise exception 'Maintenance record not found.' using errcode='P0002'; end if;
  select * into v_e from public.expenses where id=p_expense_id and organization_id=v_m.organization_id for update;
  if v_e.id is null or v_e.vehicle_id <> v_m.vehicle_id or v_e.allocation <> 'vehicle' then raise exception 'Expense must be a vehicle expense for the same vehicle.' using errcode='22023'; end if;
  update public.expenses set maintenance_id=p_maintenance_id where id=p_expense_id returning * into v_e;
  return v_e;
end $$;

create or replace function public.maintenance_unlink_expense(p_expense_id uuid) returns public.expenses language plpgsql security definer set search_path = public, pg_temp as $$
declare v_e public.expenses;
begin
  select * into v_e from public.expenses where id=p_expense_id for update;
  if v_e.id is null or not app.has_min_role(v_e.organization_id,'manager') then raise exception 'Expense not found.' using errcode='P0002'; end if;
  update public.expenses set maintenance_id=null where id=p_expense_id returning * into v_e;
  return v_e;
end $$;

create or replace function public.vehicles_available_between(p_organization_id uuid, p_from timestamptz, p_to timestamptz, p_exclude_rental_id uuid default null) returns setof public.vehicles language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not app.is_org_member(p_organization_id) then raise exception 'Not permitted.' using errcode='42501'; end if;
  if p_to <= p_from then raise exception 'End must be after start.' using errcode='22023'; end if;
  return query select v.* from public.vehicles v where v.organization_id=p_organization_id and v.archived_at is null and v.status='available'
    and not exists (select 1 from public.rentals r where r.organization_id=v.organization_id and r.vehicle_id=v.id and r.status in ('reserved','active') and r.id is distinct from p_exclude_rental_id and r.starts_at < p_to and r.ends_at > p_from)
    and not exists (select 1 from public.maintenance_records m where m.organization_id=v.organization_id and m.vehicle_id=v.id and (m.status='in_progress' or (m.status='scheduled' and m.scheduled_start is not null and m.expected_completion is not null and m.scheduled_start < p_to and m.expected_completion > p_from)));
end $$;

revoke all on function public.maintenance_create(uuid,uuid,text,public.maintenance_category,public.maintenance_priority,timestamptz,timestamptz,text,text,text,text,text,bigint,public.currency_code,uuid,text,boolean,integer) from public;
revoke all on function public.maintenance_start(uuid,timestamptz,integer), public.maintenance_complete(uuid,timestamptz,text,text,integer), public.maintenance_cancel(uuid,text), public.maintenance_reschedule(uuid,timestamptz,timestamptz), public.maintenance_conflicts(uuid), public.maintenance_link_expense(uuid,uuid), public.maintenance_unlink_expense(uuid) from public;
grant execute on function public.maintenance_create(uuid,uuid,text,public.maintenance_category,public.maintenance_priority,timestamptz,timestamptz,text,text,text,text,text,bigint,public.currency_code,uuid,text,boolean,integer) to authenticated;
grant execute on function public.maintenance_start(uuid,timestamptz,integer), public.maintenance_complete(uuid,timestamptz,text,text,integer), public.maintenance_cancel(uuid,text), public.maintenance_reschedule(uuid,timestamptz,timestamptz), public.maintenance_conflicts(uuid), public.maintenance_link_expense(uuid,uuid), public.maintenance_unlink_expense(uuid) to authenticated;

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

alter table public.maintenance_records add column if not exists service_interval_days integer check (service_interval_days is null or service_interval_days > 0);
alter table public.maintenance_records add column if not exists service_interval_odometer integer check (service_interval_odometer is null or service_interval_odometer > 0);
alter table public.maintenance_records add column if not exists next_service_on date;
alter table public.maintenance_records add column if not exists next_service_odometer integer check (next_service_odometer is null or next_service_odometer >= 0);

create table if not exists public.maintenance_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  maintenance_id uuid not null,
  storage_path text not null check (char_length(storage_path) between 1 and 512),
  file_name text not null check (char_length(file_name) between 1 and 240),
  content_type text not null,
  byte_size integer not null check (byte_size > 0 and byte_size <= 10485760),
  uploaded_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  constraint maintenance_documents_tenant_fkey foreign key (maintenance_id, organization_id) references public.maintenance_records(id, organization_id) on delete cascade,
  constraint maintenance_documents_path_key unique (storage_path)
);
create index if not exists maintenance_documents_record_idx on public.maintenance_documents(maintenance_id, created_at);
revoke all on table public.maintenance_documents from anon, authenticated;
grant select, insert, delete on table public.maintenance_documents to authenticated;
alter table public.maintenance_documents enable row level security;
drop policy if exists maintenance_documents_select on public.maintenance_documents;
create policy maintenance_documents_select on public.maintenance_documents for select to authenticated using (app.is_org_member(organization_id));
drop policy if exists maintenance_documents_insert on public.maintenance_documents;
create policy maintenance_documents_insert on public.maintenance_documents for insert to authenticated with check (app.has_min_role(organization_id, 'staff') and uploaded_by = auth.uid());
drop policy if exists maintenance_documents_delete on public.maintenance_documents;
create policy maintenance_documents_delete on public.maintenance_documents for delete to authenticated using (app.has_min_role(organization_id, 'manager'));
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('maintenance-documents', 'maintenance-documents', false, 10485760, array['application/pdf','image/png','image/jpeg','image/webp'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists "maintenance documents readable by members" on storage.objects;
create policy "maintenance documents readable by members" on storage.objects for select to authenticated using (bucket_id = 'maintenance-documents' and app.is_org_member(app.organization_id_from_storage_path(name)));
drop policy if exists "maintenance documents writable by staff" on storage.objects;
create policy "maintenance documents writable by staff" on storage.objects for insert to authenticated with check (bucket_id = 'maintenance-documents' and app.has_min_role(app.organization_id_from_storage_path(name), 'staff'));
drop policy if exists "maintenance documents removable by managers" on storage.objects;
create policy "maintenance documents removable by managers" on storage.objects for delete to authenticated using (bucket_id = 'maintenance-documents' and app.has_min_role(app.organization_id_from_storage_path(name), 'manager'));

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
  values (p_organization_id, p_vehicle_id, btrim(p_title), p_category, p_priority, (case when p_start_immediately then 'in_progress' else 'scheduled' end)::public.maintenance_status, p_scheduled_start, p_expected_completion, case when p_start_immediately then now() end, p_start_odometer, nullif(btrim(p_description),''), nullif(btrim(p_reported_issue),''), nullif(btrim(p_service_provider),''), nullif(btrim(p_technician),''), nullif(btrim(p_provider_reference),''), p_estimated_cost_minor, coalesce(p_currency, v_currency), p_incident_id, nullif(btrim(p_notes),''), auth.uid()) returning * into v_row;
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

create or replace function public.maintenance_set_service_plan(p_maintenance_id uuid, p_interval_days integer, p_interval_odometer integer, p_next_service_on date, p_next_service_odometer integer) returns public.maintenance_records language plpgsql security definer set search_path = public, pg_temp as $$
declare v_row public.maintenance_records;
begin
  select * into v_row from public.maintenance_records where id=p_maintenance_id for update;
  if v_row.id is null or not app.has_min_role(v_row.organization_id,'manager') then raise exception 'Maintenance record not found.' using errcode='P0002'; end if;
  if p_interval_days is null and p_interval_odometer is null and p_next_service_on is null and p_next_service_odometer is null then raise exception 'At least one service reminder is required.' using errcode='22023'; end if;
  update public.maintenance_records set service_interval_days=p_interval_days, service_interval_odometer=p_interval_odometer, next_service_on=p_next_service_on, next_service_odometer=p_next_service_odometer where id=p_maintenance_id returning * into v_row;
  return v_row;
end $$;

create or replace function public.maintenance_due_summary(p_organization_id uuid, p_as_of date default current_date) returns table(maintenance_id uuid, vehicle_id uuid, reference text, title text, status public.maintenance_status, overdue boolean, due_by_date boolean, due_by_odometer boolean, next_service_on date, next_service_odometer integer) language sql security definer set search_path = public, pg_temp as $$
  select m.id, m.vehicle_id, m.reference, m.title, m.status,
    (m.status in ('scheduled','in_progress') and ((m.next_service_on is not null and m.next_service_on < p_as_of) or (m.next_service_odometer is not null and v.odometer >= m.next_service_odometer))) as overdue,
    (m.next_service_on is not null and m.next_service_on <= p_as_of + 30) as due_by_date,
    (m.next_service_odometer is not null and v.odometer >= m.next_service_odometer - 500) as due_by_odometer,
    m.next_service_on, m.next_service_odometer
  from public.maintenance_records m join public.vehicles v on v.id=m.vehicle_id and v.organization_id=m.organization_id
  where m.organization_id=p_organization_id and app.is_org_member(p_organization_id)
    and m.status in ('scheduled','in_progress','completed');
$$;

create or replace function public.maintenance_actual_cost(p_maintenance_id uuid) returns bigint language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(sum(e.amount_minor), 0)::bigint from public.expenses e join public.maintenance_records m on m.id=e.maintenance_id and m.organization_id=e.organization_id where e.maintenance_id=p_maintenance_id and e.status <> 'voided' and app.is_org_member(m.organization_id);
$$;

create or replace function public.maintenance_vehicle_downtime(p_vehicle_id uuid, p_from timestamptz, p_to timestamptz) returns integer language sql stable security definer set search_path = public, pg_temp as $$
  with clipped as (
    select greatest(coalesce(m.actual_start,m.scheduled_start),p_from) as started, least(coalesce(m.actual_completion,m.expected_completion,p_to),p_to) as ended
    from public.maintenance_records m where m.vehicle_id=p_vehicle_id and m.status in ('scheduled','in_progress','completed')
      and coalesce(m.actual_start,m.scheduled_start) < p_to and coalesce(m.actual_completion,m.expected_completion,p_to) > p_from
  ), ordered as (
    select *, max(ended) over (order by started rows between unbounded preceding and 1 preceding) as prior_end from clipped
  ), grouped as (
    select *, sum(case when prior_end is null or started > prior_end then 1 else 0 end) over (order by started) as grp from ordered
  )
  select coalesce(round(extract(epoch from sum(ended-started))/60)::integer,0) from (select min(started) started, max(ended) ended from grouped group by grp) merged;
$$;

create or replace function public.vehicles_available_between(p_organization_id uuid, p_from timestamptz, p_to timestamptz, p_exclude_rental_id uuid default null) returns setof uuid language plpgsql stable set search_path = public, pg_temp as $$
begin
  if not app.is_org_member(p_organization_id) then raise exception 'Not permitted.' using errcode='42501'; end if;
  if p_to <= p_from then raise exception 'End must be after start.' using errcode='22023'; end if;
  return query select v.id from public.vehicles v where v.organization_id=p_organization_id and v.archived_at is null and v.status='available'
    and not exists (select 1 from public.rentals r where r.organization_id=v.organization_id and r.vehicle_id=v.id and r.status in ('reserved','active') and r.id is distinct from p_exclude_rental_id and r.starts_at < p_to and r.ends_at > p_from)
    and not exists (select 1 from public.maintenance_records m where m.organization_id=v.organization_id and m.vehicle_id=v.id and (m.status='in_progress' or (m.status='scheduled' and m.scheduled_start is not null and m.expected_completion is not null and m.scheduled_start < p_to and m.expected_completion > p_from)));
end $$;

revoke all on function public.maintenance_create(uuid,uuid,text,public.maintenance_category,public.maintenance_priority,timestamptz,timestamptz,text,text,text,text,text,bigint,public.currency_code,uuid,text,boolean,integer) from public;
revoke all on function public.maintenance_start(uuid,timestamptz,integer), public.maintenance_complete(uuid,timestamptz,text,text,integer), public.maintenance_cancel(uuid,text), public.maintenance_reschedule(uuid,timestamptz,timestamptz), public.maintenance_conflicts(uuid), public.maintenance_link_expense(uuid,uuid), public.maintenance_unlink_expense(uuid), public.maintenance_set_service_plan(uuid,integer,integer,date,integer), public.maintenance_due_summary(uuid,date), public.maintenance_actual_cost(uuid), public.maintenance_vehicle_downtime(uuid,timestamptz,timestamptz) from public;
grant execute on function public.maintenance_create(uuid,uuid,text,public.maintenance_category,public.maintenance_priority,timestamptz,timestamptz,text,text,text,text,text,bigint,public.currency_code,uuid,text,boolean,integer) to authenticated;
grant execute on function public.maintenance_start(uuid,timestamptz,integer), public.maintenance_complete(uuid,timestamptz,text,text,integer), public.maintenance_cancel(uuid,text), public.maintenance_reschedule(uuid,timestamptz,timestamptz), public.maintenance_conflicts(uuid), public.maintenance_link_expense(uuid,uuid), public.maintenance_unlink_expense(uuid), public.maintenance_set_service_plan(uuid,integer,integer,date,integer), public.maintenance_due_summary(uuid,date), public.maintenance_actual_cost(uuid), public.maintenance_vehicle_downtime(uuid,timestamptz,timestamptz) to authenticated;

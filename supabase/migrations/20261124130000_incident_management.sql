-- Incident management: one operational record for breakdowns, accidents,
-- damage, theft and other events. It deliberately does not mutate rentals,
-- vehicles, payments or subscriptions.

set search_path = public, extensions, pg_temp;

do $$ begin
  create type public.incident_type as enum ('breakdown', 'accident', 'vehicle_damage', 'theft', 'other');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.incident_status as enum ('open', 'in_progress', 'resolved');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.incident_responsibility as enum ('customer', 'agency', 'third_party', 'undetermined');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.incident_attachment_kind as enum ('photo', 'document');
exception when duplicate_object then null; end $$;

create sequence if not exists public.incident_reference_seq;

create table if not exists public.incidents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  reference text not null,
  incident_type public.incident_type not null,
  status public.incident_status not null default 'open',
  vehicle_id uuid not null,
  rental_id uuid,
  customer_id uuid,
  occurred_at timestamptz not null default now(),
  location text check (location is null or char_length(location) <= 500),
  description text not null check (char_length(btrim(description)) between 1 and 10000),
  reported_by uuid not null references auth.users(id),
  responsibility public.incident_responsibility not null default 'undetermined',
  towing_provider text check (towing_provider is null or char_length(towing_provider) <= 240),
  towing_reference text check (towing_reference is null or char_length(towing_reference) <= 240),
  insurance_provider text check (insurance_provider is null or char_length(insurance_provider) <= 240),
  insurance_claim_reference text check (insurance_claim_reference is null or char_length(insurance_claim_reference) <= 240),
  resolution_notes text check (resolution_notes is null or char_length(resolution_notes) <= 10000),
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint incidents_tenant_key unique (id, organization_id),
  constraint incidents_reference_key unique (organization_id, reference),
  constraint incidents_vehicle_fkey foreign key (vehicle_id, organization_id)
    references public.vehicles(id, organization_id) on delete restrict,
  constraint incidents_rental_fkey foreign key (rental_id, organization_id)
    references public.rentals(id, organization_id) on delete set null,
  constraint incidents_customer_fkey foreign key (customer_id, organization_id)
    references public.customers(id, organization_id) on delete set null,
  constraint incidents_resolution_shape check (
    (status <> 'resolved' and resolved_at is null and resolved_by is null)
    or (status = 'resolved' and resolved_at is not null and resolved_by is not null)
  )
);

create index if not exists incidents_org_status_idx on public.incidents(organization_id, status, occurred_at desc);
create index if not exists incidents_org_vehicle_idx on public.incidents(organization_id, vehicle_id, occurred_at desc);
create index if not exists incidents_org_rental_idx on public.incidents(organization_id, rental_id, occurred_at desc);

create or replace function app.set_incident_reference()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.reference is null or btrim(new.reference) = '' then
    new.reference := 'INC-' || to_char(coalesce(new.occurred_at, now()), 'YYYY') || '-' || lpad(nextval('public.incident_reference_seq')::text, 5, '0');
  end if;
  return new;
end;
$$;

drop trigger if exists incidents_reference on public.incidents;
create trigger incidents_reference before insert on public.incidents
for each row execute function app.set_incident_reference();
drop trigger if exists incidents_updated_at on public.incidents;
create trigger incidents_updated_at before update on public.incidents
for each row execute function app.set_updated_at();

revoke all on table public.incidents from anon, authenticated;
grant select on table public.incidents to authenticated;
alter table public.incidents enable row level security;
drop policy if exists incidents_select on public.incidents;
create policy incidents_select on public.incidents for select to authenticated
using (app.is_org_member(organization_id));
drop policy if exists incidents_insert on public.incidents;
create policy incidents_insert on public.incidents for insert to authenticated
with check (app.has_min_role(organization_id, 'staff') and reported_by = auth.uid());
drop policy if exists incidents_update on public.incidents;
create policy incidents_update on public.incidents for update to authenticated
using (app.has_min_role(organization_id, 'staff'))
with check (app.has_min_role(organization_id, 'staff'));

create table if not exists public.incident_attachments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  incident_id uuid not null,
  kind public.incident_attachment_kind not null,
  storage_path text not null check (char_length(storage_path) between 1 and 512),
  file_name text not null check (char_length(file_name) between 1 and 240),
  content_type text not null,
  byte_size integer not null check (byte_size > 0 and byte_size <= 10485760),
  uploaded_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  constraint incident_attachments_incident_fkey foreign key (incident_id, organization_id)
    references public.incidents(id, organization_id) on delete cascade,
  constraint incident_attachments_path_key unique (storage_path)
);
create index if not exists incident_attachments_incident_idx on public.incident_attachments(incident_id, created_at);
revoke all on table public.incident_attachments from anon, authenticated;
grant select, insert, delete on table public.incident_attachments to authenticated;
alter table public.incident_attachments enable row level security;
drop policy if exists incident_attachments_select on public.incident_attachments;
create policy incident_attachments_select on public.incident_attachments for select to authenticated
using (app.is_org_member(organization_id));
drop policy if exists incident_attachments_insert on public.incident_attachments;
create policy incident_attachments_insert on public.incident_attachments for insert to authenticated
with check (app.has_min_role(organization_id, 'staff') and uploaded_by = auth.uid());
drop policy if exists incident_attachments_delete on public.incident_attachments;
create policy incident_attachments_delete on public.incident_attachments for delete to authenticated
using (app.has_min_role(organization_id, 'manager'));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('incident-photos', 'incident-photos', false, 8388608, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('incident-documents', 'incident-documents', false, 10485760, array['application/pdf', 'image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists "incident media readable by members" on storage.objects;
create policy "incident media readable by members" on storage.objects for select to authenticated
using (bucket_id in ('incident-photos', 'incident-documents')
  and app.is_org_member(app.organization_id_from_storage_path(name)));
drop policy if exists "incident media writable by staff" on storage.objects;
create policy "incident media writable by staff" on storage.objects for insert to authenticated
with check (bucket_id in ('incident-photos', 'incident-documents')
  and app.has_min_role(app.organization_id_from_storage_path(name), 'staff'));
drop policy if exists "incident media removable by managers" on storage.objects;
create policy "incident media removable by managers" on storage.objects for delete to authenticated
using (bucket_id in ('incident-photos', 'incident-documents')
  and app.has_min_role(app.organization_id_from_storage_path(name), 'manager'));

create or replace function public.incident_create(
  p_organization_id uuid, p_vehicle_id uuid, p_rental_id uuid default null,
  p_incident_type public.incident_type default 'other', p_occurred_at timestamptz default now(),
  p_location text default null, p_description text default '',
  p_responsibility public.incident_responsibility default 'undetermined',
  p_towing_provider text default null, p_towing_reference text default null,
  p_insurance_provider text default null, p_insurance_claim_reference text default null
) returns public.incidents language plpgsql security definer set search_path = public, pg_temp as $$
declare v_customer_id uuid; v_incident public.incidents;
begin
  if not app.has_min_role(p_organization_id, 'staff') then raise exception 'Not permitted.' using errcode = '42501'; end if;
  if not exists (select 1 from public.vehicles v where v.id = p_vehicle_id and v.organization_id = p_organization_id) then raise exception 'Vehicle not found.' using errcode = 'P0002'; end if;
  if p_rental_id is not null then
    select r.customer_id into v_customer_id from public.rentals r where r.id = p_rental_id and r.organization_id = p_organization_id;
    if not found then raise exception 'Rental not found.' using errcode = 'P0002'; end if;
  end if;
  insert into public.incidents (organization_id, incident_type, vehicle_id, rental_id, customer_id, occurred_at, location, description, reported_by, responsibility, towing_provider, towing_reference, insurance_provider, insurance_claim_reference)
  values (p_organization_id, p_incident_type, p_vehicle_id, p_rental_id, v_customer_id, p_occurred_at, nullif(btrim(p_location), ''), btrim(p_description), auth.uid(), p_responsibility, nullif(btrim(p_towing_provider), ''), nullif(btrim(p_towing_reference), ''), nullif(btrim(p_insurance_provider), ''), nullif(btrim(p_insurance_claim_reference), ''))
  returning * into v_incident;
  return v_incident;
end; $$;

create or replace function public.incident_update(
  p_incident_id uuid, p_incident_type public.incident_type, p_occurred_at timestamptz,
  p_location text, p_description text, p_responsibility public.incident_responsibility,
  p_towing_provider text, p_towing_reference text, p_insurance_provider text,
  p_insurance_claim_reference text, p_status public.incident_status
) returns public.incidents language plpgsql security definer set search_path = public, pg_temp as $$
declare v_incident public.incidents;
begin
  select * into v_incident from public.incidents where id = p_incident_id;
  if v_incident.id is null or not app.has_min_role(v_incident.organization_id, 'staff') then raise exception 'Incident not found.' using errcode = 'P0002'; end if;
  if p_status = 'resolved' then raise exception 'Use incident_resolve to resolve an incident.' using errcode = '22023'; end if;
  update public.incidents set incident_type = p_incident_type, occurred_at = p_occurred_at, location = nullif(btrim(p_location), ''), description = btrim(p_description), responsibility = p_responsibility, towing_provider = nullif(btrim(p_towing_provider), ''), towing_reference = nullif(btrim(p_towing_reference), ''), insurance_provider = nullif(btrim(p_insurance_provider), ''), insurance_claim_reference = nullif(btrim(p_insurance_claim_reference), ''), status = p_status where id = p_incident_id returning * into v_incident;
  return v_incident;
end; $$;

create or replace function public.incident_resolve(p_incident_id uuid, p_resolution_notes text)
returns public.incidents language plpgsql security definer set search_path = public, pg_temp as $$
declare v_incident public.incidents;
begin
  select * into v_incident from public.incidents where id = p_incident_id;
  if v_incident.id is null or not app.has_min_role(v_incident.organization_id, 'staff') then raise exception 'Incident not found.' using errcode = 'P0002'; end if;
  update public.incidents set status = 'resolved', resolution_notes = nullif(btrim(p_resolution_notes), ''), resolved_at = now(), resolved_by = auth.uid() where id = p_incident_id returning * into v_incident;
  return v_incident;
end; $$;

revoke all on function public.incident_create(uuid, uuid, uuid, public.incident_type, timestamptz, text, text, public.incident_responsibility, text, text, text, text) from public;
revoke all on function public.incident_update(uuid, public.incident_type, timestamptz, text, text, public.incident_responsibility, text, text, text, text, public.incident_status) from public;
revoke all on function public.incident_resolve(uuid, text) from public;
grant execute on function public.incident_create(uuid, uuid, uuid, public.incident_type, timestamptz, text, text, public.incident_responsibility, text, text, text, text) to authenticated;
grant execute on function public.incident_update(uuid, public.incident_type, timestamptz, text, text, public.incident_responsibility, text, text, text, text, public.incident_status) to authenticated;
grant execute on function public.incident_resolve(uuid, text) to authenticated;

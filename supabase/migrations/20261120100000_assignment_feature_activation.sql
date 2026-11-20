-- Phase 1B-03 STG-02: server-owned, organization-scoped activation.
-- This migration defines the contract only. It does not enable any organization.

set search_path = public, extensions, pg_temp;

create table if not exists app.assignment_feature_activation (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id)
);

create table if not exists app.assignment_feature_activation_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  previous_enabled boolean not null,
  enabled boolean not null,
  changed_by uuid not null references auth.users (id),
  changed_at timestamptz not null default now()
);

revoke all on table app.assignment_feature_activation from public, anon, authenticated;
revoke all on table app.assignment_feature_activation_events from public, anon, authenticated;
alter table app.assignment_feature_activation enable row level security;
alter table app.assignment_feature_activation_events enable row level security;

comment on table app.assignment_feature_activation is
  'Server-owned organization activation state for Phase 1B-03. Missing rows mean disabled.';
comment on table app.assignment_feature_activation_events is
  'Append-only audit trail for explicit assignment feature activation changes.';

create or replace function app.assignment_lifecycle_active(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.is_org_member(p_organization_id)
    and (
      exists (
        select 1
        from app.assignment_feature_activation a
        where a.organization_id = p_organization_id
          and a.enabled
      )
      or (
        coalesce(current_setting('app.assignment_test_harness', true), '') = 'on'
        and coalesce(current_setting('app.assignment_lifecycle_enabled', true), '') = 'on'
      )
    );
$$;

comment on function app.assignment_lifecycle_active(uuid) is
  'True for an enabled organization, or for the privileged non-browser local acceptance harness GUC path.';

create or replace function app.assignment_feature_eligible(
  p_organization_id uuid,
  p_minimum_role public.org_role
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.assignment_lifecycle_active(p_organization_id)
    and app.has_min_role(p_organization_id, p_minimum_role);
$$;

revoke all on function app.assignment_lifecycle_active(uuid) from public, anon, authenticated;
revoke all on function app.assignment_feature_eligible(uuid, public.org_role) from public, anon, authenticated;
grant execute on function app.assignment_lifecycle_active(uuid) to authenticated, service_role;
grant execute on function app.assignment_feature_eligible(uuid, public.org_role) to authenticated, service_role;

create or replace function public.assignment_feature_eligibility(p_organization_id uuid)
returns table (
  enabled boolean,
  can_view_history boolean,
  can_swap boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    case when app.is_org_member(p_organization_id)
      then app.assignment_lifecycle_active(p_organization_id) else false end,
    case when app.is_org_member(p_organization_id)
      then app.assignment_feature_eligible(p_organization_id, 'staff'::public.org_role) else false end,
    case when app.is_org_member(p_organization_id)
      then app.assignment_feature_eligible(p_organization_id, 'manager'::public.org_role) else false end;
$$;

revoke all on function public.assignment_feature_eligibility(uuid) from public, anon;
grant execute on function public.assignment_feature_eligibility(uuid) to authenticated;

create or replace function public.set_assignment_feature_enabled(
  p_organization_id uuid,
  p_enabled boolean
)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_previous boolean := false;
  v_actor uuid := (select auth.uid());
begin
  if not app.has_min_role(p_organization_id, 'admin'::public.org_role) then
    raise exception 'Only an administrator can change assignment feature activation.' using errcode = '42501';
  end if;

  select enabled into v_previous
  from app.assignment_feature_activation
  where organization_id = p_organization_id
  for update;

  insert into app.assignment_feature_activation (organization_id, enabled, updated_by)
  values (p_organization_id, coalesce(p_enabled, false), v_actor)
  on conflict (organization_id) do update
    set enabled = excluded.enabled, updated_at = now(), updated_by = excluded.updated_by;

  insert into app.assignment_feature_activation_events
    (organization_id, previous_enabled, enabled, changed_by)
  values (p_organization_id, coalesce(v_previous, false), coalesce(p_enabled, false), v_actor);
end;
$$;

revoke all on function public.set_assignment_feature_enabled(uuid, boolean) from public, anon;
grant execute on function public.set_assignment_feature_enabled(uuid, boolean) to authenticated;

-- Convert the accepted harness switch into a server-owned decision for every
-- assignment-aware function already installed. The switch remains available to
-- the non-browser local harness; authenticated and anon sessions cannot use it
-- to override the organization activation row.
do $$
declare
  v_function record;
  v_definition text;
begin
  for v_function in
    select p.oid, p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'app')
      and p.prokind = 'f'
      and p.proname not in ('assignment_lifecycle_active', 'assignment_feature_eligible')
      and pg_get_functiondef(p.oid) like '%app.assignment_lifecycle_enabled%'
  loop
    v_definition := pg_get_functiondef(v_function.oid);
    if v_function.proname = 'guard_rental_vehicle_pointer_update' then
      v_definition := replace(v_definition,
        $needle$coalesce(current_setting('app.assignment_lifecycle_enabled', true), '') <> 'on'$needle$,
        $replacement$not app.assignment_lifecycle_active(new.organization_id)$replacement$);
      v_definition := replace(v_definition,
        $needle$coalesce(pg_catalog.current_setting('app.assignment_lifecycle_enabled', true), '') <> 'on'$needle$,
        $replacement$not app.assignment_lifecycle_active(new.organization_id)$replacement$);
    else
      v_definition := replace(v_definition,
        $needle$coalesce(current_setting('app.assignment_lifecycle_enabled', true), '') = 'on'$needle$,
        $replacement$app.assignment_lifecycle_active(v_rental.organization_id)$replacement$);
      v_definition := replace(v_definition,
        $needle$coalesce(current_setting('app.assignment_lifecycle_enabled',true),'')='on'$needle$,
        $replacement$app.assignment_lifecycle_active(v_rental.organization_id)$replacement$);
    end if;
    execute v_definition;
  end loop;
end;
$$;

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
    and app.assignment_feature_eligible(a.organization_id, 'staff'::public.org_role)
  order by a.sequence_no;
$$;

revoke all on function public.rental_assignment_history(uuid) from public, anon;
grant execute on function public.rental_assignment_history(uuid) to authenticated, service_role;

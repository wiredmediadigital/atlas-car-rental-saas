-- Standard vehicle assignment release.
-- Missing organization activation rows are enabled while the environment-wide
-- release control is on. An explicit disabled row remains an organization-
-- scoped safety restriction, and setting the release control to off disables
-- assignment-aware behavior for the current database role/session.

set search_path = public, extensions, pg_temp;

create or replace function app.assignment_lifecycle_active(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.is_org_member(p_organization_id)
    and coalesce(current_setting('app.assignment_lifecycle_enabled', true), 'on') = 'on'
    and coalesce(
      (
        select a.enabled
        from app.assignment_feature_activation a
        where a.organization_id = p_organization_id
      ),
      true
    );
$$;

comment on table app.assignment_feature_activation is
  'Server-owned organization safety state for the standard assignment release. Missing rows follow the environment-wide release control; explicit false rows disable the feature for that organization.';

comment on function app.assignment_lifecycle_active(uuid) is
  'True for a member when the environment-wide assignment release is on and the organization has no explicit disabled safety state.';

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

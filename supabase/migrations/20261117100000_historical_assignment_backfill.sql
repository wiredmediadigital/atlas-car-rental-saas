-- =============================================================================
-- 20261117100000_historical_assignment_backfill.sql
--
-- Phase 1B-02: local/reviewed historical rental assignment backfill.
--
-- The procedure is deliberately repeatable. It creates only sequence 1, never
-- rewrites rentals or financial records, and records malformed or conflicting
-- legacy rows instead of fabricating custody facts or weakening constraints.
-- =============================================================================

set search_path = public, extensions, pg_temp;

do $$
begin
  if not exists (
    select 1
      from pg_type
     where typname = 'rental_assignment_backfill_anomaly_code'
       and typnamespace = 'public'::regnamespace
  ) then
    create type public.rental_assignment_backfill_anomaly_code as enum (
      'active_without_pickup',
      'cancelled_with_custody_facts',
      'custody_timestamp_order',
      'availability_conflict',
      'existing_assignment_mismatch',
      'existing_sequence_gap',
      'missing_vehicle',
      'photo_link_conflict',
      'assignment_insert_conflict',
      'missing_custody_fact'
    );
  end if;

  if not exists (
    select 1
      from pg_type
     where typname = 'rental_assignment_backfill_anomaly_status'
       and typnamespace = 'public'::regnamespace
  ) then
    create type public.rental_assignment_backfill_anomaly_status as enum (
      'open',
      'resolved'
    );
  end if;
end
$$;

create table if not exists public.rental_assignment_backfill_anomalies (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null,
  rental_id          uuid not null,
  anomaly_code       public.rental_assignment_backfill_anomaly_code not null,
  severity           text not null default 'error'
                     check (severity in ('warning', 'error')),
  details            jsonb not null default '{}'::jsonb,
  status             public.rental_assignment_backfill_anomaly_status not null default 'open',
  first_detected_at  timestamptz not null default now(),
  last_detected_at   timestamptz not null default now(),
  resolved_at        timestamptz,
  resolved_by        uuid references auth.users (id) on delete set null,
  resolution_notes   text check (resolution_notes is null or char_length(resolution_notes) <= 2000),

  constraint rental_assignment_backfill_anomalies_rental_fkey
    foreign key (rental_id, organization_id)
    references public.rentals (id, organization_id)
    on delete cascade,
  constraint rental_assignment_backfill_anomalies_resolution_shape
    check (
      (status = 'open' and resolved_at is null)
      or (status = 'resolved' and resolved_at is not null)
    ),
  constraint rental_assignment_backfill_anomalies_unique_code
    unique (organization_id, rental_id, anomaly_code)
);

create index if not exists rental_assignment_backfill_anomalies_org_idx
  on public.rental_assignment_backfill_anomalies (organization_id, status, last_detected_at desc);
create index if not exists rental_assignment_backfill_anomalies_rental_idx
  on public.rental_assignment_backfill_anomalies (rental_id, anomaly_code);

revoke all on table public.rental_assignment_backfill_anomalies from anon, authenticated;
grant select on table public.rental_assignment_backfill_anomalies to authenticated;

alter table public.rental_assignment_backfill_anomalies enable row level security;

drop policy if exists rental_assignment_backfill_anomalies_select
  on public.rental_assignment_backfill_anomalies;
create policy rental_assignment_backfill_anomalies_select
  on public.rental_assignment_backfill_anomalies
  for select to authenticated
  using (app.is_org_member(organization_id));

create or replace function app.record_rental_assignment_backfill_anomaly(
  p_organization_id uuid,
  p_rental_id uuid,
  p_anomaly_code public.rental_assignment_backfill_anomaly_code,
  p_severity text,
  p_details jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.rental_assignment_backfill_anomalies (
    organization_id,
    rental_id,
    anomaly_code,
    severity,
    details,
    status,
    first_detected_at,
    last_detected_at
  )
  values (
    p_organization_id,
    p_rental_id,
    p_anomaly_code,
    p_severity,
    coalesce(p_details, '{}'::jsonb),
    'open',
    now(),
    now()
  )
  on conflict (organization_id, rental_id, anomaly_code) do update
    set severity = excluded.severity,
        details = excluded.details,
        status = 'open',
        last_detected_at = now(),
        resolved_at = null,
        resolved_by = null,
        resolution_notes = null;
end;
$$;

create or replace function app.backfill_historical_rental_assignments()
returns table (
  eligible_rentals       integer,
  created_assignments    integer,
  existing_assignments   integer,
  anomalous_rentals     integer,
  created_inspections   integer,
  linked_photos         integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rental              public.rentals;
  v_assignment          public.rental_vehicle_assignments;
  v_inspection          public.rental_vehicle_inspections;
  v_state               public.rental_assignment_state;
  v_blocks              boolean;
  v_started_at          timestamptz;
  v_ended_at            timestamptz;
  v_assignment_id       uuid;
  v_photo_time          timestamptz;
  v_missing_facts       jsonb;
  v_rental_anomalous    boolean;
  v_skip                boolean;
  v_count               integer;
begin
  eligible_rentals := 0;
  created_assignments := 0;
  existing_assignments := 0;
  anomalous_rentals := 0;
  created_inspections := 0;
  linked_photos := 0;

  for v_rental in
    select r.*
      from public.rentals r
     order by r.organization_id, r.id
  loop
    eligible_rentals := eligible_rentals + 1;
    v_rental_anomalous := false;
    v_skip := false;
    v_assignment_id := null;
    v_started_at := v_rental.picked_up_at;
    v_ended_at := v_rental.returned_at;

    if not exists (
      select 1
        from public.vehicles v
       where v.id = v_rental.vehicle_id
         and v.organization_id = v_rental.organization_id
    ) then
      perform app.record_rental_assignment_backfill_anomaly(
        v_rental.organization_id,
        v_rental.id,
        'missing_vehicle',
        'error',
        jsonb_build_object('vehicle_id', v_rental.vehicle_id)
      );
      v_rental_anomalous := true;
      v_skip := true;
    end if;

    if v_rental.picked_up_at is not null
       and v_rental.returned_at is not null
       and v_rental.returned_at < v_rental.picked_up_at then
      perform app.record_rental_assignment_backfill_anomaly(
        v_rental.organization_id,
        v_rental.id,
        'custody_timestamp_order',
        'error',
        jsonb_build_object(
          'picked_up_at', v_rental.picked_up_at,
          'returned_at', v_rental.returned_at
        )
      );
      v_rental_anomalous := true;
      v_skip := true;
    end if;

    if v_rental.status = 'active'
       and v_rental.picked_up_at is null
       and v_rental.returned_at is null then
      perform app.record_rental_assignment_backfill_anomaly(
        v_rental.organization_id,
        v_rental.id,
        'active_without_pickup',
        'error',
        jsonb_build_object('status', v_rental.status)
      );
      v_rental_anomalous := true;
      v_skip := true;
    end if;

    if v_rental.status = 'cancelled'
       and (
         v_rental.picked_up_at is not null
         or v_rental.returned_at is not null
         or v_rental.pickup_odometer is not null
         or v_rental.return_odometer is not null
         or v_rental.pickup_fuel_percent is not null
         or v_rental.return_fuel_percent is not null
       ) then
      perform app.record_rental_assignment_backfill_anomaly(
        v_rental.organization_id,
        v_rental.id,
        'cancelled_with_custody_facts',
        'error',
        jsonb_build_object(
          'picked_up_at', v_rental.picked_up_at,
          'returned_at', v_rental.returned_at,
          'pickup_odometer', v_rental.pickup_odometer,
          'return_odometer', v_rental.return_odometer
        )
      );
      v_rental_anomalous := true;
      v_skip := true;
    end if;

    if v_rental.status in ('active', 'completed') then
      v_missing_facts := '{}'::jsonb;
      if v_rental.picked_up_at is null then
        v_missing_facts := v_missing_facts || '{"picked_up_at":true}'::jsonb;
      end if;
      if v_rental.returned_at is null and v_rental.status = 'completed' then
        v_missing_facts := v_missing_facts || '{"returned_at":true}'::jsonb;
      end if;
      if v_rental.pickup_odometer is null then
        v_missing_facts := v_missing_facts || '{"pickup_odometer":true}'::jsonb;
      end if;
      if v_rental.return_odometer is null and v_rental.status = 'completed' then
        v_missing_facts := v_missing_facts || '{"return_odometer":true}'::jsonb;
      end if;
      if v_missing_facts <> '{}'::jsonb and not v_skip then
        perform app.record_rental_assignment_backfill_anomaly(
          v_rental.organization_id,
          v_rental.id,
          'missing_custody_fact',
          'warning',
          v_missing_facts
        );
        v_rental_anomalous := true;
      end if;
    end if;

    select a.*
      into v_assignment
      from public.rental_vehicle_assignments a
     where a.rental_id = v_rental.id
       and a.organization_id = v_rental.organization_id
       and a.sequence_no = 1;

    if v_skip then
      if v_rental_anomalous then anomalous_rentals := anomalous_rentals + 1; end if;
      continue;
    end if;

    if v_rental.status = 'draft' then
      v_state := 'planned';
      v_blocks := false;
      v_started_at := null;
      v_ended_at := null;
    elsif v_rental.status = 'reserved' then
      v_state := 'reserved';
      v_blocks := true;
      v_started_at := null;
      v_ended_at := null;
    elsif v_rental.status = 'active' and v_rental.returned_at is null then
      v_state := 'in_custody';
      v_blocks := true;
    elsif v_rental.status = 'active' then
      v_state := 'released';
      v_blocks := true;
    elsif v_rental.status = 'completed' then
      v_state := 'released';
      v_blocks := false;
    else
      v_state := 'cancelled';
      v_blocks := false;
      v_started_at := null;
      v_ended_at := null;
    end if;

    if v_assignment.id is not null then
      if v_assignment.organization_id is distinct from v_rental.organization_id
         or v_assignment.rental_id is distinct from v_rental.id
         or v_assignment.vehicle_id is distinct from v_rental.vehicle_id
         or v_assignment.scheduled_starts_at is distinct from v_rental.starts_at
         or v_assignment.scheduled_ends_at is distinct from v_rental.ends_at
         or v_assignment.state is distinct from v_state
         or v_assignment.blocks_availability is distinct from v_blocks then
        perform app.record_rental_assignment_backfill_anomaly(
          v_rental.organization_id,
          v_rental.id,
          'existing_assignment_mismatch',
          'error',
          jsonb_build_object('assignment_id', v_assignment.id)
        );
        v_rental_anomalous := true;
        if v_rental_anomalous then anomalous_rentals := anomalous_rentals + 1; end if;
        continue;
      end if;
      v_assignment_id := v_assignment.id;
      existing_assignments := existing_assignments + 1;
    elsif exists (
      select 1
        from public.rental_vehicle_assignments a
       where a.rental_id = v_rental.id
    ) then
      perform app.record_rental_assignment_backfill_anomaly(
        v_rental.organization_id,
        v_rental.id,
        'existing_sequence_gap',
        'error',
        jsonb_build_object('expected_sequence_no', 1)
      );
      v_rental_anomalous := true;
      if v_rental_anomalous then anomalous_rentals := anomalous_rentals + 1; end if;
      continue;
    else
      begin
        insert into public.rental_vehicle_assignments (
          organization_id,
          rental_id,
          vehicle_id,
          sequence_no,
          state,
          reason,
          reason_notes,
          scheduled_starts_at,
          scheduled_ends_at,
          started_at,
          ended_at,
          pickup_odometer,
          return_odometer,
          pickup_fuel_percent,
          return_fuel_percent,
          assigned_by,
          released_by,
          blocks_availability
        )
        values (
          v_rental.organization_id,
          v_rental.id,
          v_rental.vehicle_id,
          1,
          v_state,
          'initial',
          'Created by the Phase 1B-02 historical backfill.',
          v_rental.starts_at,
          v_rental.ends_at,
          v_started_at,
          v_ended_at,
          v_rental.pickup_odometer,
          v_rental.return_odometer,
          v_rental.pickup_fuel_percent,
          v_rental.return_fuel_percent,
          v_rental.pickup_recorded_by,
          v_rental.return_recorded_by,
          v_blocks
        )
        returning * into v_assignment;
        v_assignment_id := v_assignment.id;
        created_assignments := created_assignments + 1;
      exception
        when exclusion_violation then
          perform app.record_rental_assignment_backfill_anomaly(
            v_rental.organization_id,
            v_rental.id,
            'availability_conflict',
            'error',
            jsonb_build_object('vehicle_id', v_rental.vehicle_id)
          );
          v_rental_anomalous := true;
          v_skip := true;
        when others then
          perform app.record_rental_assignment_backfill_anomaly(
            v_rental.organization_id,
            v_rental.id,
            'assignment_insert_conflict',
            'error',
            jsonb_build_object('sqlstate', sqlstate, 'message', sqlerrm)
          );
          v_rental_anomalous := true;
          v_skip := true;
      end;
      if v_skip then
        if v_rental_anomalous then anomalous_rentals := anomalous_rentals + 1; end if;
        continue;
      end if;
    end if;

    if exists (
      select 1
        from public.rental_condition_photos p
       where p.organization_id = v_rental.organization_id
         and p.rental_id = v_rental.id
         and p.assignment_id is not null
         and p.assignment_id <> v_assignment_id
    ) then
      perform app.record_rental_assignment_backfill_anomaly(
        v_rental.organization_id,
        v_rental.id,
        'photo_link_conflict',
        'error',
        jsonb_build_object('assignment_id', v_assignment_id)
      );
      v_rental_anomalous := true;
    end if;

    insert into public.rental_vehicle_inspections (
      organization_id, rental_id, assignment_id, phase, inspected_at,
      odometer, fuel_percent, notes, recorded_by
    )
    select v_rental.organization_id,
           v_rental.id,
           v_assignment_id,
           'pickup',
           coalesce(
             v_rental.picked_up_at,
             (select min(p.uploaded_at)
                from public.rental_condition_photos p
               where p.organization_id = v_rental.organization_id
                 and p.rental_id = v_rental.id
                 and p.phase = 'pickup')
           ),
           v_rental.pickup_odometer,
           v_rental.pickup_fuel_percent,
           coalesce(v_rental.pickup_condition_notes, 'Legacy photo evidence; exact custody time unavailable.'),
           v_rental.pickup_recorded_by
     where (v_rental.picked_up_at is not null
            or exists (
              select 1
                from public.rental_condition_photos p
               where p.organization_id = v_rental.organization_id
                 and p.rental_id = v_rental.id
                 and p.phase = 'pickup'
            ))
    on conflict (assignment_id, phase) do nothing;
    get diagnostics v_count = row_count;
    created_inspections := created_inspections + v_count;

    insert into public.rental_vehicle_inspections (
      organization_id, rental_id, assignment_id, phase, inspected_at,
      odometer, fuel_percent, notes, recorded_by
    )
    select v_rental.organization_id,
           v_rental.id,
           v_assignment_id,
           'return',
           coalesce(
             v_rental.returned_at,
             (select min(p.uploaded_at)
                from public.rental_condition_photos p
               where p.organization_id = v_rental.organization_id
                 and p.rental_id = v_rental.id
                 and p.phase = 'return')
           ),
           v_rental.return_odometer,
           v_rental.return_fuel_percent,
           coalesce(v_rental.return_condition_notes, 'Legacy photo evidence; exact custody time unavailable.'),
           v_rental.return_recorded_by
     where (v_rental.returned_at is not null
            or exists (
              select 1
                from public.rental_condition_photos p
               where p.organization_id = v_rental.organization_id
                 and p.rental_id = v_rental.id
                 and p.phase = 'return'
            ))
    on conflict (assignment_id, phase) do nothing;
    get diagnostics v_count = row_count;
    created_inspections := created_inspections + v_count;

    update public.rental_condition_photos p
       set assignment_id = v_assignment_id
     where p.organization_id = v_rental.organization_id
       and p.rental_id = v_rental.id
       and p.assignment_id is null;
    get diagnostics v_count = row_count;
    linked_photos := linked_photos + v_count;

    update public.rental_condition_photos p
       set inspection_id = i.id
      from public.rental_vehicle_inspections i
     where p.organization_id = v_rental.organization_id
       and p.rental_id = v_rental.id
       and p.assignment_id = v_assignment_id
       and p.inspection_id is null
       and i.organization_id = p.organization_id
       and i.rental_id = p.rental_id
       and i.assignment_id = p.assignment_id
       and i.phase::text = p.phase::text;

    if v_rental_anomalous then
      anomalous_rentals := anomalous_rentals + 1;
    end if;
  end loop;

  return next;
end;
$$;

revoke all on function app.record_rental_assignment_backfill_anomaly(
  uuid, uuid, public.rental_assignment_backfill_anomaly_code, text, jsonb
) from public, anon, authenticated;
grant execute on function app.record_rental_assignment_backfill_anomaly(
  uuid, uuid, public.rental_assignment_backfill_anomaly_code, text, jsonb
) to service_role;

revoke all on function app.backfill_historical_rental_assignments() from public, anon, authenticated;
grant execute on function app.backfill_historical_rental_assignments() to service_role;

-- Trigger functions execute through table triggers and are not callable API
-- surface. Keep the private app schema closed to browser roles even when the
-- foundation migration was applied before the permission invariant existed.
revoke all on function app.guard_rental_condition_photo_links() from public, anon, authenticated;
revoke all on function app.guard_rental_vehicle_assignment_update() from public, anon, authenticated;

-- The account-closure purge uses an explicit, child-before-parent table list.
-- Restate it here because this migration adds tenant-scoped assignment tables;
-- leaving them unlisted would make every future purge claim fail closed.
create or replace function app.organization_purge_tables()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array[
    -- GPS
    'gps_positions', 'gps_unit_assignments', 'gps_sync_runs', 'gps_units',
    'gps_provider_credentials', 'gps_provider_connections',
    -- notifications
    'notification_preferences', 'notification_states', 'notification_events',
    -- team
    'organization_team_events', 'organization_invitations', 'organization_members',
    -- expenses
    'expense_attachments', 'expense_change_events', 'expenses',
    'expense_categories', 'expense_vendors',
    -- financing
    'financing_documents', 'financing_change_events', 'financing_payments',
    'financing_installments', 'financing_agreements', 'lenders',
    -- public booking (references vehicles, customers and rentals)
    'booking_leads',
    -- assignment children and assignment-scoped evidence
    'rental_assignment_corrections', 'rental_vehicle_inspections',
    'rental_assignment_backfill_anomalies',
    'rental_vehicle_assignments',
    -- rentals and customers
    'customer_documents', 'rental_condition_photos', 'rental_contracts',
    'rental_line_items', 'rental_drivers', 'payments', 'rentals', 'customers',
    -- fleet
    'vehicle_documents', 'vehicle_images', 'vehicles',
    -- settings
    'organization_settings',
    -- security
    'security_events'
  ];
$$;

comment on function app.organization_purge_tables() is
  'Every table the account purge empties, children first. Explicit on purpose: a table added without being listed here (or in organization_retained_tables) stops the purge before it deletes anything.';

do $assert$
begin
  if not app.organization_purge_lists_agree() then
    raise exception 'historical assignment tables left the purge lists disagreeing with the schema: %',
      app.organization_purge_list_disagreement();
  end if;
end;
$assert$;

-- The migration itself is the controlled first execution. Future executions of
-- the same procedure are explicitly idempotent and can be wrapped in a caller
-- transaction for a reviewed local/staging run.
select * from app.backfill_historical_rental_assignments();

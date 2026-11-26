-- Maintenance Management manual acceptance remediation.
--
-- The maintenance work package rewrote public.vehicles_available_between and
-- lost two behaviours the fleet depends on: the overdue unreturned hire
-- exclusion introduced by 20261107100000, and the deterministic ordering. It
-- also made an in-progress maintenance record block every period for ever,
-- rather than the period it actually covers, so a vehicle in maintenance today
-- could not be reserved for any future date. That is the standard rental
-- regression and the period-specific availability failure the owner reported.
--
-- Nothing here rewrites an existing migration. Vehicle occupancy is still
-- derived, maintenance records remain the source of truth for a maintenance
-- restriction, and legacy manually assigned restrictions are preserved until an
-- authorized operator resolves them explicitly.

set search_path = public, extensions, pg_temp;

-- ---------------------------------------------------------------------------
-- 1. Independent off-road restriction context
--
-- The existing operational restriction is vehicles.status = 'unavailable'.
-- This records why and by whom, so Return to service releases exactly the
-- restriction that was applied, and no second restriction subsystem is needed.
-- ---------------------------------------------------------------------------

alter table public.vehicles add column if not exists off_road_reason text
  check (off_road_reason is null or char_length(btrim(off_road_reason)) between 1 and 500);
alter table public.vehicles add column if not exists off_road_at timestamptz;
-- ON DELETE SET NULL, like every other actor column in the fleet schema. An
-- Auth account that a vehicle row still names cannot be deleted under NO
-- ACTION, and the last step of account closure deletes Auth accounts: a
-- manager who took a car off the road in one agency would make their own
-- erasure fail from inside another. Who applied the restriction is useful,
-- never load-bearing, so losing the name is the right trade.
alter table public.vehicles add column if not exists off_road_by uuid
  references auth.users(id) on delete set null;

-- ---------------------------------------------------------------------------
-- 2. Operational status is written only by its own authorized actions
--
-- General vehicle editing submits the whole row, so a form that carries a
-- status field silently clears whatever restriction the vehicle was under.
-- The frontend no longer sends the column; this makes the rule authoritative
-- so a direct PostgREST call cannot bypass it either.
--
-- The trigger fires only when status is actually changing, so resubmitting an
-- unchanged value stays harmless and vehicle import is unaffected.
-- ---------------------------------------------------------------------------

create or replace function app.guard_vehicle_status()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  if new.status in ('rented', 'reserved') then
    raise exception 'Rented and reserved follow rental contracts and cannot be set directly.'
      using errcode = '42501';
  end if;

  if new.status = 'maintenance' then
    raise exception 'Use Maintenance Management to start maintenance.'
      using errcode = '42501';
  end if;

  if coalesce(current_setting('pevvy.vehicle_status_write', true), '') <> 'on' then
    raise exception 'Vehicle status follows maintenance and operational actions; it is not set by editing the vehicle.'
      using errcode = '42501';
  end if;

  -- Returning a vehicle to service must not override an active maintenance
  -- restriction that nobody has resolved.
  if new.status = 'available' and exists (
    select 1
    from public.maintenance_records m
    where m.organization_id = new.organization_id
      and m.vehicle_id = new.id
      and (
        m.status = 'in_progress'
        or (m.status = 'scheduled'
            and m.scheduled_start is not null
            and m.scheduled_start <= now()
            and (m.expected_completion is null or m.expected_completion > now()))
      )
  ) then
    raise exception 'Resolve active maintenance before returning this vehicle to service.'
      using errcode = '42501';
  end if;

  return new;
end $$;

drop trigger if exists vehicles_maintenance_status_guard on public.vehicles;
drop trigger if exists vehicles_status_guard on public.vehicles;
create trigger vehicles_status_guard
  before update of status on public.vehicles
  for each row execute function app.guard_vehicle_status();

-- ---------------------------------------------------------------------------
-- 3. The period a maintenance record actually restricts
--
-- One definition, used by availability, by the rental guard and by the
-- conflict listing, so the three can never disagree about what is blocked.
--
--   scheduled    the agreed window, when both ends are known. This mirrors
--                the rental guard exactly, so nothing is offered that the
--                database would then refuse.
--   in progress  from when work actually started until the expected
--                completion, while that expectation is still credible. Once it
--                has passed without a completion the return date is unknown,
--                so the restriction stays open-ended -- the same treatment an
--                overdue unreturned hire has had since 20261107100000.
--   otherwise    nothing.
-- ---------------------------------------------------------------------------

create or replace function app.maintenance_restriction_range(
  p_status              public.maintenance_status,
  p_scheduled_start     timestamptz,
  p_expected_completion timestamptz,
  p_actual_start        timestamptz
)
returns tstzrange
language sql
stable
set search_path = public, pg_temp
as $$
  select case
    when p_status = 'in_progress' then
      tstzrange(
        coalesce(p_actual_start, p_scheduled_start, '-infinity'::timestamptz),
        case
          when p_expected_completion is not null and p_expected_completion > now()
            then p_expected_completion
          else 'infinity'::timestamptz
        end,
        '[)'
      )
    when p_status = 'scheduled'
         and p_scheduled_start is not null
         and p_expected_completion is not null then
      tstzrange(p_scheduled_start, p_expected_completion, '[)')
    else 'empty'::tstzrange
  end;
$$;

comment on function app.maintenance_restriction_range(public.maintenance_status, timestamptz, timestamptz, timestamptz) is
  'The period a maintenance record restricts a vehicle for. Half-open, so a rental ending exactly when maintenance starts is allowed.';

-- Granted explicitly, because public.vehicles_available_between is SECURITY
-- INVOKER and calls this from its body: the signed-in caller's own privileges
-- decide, and 20260821100500 removed the PUBLIC default for schema app. Without
-- this line the vehicle picker and the availability search raise 'permission
-- denied for function' for every member, which is to say no rental can be made
-- anywhere in the product. The in-memory test harness does not register that
-- migration's ALTER DEFAULT PRIVILEGES, so it grants PUBLIC anyway and the
-- tests pass either way -- the grant is what makes the hosted database agree
-- with them.
revoke all on function app.maintenance_restriction_range(public.maintenance_status, timestamptz, timestamptz, timestamptz) from public, anon;
grant execute on function app.maintenance_restriction_range(public.maintenance_status, timestamptz, timestamptz, timestamptz) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Availability, restored and made period-specific
--
-- Restores the overdue unreturned hire exclusion and the deterministic order,
-- and replaces the unconditional in-progress exclusion with the range above.
-- A vehicle in maintenance now is still bookable for a later period it does
-- not cover; a vehicle free now is not bookable across a future maintenance
-- window.
-- ---------------------------------------------------------------------------

create or replace function public.vehicles_available_between(
  p_organization_id   uuid,
  p_from              timestamptz,
  p_to                timestamptz,
  p_exclude_rental_id uuid default null
)
returns setof uuid
language plpgsql
stable
set search_path = public, pg_temp
as $$
begin
  if not app.is_org_member(p_organization_id) then
    raise exception 'Not a member of this organization.' using errcode = '42501';
  end if;

  if p_to <= p_from then
    raise exception 'The period must end after it starts.' using errcode = '22023';
  end if;

  return query
  select v.id
  from public.vehicles v
  where v.organization_id = p_organization_id
    and v.archived_at is null
    -- Legacy manual restrictions and independent off-road restrictions both
    -- live here and are deliberately period-independent: the vehicle is not
    -- offered at all until somebody resolves them.
    and v.status = 'available'
    and not exists (
      select 1
      from public.rentals r
      where r.organization_id = v.organization_id
        and r.vehicle_id = v.id
        and r.status in ('reserved', 'active')
        and r.id is distinct from p_exclude_rental_id
        and tstzrange(r.starts_at, r.ends_at, '[)') && tstzrange(p_from, p_to, '[)')
    )
    -- Out on a hire that is past its return date and has not come back. The
    -- real return date is unknown, so no period can be promised.
    and not exists (
      select 1
      from public.rentals r
      where r.organization_id = v.organization_id
        and r.vehicle_id = v.id
        and r.status = 'active'
        and r.returned_at is null
        and r.ends_at <= now()
        and r.id is distinct from p_exclude_rental_id
    )
    and not exists (
      select 1
      from public.maintenance_records m
      where m.organization_id = v.organization_id
        and m.vehicle_id = v.id
        and app.maintenance_restriction_range(
              m.status, m.scheduled_start, m.expected_completion, m.actual_start
            ) && tstzrange(p_from, p_to, '[)')
    )
  order by v.id;
end $$;

comment on function public.vehicles_available_between(uuid, timestamptz, timestamptz, uuid) is
  'Vehicles bookable for a period. Excludes restricted vehicles, overlapping contracts, cars out on an overdue unreturned hire, and the period each maintenance record actually restricts.';

revoke all on function public.vehicles_available_between(uuid, timestamptz, timestamptz, uuid) from public;
grant execute on function public.vehicles_available_between(uuid, timestamptz, timestamptz, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. The rental guard agrees with availability, and checkout revalidates
--
-- Two separate rules:
--   * a contract may not overlap the period a maintenance record restricts;
--   * taking custody now is refused while the vehicle is restricted now,
--     whatever the contract's own dates say.
--
-- Urgent maintenance no longer exempts a new contract. Urgency is about being
-- allowed to record the work despite existing rentals, which the maintenance
-- window guard still permits; it was never a licence to book a fresh rental
-- into a vehicle that is being repaired.
-- ---------------------------------------------------------------------------

create or replace function app.validate_rental_maintenance()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.status not in ('reserved', 'active') then
    return new;
  end if;

  -- An inverted period is rejected by rentals_period_valid, and that is the
  -- error the caller should see. Building a range out of it here would raise
  -- a Postgres internal message first and hide the real reason.
  if new.ends_at is null or new.starts_at is null or new.ends_at <= new.starts_at then
    return new;
  end if;

  if new.status = 'active' and exists (
    select 1
    from public.maintenance_records m
    where m.organization_id = new.organization_id
      and m.vehicle_id = new.vehicle_id
      and app.maintenance_restriction_range(
            m.status, m.scheduled_start, m.expected_completion, m.actual_start
          ) @> now()
  ) then
    raise exception 'Vehicle is unavailable because it is in maintenance.' using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from public.maintenance_records m
    where m.organization_id = new.organization_id
      and m.vehicle_id = new.vehicle_id
      and app.maintenance_restriction_range(
            m.status, m.scheduled_start, m.expected_completion, m.actual_start
          ) && tstzrange(new.starts_at, new.ends_at, '[)')
  ) then
    raise exception 'Vehicle is unavailable during scheduled maintenance.' using errcode = 'P0001';
  end if;

  return new;
end $$;

drop trigger if exists rentals_maintenance_guard on public.rentals;
create trigger rentals_maintenance_guard
  before insert or update of vehicle_id, status, starts_at, ends_at on public.rentals
  for each row execute function app.validate_rental_maintenance();

-- ---------------------------------------------------------------------------
-- 6. Conflict listing uses the same definition
-- ---------------------------------------------------------------------------

create or replace function public.maintenance_conflicts(p_maintenance_id uuid)
returns table(rental_id uuid, rental_reference text, rental_status public.rental_status, starts_at timestamptz, ends_at timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select r.id, r.reference, r.status, r.starts_at, r.ends_at
  from public.maintenance_records m
  join public.rentals r
    on r.organization_id = m.organization_id and r.vehicle_id = m.vehicle_id
  where m.id = p_maintenance_id
    and app.is_org_member(m.organization_id)
    and r.status in ('reserved', 'active')
    and app.maintenance_restriction_range(
          m.status, m.scheduled_start, m.expected_completion, m.actual_start
        ) && tstzrange(r.starts_at, r.ends_at, '[)');
$$;

revoke all on function public.maintenance_conflicts(uuid) from public;
grant execute on function public.maintenance_conflicts(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Downtime is time the vehicle was actually off the road
--
-- The previous definition counted scheduled work that had not happened yet,
-- and ran an unfinished record all the way to the end of the reporting window
-- instead of to now. Only records that actually started count; an unfinished
-- one accrues up to this moment; overlapping records are merged so shared time
-- is counted once.
-- ---------------------------------------------------------------------------

create or replace function public.maintenance_vehicle_downtime(
  p_vehicle_id uuid,
  p_from       timestamptz,
  p_to         timestamptz
)
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with actual as (
    select m.actual_start as started,
           coalesce(m.actual_completion, now()) as ended
    from public.maintenance_records m
    where m.vehicle_id = p_vehicle_id
      and app.is_org_member(m.organization_id)
      and m.status in ('in_progress', 'completed')
      and m.actual_start is not null
  ),
  clipped as (
    select greatest(started, p_from) as started,
           least(ended, p_to) as ended
    from actual
    where started < p_to and ended > p_from
  ),
  ordered as (
    select started, ended,
           max(ended) over (
             order by started, ended
             rows between unbounded preceding and 1 preceding
           ) as prior_end
    from clipped
  ),
  grouped as (
    select started, ended,
           sum(case when prior_end is null or started > prior_end then 1 else 0 end) over (
             order by started, ended
             rows between unbounded preceding and current row
           ) as island
    from ordered
  )
  select coalesce(round(extract(epoch from sum(ended - started)) / 60)::integer, 0)
  from (
    select min(started) as started, max(ended) as ended
    from grouped
    group by island
  ) merged;
$$;

comment on function public.maintenance_vehicle_downtime(uuid, timestamptz, timestamptz) is
  'Minutes a vehicle was actually out of service within a period. Only work that started counts, unfinished work accrues to now, and overlapping records are merged.';

revoke all on function public.maintenance_vehicle_downtime(uuid, timestamptz, timestamptz) from public;
grant execute on function public.maintenance_vehicle_downtime(uuid, timestamptz, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Authorized operational actions
--
-- These replace the Operational status dropdown. Each one changes exactly the
-- restriction it names and nothing else.
--
-- Billing: the two that put a vehicle back into service ask
-- app.billing_require_write, like every other write a restricted agency is not
-- allowed to make. vehicle_take_off_road deliberately does not.
--
-- Taking an unroadworthy car off the road is a safety obligation, not a
-- commercial one. It makes the fleet smaller, never larger, and it cannot be
-- used to work around a lapsed subscription. An agency whose card has expired
-- must still be able to stop a cracked windscreen being hired out, for the
-- same reason recording terms acceptance and enrolling a second factor are
-- exempt: the act belongs to safety, not to the subscription. It is listed in
-- the exempt set in billing-restricted-access.test.ts, and this paragraph is
-- the reason that listing refers to.
-- ---------------------------------------------------------------------------

create or replace function public.vehicle_take_off_road(p_vehicle_id uuid, p_reason text)
returns public.vehicles
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_row public.vehicles;
begin
  select * into v_row from public.vehicles where id = p_vehicle_id for update;
  if v_row.id is null or not app.has_min_role(v_row.organization_id, 'manager') then
    raise exception 'Vehicle not found.' using errcode = 'P0002';
  end if;
  if v_row.archived_at is not null then
    raise exception 'This vehicle is archived.' using errcode = '22023';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'A reason is required to take a vehicle off the road.' using errcode = '22023';
  end if;
  if v_row.status <> 'available' then
    raise exception 'This vehicle is already restricted.' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.rentals r
    where r.organization_id = v_row.organization_id
      and r.vehicle_id = v_row.id
      and r.status = 'active'
  ) then
    raise exception 'This vehicle is out on an active rental.' using errcode = 'P0001';
  end if;

  perform set_config('pevvy.vehicle_status_write', 'on', true);
  update public.vehicles
     set status = 'unavailable',
         off_road_reason = btrim(p_reason),
         off_road_at = now(),
         off_road_by = auth.uid()
   where id = p_vehicle_id
  returning * into v_row;
  perform set_config('pevvy.vehicle_status_write', 'off', true);

  return v_row;
end $$;

create or replace function public.vehicle_return_to_service(p_vehicle_id uuid)
returns public.vehicles
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_row public.vehicles;
begin
  select * into v_row from public.vehicles where id = p_vehicle_id for update;
  if v_row.id is null or not app.has_min_role(v_row.organization_id, 'manager') then
    raise exception 'Vehicle not found.' using errcode = 'P0002';
  end if;
  perform app.billing_require_write(v_row.organization_id);
  if v_row.status <> 'unavailable' then
    raise exception 'This vehicle is not off the road.' using errcode = '22023';
  end if;

  -- The status guard refuses this while maintenance is still open, so the
  -- independent restriction is the only thing released here.
  perform set_config('pevvy.vehicle_status_write', 'on', true);
  update public.vehicles
     set status = 'available',
         off_road_reason = null,
         off_road_at = null,
         off_road_by = null
   where id = p_vehicle_id
  returning * into v_row;
  perform set_config('pevvy.vehicle_status_write', 'off', true);

  return v_row;
end $$;

-- A vehicle carrying the legacy manual 'maintenance' value, with no maintenance
-- record behind it, is a restriction nobody can resolve through the new
-- workflow. This is the one way out, and it refuses while real work is open.
create or replace function public.vehicle_resolve_legacy_maintenance(p_vehicle_id uuid, p_reason text)
returns public.vehicles
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_row public.vehicles;
begin
  select * into v_row from public.vehicles where id = p_vehicle_id for update;
  if v_row.id is null or not app.has_min_role(v_row.organization_id, 'manager') then
    raise exception 'Vehicle not found.' using errcode = 'P0002';
  end if;
  perform app.billing_require_write(v_row.organization_id);
  if v_row.status <> 'maintenance' then
    raise exception 'This vehicle does not carry a legacy maintenance restriction.' using errcode = '22023';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'Confirm why this vehicle is roadworthy.' using errcode = '22023';
  end if;

  perform set_config('pevvy.vehicle_status_write', 'on', true);
  update public.vehicles
     set status = 'available'
   where id = p_vehicle_id
  returning * into v_row;
  perform set_config('pevvy.vehicle_status_write', 'off', true);

  return v_row;
end $$;

revoke all on function
  public.vehicle_take_off_road(uuid, text),
  public.vehicle_return_to_service(uuid),
  public.vehicle_resolve_legacy_maintenance(uuid, text)
from public;
grant execute on function
  public.vehicle_take_off_road(uuid, text),
  public.vehicle_return_to_service(uuid),
  public.vehicle_resolve_legacy_maintenance(uuid, text)
to authenticated;

-- ---------------------------------------------------------------------------
-- 9. Fleet projection carries the restriction context the UI needs
--
-- Columns are appended, so every existing consumer keeps working.
-- ---------------------------------------------------------------------------

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
  maintenance.upcoming_expected_completion as upcoming_maintenance_expected_completion,
  -- Appended for acceptance remediation.
  v.off_road_reason,
  v.off_road_at,
  (v.status = 'maintenance') as legacy_maintenance_restriction,
  (v.status = 'unavailable') as off_road_restriction,
  maintenance.open_count as open_maintenance_count
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
    (array_agg(m.expected_completion order by m.scheduled_start) filter (where m.status='scheduled' and m.scheduled_start > now()))[1] as upcoming_expected_completion,
    count(*) filter (where m.status in ('scheduled','in_progress')) as open_count
  from public.maintenance_records m where m.organization_id=v.organization_id and m.vehicle_id=v.id
) maintenance on true;

revoke all on public.vehicle_fleet from anon, authenticated;
grant select on public.vehicle_fleet to authenticated;

-- ---------------------------------------------------------------------------
-- 10. Rescheduling a reservation that predates the assignment lifecycle
--
-- app.assignment_lifecycle_active() is true only for an org member, so a
-- rental confirmed outside a member session -- service-role tooling, an Edge
-- Function, an import, a fixture -- never had an assignment row opened for it.
-- A member then rescheduling that reservation hit 'Current rental assignment
-- not found.' and could not move it at all.
--
-- rental_confirm already handles the same gap by opening the assignment it
-- needs. This does exactly that, for the state the rental is actually in, so
-- the sync has something to update. It opens nothing when the lifecycle is
-- off, and it never invents a vehicle: the assignment points at the vehicle
-- the rental already carries.
--
-- TWO CALLERS, NOT ONE. public.rental_extend reaches this same function for a
-- reserved rental, so extending one of those reservations stops failing too.
-- That is stated rather than designed around: it is one defect in two doorways,
-- and narrowing the repair to rescheduling would leave a member able to move a
-- booking but not to lengthen it, for no reason they could ever discover. The
-- row opened on the extend path carries reason 'initial' because that is what
-- it records -- the original booking nobody wrote down -- not the extension.
-- Both paths are covered in supabase/tests/maintenance-acceptance.test.ts.
-- ---------------------------------------------------------------------------

create or replace function app.sync_rental_assignment_schedule(
  p_rental_id   uuid,
  p_vehicle_id  uuid,
  p_starts_at   timestamptz,
  p_ends_at     timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rental     public.rentals;
  v_assignment public.rental_vehicle_assignments;
  v_vehicle    public.vehicles;
begin
  select r.* into v_rental from public.rentals r where r.id = p_rental_id for update;
  if v_rental.id is null or not app.has_min_role(v_rental.organization_id, 'staff'::public.org_role) then
    raise exception 'Rental not found.' using errcode = 'P0002';
  end if;

  select a.* into v_assignment
  from public.rental_vehicle_assignments a
  where a.rental_id = v_rental.id and a.organization_id = v_rental.organization_id
    and ((v_rental.status = 'draft' and a.state = 'planned')
         or (v_rental.status = 'reserved' and a.state = 'reserved'))
  order by a.sequence_no desc limit 1 for update;

  if v_assignment.id is null then
    if v_rental.status not in ('draft', 'reserved') then
      raise exception 'Current rental assignment not found.' using errcode = 'P0002';
    end if;
    -- Opened in the state the rental is already in. app.open_rental_assignment
    -- requires exactly that, and it is the honest record: nothing was planned
    -- earlier, so there is no earlier state to pretend to.
    v_assignment := app.open_rental_assignment(
      p_rental_id,
      v_rental.vehicle_id,
      (case when v_rental.status = 'draft' then 'planned' else 'reserved' end)::public.rental_assignment_state,
      'initial'::public.rental_assignment_reason
    );
  end if;

  select v.* into v_vehicle from public.vehicles v
   where v.id = p_vehicle_id and v.organization_id = v_rental.organization_id for update;
  if v_vehicle.id is null then raise exception 'Vehicle not found.' using errcode = 'P0002'; end if;
  if v_vehicle.archived_at is not null or v_vehicle.status <> 'available' then
    raise exception 'Vehicle is not available.' using errcode = '23514';
  end if;
  if p_ends_at <= p_starts_at then
    raise exception 'The return must be after the collection.' using errcode = '23514';
  end if;

  perform pg_catalog.set_config('app.assignment_write', 'on', true);
  update public.rental_vehicle_assignments
     set vehicle_id = p_vehicle_id, scheduled_starts_at = p_starts_at, scheduled_ends_at = p_ends_at
   where id = v_assignment.id;
  perform pg_catalog.set_config('app.assignment_write', 'off', true);
end;
$$;

revoke all on function app.sync_rental_assignment_schedule(uuid, uuid, timestamptz, timestamptz) from public, anon;
grant execute on function app.sync_rental_assignment_schedule(uuid, uuid, timestamptz, timestamptz) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 11. Account closure reaches the maintenance and incident data
--
-- The maintenance and incident work packages added four tables that carry an
-- organization_id, and three private buckets, without listing any of them in
-- the account purge. A closing agency's repair history, incident reports and
-- the private documents behind them therefore survived a purge that reports
-- itself complete. app.organization_purge_tables() says as much in its own
-- comment: a table added without being listed there stops the purge before it
-- deletes anything, and that is exactly what had been happening.
--
-- Order is children first, and both groups come before vehicles and rentals,
-- which they reference with on delete restrict.
-- ---------------------------------------------------------------------------

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
    -- expenses (expenses.maintenance_id points at a record emptied below)
    'expense_attachments', 'expense_change_events', 'expenses',
    'expense_categories', 'expense_vendors',
    -- financing
    'financing_documents', 'financing_change_events', 'financing_payments',
    'financing_installments', 'financing_agreements', 'lenders',
    -- public booking (references vehicles, customers and rentals)
    'booking_leads',
    -- maintenance and incidents: both reference vehicles with on delete
    -- restrict, so they are emptied before the fleet
    'maintenance_documents', 'maintenance_records',
    'incident_attachments', 'incidents',
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

-- The storage sweep, extended to the three private buckets those tables use.
-- Without this the rows went and the files stayed, which is the half of a purge
-- that actually matters for a document somebody uploaded.
create or replace function app.organization_collect_objects(p_organization_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prefix text := p_organization_id::text || '/';
begin
  /*
   * Only for an agency that is being or has been purged. This writes a complete
   * inventory of an agency's storage keys, passport and licence scans included,
   * into the table the Storage sweep deletes from. Run against a live agency it
   * would hand the sweep a list of a live tenant's documents.
   */
  if app.closure_state_of(p_organization_id) not in ('purging', 'closed') then
    raise exception 'Objects are only collected for an agency that is being purged (state: %).',
      app.closure_state_of(p_organization_id)
      using errcode = '55000';
  end if;

  insert into public.account_closure_objects (organization_id, bucket, storage_key)
  select p_organization_id, found.bucket, found.storage_key
    from (
      select 'customer-documents' as bucket, d.file_path as storage_key
        from public.customer_documents d where d.organization_id = p_organization_id
      union all
      select 'vehicle-documents', d.file_path
        from public.vehicle_documents d where d.organization_id = p_organization_id
      union all
      select 'vehicle-photos', i.storage_path
        from public.vehicle_images i where i.organization_id = p_organization_id
      union all
      select 'vehicle-photos', i.thumbnail_path
        from public.vehicle_images i where i.organization_id = p_organization_id
      union all
      select 'rental-documents', p.storage_path
        from public.rental_condition_photos p where p.organization_id = p_organization_id
      union all
      select 'rental-documents', c.renter_signature_path
        from public.rental_contracts c where c.organization_id = p_organization_id
      union all
      select 'rental-documents', c.agency_signature_path
        from public.rental_contracts c where c.organization_id = p_organization_id
      union all
      select 'rental-documents', c.pdf_path
        from public.rental_contracts c where c.organization_id = p_organization_id
      union all
      select 'expense-receipts', a.storage_path
        from public.expense_attachments a where a.organization_id = p_organization_id
      union all
      select 'financing-documents', f.storage_path
        from public.financing_documents f where f.organization_id = p_organization_id
      union all
      select 'maintenance-documents', m.storage_path
        from public.maintenance_documents m where m.organization_id = p_organization_id
      union all
      select case when a.kind = 'photo' then 'incident-photos' else 'incident-documents' end,
             a.storage_path
        from public.incident_attachments a where a.organization_id = p_organization_id
      union all
      select 'organization-logos', o.logo_path
        from public.organizations o where o.id = p_organization_id
      union all
      select o.bucket_id, o.name
        from storage.objects o
       where o.bucket_id in (
               'customer-documents', 'rental-documents', 'vehicle-documents',
               'vehicle-photos', 'expense-receipts', 'financing-documents',
               'organization-logos', 'maintenance-documents',
               'incident-photos', 'incident-documents'
             )
         and left(o.name, char_length(v_prefix)) = v_prefix
    ) as found
   where found.storage_key is not null
     and left(found.storage_key, char_length(v_prefix)) = v_prefix
  on conflict (bucket, storage_key) do nothing;

  return (select count(*)::integer
            from public.account_closure_objects x
           where x.organization_id = p_organization_id);
end;
$$;

-- The same tripwire the assignment migration used: if the lists and the schema
-- disagree, this migration fails rather than leaving a purge that quietly
-- misses a table.
do $assert$
begin
  if not app.organization_purge_lists_agree() then
    raise exception 'maintenance and incident tables left the purge lists disagreeing with the schema: %',
      app.organization_purge_list_disagreement();
  end if;
end;
$assert$;


-- ---------------------------------------------------------------------------
-- 12. A backstop on the private app schema, not a fix for a known exposure
--
-- Say plainly what this is, because the obvious reading is wrong: anon has
-- never been able to reach schema app. 20260821100500 revoked USAGE on the
-- schema from public and anon, revoked EXECUTE on everything then in it, and
-- set ALTER DEFAULT PRIVILEGES so a function added later gets no PUBLIC grant
-- either. On the hosted database this block therefore finds nothing to revoke
-- and re-issues grants that already exist.
--
-- It stays because it costs nothing and it is not a no-op everywhere. The
-- in-memory test harness does not carry that migration's default privileges
-- across, so functions created in app there DO land with the built-in PUBLIC
-- grant; this block is what brings the harness back in line with hosted. It
-- also holds if a future migration adds an app function without its own
-- revoke, or if default privileges are ever reset by a restore.
--
-- Whatever the starting state, the method is the same: record what
-- authenticated and service_role can execute, revoke from public and anon,
-- then grant back exactly what was recorded. Never more than was held before,
-- and nothing a legitimate caller was relying on is taken away. A function
-- that needs an invoker-context grant still states it explicitly, as section 3
-- does -- this block must not be the only thing standing between a member and
-- the vehicle picker.
-- ---------------------------------------------------------------------------

do $privileges$
declare
  v_function record;
begin
  create temporary table app_privilege_snapshot on commit drop as
    select p.oid as function_oid,
           has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_may,
           has_function_privilege('service_role', p.oid, 'EXECUTE') as service_may
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     -- Functions and procedures. ROUTINE covers both below; an aggregate is
     -- neither and would abort the loop, so it is excluded here rather than
     -- left to fail the deploy on the day somebody adds one.
     where n.nspname = 'app' and p.prokind in ('f', 'p');

  for v_function in
    select p.oid::regprocedure as signature
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'app' and p.prokind in ('f', 'p')
  loop
    execute format('revoke all on routine %s from public, anon', v_function.signature);
  end loop;

  for v_function in
    select function_oid::regprocedure as signature
      from app_privilege_snapshot
     where authenticated_may
  loop
    execute format('grant execute on routine %s to authenticated', v_function.signature);
  end loop;

  for v_function in
    select function_oid::regprocedure as signature
      from app_privilege_snapshot
     where service_may
  loop
    execute format('grant execute on routine %s to service_role', v_function.signature);
  end loop;
end;
$privileges$;

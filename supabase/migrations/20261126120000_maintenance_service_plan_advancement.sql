-- Recurring preventive servicing: completing qualifying maintenance advances
-- the plan the record was carrying.
--
-- public.maintenance_set_service_plan (20261125110000) records a recurrence
-- rule on a maintenance record -- an interval in days, an interval in
-- distance, or both -- but nothing ever recomputed the thresholds when the
-- work was actually done. The plan stayed at its first value for ever: once
-- the date passed, the record read "service is due" permanently, and the next
-- service was never derived by the system that was asked to remember it.
-- Verified against the migration history before writing this: completing a
-- record with intervals of 180 days and 5,000 left next_service_on and
-- next_service_odometer exactly as they were.
--
-- This replaces public.maintenance_complete with the same signature and the
-- same guards, and adds one step at the end: when the record carries a
-- recurrence rule, the next thresholds are recomputed from the completion that
-- was just recorded.
--
--   by date      the completion date, read in the agency's own time zone the
--                way every other date in this schema is derived from a
--                timestamptz (20260813090800:80-81), plus service_interval_days.
--                A completion at 23:00 in Casablanca is the 10th, not the 11th.
--
--   by distance  the reading taken for THIS job -- the completion reading, or
--                failing that the reading taken when the vehicle went in --
--                plus service_interval_odometer. Where neither was recorded the
--                distance threshold is left exactly as it was, because there is
--                nothing to compute it from.
--
--                public.vehicles.odometer is deliberately NOT used as a
--                substitute. It is the fleet's last rental hand-over reading,
--                not a reading taken at the garage, and borrowing it would
--                manufacture evidence that somebody read the odometer during
--                the service when nobody did.
--
-- Unrelated maintenance is unaffected, and the guarantee is structural rather
-- than conditional. The plan columns live on the record being completed; they
-- arrive only through maintenance_set_service_plan, which is manager-only;
-- and maintenance_create never populates them. An ordinary repair therefore
-- completes with all four still null and the advancement does nothing.
--
-- "Qualifying" is "the record carries a recurrence rule", not
-- "category = 'preventive'". The category enum has eleven values and several
-- of them are recurring servicing, while a record categorised 'preventive' may
-- carry no plan at all. A record holding only a one-off next_service_on with
-- no interval is correctly excluded: there is no rule to recur.
--
-- Advancing twice is impossible for the reason it always was: completion
-- requires status 'in_progress' and sets 'completed' in the same statement,
-- the row is locked FOR UPDATE before the test, and nothing puts a completed
-- record back -- maintenance_start requires 'scheduled'.
--
-- Nothing here changes what a vehicle is allowed to do. A service plan is a
-- reminder; availability is decided by maintenance records and by explicit
-- off-road restrictions, and neither is touched.

create or replace function public.maintenance_complete(
  p_maintenance_id      uuid,
  p_actual_completion   timestamptz default now(),
  p_completion_notes    text default null,
  p_work_performed      text default null,
  p_completion_odometer integer default null
)
returns public.maintenance_records
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row       public.maintenance_records;
  v_time_zone text;
  v_reading   integer;
  v_next_on   date;
  v_next_odo  integer;
begin
  select * into v_row from public.maintenance_records where id = p_maintenance_id for update;

  if v_row.id is null or not app.has_min_role(v_row.organization_id, 'manager') then
    raise exception 'Maintenance record not found.' using errcode = 'P0002';
  end if;

  if v_row.status <> 'in_progress' then
    raise exception 'Only in-progress maintenance can be completed.' using errcode = '22023';
  end if;

  update public.maintenance_records
     set status              = 'completed',
         actual_completion   = coalesce(p_actual_completion, now()),
         completion_notes    = nullif(btrim(p_completion_notes), ''),
         work_performed      = coalesce(nullif(btrim(p_work_performed), ''), work_performed),
         completion_odometer = coalesce(p_completion_odometer, completion_odometer),
         completed_by        = auth.uid()
   where id = p_maintenance_id
  returning * into v_row;

  -- Nothing recurring on this record: an ordinary repair ends here.
  if v_row.service_interval_days is null and v_row.service_interval_odometer is null then
    return v_row;
  end if;

  select o.time_zone into v_time_zone
  from public.organizations o
  where o.id = v_row.organization_id;

  v_next_on  := v_row.next_service_on;
  v_next_odo := v_row.next_service_odometer;

  if v_row.service_interval_days is not null then
    v_next_on := (v_row.actual_completion at time zone coalesce(v_time_zone, 'UTC'))::date
                 + v_row.service_interval_days;
  end if;

  -- Only a reading actually taken for this job. Never public.vehicles.odometer.
  v_reading := coalesce(v_row.completion_odometer, v_row.start_odometer);

  if v_row.service_interval_odometer is not null and v_reading is not null then
    v_next_odo := v_reading + v_row.service_interval_odometer;
  end if;

  update public.maintenance_records
     set next_service_on       = v_next_on,
         next_service_odometer = v_next_odo
   where id = p_maintenance_id
  returning * into v_row;

  return v_row;
end $$;

comment on function public.maintenance_complete(uuid, timestamptz, text, text, integer) is
  'Completes maintenance and, where the record carries a recurrence rule, advances its service plan from the completion date and the odometer reading taken for that job. Never reads public.vehicles.odometer: that is a hand-over reading, not a service reading.';

-- The signature is unchanged, so the existing grants still apply. Restated
-- because `create or replace` on a function whose owner differs would not, and
-- because a reader should not have to go back to 20261125110000 to find out
-- who may call this.
revoke all on function public.maintenance_complete(uuid, timestamptz, text, text, integer) from public, anon;
grant execute on function public.maintenance_complete(uuid, timestamptz, text, text, integer) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Fleet-wide downtime, for the Maintenance dashboard.
-- -----------------------------------------------------------------------------
--
-- public.maintenance_vehicle_downtime answers for one vehicle. A dashboard tile
-- covering the whole fleet would otherwise have to call it once per vehicle and
-- add the answers up in the browser, which is a request per car and a second
-- implementation of the merge waiting to be written.
--
-- Overlapping work on the SAME vehicle is merged, exactly as the per-vehicle
-- function does, so a car with two concurrent records is not counted twice.
-- Different vehicles are summed, because two cars off the road at once really
-- is twice the downtime.
--
-- "Actual" means what it says: only work that has actually started counts, and
-- work still in progress accrues to now() or to the end of the window,
-- whichever comes first. Scheduled-but-unstarted work is not downtime.

create or replace function public.maintenance_fleet_downtime(
  p_organization_id uuid,
  p_from            timestamptz,
  p_to              timestamptz
)
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with actual as (
    select m.vehicle_id,
           m.actual_start as started,
           coalesce(m.actual_completion, now()) as ended
    from public.maintenance_records m
    where m.organization_id = p_organization_id
      and app.is_org_member(p_organization_id)
      and m.status in ('in_progress', 'completed')
      and m.actual_start is not null
  ),
  clipped as (
    select vehicle_id,
           greatest(started, p_from) as started,
           least(ended, p_to) as ended
    from actual
    where started < p_to and ended > p_from
  ),
  ordered as (
    select vehicle_id, started, ended,
           max(ended) over (
             partition by vehicle_id
             order by started, ended
             rows between unbounded preceding and 1 preceding
           ) as prior_end
    from clipped
  ),
  grouped as (
    select vehicle_id, started, ended,
           sum(case when prior_end is null or started > prior_end then 1 else 0 end) over (
             partition by vehicle_id
             order by started, ended
             rows between unbounded preceding and current row
           ) as island
    from ordered
  )
  select coalesce(round(extract(epoch from sum(ended - started)) / 60)::integer, 0)
  from (
    select min(started) as started, max(ended) as ended
    from grouped
    group by vehicle_id, island
  ) merged;
$$;

comment on function public.maintenance_fleet_downtime(uuid, timestamptz, timestamptz) is
  'Total minutes the fleet was actually out of service in a window. Overlapping records on one vehicle are merged; separate vehicles are summed. Scheduled work that never started is not counted.';

revoke all on function public.maintenance_fleet_downtime(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.maintenance_fleet_downtime(uuid, timestamptz, timestamptz) to authenticated, service_role;

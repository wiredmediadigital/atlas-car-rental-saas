-- Refuse a vehicle past the agency's limit.
--
-- This is the gate. The interface shows the count and later refuses a downgrade,
-- but nothing in the browser is a barrier: the refusal has to happen inside the
-- write, so it is a trigger on public.vehicles.
--
-- Two moments add a vehicle to the count:
--   * an INSERT of an unarchived vehicle, and
--   * an UPDATE that moves a vehicle from archived to active.
-- Every other update passes untouched. The limit is never retroactive: an agency
-- that is over its limit for any reason can still edit, rent and archive what it
-- already has. Archiving only lowers the count, so it is always allowed.
--
-- The function is SECURITY DEFINER because app.vehicle_limit_of and
-- app.vehicle_count_of are granted to service_role only (they take an arbitrary
-- organization id); a plain trigger function would run as the inserting user and
-- hit "permission denied". The empty search_path matches every function here.
--
-- The organization row is locked first so that, on a real server, two sessions
-- adding the last slot at once queue behind each other and the second one counts
-- the first one's vehicle.
--
-- The database states the fact; the interface adds the ways out. Bulk imports are
-- deliberately not special-cased: the import RPC checks capacity up front and this
-- trigger stays beneath it as the backstop.

create or replace function app.enforce_vehicle_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer;
  v_count integer;
begin
  if tg_op = 'UPDATE' then
    if not (old.archived_at is not null and new.archived_at is null) then
      return new;
    end if;
  elsif new.archived_at is not null then
    return new;
  end if;

  perform 1
    from public.organizations o
   where o.id = new.organization_id
     for update;

  v_limit := app.vehicle_limit_of(new.organization_id);
  if v_limit is null then
    return new;
  end if;

  v_count := app.vehicle_count_of(new.organization_id);
  if v_count >= v_limit then
    raise exception 'Your plan covers % vehicles. You have %.', v_limit, v_count
      using errcode = '55000';
  end if;

  return new;
end;
$$;

comment on function app.enforce_vehicle_limit() is
  'BEFORE INSERT / UPDATE trigger on public.vehicles: refuses an unarchived vehicle past the agency''s limit (errcode 55000). UPDATE is checked only on the archived-to-active transition, so the limit is never retroactive. SECURITY DEFINER because the resolvers are granted to service_role only.';

revoke all on function app.enforce_vehicle_limit() from public, anon, authenticated;

drop trigger if exists vehicles_enforce_limit_on_insert on public.vehicles;
create trigger vehicles_enforce_limit_on_insert
  before insert on public.vehicles
  for each row execute function app.enforce_vehicle_limit();

drop trigger if exists vehicles_enforce_limit_on_restore on public.vehicles;
create trigger vehicles_enforce_limit_on_restore
  before update on public.vehicles
  for each row
  when (old.archived_at is not null and new.archived_at is null)
  execute function app.enforce_vehicle_limit();

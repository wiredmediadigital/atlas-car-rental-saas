-- Availability search withholds a car that is out on an overdue hire.
--
-- 20260825100000 made vehicle_fleet treat an active rental as current from
-- check-out until completion, whatever the schedule says, and left availability
-- search alone as out of its scope. The two then disagreed: the fleet page
-- showed a late car as 'rented' while the booking picker offered it for any
-- period starting after its scheduled return, and the exclusion constraint
-- accepted the booking because the ranges do not overlap.
--
-- A hire past its scheduled return with no recorded return is the one case
-- where a later period cannot be promised. The contract's ends_at has already
-- proved not to be evidence of anything: the car is with a customer and nobody
-- knows when it is coming back. Booking ahead for a hire that is running to
-- schedule stays untouched — that is ordinary business, and the fleet timeline
-- exists to support it.
--
-- p_exclude_rental_id is deliberately NOT honoured by the new condition. That
-- parameter exists so a contract does not conflict with itself when its own
-- period is edited; it says nothing about where the car physically is. A car
-- nobody has brought back is missing whichever contract you are editing, and
-- the one flow that edits an overdue hire's dates (ExtendDialog) asks
-- rental_period_conflicts, not this function.
--
-- Only this condition changes. Signature, volatility, search_path, membership
-- check, period validation, ordering and grants are as before.

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
    and v.status = 'available'
    -- Mirrors the rentals_no_vehicle_overlap exclusion constraint exactly, so a
    -- vehicle offered here is one the database will actually accept a booking
    -- for. The constraint remains the authority; this only avoids offering
    -- choices that would be rejected.
    and not exists (
      select 1
      from public.rentals r
      where r.vehicle_id = v.id
        and r.status in ('reserved', 'active')
        and (p_exclude_rental_id is null or r.id <> p_exclude_rental_id)
        and tstzrange(r.starts_at, r.ends_at, '[)') && tstzrange(p_from, p_to, '[)')
    )
    -- Narrower than the constraint, never wider: this withholds vehicles the
    -- constraint would have accepted, so the guarantee above still holds in the
    -- direction that matters — nothing is offered that would be rejected.
    and not exists (
      select 1
      from public.rentals r
      where r.vehicle_id = v.id
        and r.status = 'active'
        and r.returned_at is null
        and r.ends_at <= now()
    )
  order by v.id;
end;
$$;

comment on function public.vehicles_available_between(uuid, timestamptz, timestamptz, uuid) is
  'Vehicles bookable for a period. Excludes cars out on an overdue, unreturned hire, whose return date is unknown. p_exclude_rental_id lets an existing contract be rescheduled without conflicting with itself.';

revoke all on function public.vehicles_available_between(uuid, timestamptz, timestamptz, uuid) from public;
grant execute on function public.vehicles_available_between(uuid, timestamptz, timestamptz, uuid) to authenticated;

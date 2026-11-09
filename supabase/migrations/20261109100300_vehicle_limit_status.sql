-- =============================================================================
-- vehicle_limit_status: what the Vehicles page shows beside its heading
-- =============================================================================
--
-- app.vehicle_limit_of and app.vehicle_count_of are granted to service_role only:
-- they are definer functions that take any organization id, so granting them to
-- authenticated would let anyone read another agency's ceiling and fleet size.
-- This function is the member-gated door to them, in the shape of
-- public.fleet_status_counts: 42501 before anything is returned to a non-member.
--
--   vehicle_limit  null means no limit (no authored plan row, an unconfigured
--                  platform, or no subscription); the interface hides the counter.
--   vehicle_count  unarchived vehicles.
--   tier           the lowercase tier key of the agency's effective plan, or null.
--                  It is the PLAN's tier even when a per-agency override sets a
--                  different limit; the interface compares the two.

create or replace function public.vehicle_limit_status(p_organization_id uuid)
returns table (
  vehicle_limit integer,
  vehicle_count integer,
  tier          text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app.is_org_member(p_organization_id) then
    raise exception 'Not a member of this organization.' using errcode = '42501';
  end if;

  return query
  select
    app.vehicle_limit_of(p_organization_id),
    app.vehicle_count_of(p_organization_id),
    (select l.tier
       from public.plan_vehicle_limits l
      where l.plan_key = (app.billing_effective_subscription(p_organization_id)).plan_key);
end;
$$;

comment on function public.vehicle_limit_status(uuid) is
  'The vehicle limit, the unarchived vehicle count and the plan tier of one agency, for its members only.';

revoke all on function public.vehicle_limit_status(uuid) from public, anon;
grant execute on function public.vehicle_limit_status(uuid) to authenticated;

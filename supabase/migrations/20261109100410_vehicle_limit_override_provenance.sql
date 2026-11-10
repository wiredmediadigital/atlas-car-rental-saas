-- =============================================================================
-- The vehicle limit override: one way in, and provenance that cannot be skipped
-- =============================================================================
--
-- 20261109100000 gave the override three columns and blocked the browser roles
-- from all of them, and 20261109100010 gave the actor column a foreign key. What
-- nothing did was COUPLE them. As service_role,
--
--   update public.organizations set vehicle_limit_override = 150 where id = ...;
--
-- succeeded with both provenance columns null, which is the one thing the spec
-- asks of this feature: "it records who set it and when. A bespoke limit that
-- nobody can explain later is a liability."
--
-- Two halves, and they divide the work on purpose:
--
--   app.set_vehicle_limit_override  writes all three together, or clears all
--                                   three together, and refuses a grant with no
--                                   actor. It is the supported way in, and
--                                   RELEASE.md now names it.
--   the check constraint            makes sure a grant that skipped the function
--                                   cannot be stored at all.
--
-- WHY THE CONSTRAINT NAMES _set_at AND NOT _set_by. The function requires both.
-- The constraint can only require the column that nothing else may null, and
-- `vehicle_limit_override_set_by references auth.users (id) on delete set null`
-- (20261109100010 §1): deleting an operator's account arrives as an ordinary
-- UPDATE that nulls that column. A constraint demanding _set_by beside a live
-- override would turn that referential action into a failed DELETE -- the exact
-- outcome 20261109100010 chose against ("deleting the user must not delete or
-- block on the agency, and a dangling user id in an audit column is worse than
-- an honest null"), and the one 20260821100300 exists to keep working. _set_at
-- is nulled by nothing but this function, so it is the column that can carry the
-- guarantee: an override with a timestamp beside it was granted deliberately,
-- and the WHO may later fade to an honest null without the WHEN being lost.
--
-- The columns were introduced on this branch and no deployment can hold a row
-- that predates them, so the constraint is added validated rather than NOT VALID.

-- -----------------------------------------------------------------------------
-- 1. The supported way to grant, change and withdraw a bespoke limit
-- -----------------------------------------------------------------------------

/**
 * Sets (or clears) one agency's vehicle ceiling, with who did it and when.
 *
 * p_limit null clears all three columns. Any other value must be positive and
 * must come with p_actor, the operator's own auth.users id -- never a shared
 * account and never the agency's owner unless they really did decide it.
 *
 * SECURITY DEFINER with an empty search_path, granted to service_role only, like
 * every other app.* function this feature added. It is deliberately not reachable
 * from any browser role: raising an agency's own ceiling is not a self-serve act,
 * and app.guard_organization_vehicle_limit_columns still refuses that directly.
 */
create or replace function app.set_vehicle_limit_override(
  p_organization_id uuid,
  p_limit integer,
  p_actor uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_limit is not null and p_limit <= 0 then
    raise exception 'A vehicle limit override must be greater than zero.'
      using errcode = '22023';
  end if;

  if p_limit is not null and p_actor is null then
    raise exception 'A vehicle limit override records who set it: p_actor is required.'
      using errcode = '22023';
  end if;

  update public.organizations o
     set vehicle_limit_override = p_limit,
         -- Cleared together, so withdrawing a limit leaves no orphaned provenance.
         vehicle_limit_override_set_by = case when p_limit is null then null else p_actor end,
         vehicle_limit_override_set_at = case when p_limit is null then null else now() end
   where o.id = p_organization_id;

  if not found then
    raise exception 'No agency with that id.' using errcode = 'P0002';
  end if;
end;
$$;

comment on function app.set_vehicle_limit_override(uuid, integer, uuid) is
  'Sets one agency''s bespoke vehicle ceiling together with who set it and when, or clears all three when p_limit is null. The supported way in: a bare UPDATE of vehicle_limit_override is refused by organizations_vehicle_limit_override_provenance. service_role only.';

revoke all on function app.set_vehicle_limit_override(uuid, integer, uuid)
  from public, anon, authenticated;
grant execute on function app.set_vehicle_limit_override(uuid, integer, uuid) to service_role;

-- -----------------------------------------------------------------------------
-- 2. A grant with no provenance cannot be stored
-- -----------------------------------------------------------------------------

alter table public.organizations
  drop constraint if exists organizations_vehicle_limit_override_provenance;
alter table public.organizations
  add constraint organizations_vehicle_limit_override_provenance
  check (
    vehicle_limit_override is null
    or vehicle_limit_override_set_at is not null
  );

comment on column public.organizations.vehicle_limit_override is
  'An operator-set vehicle ceiling that replaces the plan limit for this agency. Service role only: no screen, role or self-serve path may raise an agency''s own ceiling. Set it with app.set_vehicle_limit_override, which records the actor and the time; a bare UPDATE that leaves vehicle_limit_override_set_at null is refused by organizations_vehicle_limit_override_provenance.';
comment on column public.organizations.vehicle_limit_override_set_at is
  'When the override was set. Null exactly when there is no override. Written only by app.set_vehicle_limit_override.';

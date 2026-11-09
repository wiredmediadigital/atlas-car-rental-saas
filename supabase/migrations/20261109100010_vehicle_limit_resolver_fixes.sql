-- =============================================================================
-- Vehicle limit: honour platform_unconfigured, and give the override actor an FK
-- =============================================================================
--
-- Follow-up to 20261109100000_plan_vehicle_limits.sql, in its own migration
-- because an existing migration file is never edited.

-- -----------------------------------------------------------------------------
-- 1. The actor column references auth.users like every other actor column
-- -----------------------------------------------------------------------------
--
-- on delete set null: deleting the user must not delete or block on the agency,
-- and a dangling user id in an audit column is worse than an honest null.
-- schema-invariants enumerates single-column FKs into auth.users from the
-- catalogue, so this column is now covered by its "nothing dangles" check.

alter table public.organizations
  drop constraint if exists organizations_vehicle_limit_override_set_by_fkey;
alter table public.organizations
  add constraint organizations_vehicle_limit_override_set_by_fkey
  foreign key (vehicle_limit_override_set_by) references auth.users (id) on delete set null;

-- -----------------------------------------------------------------------------
-- 2. The plan-derived limit does not apply to an unconfigured platform
-- -----------------------------------------------------------------------------

/**
 * How many unarchived vehicles may this agency have? null means no limit.
 *
 *   1. The per-agency override, if one is set. It SURVIVES an unconfigured
 *      platform: the rule is that a deployment must not acquire a limit out of
 *      nowhere, and an override is not out of nowhere, it is an explicit operator
 *      act recorded with who set it and when.
 *   2. Else, only when app.billing_platform_configured(), the authored limit of
 *      the plan of the agency's effective subscription. billing_platform_configured
 *      is also false when no billing_plans row is active (a dropped plan key, a
 *      partial refresh, a key rotation) even though subscription rows remain; in
 *      that state the rest of the product is unrestricted and a stale
 *      subscription must not impose 5/20/50 on its own.
 *   3. Else null: no limit. A plan key with no authored row, and an agency with
 *      no subscription, fail open on purpose.
 *
 * "Which subscription is the real one" stays app.billing_effective_subscription,
 * the function app.billing_access_state_of uses.
 */
create or replace function app.vehicle_limit_of(p_organization_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select o.vehicle_limit_override
       from public.organizations o
      where o.id = p_organization_id),
    case when app.billing_platform_configured() then
      (select l.vehicle_limit
         from public.plan_vehicle_limits l
        where l.plan_key = (app.billing_effective_subscription(p_organization_id)).plan_key)
    end
  );
$$;

comment on function app.vehicle_limit_of(uuid) is
  'The vehicle ceiling of an agency: its override if set (an override survives platform_unconfigured), else, only while app.billing_platform_configured(), the authored limit of its effective subscription''s plan, else null meaning no limit. Fails open on purpose.';

-- Same grants as before, restated: re-creating a function keeps them, but this
-- keeps the three revokes in this feature spelled the same way.
revoke all on function app.vehicle_limit_of(uuid) from public, anon, authenticated;
grant execute on function app.vehicle_limit_of(uuid) to service_role;
revoke all on function app.guard_organization_vehicle_limit_columns() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 3. Changing an authored limit
-- -----------------------------------------------------------------------------

comment on table public.plan_vehicle_limits is
  'The number of unarchived vehicles each plan key allows. Authored in migrations and written by no sync: billing_plans.entitlements is overwritten by every catalogue refresh, this table is not. A plan key with no row here has no limit. The seed in 20261109100000 is "on conflict do nothing", so re-running a corrected seed changes nothing: a changed limit needs its own later migration containing an explicit UPDATE.';

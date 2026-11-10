-- =============================================================================
-- plan_vehicle_limits: who reads it now, and a tier the resolver would suppress
-- =============================================================================
--
-- Two corrections to the feature built across 20261109100000 to 20261109100300,
-- unrelated to each other except that both are about reading this table.

-- -----------------------------------------------------------------------------
-- 1. The table comment names one reader and there are three
-- -----------------------------------------------------------------------------
--
-- 20261109100000 wrote "the resolver is the only reader and it is security
-- definer", and that was TRUE WHEN WRITTEN: app.vehicle_limit_of was the only
-- thing that touched the table. Two readers arrived afterwards, both legitimate
-- and neither a browser role, and the comment is now the kind of true-once note
-- that sends the next person looking for a reader that does not exist, or
-- stopping them from adding grants a reader already needs.
--
-- 20261109100010 §3 restated this same comment to correct the seed's re-run
-- semantics. Restating it again is the established way here; the sentence about
-- the seed is carried forward unchanged because it is still true.

comment on table public.plan_vehicle_limits is
  'The number of unarchived vehicles each plan key allows. Authored in migrations and written by no sync: billing_plans.entitlements is overwritten by every catalogue refresh, this table is not. A plan key with no row here has no limit. The seed in 20261109100000 is "on conflict do nothing", so re-running a corrected seed changes nothing: a changed limit needs its own later migration containing an explicit UPDATE. THREE READERS, none of them a browser role: app.vehicle_limit_of (security definer, the resolver); public.vehicle_limit_status (security definer, the member-gated door the Vehicles page calls); and the billing Edge Function, which reads plan_key, vehicle_limit and tier directly with the service client when it decides a plan change. 20261109100000 said the resolver was the only reader, which was true when it was written.';

-- -----------------------------------------------------------------------------
-- 2. vehicle_limit_status returned a tier the resolver had just suppressed
-- -----------------------------------------------------------------------------
--
-- 20261109100300 sends vehicle_limit through app.vehicle_limit_of, which since
-- 20261109100010 §2 answers null unless app.billing_platform_configured(). The
-- tier beside it was read straight from plan_vehicle_limits and was not gated, so
-- an unconfigured platform holding a stale subscription row answered
-- `limit: null, tier: 'starter'`: a tier from a plan whose limit the resolver had
-- just refused to honour.
--
-- THERE IS NO VISIBLE CONSEQUENCE TODAY. A null limit hides the counter, and
-- vehicleLimitCopy says nothing without a limit, so the stale tier reaches no
-- sentence. This is a latency, not a bug: it is closed here so the next reader of
-- `tier` -- a badge, a prompt, an export -- does not inherit it. The gate is the
-- same `case when app.billing_platform_configured()` wrapper the resolver uses,
-- written beside the call it belongs to, so the two cannot disagree.
--
-- The override is deliberately NOT part of this: the tier is the PLAN's tier even
-- when a per-agency override sets a different limit, and the interface compares
-- the two. That contract is unchanged.

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
    case when app.billing_platform_configured() then
      (select l.tier
         from public.plan_vehicle_limits l
        where l.plan_key = (app.billing_effective_subscription(p_organization_id)).plan_key)
    end;
end;
$$;

comment on function public.vehicle_limit_status(uuid) is
  'The vehicle limit, the unarchived vehicle count and the plan tier of one agency, for its members only. Both the limit and the tier are gated on app.billing_platform_configured(), so an unconfigured platform with a stale subscription row reports neither.';

-- Same grants as before, restated: re-creating a function keeps them, but this
-- keeps the feature's grants spelled the same way in every migration that
-- redefines one of its functions.
revoke all on function public.vehicle_limit_status(uuid) from public, anon;
grant execute on function public.vehicle_limit_status(uuid) to authenticated;

-- =============================================================================
-- 20261112100200_require_second_factor.sql
--
-- A verified second factor becomes part of the tenant predicate.
--
-- Supabase raises a session's assurance level to `aal2` only when GoTrue itself
-- verifies an enrolled factor, and publishes that level as the `aal` claim of
-- the request's JWT. Everything in this schema that decides "may this request
-- see this agency's data" is expressed in terms of three helpers from
-- 20260813090200_authorization.sql, so the requirement is composed into those
-- three and reaches every RLS policy, every `security_invoker` view and every
-- read model at once, rather than being restated per policy.
--
--   * app.is_org_member            — the base tenant predicate, behind most of
--                                    the read policies in the schema
--   * app.has_min_role             — the role-ranked predicate, behind most of
--                                    the write policies
--   * app.shares_organization_with — the colleague predicate, used directly by
--                                    profiles_select. Without it an aal1 session
--                                    could still enumerate the names and email
--                                    addresses of everyone in its agencies.
--
-- `app.current_role_in` is NOT gated. No policy uses it, so no data is reachable
-- through it, and gating it would be redundant with app.has_min_role, which
-- calls it. BUT read this before assuming the whole product is covered: five
-- SECURITY DEFINER RPCs authorize on app.current_role_in alone and consult no
-- gated helper, so an aal1 session can still reach them —
-- public.organization_request_closure, public.transfer_organization_ownership,
-- public.remove_team_member, public.change_team_member_role and
-- public.create_team_invitation. They read no tenant data through RLS, so this
-- is a write hole rather than a disclosure one, and closing it means adding the
-- predicate to those five checks rather than gating the helper (the membership
-- guard trigger also calls it, on paths that have no user session at all).
--
-- The `id = auth.uid()` half of profiles_select stays ungated: a person can
-- always read their own profile, which is what the sign-in and factor-enrolment
-- screens need before a factor exists.
--
-- Service role is unaffected. It holds `bypassrls`, so no policy expression —
-- and therefore no part of this predicate — is ever evaluated for it.
--
-- DEPLOYMENT ORDER: `[auth.mfa.totp] enroll_enabled` must already be true on the
-- target project before this migration is applied to it. Applied while TOTP is
-- off, nobody can enrol, every session stays at aal1, and every user of every
-- agency is locked out with no way back but service-key SQL.
-- =============================================================================

set search_path = public, extensions, pg_temp;

-- -----------------------------------------------------------------------------
-- The predicate
-- -----------------------------------------------------------------------------

-- A missing claim is a refusal, never a pass. A session minted before MFA
-- existed carries no `aal` at all, and a predicate that let that through would
-- disable this whole feature while every test stayed green.
create or replace function app.has_second_factor()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select auth.jwt()) ->> 'aal', '') = 'aal2';
$$;

comment on function app.has_second_factor() is
  'True only when the request''s JWT carries aal2 — a second factor GoTrue has verified. A missing or lower claim is false.';

-- -----------------------------------------------------------------------------
-- Composition into the authorization helpers
--
-- Each body below is the one from 20260813090200_authorization.sql with the
-- predicate conjoined, and is otherwise unchanged.
-- -----------------------------------------------------------------------------

create or replace function app.is_org_member(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.has_second_factor() and exists (
    select 1
    from public.organization_members m
    where m.organization_id = p_organization_id
      and m.user_id = (select auth.uid())
      and m.status = 'active'
  );
$$;

comment on function app.is_org_member(uuid) is
  'True when the requesting user is an active member of the organization AND the request has a verified second factor. The base tenant predicate.';

create or replace function app.has_min_role(p_organization_id uuid, p_minimum public.org_role)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.has_second_factor() and coalesce(
    app.role_rank(app.current_role_in(p_organization_id)) >= app.role_rank(p_minimum),
    false
  );
$$;

comment on function app.has_min_role(uuid, public.org_role) is
  'True when the requesting user holds at least the given role in the organization AND the request has a verified second factor.';

create or replace function app.shares_organization_with(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.has_second_factor() and exists (
    select 1
    from public.organization_members me
    join public.organization_members them
      on them.organization_id = me.organization_id
    where me.user_id = (select auth.uid())
      and me.status = 'active'
      and them.user_id = p_user_id
      and them.status = 'active'
  );
$$;

comment on function app.shares_organization_with(uuid) is
  'True when the requesting user and the target user are both active members of at least one common organization AND the request has a verified second factor.';

-- -----------------------------------------------------------------------------
-- Fallout: app.enforce_vehicle_limit
--
-- The plan-limit trigger from 20261109100110_vehicle_limit_guard_fixes.sql lets
-- a signed-in NON-MEMBER past the limit check so that row-level security does
-- the rejecting instead — a BEFORE ROW trigger runs ahead of the RLS WITH CHECK,
-- and this definer's refusal text names the agency's tier and live fleet count.
-- It asked app.is_org_member for "is this caller a member", which above has
-- become "is this caller a member AND is their second factor verified". A
-- service-role write on behalf of a member carries no aal claim, so it would now
-- take the non-member exit and skip the plan limit entirely — with no RLS behind
-- it to catch the row, because service_role bypasses RLS.
--
-- The question the trigger is asking is membership alone, so it now asks
-- app.current_role_in, which is not gated. Everything else about the function is
-- unchanged, and both triggers already point at it by name.
-- -----------------------------------------------------------------------------

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

  if (select auth.uid()) is not null
     and app.current_role_in(new.organization_id) is null then
    return new;
  end if;

  v_limit := app.vehicle_limit_of(new.organization_id);
  if v_limit is null then
    return new;
  end if;

  perform 1
    from public.organizations o
   where o.id = new.organization_id
     for update;

  v_count := app.vehicle_count_of(new.organization_id);
  if v_count >= v_limit then
    raise exception 'Your plan covers % vehicles. You have %.', v_limit, v_count
      using errcode = '55000';
  end if;

  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Execution grants
--
-- A function created in `app` would otherwise carry PUBLIC's default EXECUTE,
-- which anon inherits. The repository invariant is that nothing in this schema
-- is reachable anonymously.
-- -----------------------------------------------------------------------------

revoke all on function app.has_second_factor() from public, anon;
grant execute on function app.has_second_factor() to authenticated, service_role;

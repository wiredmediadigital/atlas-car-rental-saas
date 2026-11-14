-- =============================================================================
-- Public booking: the agency switch, the per-vehicle opt-in, the plan entitlement
-- =============================================================================
--
-- Nothing reaches an agency's public booking page by accident. The agency turns
-- the feature on (organizations.public_booking_enabled), and then opts each
-- vehicle in individually (vehicles.public_booking_enabled). Both default to off.
-- Later migrations read these columns; this one only adds them.
--
-- The plan carries the allowance, the way it carries the vehicle limit
-- (20261109100000): a column on public.plan_vehicle_limits, an authored table no
-- Stripe sync writes. billing_plans.entitlements is NOT used, for the reason
-- given in that migration: the catalogue refresh overwrites it.
--
-- FAIL OPEN, like the vehicle limit. No subscription, a plan key with no row
-- there, and an unconfigured billing platform (app.billing_platform_configured())
-- all mean "included". A paying customer is not punished for an operator's
-- mistake, and a deployment that has not launched billing has no plans to gate by.
--
-- NOT RETROACTIVE. The guard fires only when the switch goes from off to on. An
-- agency that downgrades while switched on stays switched on; deciding what to do
-- about that is somebody else's job, and it must not break unrelated edits.
--
-- WHO MAY FLIP THE SWITCHES needs no new policy. organizations_update already
-- requires admin and vehicles_update already requires manager, both through
-- app.has_min_role, which requires a verified second factor.

-- -----------------------------------------------------------------------------
-- 1. The columns
-- -----------------------------------------------------------------------------

alter table public.organizations
  add column if not exists public_booking_enabled boolean not null default false;

alter table public.vehicles
  add column if not exists public_booking_enabled boolean not null default false;

comment on column public.organizations.public_booking_enabled is
  'Whether the agency''s public booking page is on. Off by default. Turning it on is refused (42501) while the plan does not include public booking; see app.guard_organization_public_booking.';
comment on column public.vehicles.public_booking_enabled is
  'Whether this vehicle may be requested from the agency''s public booking page. Off by default; the agency opts each vehicle in. Independent of the agency switch: both must be on for a vehicle to be public.';

-- -----------------------------------------------------------------------------
-- 2. What the plan allows
-- -----------------------------------------------------------------------------

-- Default true so that a plan row added later without thinking about this fails
-- open, as a missing row does. The tiers that do not include it are set below.
alter table public.plan_vehicle_limits
  add column if not exists allows_public_booking boolean not null default true;

comment on column public.plan_vehicle_limits.allows_public_booking is
  'Whether the plan includes the public booking page. A plan key with no row in this table includes it (fail open). Authored in migrations; changing it needs a later migration with an explicit UPDATE.';

-- Starter does not include it; Pro and Business do. Monthly and yearly of one
-- tier are the same.
update public.plan_vehicle_limits
   set allows_public_booking = (tier <> 'starter');

/**
 * The Postgres role the caller arrived as: 'authenticated', 'anon',
 * 'service_role', or 'none' for a direct connection (a migration, pg_cron).
 *
 * WHY NOT current_user. Inside a SECURITY DEFINER body current_user is the
 * function owner, so the non-definer triggers' idiom (current_user in
 * ('authenticated', 'anon'), see 20261109100000) cannot be used there. The role
 * GUC is what `set role` sets and SECURITY DEFINER does not touch it.
 *
 * WHY NOT auth.uid() is null. A service key is not a user session, but nothing
 * stops the caller holding one from also presenting a `sub` claim, and an Edge
 * Function that attributes its work to a user does exactly that. Reading an
 * absent uid as "this is the server" would let that call through every gate.
 */
create or replace function app.caller_role()
returns text
language sql
stable
set search_path = ''
as $$
  select coalesce(current_setting('role', true), 'none');
$$;

comment on function app.caller_role() is
  'The role the caller arrived as, readable from inside a SECURITY DEFINER body where current_user is the owner. Never infer the service role from a null auth.uid().';

revoke all on function app.caller_role() from public, anon, authenticated;
grant execute on function app.caller_role() to service_role;

/**
 * The entitlement itself, with no caller check. Server side only.
 *
 * Same resolution as app.vehicle_limit_of: the effective subscription decides,
 * and only while the platform is configured. null for an organization that does
 * not exist.
 */
create or replace function app.plan_includes_public_booking(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when not exists (select 1 from public.organizations o where o.id = p_organization_id)
      then null
    when not app.billing_platform_configured()
      then true
    else coalesce(
      (select l.allows_public_booking
         from public.plan_vehicle_limits l
        where l.plan_key = (app.billing_effective_subscription(p_organization_id)).plan_key),
      true
    )
  end;
$$;

comment on function app.plan_includes_public_booking(uuid) is
  'Does the plan of this agency''s effective subscription include public booking? Fails open. No caller check: service_role only. Browsers use app.plan_allows_public_booking.';

revoke all on function app.plan_includes_public_booking(uuid) from public, anon, authenticated;
grant execute on function app.plan_includes_public_booking(uuid) to service_role;

/**
 * The member-gated door to the entitlement, for Settings to explain a refusal.
 *
 * A signed-in caller who is not a verified member of the organization gets null,
 * the same answer as for an organization that does not exist, so it reveals
 * neither the plan nor whether the organization is real. app.is_org_member
 * requires aal2. The service role is answered outright: it is the public
 * booking Edge Function, which has no member to be, and anon never reaches here
 * because it has no execute grant.
 */
create or replace function app.plan_allows_public_booking(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when app.caller_role() = 'service_role' or app.is_org_member(p_organization_id)
      then app.plan_includes_public_booking(p_organization_id)
  end;
$$;

comment on function app.plan_allows_public_booking(uuid) is
  'Whether the agency''s plan includes public booking: true or false for a verified member (or the service role), null for anyone else, indistinguishable from an unknown organization.';

revoke all on function app.plan_allows_public_booking(uuid) from public, anon;
grant execute on function app.plan_allows_public_booking(uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 3. The guard
-- -----------------------------------------------------------------------------

/**
 * BEFORE INSERT OR UPDATE trigger: refuses the agency switch going on while the
 * plan does not include public booking. Applies to every role, the service role
 * included: the entitlement is the plan's, not a caller's.
 *
 * SECURITY DEFINER so it can resolve the plan for a browser role. That makes the
 * early return below load-bearing: Postgres runs BEFORE ROW triggers before the
 * RLS WITH CHECK, so without it anyone who knew another agency's id could read
 * its plan from the error text. A browser-role non-member is let through here and
 * row-level security does the rejecting (the same fix as app.enforce_vehicle_limit).
 * An INSERT has no members yet and no RLS leak to protect, so it is always checked.
 *
 * THE PASS IS FOR BROWSER ROLES ONLY. The service role bypasses RLS, so letting
 * it through here would not defer the refusal, it would be the refusal not
 * happening: the switch would go on for an unentitled plan. It is checked like
 * everyone else, and there is no leak to protect it from -- it can already read
 * the plan directly.
 */
create or replace function app.guard_organization_public_booking()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.public_booking_enabled is not true then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if old.public_booking_enabled then
      return new;
    end if;
    if app.caller_role() in ('authenticated', 'anon')
       and not app.is_org_member(new.id) then
      return new;
    end if;
  end if;

  if app.plan_includes_public_booking(new.id) is false then
    raise exception 'Public booking is not included in your plan.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

comment on function app.guard_organization_public_booking() is
  'BEFORE INSERT OR UPDATE trigger: refuses (42501) turning organizations.public_booking_enabled on while the plan does not include it. Fires only on the off-to-on change. Lets a browser-role non-member through so RLS rejects without leaking the plan; the service role is checked like everyone else.';

revoke all on function app.guard_organization_public_booking() from public, anon, authenticated;

drop trigger if exists organizations_guard_public_booking on public.organizations;
create trigger organizations_guard_public_booking
  before insert or update of public_booking_enabled on public.organizations
  for each row execute function app.guard_organization_public_booking();

-- =============================================================================
-- The vehicle limit of each plan, and the function that resolves an agency's
-- =============================================================================
--
-- Pevvy is priced by fleet size: Starter 5 vehicles, Pro 20, Business 50, each
-- sold monthly and yearly. This migration authors that mapping and the one
-- function that answers "how many vehicles may this agency have?". Enforcing the
-- answer, showing it and refusing a downgrade over it are later migrations.
--
-- WHY A TABLE OF OUR OWN AND NOT billing_plans.entitlements.
--
-- billing_plans.entitlements is a jsonb column that looks like the natural home.
-- It is not. app.billing_replace_catalogue ends with
-- `entitlements = excluded.entitlements`, and the Stripe catalogue refresh does
-- not send entitlements at all, so a limit authored there would silently become
-- {} at the next sync and every agency would become unlimited. This table is
-- written by this migration and by nothing else; the sync does not know it exists.
--
-- FAIL OPEN. A plan key with no row here, and an agency with no subscription,
-- both resolve to null: no limit. The alternative punishes a paying customer for
-- an operator's mistake.
--
-- NOT RETROACTIVE. Nothing here archives, hides or restricts an existing vehicle.
-- This is a number and a count; what to do with them is somebody else's decision.

-- -----------------------------------------------------------------------------
-- 1. The authored limits
-- -----------------------------------------------------------------------------

create table if not exists public.plan_vehicle_limits (
  plan_key      text primary key,
  tier          text not null,
  vehicle_limit integer not null check (vehicle_limit > 0)
);

comment on table public.plan_vehicle_limits is
  'The number of unarchived vehicles each plan key allows. Authored in migrations and written by no sync: billing_plans.entitlements is overwritten by every catalogue refresh, this table is not. A plan key with no row here has no limit.';

-- Monthly and yearly of one tier are the same limit.
insert into public.plan_vehicle_limits (plan_key, tier, vehicle_limit) values
  ('starter_monthly',  'starter',   5),
  ('starter_yearly',   'starter',   5),
  ('pro_monthly',      'pro',      20),
  ('pro_yearly',       'pro',      20),
  ('business_monthly', 'business', 50),
  ('business_yearly',  'business', 50)
on conflict (plan_key) do nothing;

-- Browser roles never read or write this table directly; the resolver is the
-- only reader and it is security definer.
alter table public.plan_vehicle_limits enable row level security;
revoke all on public.plan_vehicle_limits from public, anon, authenticated;

-- Row security with an explicit deny-all policy: the schema-wide policy-coverage
-- test requires every public table to carry a policy, and "no browser role may
-- see a row" is the intent, so it is stated rather than implied.
drop policy if exists plan_vehicle_limits_no_browser_access on public.plan_vehicle_limits;
create policy plan_vehicle_limits_no_browser_access on public.plan_vehicle_limits
  for all to authenticated
  using (false) with check (false);

-- -----------------------------------------------------------------------------
-- 2. The per-agency override
-- -----------------------------------------------------------------------------

alter table public.organizations
  add column if not exists vehicle_limit_override integer
    check (vehicle_limit_override is null or vehicle_limit_override > 0),
  add column if not exists vehicle_limit_override_set_by uuid,
  add column if not exists vehicle_limit_override_set_at timestamptz;

comment on column public.organizations.vehicle_limit_override is
  'An operator-set vehicle ceiling that replaces the plan limit for this agency. Service role only: no screen, role or self-serve path may raise an agency''s own ceiling.';
comment on column public.organizations.vehicle_limit_override_set_by is
  'The user id of whoever set the override. A user id, never an email.';
comment on column public.organizations.vehicle_limit_override_set_at is
  'When the override was set.';

/**
 * BEFORE UPDATE trigger: refuses a change to any vehicle_limit_override* column
 * made as a browser role. Same shape as guard_organization_closure_columns:
 * deliberately not SECURITY DEFINER, so current_user is the caller, and the
 * service role and security-definer paths pass straight through.
 */
create or replace function app.guard_organization_vehicle_limit_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon')
     and (new.vehicle_limit_override, new.vehicle_limit_override_set_by,
          new.vehicle_limit_override_set_at)
         is distinct from
         (old.vehicle_limit_override, old.vehicle_limit_override_set_by,
          old.vehicle_limit_override_set_at)
  then
    raise exception 'The vehicle limit override of an agency cannot be changed directly.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

comment on function app.guard_organization_vehicle_limit_columns() is
  'BEFORE UPDATE trigger: refuses a change to any vehicle_limit_override column made as a browser role. Deliberately not SECURITY DEFINER, so current_user is the caller. Empty search_path like every function here.';

drop trigger if exists organizations_guard_vehicle_limit_columns on public.organizations;
create trigger organizations_guard_vehicle_limit_columns
  before update on public.organizations
  for each row execute function app.guard_organization_vehicle_limit_columns();

revoke all on function app.guard_organization_vehicle_limit_columns() from public, anon;

-- -----------------------------------------------------------------------------
-- 3. The resolver and the count
-- -----------------------------------------------------------------------------

/**
 * How many unarchived vehicles may this agency have? null means no limit.
 *
 * The override if one is set, else the limit authored for the plan of the agency's
 * effective subscription. "Which subscription is the real one" is answered by
 * app.billing_effective_subscription, the same function app.billing_access_state_of
 * uses; this function must not grow its own answer.
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
    (select l.vehicle_limit
       from public.plan_vehicle_limits l
      where l.plan_key = (app.billing_effective_subscription(p_organization_id)).plan_key)
  );
$$;

comment on function app.vehicle_limit_of(uuid) is
  'The vehicle ceiling of an agency: its override if set, else the authored limit of its effective subscription''s plan, else null meaning no limit. Fails open on purpose.';

/** Vehicles that count against the limit: those not archived. */
create or replace function app.vehicle_count_of(p_organization_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
    from public.vehicles v
   where v.organization_id = p_organization_id
     and v.archived_at is null;
$$;

comment on function app.vehicle_count_of(uuid) is
  'The number of vehicles an agency has with archived_at null.';

-- Server-side only for now: a security-definer function taking an arbitrary
-- organization id must not be callable by any signed-in user.
revoke all on function app.vehicle_limit_of(uuid) from public, anon, authenticated;
revoke all on function app.vehicle_count_of(uuid) from public, anon, authenticated;
grant execute on function app.vehicle_limit_of(uuid) to service_role;
grant execute on function app.vehicle_count_of(uuid) to service_role;

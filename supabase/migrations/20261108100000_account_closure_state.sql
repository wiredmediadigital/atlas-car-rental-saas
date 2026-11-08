-- =============================================================================
-- Account closure: the state, and the one gate that knows about it
--
-- An owner can close their agency; thirty days later the tenant's data is
-- purged. This file is the foundation of that and nothing more. It RECORDS that
-- closure is pending and teaches the write gate about it. It closes nothing,
-- deletes nothing and schedules nothing: the functions that move an agency
-- between these states arrive in later migrations.
--
-- THE ORGANIZATION ROW IS NEVER DELETED. Four billing tables reference
-- organizations(id) on delete cascade, and they hold the tax records that must
-- outlive the tenant. Closure leaves the row behind as a tombstone, so this
-- file only adds columns.
--
-- ONE GATE, ONE ANSWER. A policy and a SECURITY DEFINER function must never be
-- able to disagree about whether an organization may be written to. A second
-- gate would be a hole shaped like every function that consults only one of the
-- two. So there is exactly one: app.may_write. The existing billing gate is
-- redefined below as a thin delegate to it, which is what lets the 75 policies
-- that name app.billing_may_write (87 call sites in all) stay exactly as they
-- are and still be correct.
-- =============================================================================

set search_path = public, extensions, pg_temp;

-- -----------------------------------------------------------------------------
-- 1. Where an agency is in its closure
-- -----------------------------------------------------------------------------

/**
 *   open       the agency is running normally
 *   suspended  closure has been requested; read-only until the purge date, and
 *              the request can still be withdrawn
 *   purging    the purge has claimed the agency and is working through it
 *   closed     the purge finished; the row is a tombstone
 *
 * The state is DERIVED from the timestamps on organizations, never stored a
 * second time, so it cannot drift from them. See app.closure_state_of.
 */
create type public.closure_state as enum ('open', 'suspended', 'purging', 'closed');

comment on type public.closure_state is
  'Where an agency is in its closure. Derived from the closure_* timestamps on organizations by app.closure_state_of; never stored separately.';

alter table public.organizations
  add column closure_requested_at timestamptz,
  add column closure_requested_by uuid references auth.users (id) on delete set null,
  add column closure_purge_after  timestamptz,
  add column purge_started_at     timestamptz,
  add column closed_at            timestamptz;

comment on column public.organizations.closure_requested_at is
  'When an owner asked to close this agency. Null while the agency is open.';
comment on column public.organizations.closure_requested_by is
  'The owner who asked. Set null if that account is later deleted, so the purge never trips over it.';
comment on column public.organizations.closure_purge_after is
  'The earliest moment the purge may claim this agency.';
comment on column public.organizations.purge_started_at is
  'When the purge claimed this agency. Once set, the closure can no longer be withdrawn.';
comment on column public.organizations.closed_at is
  'When the purge finished. Only now is the agency closed rather than purging.';

-- -----------------------------------------------------------------------------
-- 2. Clients cannot write the closure columns
--
-- `authenticated` holds UPDATE on all of organizations, and an administrator
-- may update their own row, so without this an admin could clear
-- closure_requested_at and silently reopen an agency, or stamp closed_at on
-- one. The closure columns move only through definer functions and the service
-- role, which are not the roles named here.
-- -----------------------------------------------------------------------------

create or replace function app.guard_organization_closure_columns()
returns trigger
language plpgsql
as $$
begin
  if current_user in ('authenticated', 'anon')
     and (new.closure_requested_at, new.closure_requested_by, new.closure_purge_after,
          new.purge_started_at, new.closed_at)
         is distinct from
         (old.closure_requested_at, old.closure_requested_by, old.closure_purge_after,
          old.purge_started_at, old.closed_at)
  then
    raise exception 'The closure state of an agency cannot be changed directly.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

comment on function app.guard_organization_closure_columns() is
  'BEFORE UPDATE trigger: refuses a change to any closure_* column made as a browser role. Deliberately not SECURITY DEFINER, so current_user is the caller.';

drop trigger if exists organizations_guard_closure_columns on public.organizations;
create trigger organizations_guard_closure_columns
  before update on public.organizations
  for each row execute function app.guard_organization_closure_columns();

-- -----------------------------------------------------------------------------
-- 3. The state, derived
-- -----------------------------------------------------------------------------

/**
 * The furthest stage the timestamps record wins: closed_at, then
 * purge_started_at, then closure_requested_at.
 *
 * AN ORGANIZATION THAT DOES NOT EXIST IS 'open'. That is not a statement about
 * the organization, it is what keeps this function from changing any answer the
 * billing gate already gave: there is no closure to refuse a write over, and
 * billing still decides. A row that is not there cannot be written to anyway.
 */
create or replace function app.closure_state_of(p_organization_id uuid)
returns public.closure_state
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select case
              when o.closed_at is not null             then 'closed'
              when o.purge_started_at is not null      then 'purging'
              when o.closure_requested_at is not null  then 'suspended'
              else 'open'
            end::public.closure_state
       from public.organizations o
      where o.id = p_organization_id),
    'open'::public.closure_state
  );
$$;

comment on function app.closure_state_of(uuid) is
  'open | suspended | purging | closed, derived from the closure_* timestamps. A missing organization is open, so billing alone decides for it as before.';

-- -----------------------------------------------------------------------------
-- 4. THE gate
-- -----------------------------------------------------------------------------

/**
 * May this organization be written to? Billing is not restricted AND the
 * agency is open. This is the only place that question is answered.
 *
 * Same shape as the predicate it supersedes -- stable, SECURITY DEFINER, empty
 * search_path -- because policies call it with the invoker's privileges and it
 * must read billing and organizations regardless of what that role can see.
 */
create or replace function app.may_write(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.billing_access_state_of(p_organization_id) <> 'restricted'
     and app.closure_state_of(p_organization_id) = 'open';
$$;

comment on function app.may_write(uuid) is
  'THE write gate: billing not restricted and closure state open. Policies and SECURITY DEFINER functions both end up here. New code calls this one.';

/**
 * The same question for a function that bypasses RLS: raises 42501 instead of
 * returning, as app.billing_require_write always has.
 *
 * The billing sentence is matched on its text in src/lib/supabase/errors.ts, so
 * it is NOT reworded. A closed or closing agency gets its own sentence, because
 * "no active subscription" would be untrue of it. Closure is checked first so
 * that is the reason given when both apply.
 */
create or replace function app.require_write(p_organization_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if app.closure_state_of(p_organization_id) <> 'open' then
    raise exception 'This agency is closed or closing, so its records are read-only.'
      using errcode = '42501';
  end if;

  if not app.may_write(p_organization_id) then
    raise exception
      'This agency has no active subscription, so its records are read-only.'
      using errcode = '42501';
  end if;
end;
$$;

comment on function app.require_write(uuid) is
  'Raises 42501 when app.may_write is false. For SECURITY DEFINER functions, which bypass the RLS policies that carry the same gate. New code calls this one.';

-- -----------------------------------------------------------------------------
-- 5. The old names become delegates
-- -----------------------------------------------------------------------------

create or replace function app.billing_may_write(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.may_write(p_organization_id);
$$;

comment on function app.billing_may_write(uuid) is
  'Thin delegate to app.may_write, kept only because 75 RLS policies name it (87 call sites). It no longer means billing alone: it answers for closure too. New code calls app.may_write.';

create or replace function app.billing_require_write(p_organization_id uuid)
returns void
language sql
stable
security definer
set search_path = ''
as $$
  select app.require_write(p_organization_id);
$$;

comment on function app.billing_require_write(uuid) is
  'Thin delegate to app.require_write, kept only because 75 RLS policies and the definer functions name it (87 call sites). It no longer means billing alone: it refuses for closure too. New code calls app.require_write.';

-- -----------------------------------------------------------------------------
-- 6. Privileges
--
-- create or replace keeps the grants the delegates already had, so only the new
-- functions are granted here, mirroring the pair they supersede:
-- may_write is called from policies (the invoker needs EXECUTE);
-- require_write only from definer bodies; closure_state_of is reached through
-- those and is not widened.
-- -----------------------------------------------------------------------------

revoke all on function app.closure_state_of(uuid) from public, anon;
revoke all on function app.may_write(uuid) from public, anon;
revoke all on function app.require_write(uuid) from public, anon;
revoke all on function app.guard_organization_closure_columns() from public, anon;

grant execute on function app.closure_state_of(uuid) to service_role;
grant execute on function app.may_write(uuid) to authenticated, service_role;
grant execute on function app.require_write(uuid) to service_role;

-- -----------------------------------------------------------------------------
-- 7. Assertions
-- -----------------------------------------------------------------------------

do $$
begin
  if not has_function_privilege('authenticated', 'app.may_write(uuid)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'app.billing_may_write(uuid)', 'EXECUTE') then
    raise exception 'authenticated must be able to execute both write gates: policies call them.';
  end if;

  if has_function_privilege('anon', 'app.may_write(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'app.billing_may_write(uuid)', 'EXECUTE') then
    raise exception 'anon must not be able to execute the write gate.';
  end if;

  /*
   * The delegates must stay delegates. If either grows its own logic, a policy
   * and a definer function can disagree again.
   */
  if (select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'app' and p.proname = 'billing_may_write') not like '%app.may_write(%'
     or (select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'app' and p.proname = 'billing_require_write') not like '%app.require_write(%' then
    raise exception 'app.billing_may_write and app.billing_require_write must delegate to app.may_write and app.require_write.';
  end if;
end;
$$;

-- =============================================================================
-- Account closure: requesting it, and taking it back
--
-- Two actions and two evidence tables. Nothing here purges anything: the purge
-- is a later task, and it is the only thing that writes to the tables below.
--
-- THE WINDOW IS ALWAYS THIRTY DAYS. organization_request_closure takes only the
-- organization id; there is no parameter and no code path by which a caller can
-- shorten the window. Purging sooner is an operator action taken out of band.
-- A self-serve immediate purge was the most dangerous capability this product
-- could have had, and removing it beats guarding it.
--
-- BOTH FUNCTIONS ARE SECURITY DEFINER. The guard trigger from the previous
-- migration refuses closure-column writes made as `authenticated`, because
-- `organizations_update` lets an administrator update their own row with no
-- column restriction. Inside a definer body current_user is the function owner,
-- so the guard lets these through, and nothing else.
--
-- BOTH ARE EXEMPT FROM THE WRITE GATE, on purpose. An agency whose subscription
-- lapsed, or that never subscribed, must still be able to leave and to come
-- back. They do not call app.require_write, and must not.
--
-- THE ORGANIZATION ROW IS NEVER DELETED. Restoring clears three columns;
-- requesting sets them. Nothing removes the row.
-- =============================================================================

set search_path = public, extensions, pg_temp;

-- -----------------------------------------------------------------------------
-- 1. Requesting closure: owner only
-- -----------------------------------------------------------------------------

create or replace function public.organization_request_closure(p_organization_id uuid)
returns public.organizations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org public.organizations;
begin
  /*
   * One refusal for "not a member", "wrong agency" and "no such agency", so the
   * answer is not an oracle for which organization ids exist. The role is read
   * from the caller's own session; app.current_role_in is null for anyone who is
   * not an active member, including an unauthenticated caller.
   */
  if app.current_role_in(p_organization_id) is distinct from 'owner'::public.org_role then
    raise exception 'Only an owner can close an agency.' using errcode = '42501';
  end if;

  -- Serialise against a concurrent request, restore or purge claim.
  select * into v_org from public.organizations where id = p_organization_id for update;

  if app.closure_state_of(p_organization_id) <> 'open' then
    raise exception 'This agency is already closed or closing.' using errcode = '55000';
  end if;

  update public.organizations
     set closure_requested_at = now(),
         closure_requested_by = (select auth.uid()),
         closure_purge_after  = now() + interval '30 days'
   where id = p_organization_id
  returning * into v_org;

  return v_org;
end;
$$;

comment on function public.organization_request_closure(uuid) is
  'Owner only. Suspends the agency now and sets the purge date thirty days out. No parameter shortens the window. SECURITY DEFINER because the closure columns refuse browser roles; exempt from the write gate so a billing-restricted agency can still close.';

-- -----------------------------------------------------------------------------
-- 2. Restoring: owner or admin, until the purge claims the agency
-- -----------------------------------------------------------------------------

create or replace function public.organization_restore(p_organization_id uuid)
returns public.organizations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org public.organizations;
begin
  if not app.has_min_role(p_organization_id, 'admin'::public.org_role) then
    raise exception 'Only an owner or an administrator can restore an agency.'
      using errcode = '42501';
  end if;

  -- The lock is what makes "refused once the purge has started" true: the purge
  -- claims the row under the same lock, so one of the two wins, never both.
  select * into v_org from public.organizations where id = p_organization_id for update;

  if v_org.purge_started_at is not null or v_org.closed_at is not null then
    raise exception 'The purge of this agency has started, so it can no longer be restored.'
      using errcode = '55000';
  end if;

  if v_org.closure_requested_at is null then
    raise exception 'This agency is not closing, so there is nothing to restore.'
      using errcode = '55000';
  end if;

  update public.organizations
     set closure_requested_at = null,
         closure_requested_by = null,
         closure_purge_after  = null
   where id = p_organization_id
  returning * into v_org;

  return v_org;
end;
$$;

comment on function public.organization_restore(uuid) is
  'Owner or admin. Withdraws a pending closure. Refused once purge_started_at is set. SECURITY DEFINER because the closure columns refuse browser roles; exempt from the write gate so a billing-restricted agency can still restore.';

-- -----------------------------------------------------------------------------
-- 3. Evidence: what was purged, recorded as counts
--
-- Neither table references organizations: they must outlive anything that
-- happens to that row. The requester is a bare user id, never an email, because
-- that account may itself be deleted later; the record must not depend on it.
-- Counts only, never content.
-- -----------------------------------------------------------------------------

create table if not exists public.account_closure_events (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid        not null,
  organization_name text        not null,
  requested_by      uuid,
  requested_at      timestamptz not null,
  purged_at         timestamptz,
  table_counts      jsonb       not null default '{}'::jsonb
                    check (jsonb_typeof(table_counts) = 'object'),
  created_at        timestamptz not null default now()
);

comment on table public.account_closure_events is
  'Evidence that an agency was closed and purged: its id and legal name, the requester by user id (never email), when it was requested and purged, and per-table row counts. Counts, never content. Service role only.';
comment on column public.account_closure_events.organization_name is
  'The agency legal name at the time of closure, falling back to its display name.';
comment on column public.account_closure_events.requested_by is
  'User id of the requester. Deliberately not a foreign key and never an email.';

create index if not exists account_closure_events_organization_idx
  on public.account_closure_events (organization_id);

create table if not exists public.account_closure_objects (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid        not null,
  bucket          text        not null,
  storage_key     text        not null,
  collected_at    timestamptz not null default now(),
  deleted_at      timestamptz,
  constraint account_closure_objects_key unique (bucket, storage_key)
);

comment on table public.account_closure_objects is
  'Storage keys collected before an agency is deleted, so the sweep of Storage can resume where it stopped. deleted_at is set as each object is removed. Service role only.';

create index if not exists account_closure_objects_pending_idx
  on public.account_closure_objects (organization_id) where deleted_at is null;

revoke all on table public.account_closure_events from anon, authenticated;
revoke all on table public.account_closure_objects from anon, authenticated;

alter table public.account_closure_events enable row level security;
alter table public.account_closure_objects enable row level security;

/*
 * `using (false)` is the whole intended policy, as for billing_platform_state:
 * no browser role reads these. It exists only because the schema-wide rule is
 * "every table has RLS and a policy" with no exception list. It admits nobody.
 */
drop policy if exists account_closure_events_no_client_read on public.account_closure_events;
create policy account_closure_events_no_client_read on public.account_closure_events
  for select to authenticated using (false);

drop policy if exists account_closure_objects_no_client_read on public.account_closure_objects;
create policy account_closure_objects_no_client_read on public.account_closure_objects
  for select to authenticated using (false);

-- -----------------------------------------------------------------------------
-- 4. Execution grants
-- -----------------------------------------------------------------------------

revoke all on function public.organization_request_closure(uuid) from public, anon;
revoke all on function public.organization_restore(uuid) from public, anon;

grant execute on function public.organization_request_closure(uuid) to authenticated, service_role;
grant execute on function public.organization_restore(uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 5. Assertions
-- -----------------------------------------------------------------------------

do $$
declare
  v_fn text;
  v_body text;
begin
  foreach v_fn in array array['organization_request_closure', 'organization_restore'] loop
    select pg_get_functiondef(p.oid) into v_body
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = v_fn;

    if v_body not like '%SECURITY DEFINER%' then
      raise exception '% must be SECURITY DEFINER: the guard trigger refuses browser roles.', v_fn;
    end if;
    if v_body like '%require_write%' or v_body like '%may_write%' then
      raise exception '% must not consult the write gate: a restricted agency must still be able to use it.', v_fn;
    end if;
  end loop;

  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'organization_request_closure') <> 1 then
    raise exception 'organization_request_closure must have exactly one signature.';
  end if;

  if has_function_privilege('anon', 'public.organization_request_closure(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.organization_restore(uuid)', 'EXECUTE') then
    raise exception 'anon must not be able to execute the closure actions.';
  end if;

  if has_table_privilege('authenticated', 'public.account_closure_events', 'SELECT')
     or has_table_privilege('authenticated', 'public.account_closure_objects', 'SELECT') then
    raise exception 'authenticated must not be able to read the closure evidence tables.';
  end if;
end;
$$;

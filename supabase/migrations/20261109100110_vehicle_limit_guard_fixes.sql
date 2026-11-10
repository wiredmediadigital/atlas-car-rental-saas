-- Corrections to app.enforce_vehicle_limit(), found in review of
-- 20261109100100_vehicle_limit_enforcement.sql. That migration stays as reviewed;
-- this one redefines the function. The two triggers already point at it by name,
-- so they need no change.
--
-- 1. Its header says the bulk import's capacity check is an existing RPC. It is
--    not: today the import inserts one row per statement and so meets this gate
--    row by row, each refusal landing in the import dialog's failed list. A later
--    task adds a transactional RPC that checks capacity up front; this trigger
--    stays the backstop beneath it, and until then it is the only gate.
-- 2. Cross-tenant disclosure, fixed below.
-- 3. The organization row lock, moved below the no-limit return.
--
-- A signed-in caller who is not a member of the organization is let through here
-- so that row-level security does the rejecting. Postgres runs BEFORE ROW triggers
-- before the RLS WITH CHECK, and this function is a definer: without that early
-- return, anyone who knew another agency's id could read its tier and live fleet
-- count from the error text. Only a non-null auth.uid() takes that exit, so the
-- service role and definer paths with no user are always gated.
--
-- When there is a limit, the organization row is locked before counting so that,
-- on a real server, two sessions adding the last slot queue behind each other and
-- the second counts the first one's vehicle. An agency with no limit takes no lock.
--

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
     and not app.is_org_member(new.organization_id) then
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

comment on function app.enforce_vehicle_limit() is
  'BEFORE INSERT / UPDATE trigger on public.vehicles: refuses an unarchived vehicle past the agency''s limit (errcode 55000). UPDATE is checked only on the archived-to-active transition, so the limit is never retroactive. SECURITY DEFINER because the resolvers are granted to service_role only.';

revoke all on function app.enforce_vehicle_limit() from public, anon, authenticated;

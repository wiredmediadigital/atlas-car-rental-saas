-- =============================================================================
-- Account closure: the operator notice is never given up on
--
-- 20261110100200 capped both notices at three failed attempts. That is right for
-- the members: they also have the in-app event and the closure banner, and every
-- retry emails every owner and administrator.
--
-- It is wrong for the operator. That email is the only prompt to cancel the
-- agency's Stripe subscription, it goes to one address, and a retry costs one
-- email. Once a scheduler runs there is no backoff, so a few minutes of provider
-- outage would burn three attempts and the operator would never be told, with
-- nothing reading the state to notice.
--
-- The operator channel is therefore offered until the provider accepts it. The
-- attempt count is still kept, as a record. Only app.closure_notices_pending
-- changes; the members cap is exactly as it was.
-- =============================================================================

set search_path = public, extensions, pg_temp;

create or replace function app.closure_notices_pending(p_organization_id uuid default null)
returns table (
  organization_id   uuid,
  organization_name text,
  requested_by_name text,
  purge_after       timestamptz,
  send_members      boolean,
  send_operator     boolean,
  recipients        text[]
)
language sql
stable
security definer
set search_path = ''
as $$
  with o as (
    select
      c.*,
      -- Members: owed while not accepted and fewer than 3 failed attempts.
      coalesce(c.closure_members_notice_state in ('pending', 'failed', 'not_configured')
               and c.closure_members_notice_attempts < 3, false) as owe_members,
      -- Operator: owed until accepted. Deliberately no attempt limit.
      coalesce(c.closure_operator_notice_state in ('pending', 'failed', 'not_configured'), false)
        as owe_operator
    from public.organizations c
    where (p_organization_id is null or c.id = p_organization_id)
      and c.closure_requested_at is not null
      and c.purge_started_at is null
      and c.closed_at is null
  )
  select
    o.id,
    -- The legal name, because that is what Stripe holds and what the operator must
    -- match; the in-app event uses the display name members recognise.
    coalesce(nullif(btrim(o.legal_name), ''), o.name),
    coalesce(app.actor_display_name(o.closure_requested_by), ''),
    o.closure_purge_after,
    o.owe_members,
    o.owe_operator,
    coalesce((
      select array_agg(distinct u.email order by u.email)
      from public.organization_members m
      join auth.users u on u.id = m.user_id
      where m.organization_id = o.id
        and m.status = 'active'
        and app.role_rank(m.role) >= app.role_rank('admin')
        and u.email is not null
    ), '{}')
  from o
  where o.owe_members or o.owe_operator;
$$;

-- create or replace keeps the grants, but they are restated so this file stands on
-- its own and the deploy fails if they ever drift.
revoke all on function app.closure_notices_pending(uuid) from public, anon, authenticated;
grant execute on function app.closure_notices_pending(uuid) to service_role;

do $$
begin
  if has_function_privilege('authenticated', 'app.closure_notices_pending(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'app.closure_notices_pending(uuid)', 'EXECUTE') then
    raise exception 'Only the service role may list pending closure notices.';
  end if;
end;
$$;

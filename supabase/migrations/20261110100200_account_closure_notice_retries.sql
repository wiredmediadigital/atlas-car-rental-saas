-- =============================================================================
-- Account closure: a bound on retrying the notices
--
-- 20261110100100 made a failed notice eligible for another attempt. With a
-- scheduler draining the pending list that is unbounded: one recipient whose
-- address is permanently refused would re-email every owner and administrator on
-- every tick, forever. Each channel now counts its failed attempts and is no
-- longer offered after three. The state stays `failed`, which is the terminal
-- record that it was given up on.
--
-- Counted per channel, so a stubborn members failure cannot use up the
-- operator's attempts. `not_configured` is not counted: nothing was sent, and
-- the notice should go out as soon as the configuration exists.
--
-- 20261110100100 is never edited; what it defined and this changes is replaced
-- whole below.
-- =============================================================================

set search_path = public, extensions, pg_temp;

alter table public.organizations
  add column closure_members_notice_attempts  integer not null default 0
    check (closure_members_notice_attempts >= 0),
  add column closure_operator_notice_attempts integer not null default 0
    check (closure_operator_notice_attempts >= 0);

comment on column public.organizations.closure_members_notice_attempts is
  'Failed attempts to email owners and administrators about this closure. The notice is no longer offered at 3. Reset by a new request. Service role only.';
comment on column public.organizations.closure_operator_notice_attempts is
  'Failed attempts to email the operator about this closure. The notice is no longer offered at 3. Reset by a new request. Service role only.';

create or replace function app.guard_organization_closure_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon')
     and (new.closure_requested_at, new.closure_requested_by, new.closure_purge_after,
          new.purge_started_at, new.closed_at,
          new.closure_members_notice_state, new.closure_operator_notice_state,
          new.closure_notice_detail,
          new.closure_members_notice_attempts, new.closure_operator_notice_attempts)
         is distinct from
         (old.closure_requested_at, old.closure_requested_by, old.closure_purge_after,
          old.purge_started_at, old.closed_at,
          old.closure_members_notice_state, old.closure_operator_notice_state,
          old.closure_notice_detail,
          old.closure_members_notice_attempts, old.closure_operator_notice_attempts)
  then
    raise exception 'The closure state of an agency cannot be changed directly.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Requesting closure: 20261110100100's version, plus the counters back to zero.
-- -----------------------------------------------------------------------------

create or replace function public.organization_request_closure(p_organization_id uuid)
returns public.organizations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org   public.organizations;
  v_event uuid;
  v_actor uuid := (select auth.uid());
begin
  if app.current_role_in(p_organization_id) is distinct from 'owner'::public.org_role then
    raise exception 'Only an owner can close an agency.' using errcode = '42501';
  end if;

  select * into v_org from public.organizations where id = p_organization_id for update;

  if app.closure_state_of(p_organization_id) <> 'open' then
    raise exception 'This agency is already closed or closing.' using errcode = '55000';
  end if;

  update public.organizations
     set closure_requested_at = now(),
         closure_requested_by = v_actor,
         closure_purge_after  = now() + interval '30 days',
         closure_members_notice_state  = 'pending',
         closure_operator_notice_state = 'pending',
         closure_notice_detail = null,
         closure_members_notice_attempts  = 0,
         closure_operator_notice_attempts = 0
   where id = p_organization_id
  returning * into v_org;

  -- The event names the agency by its display name, which is what a member
  -- recognises in their inbox. The emails use the legal name (falling back to
  -- the display name) because that is the name Stripe holds: see
  -- app.closure_notices_pending. The difference is deliberate.
  insert into public.notification_events (
    organization_id, kind, severity, occurred_at,
    actor_user_id, actor_label, subject_user_id, subject_label,
    context, source_table, source_id
  ) values (
    p_organization_id, 'account_closure_requested', 'urgent', now(),
    v_actor, left(coalesce(app.actor_display_name(v_actor), ''), 200),
    null, left(coalesce(v_org.name, ''), 200),
    jsonb_build_object('purge_after', v_org.closure_purge_after),
    'account_closure', gen_random_uuid()
  )
  returning id into v_event;

  insert into public.notification_event_recipients (event_id, user_id)
  select v_event, m.user_id
  from public.organization_members m
  where m.organization_id = p_organization_id
    and m.status = 'active'
    and app.role_rank(m.role) >= app.role_rank('admin')
  on conflict do nothing;

  return v_org;
end;
$$;

-- -----------------------------------------------------------------------------
-- The drain stops offering a channel once it has failed three times
-- -----------------------------------------------------------------------------

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
      -- A channel is owed while it is not accepted and has used fewer than 3 attempts.
      coalesce(c.closure_members_notice_state in ('pending', 'failed', 'not_configured')
               and c.closure_members_notice_attempts < 3, false) as owe_members,
      coalesce(c.closure_operator_notice_state in ('pending', 'failed', 'not_configured')
               and c.closure_operator_notice_attempts < 3, false) as owe_operator
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

create or replace function app.closure_notice_record(
  p_organization_id uuid,
  p_members_state   public.invitation_delivery,
  p_operator_state  public.invitation_delivery,
  p_detail          text
)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.organizations
     set closure_members_notice_state  = coalesce(p_members_state, closure_members_notice_state),
         closure_operator_notice_state = coalesce(p_operator_state, closure_operator_notice_state),
         closure_notice_detail         = coalesce(left(p_detail, 300), closure_notice_detail),
         closure_members_notice_attempts  = closure_members_notice_attempts
           + case when p_members_state = 'failed' then 1 else 0 end,
         closure_operator_notice_attempts = closure_operator_notice_attempts
           + case when p_operator_state = 'failed' then 1 else 0 end
   where id = p_organization_id
     and closure_requested_at is not null;
$$;

revoke all on function app.closure_notices_pending(uuid) from public, anon, authenticated;
revoke all on function app.closure_notice_record(uuid, public.invitation_delivery, public.invitation_delivery, text)
  from public, anon, authenticated;
grant execute on function app.closure_notices_pending(uuid) to service_role;
grant execute on function app.closure_notice_record(uuid, public.invitation_delivery, public.invitation_delivery, text)
  to service_role;

revoke all on function public.organization_request_closure(uuid) from public, anon;
grant execute on function public.organization_request_closure(uuid) to authenticated, service_role;

-- Both service-role functions are asserted. record is the one that could mark the
-- operator notice sent, so it must fail a deploy as loudly as the one that lists
-- addresses.
do $$
begin
  if has_function_privilege('authenticated', 'app.closure_notices_pending(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'app.closure_notices_pending(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated',
          'app.closure_notice_record(uuid, public.invitation_delivery, public.invitation_delivery, text)', 'EXECUTE')
     or has_function_privilege('anon',
          'app.closure_notice_record(uuid, public.invitation_delivery, public.invitation_delivery, text)', 'EXECUTE') then
    raise exception 'Only the service role may list or record closure notices.';
  end if;
end;
$$;

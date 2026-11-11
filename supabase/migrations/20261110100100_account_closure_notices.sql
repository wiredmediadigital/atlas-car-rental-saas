-- =============================================================================
-- Account closure: telling people it happened
--
-- Requesting closure must be impossible to do quietly. Every owner and
-- administrator learns of it, and so does the operator (Adera Labs).
--
-- THE OPERATOR NOTICE IS LOAD-BEARING. Cancelling the Stripe subscription is a
-- manual step by design, and the purge refuses to run while
-- app.organization_has_live_subscription is true. That email is the only thing
-- between a closure request and an agency being billed for an account it asked
-- to close, while its data sits unpurged.
--
-- TWO CHANNELS, ONE TRANSACTION AND ONE ROW.
--
--   * IN-APP. organization_request_closure writes the notification event and its
--     recipients itself, in the request's own transaction. If the request
--     commits, the notification exists. No queue, no delay.
--
--   * EMAIL. A database function cannot send email, and the request is made from
--     the browser. So the request records that two notices are PENDING, on the
--     organizations row beside the closure columns, and an Edge Function sends
--     them and reports what it saw. An agency has at most one open closure, so
--     there is never more than one pending notice per channel; a queue table
--     would be a second mechanism beside organization_invitations.delivery_state
--     doing the same job. The members' notice and the operator's notice are
--     tracked separately because they fail separately, and a failure to reach
--     the members must never hide that the operator was not told.
--
-- A FAILED EMAIL NEVER BLOCKS OR ROLLS BACK THE REQUEST. Nothing in the request
-- function depends on delivery; the state starts as 'pending' and only a later,
-- separate call changes it.
-- =============================================================================

set search_path = public, extensions, pg_temp;

-- -----------------------------------------------------------------------------
-- 1. Delivery state, on the organization row
--
-- Reuses public.invitation_delivery: pending | accepted_by_provider | failed |
-- manual_link | not_configured. `accepted_by_provider` means an API took the
-- message, not that anybody read it. Null means no closure has been requested.
-- -----------------------------------------------------------------------------

alter table public.organizations
  add column closure_members_notice_state  public.invitation_delivery,
  add column closure_operator_notice_state public.invitation_delivery,
  add column closure_notice_detail         text
    check (closure_notice_detail is null or char_length(closure_notice_detail) <= 300);

comment on column public.organizations.closure_members_notice_state is
  'Whether the email to owners and administrators about the closure request was handed to a provider. Written only by the service role and the request function.';
comment on column public.organizations.closure_operator_notice_state is
  'Whether the email to the operator (cancel the Stripe subscription) was handed to a provider. Written only by the service role and the request function.';
comment on column public.organizations.closure_notice_detail is
  'A short category describing the last delivery attempt. Never a provider payload, an address or a key.';

-- The guard learns the new columns. Without this an administrator, who may
-- update their own organization row, could mark the operator notice as sent and
-- silently defeat the one message that prompts the Stripe cancellation.
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
          new.closure_notice_detail)
         is distinct from
         (old.closure_requested_at, old.closure_requested_by, old.closure_purge_after,
          old.purge_started_at, old.closed_at,
          old.closure_members_notice_state, old.closure_operator_notice_state,
          old.closure_notice_detail)
  then
    raise exception 'The closure state of an agency cannot be changed directly.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- 2. The feed learns the new kind
--
-- An event kind missing from this list is written, addressed to real people, and
-- then invisible forever. It is owners and administrators only, which is exactly
-- who this helper already serves, and it points at Settings, where the restore
-- button is. Replaced whole: this is the 20260823100200 version plus the kind and
-- the path.
-- -----------------------------------------------------------------------------

create or replace function app.notification_candidates_events(p_organization_id uuid)
returns setof app.notification_candidate
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
begin
  if not app.has_min_role(p_organization_id, 'admin') then
    return;
  end if;

  return query
  select
    'event:' || e.id::text,
    e.kind, 'team'::public.notification_category, e.severity,
    e.subject_user_id, e.subject_label, e.actor_user_id, e.actor_label,
    e.occurred_at, null::date, null::bigint, null::public.currency_code,
    case when e.kind = 'account_closure_requested' then '/settings' else '/team' end,
    e.context
  from public.notification_events e
  join public.notification_event_recipients r on r.event_id = e.id
  where e.organization_id = p_organization_id
    and r.user_id = v_actor
    and e.kind in (
      'team_invitation_accepted', 'team_ownership_transferred',
      'team_role_changed', 'team_member_removed',
      'account_closure_requested'
    );
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. Requesting closure: the same function, now telling people
--
-- Everything above the notification is unchanged from 20261108100100. The
-- notification is written AFTER the guards, so a refused request raises before
-- it and nothing at all is recorded.
--
-- source_id is a fresh uuid: (organization, source_table, source_id) is unique,
-- and an agency may close, restore and close again. Each closure is its own
-- event; the row lock below serialises requests, so there is no retry to dedupe.
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
         closure_notice_detail = null
   where id = p_organization_id
  returning * into v_org;

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

  -- Everyone who owns or administers the agency now, the requester included: for
  -- them it is a record of what they did, and for a single-owner agency whose
  -- account was taken over it is the only trace the real owner will see.
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
-- 4. What the Edge Function needs, and nothing a browser can reach
--
-- Granted to service_role ONLY. They return addresses, and they change delivery
-- state; neither is something a member of an agency may do.
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
  select
    o.id,
    coalesce(nullif(btrim(o.legal_name), ''), o.name),
    coalesce(app.actor_display_name(o.closure_requested_by), ''),
    o.closure_purge_after,
    coalesce(o.closure_members_notice_state in ('pending', 'failed', 'not_configured'), false),
    coalesce(o.closure_operator_notice_state in ('pending', 'failed', 'not_configured'), false),
    coalesce((
      select array_agg(distinct u.email order by u.email)
      from public.organization_members m
      join auth.users u on u.id = m.user_id
      where m.organization_id = o.id
        and m.status = 'active'
        and app.role_rank(m.role) >= app.role_rank('admin')
        and u.email is not null
    ), '{}')
  from public.organizations o
  where (p_organization_id is null or o.id = p_organization_id)
    and o.closure_requested_at is not null
    and o.purge_started_at is null
    and o.closed_at is null
    and (   o.closure_members_notice_state  in ('pending', 'failed', 'not_configured')
         or o.closure_operator_notice_state in ('pending', 'failed', 'not_configured'));
$$;

comment on function app.closure_notices_pending(uuid) is
  'Closing agencies whose notice email is not yet accepted by a provider, with the addresses of their owners and administrators. Service role only.';

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
         closure_notice_detail         = coalesce(left(p_detail, 300), closure_notice_detail)
   where id = p_organization_id
     and closure_requested_at is not null;
$$;

comment on function app.closure_notice_record(uuid, public.invitation_delivery, public.invitation_delivery, text) is
  'Records what a delivery attempt observed. A null state leaves that channel unchanged. Service role only.';

revoke all on function app.closure_notices_pending(uuid) from public, anon, authenticated;
revoke all on function app.closure_notice_record(uuid, public.invitation_delivery, public.invitation_delivery, text)
  from public, anon, authenticated;
grant execute on function app.closure_notices_pending(uuid) to service_role;
grant execute on function app.closure_notice_record(uuid, public.invitation_delivery, public.invitation_delivery, text)
  to service_role;

revoke all on function public.organization_request_closure(uuid) from public, anon;
grant execute on function public.organization_request_closure(uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 5. Assertions
-- -----------------------------------------------------------------------------

do $$
declare
  v_body text;
begin
  select pg_get_functiondef(p.oid) into v_body
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'organization_request_closure';

  if v_body not like '%SECURITY DEFINER%' or v_body like '%require_write%' or v_body like '%may_write%' then
    raise exception 'organization_request_closure must stay SECURITY DEFINER and outside the write gate.';
  end if;

  if has_function_privilege('authenticated', 'app.closure_notices_pending(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'app.closure_notices_pending(uuid)', 'EXECUTE') then
    raise exception 'Only the service role may list pending closure notices: they carry addresses.';
  end if;
end;
$$;

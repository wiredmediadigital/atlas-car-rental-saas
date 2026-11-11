-- =============================================================================
-- Account closure: restoring tells people
--
-- Closing an agency sends the operator an instruction: if its subscription is
-- still live past the purge date, cancel it in Stripe. Restoring sent nobody
-- anything, so nothing ever retracted that instruction, and an agency that had
-- changed its mind could have its subscription cancelled by an operator acting
-- on a stale message. Restoring also never told the other owners and
-- administrators, who could only notice that the banner had gone.
--
-- TWO THINGS, in the restore's own transaction:
--
--   * IN-APP. One notification event for every owner and administrator, written
--     the way organization_request_closure writes its own.
--
--   * OPERATOR EMAIL. A database function cannot send email, so the restore
--     records that a notice is PENDING on the organizations row, beside the
--     closure columns, and the daily drain (account-closure-notice) sends it and
--     reports what it saw. It is retried until the provider accepts it and is
--     deliberately uncapped, like the closure operator notice: the operator is
--     acting on an instruction from outside the product and must be told it was
--     withdrawn. There is no outbox table; delivery state lives on the row.
--
-- OWNERS AND ADMINISTRATORS ARE NOT EMAILED ON RESTORE. That was decided: the
-- in-app notification is enough, because the agency is visibly working again.
--
-- RESTORING DOES NOT TOUCH STRIPE. Nothing here, and nothing in the drain, moves
-- money or restarts a subscription. The email tells a person; it does not act.
--
-- THE RESTORE NOTICE HAS ITS OWN COLUMNS, and that is what makes the ordering of
-- close, restore and close safe when the drain has not run in between:
--
--   * A NEW CLOSURE LEAVES AN UNSENT RESTORE NOTICE ALONE.
--     organization_request_closure resets only the closure_* notice columns, and
--     none of the columns added here, so the retraction is still owed. When it is
--     sent the agency may be closing again, so the drain is told (closing_again)
--     and the email says so rather than claiming the agency is working.
--
--   * A RESTORE DOES NOT KEEP AN UNSENT CLOSURE NOTICE. It is cleared with the
--     rest of the closure, as 20261110100600 already decided. Sending "this
--     agency has asked to close" after the closure was withdrawn would be a false
--     statement, and its one purpose (prompting a cancellation if the
--     subscription is still live past the purge date) is void. The restore notice
--     is owed unconditionally, whether or not the closure notice was ever
--     accepted: a closure notice that failed may still have been delivered, and
--     only the restore notice retracts it.
--
--   * A SECOND RESTORE REPLACES AN UNSENT FIRST ONE. They say the same thing.
--
--   * AN OUTCOME IS RECORDED AGAINST THE RESTORE IT WAS FOR.
--     closure_restored_at identifies the restore and is handed back to
--     app.closure_restore_notice_record, as closure_requested_at does for the
--     closure notices. A newer restore in between makes the write a no-op.
--
-- app.closure_notices_pending, which finds the closure notices, requires
-- closure_requested_at IS NOT NULL and a restored agency has that null, so it can
-- never find a restore notice. The restore notices therefore have their own
-- finder, app.closure_restore_notices_pending, that the same drain calls; it
-- filters on the restore notice state alone. It returns no address: nobody but
-- the operator is emailed.
--
-- Earlier migrations are never edited; what they defined and this changes is
-- replaced whole below.
-- =============================================================================

set search_path = public, extensions, pg_temp;

-- -----------------------------------------------------------------------------
-- 1. Delivery state of the restore notice, on the organization row
--
-- Reuses public.invitation_delivery. Null means no restore notice has ever been
-- recorded. `accepted_by_provider` means an API took the message, not that
-- anybody read it.
-- -----------------------------------------------------------------------------

alter table public.organizations
  add column closure_restored_at timestamptz,
  add column closure_restore_notice_state public.invitation_delivery,
  add column closure_restore_notice_attempts integer not null default 0
    check (closure_restore_notice_attempts >= 0),
  add column closure_restore_notice_detail text
    check (closure_restore_notice_detail is null or char_length(closure_restore_notice_detail) <= 300);

comment on column public.organizations.closure_restored_at is
  'When the agency was last restored from a pending closure. Identifies WHICH restore a delivery outcome belongs to. Unlike the closure columns it is not cleared by a restore or by a new closure. Written only by the restore function.';
comment on column public.organizations.closure_restore_notice_state is
  'Whether the email telling the operator that a closure was withdrawn (and that a cancelled subscription has to be restarted) was handed to a provider. Written only by the service role and the restore function.';
comment on column public.organizations.closure_restore_notice_attempts is
  'Failed attempts to email the operator about this restore. A record only: the operator channel is never given up on. Service role only.';
comment on column public.organizations.closure_restore_notice_detail is
  'A short category describing the last restore-notice delivery attempt. Never a provider payload, an address or a key.';

-- The guard learns the new columns. Without this an administrator, who may update
-- their own organization row, could mark the restore notice as sent.
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
          new.closure_members_notice_attempts, new.closure_operator_notice_attempts,
          new.closure_restored_at, new.closure_restore_notice_state,
          new.closure_restore_notice_attempts, new.closure_restore_notice_detail)
         is distinct from
         (old.closure_requested_at, old.closure_requested_by, old.closure_purge_after,
          old.purge_started_at, old.closed_at,
          old.closure_members_notice_state, old.closure_operator_notice_state,
          old.closure_notice_detail,
          old.closure_members_notice_attempts, old.closure_operator_notice_attempts,
          old.closure_restored_at, old.closure_restore_notice_state,
          old.closure_restore_notice_attempts, old.closure_restore_notice_detail)
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
-- 20261110100100's version plus the kind. It is owners and administrators only,
-- which is who this helper already serves, and points at Settings, where the
-- agency's closure status lives.
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
    case when e.kind in ('account_closure_requested', 'account_closure_restored')
         then '/settings' else '/team' end,
    e.context
  from public.notification_events e
  join public.notification_event_recipients r on r.event_id = e.id
  where e.organization_id = p_organization_id
    and r.user_id = v_actor
    and e.kind in (
      'team_invitation_accepted', 'team_ownership_transferred',
      'team_role_changed', 'team_member_removed',
      'account_closure_requested', 'account_closure_restored'
    );
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. Restoring: 20261110100600's version, now telling people
--
-- Everything above the UPDATE is unchanged, including the lock and its order.
-- The notification is written AFTER the guards, so a refused restore raises
-- before it and nothing at all is recorded.
-- -----------------------------------------------------------------------------

create or replace function public.organization_restore(p_organization_id uuid)
returns public.organizations
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_org   public.organizations;
  v_event uuid;
  v_actor uuid := (select auth.uid());
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

  /*
   * Every closure column is cleared, and the restore notice is recorded as
   * pending. The restore notice columns are NOT closure columns in that sense:
   * they describe this restore, and a later closure does not reset them. An
   * unsent closure notice is cleared with the closure it belonged to.
   */
  update public.organizations
     set closure_requested_at             = null,
         closure_requested_by             = null,
         closure_purge_after              = null,
         closure_members_notice_state     = null,
         closure_operator_notice_state    = null,
         closure_notice_detail            = null,
         closure_members_notice_attempts  = 0,
         closure_operator_notice_attempts = 0,
         closure_restored_at              = now(),
         closure_restore_notice_state     = 'pending',
         closure_restore_notice_attempts  = 0,
         closure_restore_notice_detail    = null
   where id = p_organization_id
  returning * into v_org;

  -- source_id is a fresh uuid: (organization, source_table, source_id) is unique
  -- and an agency may close and restore any number of times.
  insert into public.notification_events (
    organization_id, kind, severity, occurred_at,
    actor_user_id, actor_label, subject_user_id, subject_label,
    context, source_table, source_id
  ) values (
    p_organization_id, 'account_closure_restored', 'info', now(),
    v_actor, left(coalesce(app.actor_display_name(v_actor), ''), 200),
    null, left(coalesce(v_org.name, ''), 200),
    '{}'::jsonb,
    'account_closure_restore', gen_random_uuid()
  )
  returning id into v_event;

  -- Everyone who owns or administers the agency now, the restorer included: any
  -- of them can restore, so the others must be able to learn that someone did.
  insert into public.notification_event_recipients (event_id, user_id)
  select v_event, m.user_id
  from public.organization_members m
  where m.organization_id = p_organization_id
    and m.status = 'active'
    and app.role_rank(m.role) >= app.role_rank('admin')
  on conflict do nothing;

  return v_org;
end;
$fn$;

comment on function public.organization_restore(uuid) is
  'Owner or admin. Withdraws a pending closure and clears every closure column. In the same transaction it records an operator email as pending (closure_restore_notice_state) and writes an in-app notification for every owner and administrator. Touches nothing in Stripe. Refused once purge_started_at is set. SECURITY DEFINER because the closure columns refuse browser roles; exempt from the write gate so a billing-restricted agency can still restore.';

-- -----------------------------------------------------------------------------
-- 4. What the drain needs, and nothing a browser can reach
-- -----------------------------------------------------------------------------

create function app.closure_restore_notices_pending(p_organization_id uuid default null)
returns table (
  organization_id   uuid,
  organization_name text,
  restored_at       timestamptz,
  closing_again     boolean
)
language sql
stable
security definer
set search_path = ''
as $fn$
  select
    o.id,
    -- The legal name, the same name the closure operator email uses.
    coalesce(nullif(btrim(o.legal_name), ''), o.name),
    -- WHICH restore this is, handed back to closure_restore_notice_record.
    o.closure_restored_at,
    -- The agency may have been closed again since: the email must not claim it
    -- is working then.
    o.closure_requested_at is not null
  from public.organizations o
  where (p_organization_id is null or o.id = p_organization_id)
    -- Owed until accepted. Deliberately no attempt limit, and deliberately no
    -- condition on closure_requested_at: a restored agency has it null.
    and o.closure_restore_notice_state in ('pending', 'failed', 'not_configured')
    and o.closure_restored_at is not null
    and o.purge_started_at is null
    and o.closed_at is null;
$fn$;

comment on function app.closure_restore_notices_pending(uuid) is
  'Agencies whose operator restore notice is owed, with closure_restored_at (which restore) and whether the agency is closing again. Never capped. Returns no addresses. Service role only.';

create function app.closure_restore_notice_record(
  p_organization_id uuid,
  p_state           public.invitation_delivery,
  p_detail          text,
  p_restored_at     timestamptz
)
returns void
language sql
security definer
set search_path = ''
as $fn$
  update public.organizations
     set closure_restore_notice_state    = coalesce(p_state, closure_restore_notice_state),
         closure_restore_notice_detail   = coalesce(left(p_detail, 300), closure_restore_notice_detail),
         closure_restore_notice_attempts = closure_restore_notice_attempts
           + case when p_state = 'failed' then 1 else 0 end
   where id = p_organization_id
     and closure_restored_at is not null
     -- The restore the sender was told about. A newer restore in between makes
     -- this not match, and then nothing is written.
     and closure_restored_at = p_restored_at;
$fn$;

comment on function app.closure_restore_notice_record(uuid, public.invitation_delivery, text, timestamptz) is
  'Records what a restore notice attempt observed, for the restore named by p_restored_at. Writes nothing if the agency has been restored again since. Service role only.';

revoke all on function app.closure_restore_notices_pending(uuid) from public, anon, authenticated;
revoke all on function app.closure_restore_notice_record(
  uuid, public.invitation_delivery, text, timestamptz) from public, anon, authenticated;
grant execute on function app.closure_restore_notices_pending(uuid) to service_role;
grant execute on function app.closure_restore_notice_record(
  uuid, public.invitation_delivery, text, timestamptz) to service_role;

-- -----------------------------------------------------------------------------
-- 5. Assertions
-- -----------------------------------------------------------------------------

do $assert$
declare
  v_restore text;
  v_request text;
begin
  if has_function_privilege('authenticated', 'app.closure_restore_notices_pending(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'app.closure_restore_notices_pending(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated',
          'app.closure_restore_notice_record(uuid, public.invitation_delivery, text, timestamptz)',
          'EXECUTE')
     or has_function_privilege('anon',
          'app.closure_restore_notice_record(uuid, public.invitation_delivery, text, timestamptz)',
          'EXECUTE') then
    raise exception 'Only the service role may list or record restore notices.';
  end if;

  select pg_get_functiondef('public.organization_restore(uuid)'::regprocedure) into v_restore;
  if v_restore not like '%closure_restore_notice_state%'
     or v_restore not like '%account_closure_restored%' then
    raise exception 'organization_restore must record the notice and write the notification.';
  end if;

  -- A new closure must not reset the restore notice.
  select pg_get_functiondef('public.organization_request_closure(uuid)'::regprocedure) into v_request;
  if v_request like '%closure_restore%' or v_request like '%closure_restored_at%' then
    raise exception 'organization_request_closure must leave an unsent restore notice alone.';
  end if;
end;
$assert$;

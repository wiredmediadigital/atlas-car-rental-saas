-- =============================================================================
-- Account closure: a restore clears the whole closure, and an outcome names
-- the closure it belongs to
--
-- TWO THINGS, ONE CAUSE: organization_restore was written in 20261108100100,
-- when a closure was three columns. 20261110100100 and 20261110100200 added
-- five more -- the two notice states, the detail, and the two attempt counts --
-- and nothing revisited the restore.
--
--   1. A RESTORED AGENCY KEPT THE DELIVERY RECORD OF A CLOSURE THAT NO LONGER
--      EXISTS. That contradicts the columns' own comment, "Null means no
--      closure has been requested", and leaves a reader of the row unable to
--      tell a fresh agency from one that closed, failed to email anybody, and
--      came back. Every closure column is cleared here, and the counts go back
--      to zero.
--
--   2. AN OUTCOME COULD BE RECORDED AGAINST THE WRONG CLOSURE. This is the only
--      "marked sent without being sent" route on the branch. A drain tick reads
--      closure_notices_pending for closure #1 and starts sending; before it
--      records what the provider said, an administrator restores the agency and
--      the owner closes it again. closure_notice_record was keyed on the
--      organization id alone, so it wrote `accepted_by_provider` onto closure
--      #2 for an email that named closure #1's purge date -- and closure #2's
--      notice, which nobody had sent, was never offered again. The owners and
--      administrators of an agency that is genuinely closing are then never
--      told, and (for the operator channel) the Stripe subscription is never
--      cancelled.
--
--      So the drain is told which closure each pending notice belongs to, and
--      hands it back when it records. A mismatch updates nothing, which leaves
--      the notice owed and sent on the next tick. Clearing the columns on
--      restore does NOT fix this on its own: organization_request_closure
--      already resets them, so the stale write lands on a freshly reset row.
--
-- closure_notices_pending changes its return shape and closure_notice_record
-- its signature, so both are dropped and recreated rather than replaced. The
-- operator channel is still never capped (20261110100300) and the members cap
-- is still three (20261110100200): neither rule changes here.
--
-- 20261108100100, 20261110100100, 20261110100200 and 20261110100300 are never
-- edited; what they defined and this changes is replaced whole below.
-- =============================================================================

set search_path = public, extensions, pg_temp;

-- -----------------------------------------------------------------------------
-- 1. Restoring clears the whole closure
--
-- 20261108100100's definition, with five more columns in the UPDATE. The lock
-- is still taken before the state is read, and still before organization_
-- claim_purge can take it: that is what makes "refused once the purge has
-- started" true, and it is not reordered.
-- -----------------------------------------------------------------------------

create or replace function public.organization_restore(p_organization_id uuid)
returns public.organizations
language plpgsql
security definer
set search_path = ''
as $fn$
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

  /*
   * EVERY closure column, not the three this function was written with. The
   * notice states and their attempt counts describe a closure that is being
   * withdrawn; leaving them behind makes the row say that a closure nobody
   * requested failed to email anybody.
   */
  update public.organizations
     set closure_requested_at             = null,
         closure_requested_by             = null,
         closure_purge_after              = null,
         closure_members_notice_state     = null,
         closure_operator_notice_state    = null,
         closure_notice_detail            = null,
         closure_members_notice_attempts  = 0,
         closure_operator_notice_attempts = 0
   where id = p_organization_id
  returning * into v_org;

  return v_org;
end;
$fn$;

comment on function public.organization_restore(uuid) is
  'Owner or admin. Withdraws a pending closure and clears every closure column, including the notice states and their attempt counts. Refused once purge_started_at is set. SECURITY DEFINER because the closure columns refuse browser roles; exempt from the write gate so a billing-restricted agency can still restore.';

-- -----------------------------------------------------------------------------
-- 2. The pending list says which closure each notice is for
--
-- 20261110100300's definition with one more output column. The members cap and
-- the uncapped operator channel are unchanged.
-- -----------------------------------------------------------------------------

drop function if exists app.closure_notices_pending(uuid);

create function app.closure_notices_pending(p_organization_id uuid default null)
returns table (
  organization_id   uuid,
  organization_name text,
  requested_by_name text,
  requested_at      timestamptz,
  purge_after       timestamptz,
  send_members      boolean,
  send_operator     boolean,
  recipients        text[]
)
language sql
stable
security definer
set search_path = ''
as $fn$
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
    -- WHICH closure this is. Handed back to closure_notice_record, so an
    -- outcome cannot land on a later closure of the same agency.
    o.closure_requested_at,
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
$fn$;

comment on function app.closure_notices_pending(uuid) is
  'Every agency with a closure notice still owed, with the addresses to send to and the closure_requested_at that identifies the closure. Members are capped at three failed attempts; the operator channel never is. Service role only.';

-- -----------------------------------------------------------------------------
-- 3. Recording an outcome names the closure it belongs to
-- -----------------------------------------------------------------------------

drop function if exists app.closure_notice_record(
  uuid, public.invitation_delivery, public.invitation_delivery, text);

create function app.closure_notice_record(
  p_organization_id uuid,
  p_members_state   public.invitation_delivery,
  p_operator_state  public.invitation_delivery,
  p_detail          text,
  p_requested_at    timestamptz
)
returns void
language sql
security definer
set search_path = ''
as $fn$
  update public.organizations
     set closure_members_notice_state  = coalesce(p_members_state, closure_members_notice_state),
         closure_operator_notice_state = coalesce(p_operator_state, closure_operator_notice_state),
         closure_notice_detail         = coalesce(left(p_detail, 300), closure_notice_detail),
         closure_members_notice_attempts  = closure_members_notice_attempts
           + case when p_members_state = 'failed' then 1 else 0 end,
         closure_operator_notice_attempts = closure_operator_notice_attempts
           + case when p_operator_state = 'failed' then 1 else 0 end
   where id = p_organization_id
     and closure_requested_at is not null
     -- The closure the sender was told about. A restore and a second closure in
     -- between make this not match, and then nothing is written: the new
     -- closure's notice stays owed and goes out on the next tick.
     and closure_requested_at = p_requested_at;
$fn$;

comment on function app.closure_notice_record(uuid, public.invitation_delivery, public.invitation_delivery, text, timestamptz) is
  'Records what a closure notice attempt observed, for the closure named by p_requested_at. Writes nothing if the agency has since been restored and closed again, so an outcome cannot be recorded against a notice that was never sent. Service role only.';

-- -----------------------------------------------------------------------------
-- 4. Privileges
-- -----------------------------------------------------------------------------

revoke all on function app.closure_notices_pending(uuid) from public, anon, authenticated;
revoke all on function app.closure_notice_record(
  uuid, public.invitation_delivery, public.invitation_delivery, text, timestamptz)
  from public, anon, authenticated;
grant execute on function app.closure_notices_pending(uuid) to service_role;
grant execute on function app.closure_notice_record(
  uuid, public.invitation_delivery, public.invitation_delivery, text, timestamptz)
  to service_role;

-- -----------------------------------------------------------------------------
-- 5. Assertions
-- -----------------------------------------------------------------------------

do $assert$
declare
  v_body text;
begin
  if has_function_privilege('authenticated', 'app.closure_notices_pending(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'app.closure_notices_pending(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated',
          'app.closure_notice_record(uuid, public.invitation_delivery, public.invitation_delivery, text, timestamptz)',
          'EXECUTE')
     or has_function_privilege('anon',
          'app.closure_notice_record(uuid, public.invitation_delivery, public.invitation_delivery, text, timestamptz)',
          'EXECUTE') then
    raise exception 'Only the service role may list or record closure notices.';
  end if;

  -- The four-argument version must be gone, or a caller that was never updated
  -- keeps writing outcomes keyed on the organization alone.
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'app' and p.proname = 'closure_notice_record' and p.pronargs = 4
  ) then
    raise exception 'The closure-blind closure_notice_record must not still exist.';
  end if;

  -- Restoring must clear every closure column the guard trigger protects.
  select pg_get_functiondef('public.organization_restore(uuid)'::regprocedure) into v_body;
  if v_body not like '%closure_members_notice_state%'
     or v_body not like '%closure_operator_notice_state%'
     or v_body not like '%closure_notice_detail%'
     or v_body not like '%closure_members_notice_attempts%'
     or v_body not like '%closure_operator_notice_attempts%' then
    raise exception 'organization_restore must clear every closure column.';
  end if;
end;
$assert$;

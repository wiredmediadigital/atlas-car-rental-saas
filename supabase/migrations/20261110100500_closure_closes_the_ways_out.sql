-- =============================================================================
-- Account closure: the "ways out" exemption, re-derived for a SUSPENDED agency
--
-- 20261103100200 exempts seven functions from the write gate under the heading
-- "the ways out", and every reason written beside them is a BILLING reason:
-- they belong to an agency whose subscription lapsed, and each is a way back to
-- paying or a way to wind down. 20261108100000 then made
-- app.billing_require_write a thin delegate to app.may_write, which quietly
-- re-scoped that same list from "things a LAPSED agency may still do" to
-- "things a SUSPENDED agency may still do". Nobody re-derived it, and the spec
-- had asked for exactly that: "Which calls the exemption covers is
-- security-sensitive and should be spelled out, not inherited by accident."
--
-- 20261103100200 can never be edited, so the re-derivation is written here,
-- one line per exempt function that touches membership:
--
--   remove_team_member               GOES. It is SECURITY DEFINER, so it
--     bypasses both the policies and the gate, and app.may_act_on_member lets
--     an owner remove an administrator -- so a compromised sole owner could
--     request closure and then remove every administrator, destroying the
--     spec's own stated mitigation for that exact case, which is that any
--     administrator can reach the restore button during the grace period.
--   change_team_member_role          GOES, for the same reason by another
--     route: demoting the administrators to staff removes the restore button
--     just as effectively as removing the people.
--   accept_team_invitation           GOES. The invitation was authorised while
--     the agency was in good standing; the agency it now leads to is not. A
--     person who joins a closing agency and belongs to no other has their login
--     deleted by the purge thirty days later, having done nothing but accept.
--   transfer_organization_ownership  STAYS. It hands the agency to another
--     owner rather than removing one, so it cannot shrink the set of people who
--     can restore, and for an agency whose owner has gone it is the only route
--     to anybody who can.
--   leave_organization               STAYS. It removes only the caller, and the
--     last-owner guard already stops the one person who could restore from
--     being the one who leaves.
--   revoke_team_invitation           STAYS. It only takes a capability away,
--     and a closing agency has every reason to withdraw outstanding invitations.
--   record_invitation_delivery       STAYS. It records what an email provider
--     did with a link that was already issued. Refusing it would lose evidence,
--     not prevent a write.
--
-- BILLING IS NOT NARROWED. The three that go are refused on CLOSURE only, by
-- asking app.closure_state_of directly rather than app.require_write: a lapsed
-- agency must still be able to shrink its team, and that reason is untouched.
--
-- The refusal is the sentence app.require_write already raises for closure, and
-- it is matched on its text in src/lib/supabase/errors.ts, so it is not
-- reworded.
--
-- 20260821100200 is never edited; what it defined and this changes is replaced
-- whole below, each body otherwise untouched.
-- =============================================================================

set search_path = public, extensions, pg_temp;

-- -----------------------------------------------------------------------------
-- 1. Changing a role
-- -----------------------------------------------------------------------------

create or replace function public.change_team_member_role(
  p_organization_id uuid,
  p_user_id         uuid,
  p_role            public.org_role
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor       uuid := (select auth.uid());
  v_actor_role  public.org_role;
  v_target      public.organization_members;
  v_owners      integer;
begin
  if v_actor is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  if p_user_id = v_actor then
    raise exception 'You cannot change your own role.' using errcode = '42501';
  end if;

  if p_role = 'owner' then
    raise exception 'Ownership is transferred, not assigned.' using errcode = '42501';
  end if;

  /*
   * The lock precedes every read the decision rests on — including the reader's
   * own role. It did not, and a request already in flight when its author was
   * demoted completed one more privileged write with the authority it no longer
   * had.
   */
  v_owners := app.lock_and_count_active_owners(p_organization_id);

  v_actor_role := app.current_role_in(p_organization_id);
  if v_actor_role is null then
    raise exception 'Not a member of this organization.' using errcode = '42501';
  end if;

  select * into v_target
  from public.organization_members m
  where m.organization_id = p_organization_id
    and m.user_id = p_user_id
    and m.status = 'active'
  for update;

  if not found then
    raise exception 'That person is not a member of this organization.' using errcode = 'P0002';
  end if;

  if not app.may_act_on_member(v_actor_role, v_target.role) then
    raise exception 'You cannot change the role of a %.', v_target.role using errcode = '42501';
  end if;
  if not app.may_grant_role(v_actor_role, p_role) then
    raise exception 'You cannot grant the % role.', p_role using errcode = '42501';
  end if;

  if v_target.role = p_role then
    return;
  end if;

  /*
   * CLOSURE, AFTER IDENTITY AND AUTHORITY. See the header: this function is
   * exempt from the write gate for a BILLING reason, and that reason does not
   * survive closure.
   */
  if app.closure_state_of(p_organization_id) <> 'open' then
    raise exception 'This agency is closed or closing, so its records are read-only.'
      using errcode = '42501';
  end if;

  if v_target.role = 'owner' and v_owners <= 1 then
    raise exception 'An organization must always keep at least one active owner.'
      using errcode = '23514';
  end if;

  perform set_config('app.membership_operation', 'on', true);

  update public.organization_members
     set role = p_role
   where organization_id = p_organization_id
     and user_id = p_user_id;

  perform set_config('app.membership_operation', 'off', true);

  perform app.record_team_event(
    p_organization_id, 'role_changed', p_user_id, null, v_target.role, p_role, null, null
  );

  perform app.revoke_invitations_beyond_authority(
    p_organization_id, p_user_id,
    'The person who sent it no longer has authority to grant this role.'
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- 2. Removing a member
-- -----------------------------------------------------------------------------

create or replace function public.remove_team_member(
  p_organization_id uuid,
  p_user_id         uuid
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor      uuid := (select auth.uid());
  v_actor_role public.org_role;
  v_target     public.organization_members;
  v_owners     integer;
  v_name       text;
  v_email      text;
begin
  if v_actor is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  if p_user_id = v_actor then
    raise exception 'Use Leave organization to remove yourself.' using errcode = '42501';
  end if;

  v_owners := app.lock_and_count_active_owners(p_organization_id);

  v_actor_role := app.current_role_in(p_organization_id);
  if v_actor_role is null then
    raise exception 'Not a member of this organization.' using errcode = '42501';
  end if;

  select * into v_target
  from public.organization_members m
  where m.organization_id = p_organization_id
    and m.user_id = p_user_id
    and m.status = 'active'
  for update;

  if not found then
    raise exception 'That person is not a member of this organization.' using errcode = 'P0002';
  end if;

  if not app.may_act_on_member(v_actor_role, v_target.role) then
    raise exception 'You cannot remove a %.', v_target.role using errcode = '42501';
  end if;

  /*
   * CLOSURE, AFTER IDENTITY AND AUTHORITY. See the header: this function is
   * exempt from the write gate for a BILLING reason, and that reason does not
   * survive closure.
   */
  if app.closure_state_of(p_organization_id) <> 'open' then
    raise exception 'This agency is closed or closing, so its records are read-only.'
      using errcode = '42501';
  end if;

  if v_target.role = 'owner' and v_owners <= 1 then
    raise exception 'An organization must always keep at least one active owner.'
      using errcode = '23514';
  end if;

  -- Snapshot before the membership disappears; the address comes from the
  -- authority rather than the mirror.
  select coalesce(nullif(btrim(p.full_name), ''), u.email, ''), u.email
    into v_name, v_email
  from auth.users u
  left join public.profiles p on p.id = u.id
  where u.id = p_user_id;

  perform set_config('app.membership_operation', 'on', true);

  delete from public.organization_members
   where organization_id = p_organization_id
     and user_id = p_user_id;

  perform set_config('app.membership_operation', 'off', true);

  perform app.record_team_event(
    p_organization_id, 'member_removed', p_user_id, v_email, v_target.role, null, null, null, v_name
  );

  perform app.revoke_invitations_beyond_authority(
    p_organization_id, p_user_id, 'The person who sent it is no longer a member.'
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. Accepting an invitation
-- -----------------------------------------------------------------------------

create or replace function public.accept_team_invitation(p_token text)
returns table (
  organization_id   uuid,
  organization_name text,
  role              public.org_role,
  outcome           text
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor        uuid := (select auth.uid());
  v_email        text;
  v_confirmed_at timestamptz;
  v_invitation   public.organization_invitations;
  v_state        text;
  v_inviter_role public.org_role;
  v_existing     public.org_role;
  v_status       public.member_status;
  v_org_name     text;
  v_organization uuid;
  v_invited_email text;
begin
  if v_actor is null then
    raise exception 'Sign in to accept this invitation.' using errcode = '42501';
  end if;

  select app.normalize_email(u.email), u.email_confirmed_at
    into v_email, v_confirmed_at
  from auth.users u
  where u.id = v_actor;

  if v_email is null then
    raise exception 'Your account has no email address on file.' using errcode = '42501';
  end if;
  if v_confirmed_at is null then
    raise exception 'Confirm your email address before joining an agency.' using errcode = '42501';
  end if;

  /*
   * Advisory lock first, then the row — the same order every other function in
   * this module uses. Reversing it here would let an acceptance and a reissue
   * on one agency each hold what the other is waiting for.
   *
   * The unlocked read establishes only which agency is involved. The address is
   * still checked before any state is reported, so a stranger holding a stale
   * token learns nothing, and everything the decision rests on is read again
   * under the locks.
   */
  select i.organization_id, i.email_normalized
    into v_organization, v_invited_email
  from public.organization_invitations i
  where i.token_digest = app.invitation_token_digest(p_token);

  if v_organization is null then
    raise exception 'That invitation link is not valid.' using errcode = 'P0002';
  end if;

  if v_invited_email <> v_email then
    raise exception 'This invitation was sent to a different account.' using errcode = '42501';
  end if;

  /*
   * CLOSURE, AFTER THE ADDRESS IS PROVED. A stranger holding a stale token
   * still learns nothing: they are refused above, before this. Somebody who
   * really was invited is told the agency is on its way out rather than being
   * joined to it -- and if it were their only membership, the purge would
   * delete their login thirty days later.
   */
  if app.closure_state_of(v_organization) <> 'open' then
    raise exception 'This agency is closed or closing, so its records are read-only.'
      using errcode = '42501';
  end if;

  perform app.lock_organization_membership(v_organization);

  select * into v_invitation
  from public.organization_invitations i
  where i.token_digest = app.invitation_token_digest(p_token)
  for update;

  if not found then
    raise exception 'That invitation link is not valid.' using errcode = 'P0002';
  end if;

  v_state := app.invitation_state(v_invitation.accepted_at, v_invitation.revoked_at, v_invitation.expires_at);

  if v_state = 'revoked' then
    raise exception 'That invitation was withdrawn.' using errcode = '42501';
  end if;
  if v_state = 'expired' then
    raise exception 'That invitation has expired. Ask for a new one.' using errcode = '42501';
  end if;

  select o.name into v_org_name
  from public.organizations o
  where o.id = v_invitation.organization_id;

  if v_org_name is null then
    raise exception 'That agency no longer exists.' using errcode = 'P0002';
  end if;

  select m.role, m.status into v_existing, v_status
  from public.organization_members m
  where m.organization_id = v_invitation.organization_id
    and m.user_id = v_actor
  for update;

  /*
   * A SPENT INVITATION IS SETTLED HERE, BEFORE ANY MEMBERSHIP BRANCH.
   *
   * It used to be settled after them, and that was a replay: somebody who
   * accepted, was later suspended, and still had the original email could open
   * the same link and reinstate themselves at the invited role — which may be
   * higher than the role they were suspended at — leaving an ordinary
   * "invitation_accepted" event as the only trace.
   *
   * The one thing a used token may still do is answer the second of two tabs,
   * and only for the account that used it and only while that membership is
   * live. That is why the token is not rotated on acceptance: rotating it would
   * make the second tab read "this link is not valid" to somebody who has just
   * successfully joined. It grants nothing either way.
   */
  if v_state = 'accepted' then
    if v_invitation.accepted_by = v_actor and v_existing is not null and v_status = 'active' then
      return query select v_invitation.organization_id, v_org_name, v_existing, 'already_member'::text;
      return;
    end if;

    raise exception 'That invitation has already been used.' using errcode = '42501';
  end if;

  -- Already a member: close the invitation rather than failing on the unique
  -- constraint, and never create a second membership row.
  if v_existing is not null and v_status = 'active' then
    update public.organization_invitations
       set accepted_at = now(), accepted_by = v_actor
     where id = v_invitation.id;

    perform app.record_team_event(
      v_invitation.organization_id, 'invitation_accepted', v_actor, v_invitation.email,
      null, v_existing, v_invitation.id, 'Already a member; the invitation was closed.'
    );

    return query select v_invitation.organization_id, v_org_name, v_existing, 'already_member'::text;
    return;
  end if;

  -- A suspended member holding a PENDING invitation is being readmitted. The
  -- row is unique on (organization, user), so this is a reinstatement rather
  -- than an insert.
  if v_existing is not null then
    perform set_config('app.membership_operation', 'on', true);

    update public.organization_members m
       set status = 'active', role = v_invitation.role
     where m.organization_id = v_invitation.organization_id
       and m.user_id = v_actor;

    update public.organization_invitations
       set accepted_at = now(), accepted_by = v_actor
     where id = v_invitation.id;

    perform set_config('app.membership_operation', 'off', true);

    perform app.record_team_event(
      v_invitation.organization_id, 'invitation_accepted', v_actor, v_invitation.email,
      v_existing, v_invitation.role, v_invitation.id, 'Readmitted from a suspended membership.'
    );

    return query select v_invitation.organization_id, v_org_name, v_invitation.role, 'joined'::text;
    return;
  end if;

  /*
   * Does the person who sent this still have the authority to send it?
   *
   * A refusal and nothing else. The earlier version wrote a revocation here and
   * then raised — and the RAISE rolled its own UPDATE back, so the link stayed
   * live and became acceptable again the moment its author was restored. The
   * durable revocation belongs to the demotion, which performs it under the
   * same per-agency lock this function now takes, so the race that made an
   * acceptance-time revocation seem necessary cannot happen.
   */
  if v_invitation.invited_by is not null then
    select m.role into v_inviter_role
    from public.organization_members m
    where m.organization_id = v_invitation.organization_id
      and m.user_id = v_invitation.invited_by
      and m.status = 'active';

    if not app.may_grant_role(v_inviter_role, v_invitation.role) then
      raise exception 'That invitation is no longer valid. Ask an administrator to send a new one.'
        using errcode = '42501';
    end if;
  end if;

  perform set_config('app.membership_operation', 'on', true);

  insert into public.organization_members (organization_id, user_id, role, status, invited_by)
  values (v_invitation.organization_id, v_actor, v_invitation.role, 'active', v_invitation.invited_by);

  update public.organization_invitations
     set accepted_at = now(), accepted_by = v_actor
   where id = v_invitation.id;

  perform set_config('app.membership_operation', 'off', true);

  perform app.record_team_event(
    v_invitation.organization_id, 'invitation_accepted', v_actor, v_invitation.email,
    null, v_invitation.role, v_invitation.id, null
  );

  return query select v_invitation.organization_id, v_org_name, v_invitation.role, 'joined'::text;
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. Assertions
--
-- create or replace keeps each function's oid, so its grants and its comment
-- survive and are not restated. What is restated is the property this file
-- exists for.
-- -----------------------------------------------------------------------------

do $assert$
declare
  v_name text;
  v_body text;
begin
  foreach v_name in array array[
    'public.change_team_member_role(uuid, uuid, public.org_role)',
    'public.remove_team_member(uuid, uuid)',
    'public.accept_team_invitation(text)'
  ] loop
    select pg_get_functiondef(v_name::regprocedure) into v_body;
    if v_body not like '%closure_state_of%' then
      raise exception 'Function % must refuse a closing agency.', v_name;
    end if;
    -- And it must still NOT carry the billing gate: a lapsed agency keeps these.
    if v_body like '%billing_require_write%' or v_body like '%app.require_write%' then
      raise exception
        'Function % must refuse on closure only; a lapsed agency keeps it.', v_name;
    end if;
  end loop;

  -- The two that stay must stay: a future edit that gates them should have to
  -- argue with this line rather than slip past it.
  foreach v_name in array array[
    'public.transfer_organization_ownership(uuid, uuid, public.org_role)',
    'public.leave_organization(uuid)'
  ] loop
    select pg_get_functiondef(v_name::regprocedure) into v_body;
    if v_body like '%closure_state_of%' then
      raise exception
        'Function % is exempt from closure on purpose; see this file''s header.', v_name;
    end if;
  end loop;
end;
$assert$;

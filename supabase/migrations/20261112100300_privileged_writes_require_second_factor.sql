-- =============================================================================
-- 20261112100300_privileged_writes_require_second_factor.sql
--
-- Closes the write half of the second-factor gate.
--
-- 20261112100200 puts app.has_second_factor() into the helpers behind every RLS
-- policy, so a session that has only passed the password (aal1, or a pre-MFA
-- token with no aal claim) can no longer READ tenant data. Five SECURITY DEFINER
-- RPCs decide who may act with app.current_role_in alone, which is deliberately
-- left ungated, so that session could still take the account over:
--
--   public.transfer_organization_ownership   hand the agency to itself
--   public.remove_team_member                remove the real owner
--   public.change_team_member_role           promote itself
--   public.create_team_invitation            invite a second account for itself
--   public.organization_request_closure      start closing the agency
--
-- Each now refuses with 42501 unless the request carries aal2. The check is the
-- first thing each body does after identity (and, in create_team_invitation, it
-- precedes the advisory lock), so a refusal takes no lock and writes nothing.
--
-- app.current_role_in is NOT gated here and must not be: app.enforce_vehicle_limit
-- uses it as an ungated membership test, and app.guard_membership_changes calls
-- it on paths with no user session. Gating it would reopen the plan-limit
-- fail-open 20261112100200 repaired.
--
-- Each body below is the latest existing definition of that function, unchanged
-- apart from the added check:
--   transfer_organization_ownership  20260821100000_team_membership.sql
--   remove_team_member               20261110100500_closure_closes_the_ways_out.sql
--   change_team_member_role          20261110100500_closure_closes_the_ways_out.sql
--   create_team_invitation           20261103100200_billing_restricted_rpcs.sql
--   organization_request_closure     20261110100200_account_closure_notice_retries.sql
--
-- Restoring is already symmetric: organization_restore guards with
-- app.has_min_role, which 20261112100200 gated.
-- =============================================================================

set search_path = public, extensions, pg_temp;

create or replace function public.transfer_organization_ownership(
  p_organization_id uuid,
  p_user_id         uuid,
  p_outgoing_role   public.org_role default 'admin'
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor  uuid := (select auth.uid());
  v_target public.organization_members;
  v_owners integer;
begin
  if v_actor is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  if not app.has_second_factor() then
    raise exception 'A verified second factor is required to transfer ownership.' using errcode = '42501';
  end if;

  if app.current_role_in(p_organization_id) is distinct from 'owner' then
    raise exception 'Only the owner can transfer ownership.' using errcode = '42501';
  end if;

  if p_user_id = v_actor then
    raise exception 'You already own this organization.' using errcode = '22023';
  end if;

  if p_outgoing_role = 'owner' then
    raise exception 'Choose the role you will keep after the transfer.' using errcode = '22023';
  end if;

  v_owners := app.lock_and_count_active_owners(p_organization_id);

  -- Re-read the caller's own membership under the lock. Between the role check
  -- above and this line another transfer may have completed and demoted them.
  if not exists (
    select 1 from public.organization_members m
    where m.organization_id = p_organization_id
      and m.user_id = v_actor
      and m.role = 'owner'
      and m.status = 'active'
  ) then
    raise exception 'Only the owner can transfer ownership.' using errcode = '42501';
  end if;

  -- The target is read from this organization's membership, never taken on
  -- trust: an id belonging to another agency simply is not a member here.
  select * into v_target
  from public.organization_members m
  where m.organization_id = p_organization_id
    and m.user_id = p_user_id
    and m.status = 'active'
  for update;

  if not found then
    raise exception 'Choose an active member of this organization.' using errcode = 'P0002';
  end if;

  perform set_config('app.membership_operation', 'on', true);

  update public.organization_members
     set role = 'owner'
   where organization_id = p_organization_id and user_id = p_user_id;

  update public.organization_members
     set role = p_outgoing_role
   where organization_id = p_organization_id and user_id = v_actor;

  perform set_config('app.membership_operation', 'off', true);

  -- The invariant, re-asserted against what is actually in the table rather
  -- than against what this function believes it just did.
  select count(*) into v_owners
  from public.organization_members m
  where m.organization_id = p_organization_id
    and m.role = 'owner'
    and m.status = 'active';

  if v_owners < 1 then
    raise exception 'Ownership transfer would leave the organization without an owner.'
      using errcode = '23514';
  end if;

  perform app.record_team_event(
    p_organization_id, 'ownership_transferred', p_user_id, null, v_target.role, 'owner', null,
    'The previous owner is now ' || p_outgoing_role || '.'
  );

  -- The outgoing owner may no longer be able to grant what they promised.
  perform app.revoke_invitations_beyond_authority(
    p_organization_id, v_actor,
    'The person who sent it no longer has authority to grant this role.'
  );
end;
$$;

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

  if not app.has_second_factor() then
    raise exception 'A verified second factor is required to remove a member.' using errcode = '42501';
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

  if not app.has_second_factor() then
    raise exception 'A verified second factor is required to change a role.' using errcode = '42501';
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

create or replace function public.create_team_invitation(p_organization_id uuid, p_email text, p_role public.org_role)
 RETURNS TABLE(invitation_id uuid, token text, expires_at timestamp with time zone, outcome text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
declare
  v_actor       uuid := (select auth.uid());
  v_actor_role  public.org_role;
  v_email       text;
  v_normalized  text;
  v_token       text;
  v_existing    public.organization_invitations;
  v_target_user uuid;
  v_id          uuid;
  v_expires     timestamptz;
begin
  if v_actor is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  if not app.has_second_factor() then
    raise exception 'A verified second factor is required to invite somebody.' using errcode = '42501';
  end if;

  /*
   * The agency lock comes FIRST, before the caller's own authority is read.
   *
   * Without it, an invitation could be inserted in the window between a
   * demotion's authority sweep taking its snapshot and the demotion committing
   * — leaving a live grant of a role its author could no longer make. Taking
   * the same lock the role-change path takes means the two serialise: either
   * this call runs first and the sweep sees the invitation, or the demotion
   * runs first and the role check below refuses.
   */
  perform app.lock_organization_membership(p_organization_id);

  v_actor_role := app.current_role_in(p_organization_id);
  if v_actor_role is null then
    raise exception 'Not a member of this organization.' using errcode = '42501';
  end if;

  if p_role = 'owner' then
    raise exception 'Ownership is transferred, not invited.' using errcode = '42501';
  end if;

  if not app.may_grant_role(v_actor_role, p_role) then
    raise exception 'You cannot invite somebody as %.', p_role using errcode = '42501';
  end if;

  /*
   * A restricted agency may not take on new staff.
   *
   * Inviting somebody is growth, and the wind-down is the opposite of growth.
   * Removing a member, changing a role, leaving, and transferring ownership are
   * all deliberately left open: each of those is how an agency gets itself out
   * of this state, and the last one may be the only way an abandoned agency
   * ever pays again.
   */
  perform app.billing_require_write(p_organization_id);

  v_email := left(btrim(coalesce(p_email, '')), 320);
  v_normalized := app.normalize_email(v_email);

  if v_normalized is null then
    raise exception 'An email address is required.' using errcode = '22004';
  end if;
  if v_normalized !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'That is not a valid email address.' using errcode = '22023';
  end if;

  if (
    select count(*) from public.organization_invitations i
    where i.organization_id = p_organization_id
      and i.last_issued_at > now() - interval '1 hour'
  ) >= app.invitation_hourly_limit() then
    raise exception 'This agency has sent a lot of invitations in the last hour. Try again shortly.'
      using errcode = '55006';
  end if;

  /*
   * Already in the agency? Matched against auth.users, not the profile mirror.
   *
   * The mirror used to be client-writable, so any member could set their own
   * profile email to an address the agency was about to invite and make this
   * check answer "already_member" — an invitation silently swallowed, reported
   * to the administrator as success, with no row, no token and no event. The
   * mirror is fixed above; this reads the authority regardless, because a check
   * that decides whether an invitation happens should not depend on a
   * denormalisation being in step.
   */
  select m.user_id into v_target_user
  from public.organization_members m
  join auth.users u on u.id = m.user_id
  where m.organization_id = p_organization_id
    and m.status = 'active'
    and app.normalize_email(u.email) = v_normalized
  limit 1;

  if v_target_user is not null then
    return query select null::uuid, null::text, null::timestamptz, 'already_member'::text;
    return;
  end if;

  v_token := app.new_invitation_token();
  v_expires := now() + app.invitation_ttl();

  select * into v_existing
  from public.organization_invitations i
  where i.organization_id = p_organization_id
    and i.email_normalized = v_normalized
    and i.accepted_at is null
    and i.revoked_at is null
  for update;

  if found then
    if v_existing.last_issued_at + app.invitation_resend_cooldown() > now() then
      raise exception 'That invitation was issued moments ago. Try again shortly.'
        using errcode = '55006';
    end if;

    /*
     * `invited_by` moves to whoever reissued it.
     *
     * It did not, and the authority cascade keys on that column: demoting the
     * original author revoked an invitation a higher-authority administrator
     * had since taken over, while demoting the administrator who actually
     * rotated the token and chose the role revoked nothing. The person who last
     * issued a capability is the person whose authority it rests on.
     */
    update public.organization_invitations
       set email          = v_email,
           role           = p_role,
           invited_by     = v_actor,
           token_digest   = app.invitation_token_digest(v_token),
           token_version  = token_version + 1,
           expires_at     = v_expires,
           last_issued_at = now(),
           delivery_state = 'pending',
           delivery_detail = null
     where id = v_existing.id
     returning id into v_id;

    perform app.record_team_event(
      p_organization_id, 'invitation_created', null, v_email,
      case when v_existing.role <> p_role then v_existing.role end, p_role, v_id,
      'Reissued; the previous link stopped working.'
    );

    return query select v_id, v_token, v_expires, 'reissued'::text;
    return;
  end if;

  insert into public.organization_invitations (
    organization_id, email, email_normalized, role, invited_by,
    expires_at, token_digest
  ) values (
    p_organization_id, v_email, v_normalized, p_role, v_actor,
    v_expires, app.invitation_token_digest(v_token)
  )
  returning id into v_id;

  perform app.record_team_event(
    p_organization_id, 'invitation_created', null, v_email, null, p_role, v_id, null
  );

  return query select v_id, v_token, v_expires, 'created'::text;
end;
$$;

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
  if not app.has_second_factor() then
    raise exception 'A verified second factor is required to close an agency.' using errcode = '42501';
  end if;

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

-- create or replace keeps existing grants; restated so the file stands alone.
revoke all on function public.transfer_organization_ownership(uuid, uuid, public.org_role) from public, anon;
revoke all on function public.remove_team_member(uuid, uuid) from public, anon;
revoke all on function public.change_team_member_role(uuid, uuid, public.org_role) from public, anon;
revoke all on function public.create_team_invitation(uuid, text, public.org_role) from public, anon;
revoke all on function public.organization_request_closure(uuid) from public, anon;
grant execute on function public.transfer_organization_ownership(uuid, uuid, public.org_role) to authenticated;
grant execute on function public.remove_team_member(uuid, uuid) to authenticated;
grant execute on function public.change_team_member_role(uuid, uuid, public.org_role) to authenticated;
grant execute on function public.create_team_invitation(uuid, text, public.org_role) to authenticated;
grant execute on function public.organization_request_closure(uuid) to authenticated, service_role;

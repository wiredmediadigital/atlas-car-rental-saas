-- =============================================================================
-- Billing: the four functions that RLS cannot see
--
-- A SECURITY DEFINER function runs as its owner and does not consult the
-- policies on the tables it writes. So a gate expressed only in policies — the
-- previous migration — has a hole shaped like every definer function that a
-- signed-in user can call. Closing that hole is this file.
--
-- HOW THE LIST WAS ARRIVED AT, so the next person can repeat it rather than
-- trust it. Every function in `public` and `app` was read back from pg_proc on
-- a database with all migrations applied, filtered to those that are both
-- `prosecdef` AND executable by `authenticated`, and then to those whose body
-- contains an INSERT, UPDATE or DELETE against a table. That is 17 functions.
-- They fall into four groups:
--
--   GATED HERE (4)
--     financing_activate_agreement, financing_generate_schedule
--       They write financing_agreements and financing_installments. New work.
--     create_team_invitation, resend_team_invitation
--       They issue a capability to a new person. Growth.
--
--   DELIBERATELY NOT GATED — billing itself (1)
--     billing_set_email
--       The address an invoice is sent to. Gating the one field somebody has to
--       fix in order to start paying again would be a locked door with the key
--       behind it.
--
--   DELIBERATELY NOT GATED — personal interface state (5)
--     notification_dismiss, notification_mark_read, notification_mark_all_read,
--     notification_snooze, notification_preference_set
--       These write one person's read/dismissed/snoozed markers. Not agency
--       records. Gating them would mean a restricted agency could not dismiss
--       the notification telling it that it is restricted.
--
--   DELIBERATELY NOT GATED — the ways out (7)
--     revoke_team_invitation, remove_team_member, leave_organization,
--     change_team_member_role, transfer_organization_ownership,
--     accept_team_invitation, record_invitation_delivery
--       Every one of these either removes something or hands responsibility to
--       somebody else. transfer_organization_ownership especially: for an
--       agency whose owner has gone, that is the only route back to a paying
--       subscription, and gating it would make the restriction permanent by
--       construction. accept_team_invitation is open because the invitation it
--       accepts was authorised while the agency was in good standing, and the
--       person joining can only read.
--
-- THE ORDER OF CHECKS INSIDE EACH FUNCTION IS NOT ARBITRARY. Identity first,
-- then authority, then billing. Asking about billing before "does this record
-- exist and may you touch it" would let a stranger probe ids and learn from the
-- difference in error which agencies have stopped paying.
--
-- Each function below is its current definition with one `perform` added. The
-- bodies are otherwise untouched, and were taken from pg_get_functiondef rather
-- than retyped. CREATE OR REPLACE keeps each function's oid, so its grants and
-- its comment survive and are not restated here.
-- =============================================================================

set search_path = public, extensions, pg_temp;

create or replace function public.financing_generate_schedule(p_agreement_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
declare
  v_agreement public.financing_agreements;
  v_existing  integer;
  v_revision  integer;
  v_written   integer;
  v_level     bigint;
begin
  select * into v_agreement
  from public.financing_agreements
  where id = p_agreement_id
  for update;

  -- A cross-tenant id and an id that never existed answer identically.
  if v_agreement.id is null or not app.has_min_role(v_agreement.organization_id, 'admin') then
    raise exception 'Financing agreement not found.' using errcode = 'P0002';
  end if;

  /*
   * Billing is asked AFTER the agreement is found and the role is checked, so
   * that a cross-tenant id still answers "not found" rather than disclosing
   * that some other agency has stopped paying.
   */
  perform app.billing_require_write(v_agreement.organization_id);

  if exists (
    select 1 from public.financing_payments p
    where p.agreement_id = p_agreement_id and p.status = 'recorded'
  ) then
    raise exception
      'Payments have been recorded against this agreement, so its schedule can no longer be regenerated.'
      using errcode = '23514';
  end if;

  select count(*) into v_existing
  from public.financing_installments i
  where i.agreement_id = p_agreement_id;

  -- The first schedule is revision 1; every replacement is the next number, so
  -- an instalment can be traced to the terms it came from.
  v_revision := case when v_existing > 0 then v_agreement.schedule_revision + 1
                     else v_agreement.schedule_revision end;

  delete from public.financing_installments where agreement_id = p_agreement_id;

  insert into public.financing_installments (
    organization_id, agreement_id, sequence, due_on,
    expected_total_minor, expected_principal_minor, expected_interest_minor,
    remaining_principal_minor, is_balloon, revision
  )
  select
    v_agreement.organization_id,
    v_agreement.id,
    s.sequence,
    s.due_on,
    s.expected_total_minor,
    s.expected_principal_minor,
    s.expected_interest_minor,
    s.remaining_principal_minor,
    s.is_balloon,
    v_revision
  from public.financing_projected_schedule(
    v_agreement.mode,
    v_agreement.financed_amount_minor,
    v_agreement.rate_bps,
    v_agreement.installments_count::integer,
    v_agreement.installment_amount_minor,
    v_agreement.first_payment_on,
    v_agreement.schedule_anchor_day,
    v_agreement.payment_frequency,
    coalesce(v_agreement.balloon_minor, 0)
  ) s;

  get diagnostics v_written = row_count;

  -- The level payment the schedule settled on: the amount every ordinary
  -- instalment shares. The final one differs by the rounding it absorbs, and a
  -- balloon is not an instalment, so both are excluded.
  if v_agreement.installment_amount_minor is null then
    select i.expected_total_minor into v_level
    from public.financing_installments i
    where i.agreement_id = p_agreement_id
      and not i.is_balloon
    group by i.expected_total_minor
    order by count(*) desc, i.expected_total_minor
    limit 1;
  end if;

  update public.financing_agreements
     set ends_on = (select max(i.due_on) from public.financing_installments i where i.agreement_id = p_agreement_id),
         installment_amount_minor = coalesce(installment_amount_minor, v_level),
         schedule_revision = v_revision
   where id = p_agreement_id;

  return v_written;
end;
$$;


create or replace function public.financing_activate_agreement(p_agreement_id uuid)
 RETURNS financing_agreements
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
declare
  v_agreement public.financing_agreements;
begin
  select * into v_agreement
  from public.financing_agreements
  where id = p_agreement_id
  for update;

  if v_agreement.id is null or not app.has_min_role(v_agreement.organization_id, 'admin') then
    raise exception 'Financing agreement not found.' using errcode = 'P0002';
  end if;

  -- Same order, same reason: identity, then authority, then billing.
  perform app.billing_require_write(v_agreement.organization_id);

  if v_agreement.agreement_status <> 'draft' then
    raise exception 'Only a draft agreement can be activated.' using errcode = '23514';
  end if;

  perform public.financing_generate_schedule(p_agreement_id);

  update public.financing_agreements
     set agreement_status = 'active',
         activated_at = now(),
         updated_by = (select auth.uid())
   where id = p_agreement_id
  returning * into v_agreement;

  return v_agreement;
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


create or replace function public.resend_team_invitation(p_invitation_id uuid)
 RETURNS TABLE(invitation_id uuid, token text, expires_at timestamp with time zone, outcome text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
declare
  v_actor        uuid := (select auth.uid());
  v_actor_role   public.org_role;
  v_invitation   public.organization_invitations;
  v_organization uuid;
  v_token        text;
  v_expires      timestamptz;
begin
  if v_actor is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  /*
   * The agency lock is taken BEFORE the row lock, in the same order as
   * create_team_invitation — advisory first, then the row.
   *
   * Taking them the other way round is a lock-order inversion: a create and a
   * resend racing on the same agency would each hold what the other wanted and
   * PostgreSQL would abort one with a deadlock. So the row is read once
   * unlocked purely to learn which agency it belongs to, and everything the
   * decision rests on is re-read afterwards under both locks.
   */
  select i.organization_id into v_organization
  from public.organization_invitations i
  where i.id = p_invitation_id;

  if v_organization is null or not app.is_org_member(v_organization) then
    raise exception 'That invitation was not found.' using errcode = 'P0002';
  end if;

  perform app.lock_organization_membership(v_organization);

  select * into v_invitation
  from public.organization_invitations i
  where i.id = p_invitation_id
  for update;

  if not found then
    raise exception 'That invitation was not found.' using errcode = 'P0002';
  end if;

  v_actor_role := app.current_role_in(v_invitation.organization_id);
  if not app.may_grant_role(v_actor_role, v_invitation.role) then
    raise exception 'You cannot resend an invitation for the % role.', v_invitation.role
      using errcode = '42501';
  end if;

  -- Resending mints a new token and sends mail. Same growth, same answer.
  perform app.billing_require_write(v_invitation.organization_id);

  if v_invitation.accepted_at is not null then
    raise exception 'That invitation has already been accepted.' using errcode = '22023';
  end if;
  if v_invitation.revoked_at is not null then
    raise exception 'That invitation was revoked. Invite the person again to send a new one.'
      using errcode = '22023';
  end if;

  if v_invitation.last_issued_at + app.invitation_resend_cooldown() > now() then
    raise exception 'That invitation was sent moments ago. Try again shortly.'
      using errcode = '55006';
  end if;

  /*
   * The agency ceiling applies here too.
   *
   * It used to sit only on creation, and it counted rows. Resend mints a token
   * and asks a provider to send mail, so an agency with enough open invitations
   * could loop resends and use the product's mail reputation as a relay while
   * every individual call respected its two-minute floor.
   */
  if (
    select count(*) from public.organization_invitations i
    where i.organization_id = v_invitation.organization_id
      and i.last_issued_at > now() - interval '1 hour'
  ) >= app.invitation_hourly_limit() then
    raise exception 'This agency has sent a lot of invitations in the last hour. Try again shortly.'
      using errcode = '55006';
  end if;

  v_token := app.new_invitation_token();
  v_expires := now() + app.invitation_ttl();

  update public.organization_invitations
     set invited_by      = v_actor,
         token_digest    = app.invitation_token_digest(v_token),
         token_version   = token_version + 1,
         expires_at      = v_expires,
         last_issued_at  = now(),
         delivery_state  = 'pending',
         delivery_detail = null
   where id = p_invitation_id;

  perform app.record_team_event(
    v_invitation.organization_id, 'invitation_resent', null, v_invitation.email,
    null, v_invitation.role, p_invitation_id,
    'A new link was issued; the previous one stopped working.'
  );

  return query select p_invitation_id, v_token, v_expires, 'reissued'::text;
end;
$$;
-- -----------------------------------------------------------------------------
-- Assertions
--
-- The list above was derived from the database, and the derivation is repeated
-- here so that a definer function added LATER cannot quietly widen the hole.
-- Anything new that is definer, reachable by `authenticated` and writes one of
-- the gated tenant tables must either carry the gate or be named in the
-- exemption list — and naming it there is a decision somebody has to write down.
-- -----------------------------------------------------------------------------

do $$
declare
  v_exempt constant text[] := array[
    -- Billing itself. See the header.
    'billing_set_email',
    -- One person's own notification markers. See the header.
    'notification_dismiss', 'notification_mark_read', 'notification_mark_all_read',
    'notification_snooze', 'notification_preference_set',
    -- The ways out. See the header.
    'revoke_team_invitation', 'remove_team_member', 'leave_organization',
    'change_team_member_role', 'transfer_organization_ownership',
    'accept_team_invitation', 'record_invitation_delivery',
    -- Provisioning: creates the agency, runs before it could have a subscription.
    'create_organization'
  ];
  v_unguarded text;
begin
  select string_agg(p.proname, ', ' order by p.proname) into v_unguarded
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prosecdef
    and has_function_privilege('authenticated', p.oid, 'EXECUTE')
    and pg_get_functiondef(p.oid) ~* '\m(insert\s+into|update|delete\s+from)\s+public\.'
    and pg_get_functiondef(p.oid) not like '%billing_require_write%'
    and not (p.proname = any (v_exempt));

  if v_unguarded is not null then
    raise exception
      'These SECURITY DEFINER functions write through RLS without the billing gate and are not exempt: %. Add app.billing_require_write, or add the function to the exemption list with a reason.',
      v_unguarded;
  end if;

  -- And the gate itself has to be reachable from inside a definer body.
  if not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app' and p.proname = 'billing_require_write'
  ) then
    raise exception 'app.billing_require_write must exist.';
  end if;
end;
$$;

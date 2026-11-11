-- =============================================================================
-- Account closure: two comments corrected, no behaviour changed
--
-- Cancelling the agency's Stripe subscription is not automatic and is not the
-- runner's job. The agency is asked to cancel its own from Manage billing, and
-- the operator email is a backstop for a subscription still live past the purge
-- date. Two pieces of shipped database metadata said otherwise:
--
--   1. The comment on organizations.closure_operator_notice_state, written by
--      20261110100100, described the operator email as "cancel the Stripe
--      subscription". Superseded by a fresh comment on column below.
--
--   2. The body comment in app.organization_claim_purge, written by
--      20261108100200 and carried unchanged by 20261110100400, said the runner
--      "cancels the agency's Stripe subscription before it claims". The runner
--      never touches Stripe. This migration supersedes that function with the
--      identical definition of 20261110100400 and a corrected comment. Only a
--      comment differs: the logic, the errcode, the signature and the grants
--      (create or replace keeps them) are untouched.
--
-- The older migrations are history and are left as they are.
-- =============================================================================

comment on column public.organizations.closure_operator_notice_state is
  'Whether the backstop email to the operator (a closure was requested; cancel the subscription only if it is still live past the purge date) was handed to a provider. Written only by the service role and the request function.';

-- -----------------------------------------------------------------------------
-- The claim, with its comment corrected
-- -----------------------------------------------------------------------------

create or replace function app.organization_claim_purge(p_organization_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_org public.organizations;
begin
  select * into v_org from public.organizations where id = p_organization_id for update;

  if not found then
    return false;
  end if;

  if v_org.purge_started_at is not null or v_org.closed_at is not null then
    return false;
  end if;

  if v_org.closure_requested_at is null
     or v_org.closure_purge_after is null
     or v_org.closure_purge_after > now()
  then
    return false;
  end if;

  /*
   * NOTHING HAS BEEN SWEPT YET, AND THIS IS THE LAST MOMENT AT WHICH THAT IS
   * TRUE. The caller sweeps Storage as soon as it holds the claim, and Storage
   * is not transactional: a rollback afterwards brings the rows back and not
   * the files. So the lists are compared here, where refusing costs nothing and
   * leaves the agency 'suspended' and therefore still restorable.
   *
   * No errcode on purpose: the runner reads 55000 from this function as "still
   * billed". This is not that, and must surface as a failure.
   */
  if not app.organization_purge_lists_agree() then
    raise exception
      'The purge lists and the schema disagree, so nothing was claimed or deleted. %',
      app.organization_purge_list_disagreement();
  end if;

  /*
   * THIS REFUSAL IS THE INTERLOCK, AND MEANT TO STAY. Nothing cancels the
   * agency's Stripe subscription automatically: the runner never touches Stripe
   * (see account-closure.ts), the agency is asked to cancel its own from
   * Manage billing, and the operator is told to cancel it only if it is still
   * live past the purge date. So this refusal is what stops a paying customer
   * being purged, and it will fire for any agency that has not cancelled. The
   * claim is the one step after which the agency's data is destroyed and cannot
   * be brought back, so "purged a paying customer" must be unreachable no
   * matter what a caller forgot, got wrong, or was changed to do. If you are
   * reading this and about to delete it, do not. It mirrors the refusal the old
   * organization-delete guard (app.guard_organization_billing_on_delete) made
   * for the same reason, with the same set of live statuses.
   */
  if app.organization_has_live_subscription(p_organization_id) then
    raise exception
      'This agency still has a live subscription. Cancel it in Stripe before purging.'
      using errcode = '55000';
  end if;

  update public.organizations
     set purge_started_at = now()
   where id = p_organization_id;

  return true;
end;
$fn$;

comment on function app.organization_claim_purge(uuid) is
  'Sets purge_started_at when the agency is closing and its date has passed; refuses if the purge lists and the schema disagree (while nothing has been swept and the agency is still restorable) and if a live subscription remains. Takes the organizations row lock as its first statement, the same lock organization_restore takes, so a restore and a claim cannot both win. Service role only.';

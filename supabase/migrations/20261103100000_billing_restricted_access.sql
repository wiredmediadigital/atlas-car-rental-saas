-- =============================================================================
-- Billing: the restriction policy, decided
--
-- public.billing_access_state has carried a fourth value, `restricted`, since
-- the billing model was written, and nothing has ever produced it. The comment
-- on the enum said why: no commercial restriction policy had been decided, and
-- a migration is not where one gets decided.
--
-- It has now been decided. This file is where it lands.
--
-- THE POLICY, IN ONE SENTENCE: an agency without a live subscription keeps
-- everything it can READ and loses everything it can WRITE.
--
-- Not a blackout. The records, documents, contracts and history of an agency
-- that stops paying are still that agency's -- they stay visible, searchable and
-- exportable for as long as the account exists. What stops is new work: no new
-- rental, no new customer, no new expense, no new contract. A wind-down, not a
-- hostage situation.
--
-- WHY past_due KEEPS ACCESS. `past_due` does not mean "this agency refused to
-- pay". It means Stripe tried a card and will try again -- the retry schedule
-- runs for weeks, and a large share of those retries succeed. Restricting on
-- the first failed attempt would punish an expired card. The product waits
-- until Stripe itself gives up, which it signals by moving the subscription to
-- `unpaid` or `canceled` depending on the dashboard's failed-payment setting.
-- Both of those are restricted here, so the behaviour is correct whichever one
-- this deployment happens to be configured for.
--
-- WHY `incomplete` KEEPS ACCESS. It is a checkout whose first payment has not
-- confirmed yet -- 3-D Secure, a bank prompt, a slow issuer. It is terminal
-- after 23 hours and becomes `incomplete_expired`, which is restricted. The
-- window is deliberately generous: somebody who is in the act of paying must
-- not be locked out mid-payment.
--
-- WHAT THIS FILE DOES NOT DO. It restricts nothing. It decides what `restricted`
-- MEANS and publishes a predicate that asks the question; the next two
-- migrations are what make a write stop. Split that way so this one can be
-- applied, read back on the Billing page and in the notification feed, and
-- checked against a real Stripe account before anything is actually denied.
-- =============================================================================

set search_path = public, extensions, pg_temp;

-- -----------------------------------------------------------------------------
-- 1. Stripe's vocabulary becomes ours -- now with a fourth answer
-- -----------------------------------------------------------------------------

/**
 * What the product does about one agency's billing.
 *
 * THE ORDER OF THESE TESTS IS STILL THE FIX IT WAS. A subscription that exists
 * is a fact about this agency; a catalogue that has nothing for sale is a fact
 * about the deployment. Asking the second question first once told a paying
 * customer their billing was not set up, hid their plan and their renewal date,
 * and dropped the notification that would have warned them about a failed
 * payment. That order is preserved exactly.
 *
 * WHAT CHANGED is only the right-hand side of the status mapping, and the
 * answer for an agency that has never subscribed:
 *
 *   active, trialing                       normal      work continues
 *   past_due, incomplete                   attention   work continues, loudly
 *   unpaid, canceled, paused,
 *     incomplete_expired                   restricted  read-only
 *   no subscription, platform configured   restricted  read-only
 *   no subscription, platform unconfigured platform_unconfigured
 *
 * `paused` is restricted rather than attention because it is what a trial
 * becomes when it ends with no payment method on file. That is precisely the
 * "the free trial ended and nothing was paid" case, and the whole point of
 * having a trial is that it ends.
 *
 * THE LAST ROW IS THE ONE THAT CHANGES A DEPLOYMENT'S CHARACTER. An agency that
 * has never subscribed used to resolve to `attention` -- a nag with no teeth.
 * It now resolves to `restricted`, which is what "the product is sold by
 * subscription" actually means. A new agency therefore starts read-only and
 * stays that way for the time between creating the agency and starting its free
 * trial. Everything that path needs is deliberately exempt:
 * public.create_organization provisions as definer, the Billing page is a read,
 * and checkout happens in an Edge Function under the service role.
 *
 * `platform_unconfigured` is untouched and must stay that way. A deployment
 * with no Stripe keys and no sellable plan has not launched billing at all, and
 * locking such an installation out of its own data over a subscription nobody
 * was ever offered would be indefensible.
 */
create or replace function app.billing_access_state_of(p_organization_id uuid)
returns public.billing_access_state
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_subscription public.billing_subscriptions;
begin
  v_subscription := app.billing_effective_subscription(p_organization_id);

  -- A subscription this agency actually has. Its state is the answer, whatever
  -- the catalogue currently offers for sale.
  if v_subscription.id is not null then
    return case v_subscription.status
      when 'active'   then 'normal'
      when 'trialing' then 'normal'

      /*
       * Stripe has not finished trying.
       *   past_due    a payment failed and the retry schedule is still running
       *   incomplete  a first payment that has not confirmed; terminal at 23h
       */
      when 'past_due'   then 'attention'
      when 'incomplete' then 'attention'

      /*
       * Stripe has finished trying, or there was never anything to try.
       *   unpaid              retries exhausted, invoice left unpaid
       *   canceled            terminal
       *   incomplete_expired  the 23 hours passed; this one cannot be revived
       *   paused              a trial ended with no payment method
       */
      else 'restricted'
    end;
  end if;

  -- No subscription, and nothing to sell. Billing has not launched in this
  -- deployment: access is normal, and this is not a subscription, an exemption
  -- or a grandfathered plan.
  if not app.billing_platform_configured() then
    return 'platform_unconfigured';
  end if;

  -- Configured, and this agency has never subscribed. There is a product to buy
  -- and they have not bought it.
  return 'restricted';
end;
$$;

comment on function app.billing_access_state_of(uuid) is
  'Stripe status -> product access, in one place. An existing subscription always decides; only an agency with none can resolve to platform_unconfigured. Returns restricted when Stripe has stopped trying (unpaid, canceled, paused, incomplete_expired) or the agency never subscribed; past_due and incomplete keep access while Stripe is still retrying.';

comment on type public.billing_access_state is
  'What the product does about an agency''s billing. restricted means read-only: everything already recorded stays readable and exportable, nothing new can be written. See app.billing_access_state_of.';

-- -----------------------------------------------------------------------------
-- 2. The predicate the policies ask
-- -----------------------------------------------------------------------------

/**
 * May this agency write today?
 *
 * WHY THIS IS ITS OWN FUNCTION AND NOT A CLAUSE INSIDE app.has_min_role.
 *
 * Folding the billing check into has_min_role is the one-line version of this
 * entire change, and it is wrong. has_min_role is the role predicate in 178
 * places, 44 of which are SELECT policies. Putting a billing condition inside
 * it would make a restricted agency unable to READ its own customers, rentals,
 * contracts and documents -- which is not a wind-down, it is the blackout this
 * policy deliberately is not. The separation IS the policy.
 *
 * WHY IT IS NOT WRAPPED IN A SCALAR SUBQUERY IN THE POLICIES.
 *
 * The Supabase guidance to write `(select auth.uid())` inside a policy works
 * because auth.uid() takes no arguments: the planner can hoist it to an
 * InitPlan evaluated once per statement. This predicate takes the row's
 * organization_id, so it is correlated and cannot be hoisted -- wrapping it
 * would only turn a function call into a SubPlan. It is left bare, in exactly
 * the shape app.has_min_role already appears in beside it.
 *
 * That cost is acceptable here and would not be in a SELECT policy: this
 * predicate is only ever added to INSERT, UPDATE and DELETE policies, which
 * touch a handful of rows per statement. The 44 SELECT policies -- the hot
 * path, the ones a report or a list view runs -- are untouched by this change.
 *
 * NULL IS IMPOSSIBLE, AND WOULD BE SAFE ANYWAY. billing_access_state_of always
 * returns a value; if it somehow did not, a NULL in a policy predicate denies
 * rather than permits.
 */
create or replace function app.billing_may_write(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.billing_access_state_of(p_organization_id) <> 'restricted';
$$;

comment on function app.billing_may_write(uuid) is
  'False only when the organization is billing-restricted. The write half of the read-only wind-down; deliberately separate from app.has_min_role so that reads are never affected.';

/**
 * The same question, for a function that bypasses RLS.
 *
 * A SECURITY DEFINER function does not consult the policies on the tables it
 * writes, so a gate expressed only in policies has a hole shaped like every
 * definer function granted to `authenticated`. This raises instead of
 * returning, because that is what a function body can act on.
 *
 * THE SQLSTATE IS 42501 ON PURPOSE. It is insufficient_privilege, which
 * PostgREST answers with 403 and the client already maps to a permission
 * message. A bespoke SQLSTATE class would be answered with 500 and shown to an
 * agency as a crash. The sentence is matched on its text in
 * src/lib/supabase/errors.ts, so it is a stable string and not a place to
 * improvise wording.
 */
create or replace function app.billing_require_write(p_organization_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app.billing_may_write(p_organization_id) then
    raise exception
      'This agency has no active subscription, so its records are read-only.'
      using errcode = '42501';
  end if;
end;
$$;

comment on function app.billing_require_write(uuid) is
  'Raises 42501 when the organization is billing-restricted. For SECURITY DEFINER functions, which bypass the RLS policies that carry the same gate.';

-- -----------------------------------------------------------------------------
-- 3. Privileges
--
-- app.billing_may_write is called FROM policies, which are evaluated with the
-- privileges of the invoking role -- so `authenticated` needs EXECUTE on it or
-- every gated policy fails with "permission denied for function".
--
-- app.billing_require_write is called only from inside SECURITY DEFINER
-- function bodies, where privileges are checked against the function's owner.
-- It is deliberately NOT granted to authenticated: nothing a client can reach
-- calls it directly.
--
-- app.billing_access_state_of keeps the grants it already had. It is reached
-- through the two functions above, both definer, so widening it would buy
-- nothing and widen the surface.
-- -----------------------------------------------------------------------------

revoke all on function app.billing_may_write(uuid) from public, anon;
revoke all on function app.billing_require_write(uuid) from public, anon;

grant execute on function app.billing_may_write(uuid) to authenticated, service_role;
grant execute on function app.billing_require_write(uuid) to service_role;

-- -----------------------------------------------------------------------------
-- 4. Assertions
--
-- The mapping is the product's commercial policy expressed as code. If a later
-- migration quietly changes it back, this is where that gets caught.
-- -----------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app' and p.proname = 'billing_may_write'
  ) then
    raise exception 'app.billing_may_write must exist: the write gate depends on it.';
  end if;

  if not has_function_privilege('authenticated', 'app.billing_may_write(uuid)', 'EXECUTE') then
    raise exception
      'authenticated must be able to execute app.billing_may_write: every gated policy calls it.';
  end if;

  if has_function_privilege('anon', 'app.billing_may_write(uuid)', 'EXECUTE') then
    raise exception 'anon must not be able to execute app.billing_may_write.';
  end if;

  /*
   * has_min_role is the role predicate for reads as well as writes. The billing
   * gate must never appear inside it; if it ever does, a restricted agency
   * loses the ability to read its own records, and the wind-down silently
   * becomes the blackout it was chosen over.
   */
  if (select pg_get_functiondef(p.oid)
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'app' and p.proname = 'has_min_role') ilike '%billing%' then
    raise exception
      'app.has_min_role must not consider billing: it guards reads, and the wind-down is read-only.';
  end if;
end;
$$;

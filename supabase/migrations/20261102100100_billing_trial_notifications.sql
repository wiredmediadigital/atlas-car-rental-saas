-- =============================================================================
-- "Your trial ends on the 16th", in the notification feed
--
-- WHY THIS EXISTS AT ALL
--
-- A trial that converts automatically charges a card on a day the owner chose
-- fourteen days earlier and has almost certainly forgotten. Stripe sends
-- `customer.subscription.trial_will_end` three days before that happens. Not
-- passing it on is the difference between a subscription and a surprise, and a
-- surprised owner disputes the charge rather than cancelling the plan.
--
-- WHAT THIS IS NOT
--
-- It is not a condition, so it does not resolve itself. The trial really is
-- ending whether or not anybody reads about it, and the moment has a date; that
-- makes it an EVENT, written once from the billing_events row the webhook
-- records, deduplicated by the same unique index that makes Stripe's three days
-- of retries harmless.
--
-- It is also not a sales prompt. The title states the fact and the date; it does
-- not ask anybody to upgrade, and it does not say "don't lose access", which
-- would be a claim about a restriction policy this deployment has not decided.
--
-- Two functions are replaced, and only two. Both are replaced WHOLE rather than
-- patched, because `create or replace function` has no other mode — so each one
-- below is the 20260823100200 version plus the trial kind, and nothing else.
-- =============================================================================

set search_path = public, extensions, pg_temp;

-- -----------------------------------------------------------------------------
-- 1. The owner's feed learns the new kind
--
-- An event kind missing from this list is an event that is written, addressed
-- to real recipients, and then invisible forever. The list is the audience.
-- -----------------------------------------------------------------------------

create or replace function app.notification_candidates_billing_events(p_organization_id uuid)
returns setof app.notification_candidate
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
begin
  -- An early return, never a raise: a raise propagates through the feed's union
  -- and would break every member's notifications rather than hiding one row.
  if not app.has_min_role(p_organization_id, 'owner') then
    return;
  end if;

  return query
  select
    'event:' || e.id::text,
    e.kind, 'billing'::public.notification_category, e.severity,
    e.subject_user_id, e.subject_label, e.actor_user_id, e.actor_label,
    e.occurred_at, null::date, null::bigint, null::public.currency_code,
    '/billing',
    e.context
  from public.notification_events e
  join public.notification_event_recipients r on r.event_id = e.id
  where e.organization_id = p_organization_id
    and r.user_id = v_actor
    and e.kind in (
      'billing_subscription_activated', 'billing_payment_failed',
      'billing_payment_recovered', 'billing_cancellation_scheduled',
      'billing_subscription_ended', 'billing_plan_changed',
      'billing_trial_ending'
    );
end;
$$;

-- -----------------------------------------------------------------------------
-- 2. The billing event becomes a notification
-- -----------------------------------------------------------------------------

create or replace function app.notification_from_billing_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind     public.notification_kind;
  v_severity public.notification_severity;
  v_event    uuid;
begin
  /*
   * Seven of fourteen billing event kinds. The rest — a customer being created,
   * a checkout being started, a reconciliation running, an anomaly for support
   * — are operational facts that an owner either just caused themselves or
   * cannot act on, and an inbox that reports every one of them is an inbox
   * nobody reads.
   */
  v_kind := case new.kind
    when 'subscription_activated' then 'billing_subscription_activated'
    when 'payment_failed'         then 'billing_payment_failed'
    when 'payment_recovered'      then 'billing_payment_recovered'
    when 'cancellation_scheduled' then 'billing_cancellation_scheduled'
    when 'subscription_ended'     then 'billing_subscription_ended'
    when 'plan_changed'           then 'billing_plan_changed'
    when 'trial_ending'           then 'billing_trial_ending'
  end::public.notification_kind;

  if v_kind is null then
    return new;
  end if;

  /*
   * `attention`, not `urgent` and not `info`.
   *
   * Not `info`, because there is something to do and a deadline to do it by —
   * an owner who wanted to stop before the first charge has three days.
   * Not `urgent`, because nothing has gone wrong: a trial converting is the
   * subscription working exactly as it was sold. `urgent` is reserved here for
   * a failed payment and a subscription that ended, and spending it on an
   * expected event is how a severity stops meaning anything.
   */
  v_severity := case new.kind
    when 'payment_failed'         then 'urgent'
    when 'subscription_ended'     then 'urgent'
    when 'cancellation_scheduled' then 'attention'
    when 'trial_ending'           then 'attention'
    else 'info'
  end::public.notification_severity;

  insert into public.notification_events (
    organization_id, kind, severity, occurred_at,
    actor_user_id, actor_label, subject_user_id, subject_label,
    context, source_table, source_id
  ) values (
    new.organization_id, v_kind, v_severity, new.occurred_at,
    new.actor_user_id, new.actor_label, null, coalesce(new.plan_key, ''),
    jsonb_strip_nulls(jsonb_build_object(
      'plan_key', new.plan_key,
      'previous_plan_key', new.previous_plan_key,
      'summary', new.summary
    )),
    'billing_events', new.id
  )
  -- The same authoritative row twice is the same notification once. Stripe
  -- retries webhooks for three days; this is what makes that harmless.
  on conflict (organization_id, source_table, source_id) do nothing
  returning id into v_event;

  if v_event is null then
    return new;
  end if;

  /*
   * The audience: whoever owns the agency at this moment, except whoever caused
   * it. Owners only, because `billing` is an owner's category — a recipient who
   * cannot pass the category threshold would be a row claiming somebody was
   * told something they can never see.
   *
   * A trial reminder has no actor at all: Stripe's clock caused it, not a
   * person, so `new.actor_user_id` is null and every owner is told.
   */
  insert into public.notification_event_recipients (event_id, user_id)
  select v_event, m.user_id
  from public.organization_members m
  where m.organization_id = new.organization_id
    and m.status = 'active'
    and m.role = 'owner'
    and m.user_id is distinct from new.actor_user_id
  on conflict do nothing;

  return new;
end;
$$;

-- The trigger already points at this function by name, so replacing the body is
-- enough. It is re-created anyway: a dropped trigger is a silent feature, and
-- `create or replace` on the function would not tell us if it had gone.
drop trigger if exists billing_events_notify on public.billing_events;
create trigger billing_events_notify
  after insert on public.billing_events
  for each row execute function app.notification_from_billing_event();

-- -----------------------------------------------------------------------------
-- 3. Privileges
--
-- `create or replace function` resets a function's ACL to the default, which
-- grants EXECUTE to public. Re-revoking is not belt and braces; without it this
-- migration would quietly hand the anonymous role two billing functions.
-- -----------------------------------------------------------------------------

revoke all on function app.notification_candidates_billing_events(uuid) from public, anon;
revoke all on function app.notification_from_billing_event() from public, anon;

-- -----------------------------------------------------------------------------
-- 4. Self-checks
-- -----------------------------------------------------------------------------

do $$
declare
  v_offenders text;
begin
  -- The same assertion 20260823100200 makes, re-made because this migration
  -- replaced two functions and could have undone it.
  select string_agg(n.nspname || '.' || p.proname, ', ' order by p.proname)
    into v_offenders
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'app')
    and has_function_privilege('anon', p.oid, 'EXECUTE');

  if v_offenders is not null then
    raise exception 'The anonymous role can execute: %.', v_offenders;
  end if;

  /*
   * The two halves must agree. A kind the trigger writes but the feed does not
   * select is a notification nobody can ever see, and that failure is invisible
   * until an owner says they were never told.
   */
  if (select p.prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'app' and p.proname = 'notification_from_billing_event')
     not like '%billing_trial_ending%' then
    raise exception 'The billing event trigger must map trial_ending to a notification kind.';
  end if;

  if (select p.prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'app' and p.proname = 'notification_candidates_billing_events')
     not like '%billing_trial_ending%' then
    raise exception 'The billing notification feed must select billing_trial_ending.';
  end if;

  -- The feed and the existence check must still read the same seven sources.
  -- This migration does not touch either union; the check is here so that
  -- replacing a candidate helper can never silently drop one.
  if (select count(*) from regexp_matches(
        (select p.prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'notification_feed'),
        'app\.notification_candidates_', 'g')) <> 7
     or (select count(*) from regexp_matches(
        (select p.prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'app' and p.proname = 'notification_exists'),
        'app\.notification_candidates_', 'g')) <> 7
  then
    raise exception 'notification_feed and app.notification_exists must union the same seven candidate helpers.';
  end if;

  -- The trigger must still be attached. Replacing the function it calls is
  -- exactly the edit that tempts somebody to drop it and forget.
  if not exists (
    select 1 from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'billing_events'
      and t.tgname = 'billing_events_notify' and not t.tgisinternal
  ) then
    raise exception 'The billing_events_notify trigger is missing.';
  end if;
end
$$;

-- =============================================================================
-- Security event audit table
--
-- An append-only record of changes to a person's sign-in security: a second
-- factor enrolled, removed or reset, a recovery code spent.
--
-- Writes arrive only through app.record_security_event. No role that browsers
-- use holds INSERT, UPDATE or DELETE, and there is no write policy, so the
-- trail cannot be edited by the people it describes.
--
-- organization_id is nullable on purpose: a recovery code belongs to a user, not
-- an agency, so a `recovery_code_used` event has no organization context.
-- actor_user_id is nullable because the actor is whoever auth.uid() resolves to,
-- and a service-role call carries none.
-- =============================================================================

do $$
begin
  if not exists (
    select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'security_event_type'
  ) then
    create type public.security_event_type as enum (
      'factor_enrolled',
      'factor_removed',
      'recovery_code_used',
      'factor_reset_by_owner',
      'factor_reset_by_operator'
    );
  end if;
end
$$;

create table if not exists public.security_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations (id) on delete set null,
  actor_user_id uuid,
  subject_user_id uuid not null,
  event_type public.security_event_type not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on table public.security_events is
  'Append-only audit trail of second-factor changes. Written only by app.record_security_event; readable by owners of the organization.';

create index if not exists security_events_organization_created_idx
  on public.security_events (organization_id, created_at desc);
create index if not exists security_events_subject_created_idx
  on public.security_events (subject_user_id, created_at desc);

alter table public.security_events enable row level security;

revoke all on table public.security_events from anon, authenticated;
grant select on table public.security_events to authenticated;

drop policy if exists security_events_select on public.security_events;
create policy security_events_select on public.security_events
  for select to authenticated
  using (app.has_min_role(organization_id, 'owner'));

create or replace function app.record_security_event(
  p_event_type public.security_event_type,
  p_subject_user_id uuid,
  p_organization_id uuid,
  p_detail jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into public.security_events (
    organization_id, actor_user_id, subject_user_id, event_type, detail
  )
  values (
    p_organization_id,
    (select auth.uid()),
    p_subject_user_id,
    p_event_type,
    coalesce(p_detail, '{}'::jsonb)
  )
  returning id into v_id;

  return v_id;
end;
$$;

comment on function app.record_security_event(public.security_event_type, uuid, uuid, jsonb) is
  'Appends a security event. The actor is the requesting user (auth.uid()). The only write path to public.security_events.';

revoke all on function app.record_security_event(public.security_event_type, uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function app.record_security_event(public.security_event_type, uuid, uuid, jsonb)
  to service_role;

-- -----------------------------------------------------------------------------
-- Account closure: security_events is KEPT
--
-- It carries organization_id, so the purge lists must account for it or every
-- due agency's claim is refused (app.organization_purge_lists_agree). It is
-- kept, like the billing and closure evidence, because it is an audit trail:
-- the purge neither deletes it nor needs to, and the organizations row it
-- points at is only ever tombstoned. subject_user_id has no foreign key, so
-- removing the agency's accounts does not touch it either.
-- -----------------------------------------------------------------------------
create or replace function app.organization_retained_tables()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array[
    'billing_checkout_sessions', 'billing_customers', 'billing_events',
    'billing_subscriptions', 'billing_webhook_events',
    'account_closure_events', 'account_closure_objects',
    'security_events'
  ];
$$;

comment on function app.organization_retained_tables() is
  'Tables carrying organization_id that the account purge keeps on purpose: billing records, closure evidence and the security audit trail.';

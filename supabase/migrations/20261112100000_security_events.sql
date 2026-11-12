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
-- Account closure: security_events is PURGED with the organization
--
-- It carries organization_id, so the purge lists must account for it or every
-- due agency's claim is refused (app.organization_purge_lists_agree). It is
-- purged rather than kept: organization_id is `on delete set null` and the
-- select policy is has_min_role(organization_id, 'owner'), so retained rows
-- would be unreadable by every user while still holding subject_user_id and
-- detail. Forensic retention past closure, if ever wanted, needs a deliberate
-- design (a stated retention period, anonymised actor ids).
--
-- Rows with a null organization_id (recovery_code_used) are not
-- organization-scoped and are outside the purge's remit by construction. That
-- is expected, not an oversight.
--
-- organization_purge_tables() is restated whole below with 'security_events'
-- added; the earlier migration is not edited. The table references only
-- organizations, so its position in the list does not matter.
-- -----------------------------------------------------------------------------
create or replace function app.organization_purge_tables()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array[
    -- GPS
    'gps_positions', 'gps_unit_assignments', 'gps_sync_runs', 'gps_units',
    'gps_provider_credentials', 'gps_provider_connections',
    -- notifications
    'notification_preferences', 'notification_states', 'notification_events',
    -- team
    'organization_team_events', 'organization_invitations', 'organization_members',
    -- expenses
    'expense_attachments', 'expense_change_events', 'expenses',
    'expense_categories', 'expense_vendors',
    -- financing
    'financing_documents', 'financing_change_events', 'financing_payments',
    'financing_installments', 'financing_agreements', 'lenders',
    -- rentals and customers
    'customer_documents', 'rental_condition_photos', 'rental_contracts',
    'rental_line_items', 'rental_drivers', 'payments', 'rentals', 'customers',
    -- fleet
    'vehicle_documents', 'vehicle_images', 'vehicles',
    -- settings
    'organization_settings',
    -- security
    'security_events'
  ];
$$;

comment on function app.organization_purge_tables() is
  'Every table the account purge empties, children first. Explicit on purpose: a table added without being listed here (or in organization_retained_tables) stops the purge before it deletes anything.';

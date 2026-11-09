-- =============================================================================
-- Account closure: the purge
--
-- Thirty days after an owner asks to close an agency, its data is destroyed.
-- This file is that destruction. It is the only irreversible code on the
-- account-closure branch, and it is written to be hard to run by accident:
-- nothing here is granted to a browser role, and the three functions must be
-- called in order -- claim, then purge -- because the purge refuses an agency
-- nobody has claimed.
--
-- "MONEY IS NEVER DELETED" IS NOT CONTRADICTED BY THIS FILE. That principle
-- governs editing a LIVE contract: a payment, an expense or a financing record
-- is voided, never deleted, so that history cannot be rewritten while the
-- relationship continues. It says nothing about ending the relationship. When an
-- agency has been told its data will be destroyed and the thirty days have run,
-- deleting its payments, expenses and agreements is the promised outcome, not an
-- erasure of an inconvenient correction. The records that must outlive the
-- tenant are the PLATFORM's own: what Pevvy invoiced the agency (billing_*) and
-- the evidence of this purge (account_closure_*). Those are kept.
--
-- THE ORGANIZATION ROW IS NEVER DELETED. billing_customers,
-- billing_subscriptions, billing_checkout_sessions and billing_events reference
-- it ON DELETE CASCADE, so deleting the row would destroy exactly the tax records
-- that have to survive. The row stays as a tombstone: id, legal name (falling
-- back to the display name), slug and the closure columns. The display name
-- becomes a neutral placeholder so it cannot be mistaken for a live agency.
-- The slug stays because it is frozen by app.freeze_columns and unique; it is
-- the one descriptive field this file cannot clear.
--
-- THE TABLES ARE LISTED, NOT DISCOVERED. app.organization_purge_tables() names
-- every table the purge empties, in dependency order, and
-- app.organization_retained_tables() names the ones it deliberately keeps. A
-- loop over the catalogue would silently sweep a table nobody had considered;
-- an explicit list fails loudly instead. The purge compares both lists with the
-- tables that actually carry organization_id and refuses to start, having
-- deleted nothing, if they disagree -- which is what happens the day someone
-- adds a table without deciding what closure means for it.
--
-- OBJECTS BEFORE ROWS. Storage is not reached by any cascade, and the rows are
-- the only record of which objects belong to the agency (they include passport
-- and driving licence scans). So app.organization_collect_objects writes every
-- key into account_closure_objects first, and app.organization_purge_data calls
-- it itself before deleting anything: the order is a property of the function,
-- not of whoever calls it.
--
-- COUNTS, NEVER CONTENT. The evidence record holds how many rows each table
-- lost. An evidence record that quoted the data would defeat its own purpose.
-- =============================================================================

set search_path = public, extensions, pg_temp;

-- -----------------------------------------------------------------------------
-- 1. The two lists
-- -----------------------------------------------------------------------------

/**
 * Every table the purge empties, children before parents. A table appears here
 * only after its dependants, because several foreign keys are RESTRICT
 * (expenses -> rentals/vehicles, financing_payments -> installments, ...).
 *
 * Tables that hang off one of these by cascade and carry no organization_id of
 * their own -- notification_event_recipients, gps_rate_limits -- go with their
 * parent and are not listed.
 */
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
    'organization_settings'
  ];
$$;

comment on function app.organization_purge_tables() is
  'Every table the account purge empties, children first. Explicit on purpose: a table added without being listed here (or in organization_retained_tables) stops the purge before it deletes anything.';

/**
 * Tables that carry organization_id and are KEPT, with the reason.
 *
 *   billing_*           what the platform invoiced the agency: tax records.
 *   account_closure_*   the evidence of this purge, and the list of objects
 *                       still to be swept from Storage.
 *
 * billing_webhook_events references organizations ON DELETE SET NULL, so it
 * was never going to be cascaded; it stays with the rest of the billing trail.
 */
create or replace function app.organization_retained_tables()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array[
    'billing_checkout_sessions', 'billing_customers', 'billing_events',
    'billing_subscriptions', 'billing_webhook_events',
    'account_closure_events', 'account_closure_objects'
  ];
$$;

comment on function app.organization_retained_tables() is
  'Tables carrying organization_id that the account purge keeps on purpose: billing records and closure evidence.';

-- -----------------------------------------------------------------------------
-- 2. Claiming
-- -----------------------------------------------------------------------------

/**
 * Takes the agency for purging. True when this call took it; false when it was
 * already taken, is not due, is not closing, or does not exist.
 *
 * THE LOCK IS THE FIRST STATEMENT, AND MUST STAY THE FIRST STATEMENT.
 * organization_restore takes this same row lock before it checks state, so a
 * restore and a claim that arrive together are serialised: one of them wins and
 * the other sees the winner's result. Check first and lock second and both can
 * believe they won -- an agency restored while its rows are being deleted, which
 * is unrecoverable. The test harness has one connection and cannot exercise the
 * race, so this is correct by construction or not at all. Do not reorder.
 */
create or replace function app.organization_claim_purge(p_organization_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
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
   * DELIBERATELY REDUNDANT, AND MEANT TO STAY. The runner that calls this
   * cancels the agency's Stripe subscription before it claims, so in normal
   * operation this refusal never fires. It is here anyway, because the claim is
   * the one step after which the agency's data is destroyed and cannot be
   * brought back, and "purged a paying customer" must be unreachable no matter
   * what a caller forgot, got wrong, or was changed to do. The runner is the
   * braces, this is the belt: if you are reading this and about to delete it
   * because the runner already cancels, do not. It mirrors the refusal the old
   * organization-delete guard (app.guard_organization_billing_on_delete) made
   * for the same reason, with the same set of live statuses.
   */
  if exists (
    select 1
      from public.billing_subscriptions s
     where s.organization_id = p_organization_id
       and s.status in ('trialing', 'active', 'past_due', 'unpaid', 'paused')
  ) then
    raise exception
      'This agency still has a live subscription. Cancel it in Stripe before purging.'
      using errcode = '55000';
  end if;

  update public.organizations
     set purge_started_at = now()
   where id = p_organization_id;

  return true;
end;
$$;

comment on function app.organization_claim_purge(uuid) is
  'Sets purge_started_at when the agency is closing and its date has passed; raises if a live subscription remains (deliberately redundant with the runner, which cancels first). Takes the organizations row lock as its first statement, the same lock organization_restore takes, so a restore and a claim cannot both win. Service role only.';

-- -----------------------------------------------------------------------------
-- 3. Writing down what is in Storage
-- -----------------------------------------------------------------------------

/**
 * Records every Storage key belonging to the agency in account_closure_objects
 * and returns how many are now recorded for it. Idempotent: running it again
 * adds nothing, so a purge that failed halfway can simply be run again.
 *
 * Two sources, because either alone can miss something:
 *   * the path columns on the rows, which name the bucket as well as the key;
 *   * storage.objects itself, by the `<organization_id>/` prefix every policy
 *     in this schema depends on, which also finds an upload whose row was never
 *     written.
 *
 * Only keys under the agency's own prefix are recorded. The sweep refuses a key
 * outside it anyway, and this function must never be the thing that puts
 * another agency's file on the list.
 */
create or replace function app.organization_collect_objects(p_organization_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prefix text := p_organization_id::text || '/';
begin
  insert into public.account_closure_objects (organization_id, bucket, storage_key)
  select p_organization_id, found.bucket, found.storage_key
    from (
      select 'customer-documents' as bucket, d.file_path as storage_key
        from public.customer_documents d where d.organization_id = p_organization_id
      union all
      select 'vehicle-documents', d.file_path
        from public.vehicle_documents d where d.organization_id = p_organization_id
      union all
      select 'vehicle-photos', i.storage_path
        from public.vehicle_images i where i.organization_id = p_organization_id
      union all
      select 'vehicle-photos', i.thumbnail_path
        from public.vehicle_images i where i.organization_id = p_organization_id
      union all
      select 'rental-documents', p.storage_path
        from public.rental_condition_photos p where p.organization_id = p_organization_id
      union all
      select 'rental-documents', c.renter_signature_path
        from public.rental_contracts c where c.organization_id = p_organization_id
      union all
      select 'rental-documents', c.agency_signature_path
        from public.rental_contracts c where c.organization_id = p_organization_id
      union all
      select 'rental-documents', c.pdf_path
        from public.rental_contracts c where c.organization_id = p_organization_id
      union all
      select 'expense-receipts', a.storage_path
        from public.expense_attachments a where a.organization_id = p_organization_id
      union all
      select 'financing-documents', f.storage_path
        from public.financing_documents f where f.organization_id = p_organization_id
      union all
      select 'organization-logos', o.logo_path
        from public.organizations o where o.id = p_organization_id
      union all
      select o.bucket_id, o.name
        from storage.objects o
       where o.bucket_id in (
               'customer-documents', 'rental-documents', 'vehicle-documents',
               'vehicle-photos', 'expense-receipts', 'financing-documents',
               'organization-logos'
             )
         and left(o.name, char_length(v_prefix)) = v_prefix
    ) as found
   where found.storage_key is not null
     and left(found.storage_key, char_length(v_prefix)) = v_prefix
  on conflict (bucket, storage_key) do nothing;

  return (select count(*)::integer
            from public.account_closure_objects x
           where x.organization_id = p_organization_id);
end;
$$;

comment on function app.organization_collect_objects(uuid) is
  'Writes every Storage key of the agency into account_closure_objects (from the row path columns and from storage.objects by prefix) and returns how many are recorded. Idempotent. Must run before any row is deleted; organization_purge_data calls it first itself.';

-- -----------------------------------------------------------------------------
-- 4. The guards that took "the organization is gone" to mean "being torn down"
--
-- Five delete guards decided that a delete was a tenant teardown by checking
-- that the organizations row no longer existed, which was true when deleting the
-- row was the way an agency left. The tombstone keeps the row, so each of them
-- would now refuse the purge: a voided expense, a financing payment, a
-- non-draft financing agreement, team history and notification history.
--
-- Each is redefined below with ONE added condition: the delete is also allowed
-- when the transaction-local setting `app.account_purge` equals the id of the
-- row's own organization. app.organization_purge_data sets it, to the id it is
-- purging, and nothing else does. It cannot be set from a browser: set_config
-- lives in pg_catalog and PostgREST exposes only `public`, the same property the
-- membership guard already relies on for `app.membership_operation`. And it
-- names one organization, so even a forged value would unlock one agency's rows.
-- Everything else in each body is unchanged from its latest definition.
-- -----------------------------------------------------------------------------

create or replace function app.guard_expense_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Deleting the agency deletes its parent row first, so by the time the
  -- cascade reaches here the organization is already gone. That is a tenant
  -- being torn down, not somebody erasing an inconvenient correction. The
  -- account purge keeps the row, and says so with app.account_purge.
  if old.status = 'voided'
     and exists (select 1 from public.organizations o where o.id = old.organization_id)
     and coalesce(current_setting('app.account_purge', true), '') <> old.organization_id::text
  then
    raise exception
      'A voided expense is the record of a correction and cannot be deleted.'
      using errcode = '23514';
  end if;
  return old;
end;
$$;

comment on function app.guard_expense_delete() is
  'Keeps a voided cost for as long as the agency exists. Lets the tenant cascade, or the account purge of that same agency, take it.';

create or replace function app.guard_financing_payment_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Same shape as the expense guard, including the tenant-teardown exemption:
  -- once the agency is gone the cascade may take its history with it, and the
  -- account purge says the same with app.account_purge.
  if exists (select 1 from public.organizations o where o.id = old.organization_id)
     and coalesce(current_setting('app.account_purge', true), '') <> old.organization_id::text
  then
    raise exception
      'A financing payment is financial history. Void it instead of deleting it.'
      using errcode = '23514';
  end if;
  return old;
end;
$$;

create or replace function app.guard_financing_agreement_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.organizations o where o.id = old.organization_id) then
    return old; -- the agency itself is being torn down
  end if;

  if coalesce(current_setting('app.account_purge', true), '') = old.organization_id::text then
    return old; -- the agency is being purged; the row stays, its data does not
  end if;

  if old.agreement_status <> 'draft' then
    raise exception
      'Only a draft agreement can be deleted. Close or cancel this one instead so its history survives.'
      using errcode = '23514';
  end if;

  if exists (select 1 from public.financing_payments p where p.agreement_id = old.id) then
    raise exception 'This agreement has payments recorded against it and cannot be deleted.'
      using errcode = '23514';
  end if;

  return old;
end;
$$;

create or replace function app.team_events_are_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    /*
     * Only as part of its agency disappearing: either the organizations row is
     * already gone (the cascade), or the account purge of this same agency has
     * said so with app.account_purge. No client can manufacture either.
     */
    if not exists (select 1 from public.organizations o where o.id = old.organization_id)
       or coalesce(current_setting('app.account_purge', true), '') = old.organization_id::text
    then
      return old;
    end if;

    raise exception 'Team history cannot be deleted once written.'
      using errcode = '42501';
  end if;

  /*
   * The one update: a foreign key nulling a reference to a row that has gone.
   *
   * Three columns can be nulled this way and they are exactly the three that
   * reference something outside this table — the actor, the target, and the
   * invitation an event was about. Each is ON DELETE SET NULL, so refusing the
   * action does not protect the history, it makes the referenced row
   * undeletable: an Auth account, or an invitation that has been superseded.
   *
   * Compared as a whole row minus those three, for the same reason as above —
   * everything the history actually SAYS is snapshotted text, and a column added
   * later must not quietly become editable.
   */
  if (to_jsonb(new) - 'actor_user_id' - 'target_user_id' - 'invitation_id')
       = (to_jsonb(old) - 'actor_user_id' - 'target_user_id' - 'invitation_id')
     and (new.actor_user_id  is null or new.actor_user_id  is not distinct from old.actor_user_id)
     and (new.target_user_id is null or new.target_user_id is not distinct from old.target_user_id)
     and (new.invitation_id  is null or new.invitation_id  is not distinct from old.invitation_id)
     and (new.actor_user_id, new.target_user_id, new.invitation_id)
           is distinct from (old.actor_user_id, old.target_user_id, old.invitation_id)
  then
    return new;
  end if;

  raise exception 'Team history cannot be updated once written.'
    using errcode = '42501';
end;
$$;

comment on function app.team_events_are_immutable() is
  'Refuses every write to a team event except the two referential actions: a foreign key nulling a deleted account, and the removal of history with the agency it belongs to (the cascade, or the account purge of that same agency).';

create or replace function app.notification_events_are_server_written()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    /*
     * Only as part of the agency disappearing: the organizations row is gone
     * (the cascade), or the account purge of this same agency has said so with
     * app.account_purge. No client can manufacture either.
     */
    if not exists (select 1 from public.organizations o where o.id = old.organization_id)
       or coalesce(current_setting('app.account_purge', true), '') = old.organization_id::text
    then
      return old;
    end if;

    raise exception 'Notification events are written by the domain, not by clients.'
      using errcode = '42501';
  end if;

  /*
   * The one update: a foreign key nulling a reference to an Auth account that
   * has been deleted. Both columns are ON DELETE SET NULL, and refusing the
   * action does not protect anything — it makes the account undeletable.
   *
   * What the event SAYS is snapshotted text (`actor_label`, `subject_label`),
   * captured precisely so the record outlives the accounts it names. Compared as
   * a whole row minus those two references, so a column added to this table
   * later cannot quietly become editable.
   */
  if (to_jsonb(new) - 'actor_user_id' - 'subject_user_id')
       = (to_jsonb(old) - 'actor_user_id' - 'subject_user_id')
     and (new.actor_user_id   is null or new.actor_user_id   is not distinct from old.actor_user_id)
     and (new.subject_user_id is null or new.subject_user_id is not distinct from old.subject_user_id)
     and (new.actor_user_id, new.subject_user_id)
           is distinct from (old.actor_user_id, old.subject_user_id)
  then
    return new;
  end if;

  raise exception 'Notification events are written by the domain, not by clients.'
    using errcode = '42501';
end;
$$;

-- -----------------------------------------------------------------------------
-- 5. The purge
-- -----------------------------------------------------------------------------

/**
 * Deletes every tenant row, tombstones the organization, records the evidence,
 * and returns the per-table counts. One transaction: it completes or leaves the
 * agency exactly as it was, still claimed, so it can be run again.
 *
 * Refuses unless the agency is 'purging', i.e. has been claimed and not yet
 * closed. That is what stops it being pointed at a live agency.
 */
create or replace function app.organization_purge_data(p_organization_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org          public.organizations;
  v_table        text;
  v_deleted      bigint;
  v_counts       jsonb := '{}'::jsonb;
  v_vault        bigint;
  v_listed       text[] := app.organization_purge_tables() || app.organization_retained_tables();
  v_carrying     text[];
  v_prev_purge   text := coalesce(current_setting('app.account_purge', true), '');
  v_prev_member  text := coalesce(current_setting('app.membership_operation', true), '');
begin
  -- Serialise against a restore and against another purge of the same agency.
  select * into v_org from public.organizations where id = p_organization_id for update;

  if not found then
    raise exception 'There is no such agency to purge.' using errcode = 'P0002';
  end if;

  if app.closure_state_of(p_organization_id) <> 'purging' then
    raise exception 'This agency has not been claimed for purging (state: %).',
      app.closure_state_of(p_organization_id)
      using errcode = '55000';
  end if;

  /*
   * Every table that carries organization_id must be either listed for purging
   * or listed as kept. Anything else was added without deciding what closure
   * means for it, and the safe answer is to delete nothing.
   */
  select coalesce(array_agg(c.relname::text order by c.relname), '{}')
    into v_carrying
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    join pg_catalog.pg_attribute a
      on a.attrelid = c.oid and a.attname = 'organization_id' and not a.attisdropped
   where n.nspname = 'public' and c.relkind in ('r', 'p');

  if exists (select 1 from unnest(v_carrying) t where t <> all (v_listed))
     or exists (select 1 from unnest(v_listed) t where t <> all (v_carrying))
  then
    raise exception
      'The purge lists and the schema disagree. Unlisted: %. Listed but absent: %.',
      (select coalesce(string_agg(t, ', '), 'none') from unnest(v_carrying) t where t <> all (v_listed)),
      (select coalesce(string_agg(t, ', '), 'none') from unnest(v_listed) t where t <> all (v_carrying))
      using errcode = '55000';
  end if;

  -- Objects first. The rows being deleted below are the only record of them.
  perform app.organization_collect_objects(p_organization_id);

  perform set_config('app.account_purge', p_organization_id::text, true);
  perform set_config('app.membership_operation', 'on', true);

  -- A provider token lives in the vault, which no cascade reaches.
  delete from vault.secrets s
   where s.id in (select k.secret_ref from public.gps_provider_credentials k
                   where k.organization_id = p_organization_id);
  get diagnostics v_vault = row_count;
  v_counts := v_counts || jsonb_build_object('vault.secrets', v_vault);

  foreach v_table in array app.organization_purge_tables() loop
    execute format('delete from public.%I where organization_id = $1', v_table)
      using p_organization_id;
    get diagnostics v_deleted = row_count;
    v_counts := v_counts || jsonb_build_object(v_table, v_deleted);
  end loop;

  perform set_config('app.account_purge', v_prev_purge, true);
  perform set_config('app.membership_operation', v_prev_member, true);

  update public.organizations
     set name           = 'Closed agency',
         legal_name     = coalesce(nullif(btrim(v_org.legal_name), ''), v_org.name),
         tax_identifier = null,
         country_code   = null,
         email          = null,
         phone          = null,
         website        = null,
         address_line1  = null,
         address_line2  = null,
         city           = null,
         region         = null,
         postal_code    = null,
         logo_path      = null,
         closed_at      = now()
   where id = p_organization_id;

  insert into public.account_closure_events
    (organization_id, organization_name, requested_by, requested_at, purged_at, table_counts)
  values (
    p_organization_id,
    coalesce(nullif(btrim(v_org.legal_name), ''), v_org.name),
    v_org.closure_requested_by,
    v_org.closure_requested_at,
    now(),
    v_counts
  );

  return v_counts;
end;
$$;

comment on function app.organization_purge_data(uuid) is
  'Deletes every tenant row of a claimed agency in dependency order (after recording its Storage keys), turns the organizations row into a tombstone, writes counts to account_closure_events and returns them. One transaction. Never deletes the organizations row. Service role only.';

-- -----------------------------------------------------------------------------
-- 6. Privileges: the service role and nobody else
-- -----------------------------------------------------------------------------

revoke all on function app.organization_purge_tables() from public, anon, authenticated;
revoke all on function app.organization_retained_tables() from public, anon, authenticated;
revoke all on function app.organization_claim_purge(uuid) from public, anon, authenticated;
revoke all on function app.organization_collect_objects(uuid) from public, anon, authenticated;
revoke all on function app.organization_purge_data(uuid) from public, anon, authenticated;

grant execute on function app.organization_purge_tables() to service_role;
grant execute on function app.organization_retained_tables() to service_role;
grant execute on function app.organization_claim_purge(uuid) to service_role;
grant execute on function app.organization_collect_objects(uuid) to service_role;
grant execute on function app.organization_purge_data(uuid) to service_role;

-- -----------------------------------------------------------------------------
-- 7. Assertions
-- -----------------------------------------------------------------------------

do $$
declare
  v_body text;
  v_missing text;
begin
  -- The purge must never delete the organizations row.
  select pg_get_functiondef('app.organization_purge_data(uuid)'::regprocedure) into v_body;
  if v_body ~* 'delete\s+from\s+(only\s+)?(public\.)?organizations' then
    raise exception 'The purge must never delete the organizations row.';
  end if;
  if v_body not like '%SECURITY DEFINER%' then
    raise exception 'The purge must be SECURITY DEFINER: the closure columns refuse browser roles.';
  end if;

  -- The claim must lock before it reads.
  select pg_get_functiondef('app.organization_claim_purge(uuid)'::regprocedure) into v_body;
  if position('for update' in lower(v_body)) = 0
     or position('for update' in lower(v_body)) > position('purge_started_at is not null' in lower(v_body))
  then
    raise exception 'The claim must take the organizations row lock before it checks purge_started_at.';
  end if;

  -- No table may carry organization_id without being listed one way or the other.
  select string_agg(c.relname, ', ') into v_missing
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attname = 'organization_id' and not a.attisdropped
   where n.nspname = 'public' and c.relkind in ('r', 'p')
     and c.relname <> all (app.organization_purge_tables() || app.organization_retained_tables());
  if v_missing is not null then
    raise exception 'Tables carry organization_id but are not in the purge lists: %', v_missing;
  end if;

  if has_function_privilege('authenticated', 'app.organization_purge_data(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'app.organization_purge_data(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'app.organization_claim_purge(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'app.organization_collect_objects(uuid)', 'EXECUTE') then
    raise exception 'No browser role may execute the purge functions.';
  end if;
end;
$$;

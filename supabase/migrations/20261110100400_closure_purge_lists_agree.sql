-- =============================================================================
-- Account closure: the lists are compared BEFORE anything is swept
--
-- 20261108100200's header says the purge "refuses to start, having deleted
-- nothing, if they disagree". That was true of app.organization_purge_data and
-- false of the feature. The runner's order is
--
--     claim -> collect -> sweep Storage -> purge rows -> remove accounts
--
-- and the list-versus-catalogue comparison lived inside purge_data, which runs
-- AFTER the sweep. So the day somebody adds a table carrying organization_id
-- without listing it in organization_purge_tables or organization_retained_tables,
-- every due agency has its entire Storage contents deleted first -- passport
-- scans, driving licence scans, condition photos, signed contracts -- and only
-- then does the check raise. The transaction rolls back, so the ROWS survive and
-- the OBJECTS do not: the agency is left in 'purging', which organization_restore
-- refuses, with its records present and its documents gone. There is no way back
-- from that.
--
-- So the comparison is extracted here and asked by the CLAIM, before
-- purge_started_at is set. A mismatch now refuses the claim with nothing swept
-- and the agency still 'suspended', therefore still restorable. The claim's
-- refusal is a plain exception, not the 55000 the live-subscription refusal
-- uses, because the runner reads 55000 from this function as "still billed"
-- (interpretClaim); a schema mismatch must surface as a failure and turn the
-- daily run red.
--
-- purge_data keeps the same check, through the same function. It is the step
-- that actually destroys the data, and something other than the claim can set
-- purge_started_at.
--
-- 20261108100200 is never edited; what it defined and this changes is replaced
-- whole below. THE CLAIM'S LOCK IS STILL ITS FIRST STATEMENT, and the assertion
-- that proves it is repeated at the foot of this file.
-- =============================================================================

set search_path = public, extensions, pg_temp;

-- -----------------------------------------------------------------------------
-- 1. The comparison, extracted
-- -----------------------------------------------------------------------------

/**
 * Do the two purge lists account for exactly the tables that carry
 * organization_id? True when they agree.
 *
 * Deliberately asks pg_catalog rather than a stored list: the question is
 * whether somebody has added a table without deciding what closure means for
 * it, and only the live catalogue can answer that.
 */
create or replace function app.organization_purge_lists_agree()
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  with listed as (
    select unnest(app.organization_purge_tables() || app.organization_retained_tables()) as name
  ),
  carrying as (
    select c.relname::text as name
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      join pg_catalog.pg_attribute a
        on a.attrelid = c.oid and a.attname = 'organization_id' and not a.attisdropped
     where n.nspname = 'public' and c.relkind in ('r', 'p')
  )
  select not exists (select name from carrying except select name from listed)
     and not exists (select name from listed except select name from carrying);
$fn$;

comment on function app.organization_purge_lists_agree() is
  'True when every public table carrying organization_id is named in organization_purge_tables or organization_retained_tables, and nothing is named that does not exist. Asked by the purge claim before anything is swept, and again by organization_purge_data.';

/** The same answer in words, for the exception message. */
create or replace function app.organization_purge_list_disagreement()
returns text
language sql
stable
security definer
set search_path = ''
as $fn$
  with listed as (
    select unnest(app.organization_purge_tables() || app.organization_retained_tables()) as name
  ),
  carrying as (
    select c.relname::text as name
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      join pg_catalog.pg_attribute a
        on a.attrelid = c.oid and a.attname = 'organization_id' and not a.attisdropped
     where n.nspname = 'public' and c.relkind in ('r', 'p')
  )
  select format(
    'Unlisted: %s. Listed but absent: %s.',
    coalesce((select string_agg(x.name, ', ' order by x.name)
                from (select name from carrying except select name from listed) x), 'none'),
    coalesce((select string_agg(y.name, ', ' order by y.name)
                from (select name from listed except select name from carrying) y), 'none')
  );
$fn$;

comment on function app.organization_purge_list_disagreement() is
  'Names the tables the purge lists and the schema disagree about, for the exception message. Always returns a sentence; ask organization_purge_lists_agree whether there is anything to report.';

-- -----------------------------------------------------------------------------
-- 2. The claim asks before it claims
--
-- 20261108100200's definition with one block added, after the row lock and
-- before purge_started_at is set. Everything else is unchanged.
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

-- -----------------------------------------------------------------------------
-- 3. The purge keeps the same check, through the same function
-- -----------------------------------------------------------------------------

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
   * The same refusal the claim makes, made again here because this is the step
   * that destroys the data. Something other than app.organization_claim_purge
   * can set purge_started_at (a service-role UPDATE, a retry helper), and
   * "purged a paying customer" must be unreachable whatever a caller did.
   */
  if app.organization_has_live_subscription(p_organization_id) then
    raise exception
      'This agency still has a live subscription. Cancel it in Stripe before purging.'
      using errcode = '55000';
  end if;

  /*
   * Every table that carries organization_id must be either listed for purging
   * or listed as kept. Anything else was added without deciding what closure
   * means for it, and the safe answer is to delete nothing.
   *
   * The comparison itself now lives in app.organization_purge_lists_agree, so
   * that app.organization_claim_purge can ask the same question BEFORE the
   * runner sweeps Storage. Kept here as well: this is the step that destroys
   * the data, and something other than the claim can set purge_started_at.
   */
  if not app.organization_purge_lists_agree() then
    raise exception 'The purge lists and the schema disagree. %',
      app.organization_purge_list_disagreement()
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
-- 4. Privileges: the service role and nobody else
-- -----------------------------------------------------------------------------

revoke all on function app.organization_purge_lists_agree() from public, anon, authenticated;
revoke all on function app.organization_purge_list_disagreement() from public, anon, authenticated;
grant execute on function app.organization_purge_lists_agree() to service_role;
grant execute on function app.organization_purge_list_disagreement() to service_role;

-- -----------------------------------------------------------------------------
-- 5. Assertions
-- -----------------------------------------------------------------------------

do $assert$
declare
  v_body text;
begin
  -- Unchanged from 20261108100200, repeated because this file redefines both.
  select pg_get_functiondef('app.organization_purge_data(uuid)'::regprocedure) into v_body;
  if v_body ~* 'delete\s+from\s+(only\s+)?(public\.)?organizations' then
    raise exception 'The purge must never delete the organizations row.';
  end if;
  if v_body not like '%SECURITY DEFINER%' then
    raise exception 'The purge must be SECURITY DEFINER: the closure columns refuse browser roles.';
  end if;
  if v_body not like '%organization_purge_lists_agree%' then
    raise exception 'The purge must still compare its lists with the schema.';
  end if;

  select pg_get_functiondef('app.organization_claim_purge(uuid)'::regprocedure) into v_body;
  if position('for update' in lower(v_body)) = 0
     or position('for update' in lower(v_body)) > position('purge_started_at is not null' in lower(v_body))
  then
    raise exception 'The claim must take the organizations row lock before it checks purge_started_at.';
  end if;

  -- And the lists must be compared before purge_started_at is written, or the
  -- sweep happens first and the objects are gone before anything refuses.
  if position('organization_purge_lists_agree' in v_body) = 0
     or position('organization_purge_lists_agree' in v_body)
        > position('set purge_started_at' in v_body)
  then
    raise exception 'The claim must compare the purge lists before it sets purge_started_at.';
  end if;

  if has_function_privilege('authenticated', 'app.organization_purge_lists_agree()', 'EXECUTE')
     or has_function_privilege('anon', 'app.organization_purge_lists_agree()', 'EXECUTE') then
    raise exception 'No browser role may execute the purge list functions.';
  end if;
end;
$assert$;

-- =============================================================================
-- 20261112100800_terms_acceptance_two_writers.sql
--
-- Review fixes for 20261112100700. Three changes, one of which matters.
--
-- 1. THE GUARD MADE THE VALUES HONEST BUT NOT THE FACT.
--
--    As shipped, app.guard_terms_acceptance() let a first stamp through and
--    merely rewrote what it said: a client holding the ordinary UPDATE on
--    public.profiles could PATCH its own row and come away with a record
--    carrying the real version and the real moment, byte for byte identical to
--    an acceptance by somebody who had been shown the sentence. Honest values
--    attached to a thing that never happened are worse than obvious forgeries,
--    because nothing downstream can tell them apart.
--
--    The guard now restores the old values on EVERY update except one it can
--    recognise: public.record_terms_acceptance() announces itself with a
--    transaction-local setting, the way app.guard_membership_changes() already
--    uses app.membership_operation. A browser cannot set a GUC — PostgREST
--    offers no way to — so the writers are exactly two:
--
--      app.handle_new_user()             on INSERT, from the sign-up metadata
--      public.record_terms_acceptance()  on UPDATE, for the invitation path
--
--    It still never refuses. An ordinary profile edit that echoes the row back
--    silently keeps the stored acceptance rather than failing, which is what
--    stops a name change breaking on a column it has no opinion about.
--
-- 2. app.current_terms_version() IS STABLE, NOT IMMUTABLE. It returns a
--    constant today and a different constant after the next revision of the
--    Terms, which is precisely what immutable promises will never happen. The
--    practical risk was an index or a cached plan built on the old answer.
--
-- 3. app.handle_new_user() is re-declared unchanged apart from a comment on its
--    `on conflict (id) do nothing`, which silently drops the stamp when a
--    profile row already exists. That is deliberate and worth saying out loud.
-- =============================================================================

set search_path = public, extensions, pg_temp;

-- -----------------------------------------------------------------------------
-- The version changes; it is stable, not immutable
-- -----------------------------------------------------------------------------

create or replace function app.current_terms_version()
returns text
language sql
stable
set search_path = ''
as $$
  select '12 November 2026'::text;
$$;

comment on function app.current_terms_version() is
  'The current Terms of Service version, as a constant. Stable rather than immutable: the constant changes when the Terms do. Must equal lastUpdated in src/pages/legal/legal-config.ts.';

revoke all on function app.current_terms_version() from public;

-- -----------------------------------------------------------------------------
-- Two writers, and the guard knows both of them
-- -----------------------------------------------------------------------------

create or replace function app.guard_terms_acceptance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Set by public.record_terms_acceptance() for the length of its own
  -- transaction, and by nothing else. A browser has no way to set it.
  if coalesce(current_setting('app.recording_terms', true), 'off') = 'on' then
    return new;
  end if;

  new.terms_accepted_version := old.terms_accepted_version;
  new.terms_accepted_at := old.terms_accepted_at;
  return new;
end;
$$;

comment on function app.guard_terms_acceptance() is
  'Restores the stored terms acceptance on every update except the one public.record_terms_acceptance() announces. Never refuses, so an ordinary profile edit is unaffected.';

drop trigger if exists profiles_guard_terms_acceptance on public.profiles;
create trigger profiles_guard_terms_acceptance
  before update on public.profiles
  for each row execute function app.guard_terms_acceptance();

revoke all on function app.guard_terms_acceptance() from public;

-- -----------------------------------------------------------------------------
-- The one writer on the UPDATE side
--
-- Unchanged apart from the two set_config calls that let the guard above
-- recognise it. Still stamps only a row whose terms_accepted_at is null, so a
-- second invitation years later cannot move the original date.
-- -----------------------------------------------------------------------------

create or replace function public.record_terms_acceptance()
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
begin
  if v_user_id is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  -- `true` scopes both to this transaction, so nothing leaks into the next
  -- statement on a pooled connection even if the update below raises.
  perform set_config('app.recording_terms', 'on', true);

  update public.profiles
     set terms_accepted_version = app.current_terms_version(),
         terms_accepted_at = now()
   where id = v_user_id
     and terms_accepted_at is null;

  perform set_config('app.recording_terms', 'off', true);
end;
$$;

comment on function public.record_terms_acceptance() is
  'Stamps the calling user''s own terms acceptance, once. A row that already carries a date keeps it. The only UPDATE path the guard trigger lets through.';

revoke all on function public.record_terms_acceptance() from public, anon;
grant execute on function public.record_terms_acceptance() to authenticated;

-- -----------------------------------------------------------------------------
-- Sign-up, re-declared only to say why the conflict clause drops the stamp
-- -----------------------------------------------------------------------------

create or replace function app.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_meta     jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_org_name text;
  v_invited  boolean;
  v_accepted boolean := false;
begin
  -- Read defensively and then forget about it. `->` returns null for a missing
  -- key and for metadata that is not an object at all, the comparison against a
  -- JSON true is false for every other shape, and the handler catches anything
  -- left. Nothing here can stop the insert below from happening.
  begin
    v_accepted := coalesce((v_meta -> 'terms_accepted') = to_jsonb(true), false);
  exception
    when others then
      v_accepted := false;
  end;

  /*
   * `do nothing` keeps its existing meaning, including for the two columns: a
   * profile that somehow already exists for this id keeps whatever acceptance
   * it already carries, and this sign-up's stamp is dropped rather than
   * written over it. That is the right way round — the stored row is the older
   * fact — and the alternative, a `do update`, would be a second UPDATE writer
   * on columns whose whole point is having only two.
   */
  insert into public.profiles (id, full_name, email, terms_accepted_version, terms_accepted_at)
  values (
    new.id,
    left(btrim(coalesce(v_meta ->> 'full_name', '')), 120),
    new.email,
    case when v_accepted then app.current_terms_version() end,
    case when v_accepted then now() end
  )
  on conflict (id) do nothing;

  v_org_name := btrim(coalesce(v_meta ->> 'organization_name', ''));

  v_invited := exists (
    select 1
    from public.organization_invitations i
    where i.email_normalized = app.normalize_email(new.email)
      and i.accepted_at is null
      and i.revoked_at is null
      and i.expires_at > now()
  );

  if v_invited then
    -- Nothing is provisioned and nothing is accepted. The invitation is still a
    -- pending offer; the person accepts it themselves, from the link, once their
    -- address is confirmed.
    return new;
  end if;

  if char_length(v_org_name) >= 2 then
    begin
      perform app.provision_organization(
        new.id,
        v_org_name,
        v_meta ->> 'country_code',
        v_meta ->> 'default_currency',
        v_meta ->> 'time_zone',
        v_meta ->> 'locale'
      );
    exception
      when others then
        -- Never let agency provisioning block account creation. The application
        -- detects "authenticated but no membership" and offers onboarding, which
        -- calls public.create_organization() directly.
        raise warning 'Agency provisioning failed for user %: %', new.id, sqlerrm;
    end;
  end if;

  return new;
end;
$$;

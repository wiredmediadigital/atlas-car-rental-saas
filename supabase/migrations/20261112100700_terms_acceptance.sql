-- =============================================================================
-- 20261112100700_terms_acceptance.sql
--
-- Records that a person agreed to the Terms of Service.
--
-- The Terms now carry a liability cap and an indemnity, and a liability cap
-- nobody accepted is not a liability cap. Two nullable columns on
-- public.profiles hold the answer, and two paths write them.
--
--   SIGN-UP. The browser sends a boolean in the sign-up metadata, and
--     app.handle_new_user() stamps the columns in the same transaction that
--     creates the account. A follow-up call from the client could fail silently
--     between the account existing and the acceptance being recorded; this
--     cannot.
--   AN INVITATION. An invited team member never passes through the sign-up
--     screen, so public.record_terms_acceptance() stamps their own row when they
--     accept. public.accept_team_invitation is deliberately left alone: joining
--     an agency and agreeing to a contract are two facts, and folding one into
--     the other would make the membership function fail for a reason that has
--     nothing to do with membership.
--
-- NEITHER TAKES THE VERSION FROM THE BROWSER. Both read
-- app.current_terms_version(), which returns the same date the legal pages
-- print. A client claiming to have accepted version 9 proves nothing.
--
-- BOTH COLUMNS ARE NULLABLE, and that is load-bearing rather than lax. Everyone
-- who signed up before today is grandfathered: the Terms already say continued
-- use accepts later updates, so backfilling a date nobody clicked on would be
-- inventing evidence.
--
-- THE TRIGGER RUNS INSIDE ACCOUNT CREATION. If it raises, signing up breaks
-- entirely — which is why profiles.email is plain text rather than the
-- email_address domain. The added code therefore has no constraint that can
-- fail, raises nothing, and assumes nothing about the metadata being present or
-- well typed. Absent, false or malformed all leave the columns null and let the
-- account be created.
--
-- public.record_terms_acceptance is SECURITY DEFINER, writes a public table and
-- does not ask app.billing_require_write, so it joins the exempt list in
-- billing-restricted-access.test.ts. The reason is the one recovery codes have:
-- agreeing to the terms of the product belongs to a person, not to an agency,
-- and an agency's billing state must never be the thing that stops someone
-- accepting them. It is likewise not gated on a second factor — a brand-new
-- invited user arrives at aal1 and has no factor to verify.
-- =============================================================================

set search_path = public, extensions, pg_temp;

-- -----------------------------------------------------------------------------
-- The record
-- -----------------------------------------------------------------------------

alter table public.profiles
  add column if not exists terms_accepted_version text,
  add column if not exists terms_accepted_at timestamptz;

comment on column public.profiles.terms_accepted_version is
  'Which version of the Terms of Service this person agreed to, stamped by the server. Null for anyone who signed up before acceptance was recorded.';

comment on column public.profiles.terms_accepted_at is
  'When they agreed. Null and non-null are both real states; a null is never backfilled.';

-- -----------------------------------------------------------------------------
-- The version, in one place
--
-- Returns the same string src/pages/legal/legal-config.ts prints as
-- `lastUpdated`. Two sources of truth would drift, so supabase/tests/
-- terms-acceptance.test.ts imports the config and fails when they disagree.
-- That test is the whole mechanism keeping them in step: change the date in one
-- place and the suite tells you about the other.
-- -----------------------------------------------------------------------------

create or replace function app.current_terms_version()
returns text
language sql
immutable
set search_path = ''
as $$
  select '12 November 2026'::text;
$$;

comment on function app.current_terms_version() is
  'The current Terms of Service version, as a constant. Must equal lastUpdated in src/pages/legal/legal-config.ts.';

revoke all on function app.current_terms_version() from public;

-- -----------------------------------------------------------------------------
-- The record is not its subject's to rewrite
--
-- `authenticated` holds UPDATE on public.profiles so a person can change their
-- own name, and profiles_update_self reaches their own row — so without this the
-- two columns sat inside that grant. A record the subject can erase or backdate
-- is worse than no record at all, and a subject who can name the version has not
-- accepted any particular document.
--
-- The answer is the one 20260821100200 already chose for profiles.email: rewrite
-- what the client sent rather than refuse the update. Refusing would make an
-- ordinary name change fail whenever the client echoed the row back, and a
-- freeze would then have to be fought by record_terms_acceptance below.
--
--   Already recorded  -> the old values are put back. The date never moves.
--   Not yet recorded  -> a stamp is allowed, but the server writes what it says.
--                        A browser naming version 9 and the year 1999 gets the
--                        real version and the real moment.
-- -----------------------------------------------------------------------------

create or replace function app.guard_terms_acceptance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.terms_accepted_at is not null then
    new.terms_accepted_version := old.terms_accepted_version;
    new.terms_accepted_at := old.terms_accepted_at;
  elsif new.terms_accepted_at is not null or new.terms_accepted_version is not null then
    new.terms_accepted_version := app.current_terms_version();
    new.terms_accepted_at := now();
  end if;

  return new;
end;
$$;

comment on function app.guard_terms_acceptance() is
  'Keeps a recorded terms acceptance where it is, and makes a first stamp say what the server knows rather than what the client sent.';

drop trigger if exists profiles_guard_terms_acceptance on public.profiles;
create trigger profiles_guard_terms_acceptance
  before update on public.profiles
  for each row execute function app.guard_terms_acceptance();

revoke all on function app.guard_terms_acceptance() from public;

-- -----------------------------------------------------------------------------
-- Sign-up stamps it
--
-- The body below is the latest existing definition (20260821100000_team_
-- membership.sql), unchanged apart from v_accepted and the two added columns.
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

-- -----------------------------------------------------------------------------
-- An invited person stamps it on accept
--
-- Only ever writes a row whose terms_accepted_at is still null, so a second call
-- — a retry, a second invitation years later — cannot move the original date
-- forward. The caller is auth.uid() and nothing else: there is no parameter to
-- point at somebody else's row.
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

  update public.profiles
     set terms_accepted_version = app.current_terms_version(),
         terms_accepted_at = now()
   where id = v_user_id
     and terms_accepted_at is null;
end;
$$;

comment on function public.record_terms_acceptance() is
  'Stamps the calling user''s own terms acceptance, once. A row that already carries a date keeps it.';

revoke all on function public.record_terms_acceptance() from public, anon;
grant execute on function public.record_terms_acceptance() to authenticated;

-- =============================================================================
-- Single-use MFA recovery codes
--
-- Supabase raises a session to aal2 only when GoTrue itself verifies an enrolled
-- factor, so a code checked in our own SQL can never grant access directly. A
-- recovery code authorises removing the lost factor (an Edge Function does that
-- with the service role); the user then enrols a new one.
--
-- The table has RLS enabled and no policy: every read and write goes through the
-- two functions below. A deny-all policy sits on it only because the repository
-- invariant (permission-matrix.test.ts) requires every public table to have one.
-- Codes are stored as bcrypt hashes and the plaintext is
-- returned exactly once, by mfa_generate_recovery_codes.
--
-- mfa_generate_recovery_codes is a SECURITY DEFINER function that writes a public
-- table for a signed-in user and does not ask app.billing_require_write. That is
-- deliberate: recovery codes belong to a person, not an agency, so a suspended
-- or closing organization must never lock someone out of their own sign-in
-- security. It is listed as exempt in billing-restricted-access.test.ts.
-- =============================================================================

create table if not exists public.mfa_recovery_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  code_hash text not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table public.mfa_recovery_codes is
  'Bcrypt hashes of single-use MFA recovery codes. No policies: reachable only through mfa_generate_recovery_codes and app.mfa_consume_recovery_code.';

create index if not exists mfa_recovery_codes_user_unused_idx
  on public.mfa_recovery_codes (user_id) where used_at is null;

alter table public.mfa_recovery_codes enable row level security;

drop policy if exists mfa_recovery_codes_no_access on public.mfa_recovery_codes;
create policy mfa_recovery_codes_no_access on public.mfa_recovery_codes
  for all to authenticated
  using (false)
  with check (false);

-- Rows are invisible to browser roles (RLS, no policy); writes are not granted.
revoke all on table public.mfa_recovery_codes from anon, authenticated;
grant select on table public.mfa_recovery_codes to authenticated;

-- Returns ten fresh codes for the signed-in user, replacing any unused ones.
-- 10 characters of Crockford base32 (no I, L, O or U) is 50 bits. Each character
-- is a random byte modulo 32; 256 is a multiple of 32, so there is no bias.
create or replace function public.mfa_generate_recovery_codes()
returns setof text
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_alphabet constant text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  c_count constant int := 10;
  c_length constant int := 10;
  v_user_id uuid := (select auth.uid());
  v_code text;
  v_bytes bytea;
  v_codes text[] := array[]::text[];
  i int;
begin
  if v_user_id is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  -- Reachable directly over PostgREST, so the second factor is enforced here: a
  -- session that has only passed the password (aal1), or carries no aal claim,
  -- could otherwise mint codes and use one to strip the victim's authenticator.
  -- GoTrue raises the session to aal2 when the first factor is verified, so the
  -- first-enrolment path already arrives at aal2.
  if coalesce((select auth.jwt()) ->> 'aal', '') <> 'aal2' then
    raise exception 'recovery codes require a verified second factor'
      using errcode = '42501';
  end if;

  delete from public.mfa_recovery_codes
   where user_id = v_user_id and used_at is null;

  while coalesce(array_length(v_codes, 1), 0) < c_count loop
    v_bytes := extensions.gen_random_bytes(c_length);
    v_code := '';
    for i in 0 .. c_length - 1 loop
      v_code := v_code || substr(c_alphabet, (get_byte(v_bytes, i) % 32) + 1, 1);
    end loop;
    if not (v_code = any (v_codes)) then
      v_codes := v_codes || v_code;
    end if;
  end loop;

  insert into public.mfa_recovery_codes (user_id, code_hash)
  select v_user_id, extensions.crypt(code, extensions.gen_salt('bf'))
    from unnest(v_codes) as code;

  return query select unnest(v_codes);
end;
$$;

comment on function public.mfa_generate_recovery_codes() is
  'Replaces the caller''s unused recovery codes with ten new ones and returns the plaintext once.';

revoke all on function public.mfa_generate_recovery_codes() from public, anon;
grant execute on function public.mfa_generate_recovery_codes() to authenticated;

-- Spends one unused code belonging to p_user_id. Returns whether it matched.
-- Server-side only: the caller (an Edge Function) has already authenticated the
-- user and goes on to remove the lost factor.
create or replace function app.mfa_consume_recovery_code(p_user_id uuid, p_code text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_user_id is null or p_code is null then
    return false;
  end if;

  select id into v_id
    from public.mfa_recovery_codes
   where user_id = p_user_id
     and used_at is null
     and extensions.crypt(p_code, code_hash) = code_hash
   order by created_at
   limit 1
     for update;

  if v_id is null then
    return false;
  end if;

  update public.mfa_recovery_codes
     set used_at = now()
   where id = v_id and used_at is null;

  if not found then
    return false;
  end if;

  perform app.record_security_event(
    'recovery_code_used', p_user_id, null, '{}'::jsonb
  );
  return true;
end;
$$;

comment on function app.mfa_consume_recovery_code(uuid, text) is
  'Marks one matching unused recovery code used and records a recovery_code_used event. Returns false when nothing matched. Service role only.';

revoke all on function app.mfa_consume_recovery_code(uuid, text) from public, anon, authenticated;
grant execute on function app.mfa_consume_recovery_code(uuid, text) to service_role;

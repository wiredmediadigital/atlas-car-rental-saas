# Second-factor recovery (operator runbook)

**Owner:** the operator of the Supabase project
**Applies to:** one person who cannot sign in to Pevvy
**Needs:** service-key access to the project's SQL editor

Pevvy requires a second factor of every account. A user who has lost their
authenticator normally unblocks themselves with a recovery code, and an owner
can reset a member of their own agency from Settings. This runbook is the last
case neither of those covers: **the person has lost both their authenticator and
their recovery codes, and there is no active owner in their agency who can reset
them** — typically a sole owner.

It is a runbook and not a feature on purpose. A button that removes a second
factor on the strength of an email is a second factor that is worth nothing.

---

## 1. When to use this, and when not to

Use it only when **all** of these hold:

- The person cannot produce a code from their authenticator app, and
- they have no unused recovery code, and
- nobody else can reset them: they are the only active owner of their agency, or
  the other owners are themselves locked out, and
- you have verified who they are **away from Pevvy** — see step 2.

Do **not** use it when:

- Another active owner of the same agency can do it from **Settings → Team**.
  That path is auditable by the agency itself and does not need you.
- The person still has a recovery code. Send them to `/sign-in/recover`.
- The agency is closed or closing. A factor reset is not a way back into a
  closed agency; restore it first.
- You cannot verify who is asking. **Stop.** Everything below hands an account
  to whoever asks next, and a plausible email is not verification.

---

## 2. Verify the person first

Before touching the database, confirm the request came from the account holder
and not from someone who has their email. Use a channel that is not the one the
request arrived on: a phone number held on the agency's billing record, a video
call where they show identity matching the account, or a known contact who can
vouch for them in person.

Write down what you did. Step 4 records it, in the clear, in the audit trail.

---

## 3. Find the user and see what the reset will touch

Run these against **your own** project, in the Supabase SQL editor.

```sql
-- Who they are.
select u.id, u.email, u.last_sign_in_at
from auth.users u
where lower(u.email) = lower('person@example.com');
```

```sql
-- What they hold, and every agency the reset will be felt in. A factor belongs
-- to the person, not to one agency: removing it removes their protection
-- everywhere they work.
select f.id, f.factor_type, f.status, f.created_at
from auth.mfa_factors f
where f.user_id = '00000000-0000-0000-0000-000000000000';

select m.organization_id, o.name, m.role, m.status
from public.organization_members m
join public.organizations o on o.id = m.organization_id
where m.user_id = '00000000-0000-0000-0000-000000000000';
```

If the membership list has more than one agency, say so to the person: every one
of those agencies is about to see a security event about them.

---

## 4. Remove the factors and record it

One statement, atomic. Fill in the two values at the top; change nothing else.

```sql
do $$
declare
  v_user     uuid := '00000000-0000-0000-0000-000000000000';  -- from step 3
  v_verified text := 'phone call to the number on file, 12 Nov 2026';  -- from step 2
  v_removed  integer;
  v_detail   jsonb;
begin
  delete from auth.mfa_factors where user_id = v_user;
  get diagnostics v_removed = row_count;

  if v_removed = 0 then
    raise exception 'No second factor to remove for %. Nothing was changed.', v_user;
  end if;

  v_detail := jsonb_build_object(
    'method', 'operator_runbook',
    'factors_removed', v_removed,
    'verified_by', v_verified
  );

  -- One event per agency the person is an active member of, each carrying that
  -- agency's own id, because that is the only id its owners can read. The
  -- actor is passed as null on purpose: no Pevvy user did this, an operator
  -- did, and `method` says so.
  if exists (
    select 1 from public.organization_members m
    where m.user_id = v_user and m.status = 'active'
  ) then
    perform app.record_security_event(
      'factor_reset_by_operator', v_user, m.organization_id, v_detail, null
    )
    from public.organization_members m
    where m.user_id = v_user and m.status = 'active';
  else
    -- Nobody owns this person's security history but them.
    perform app.record_security_event(
      'factor_reset_by_operator', v_user, null, v_detail, null
    );
  end if;

  raise notice 'Removed % factor(s) for %.', v_removed, v_user;
end
$$;
```

`factor_reset_by_operator` exists in `public.security_event_type` for exactly
this, and **this runbook is the only thing that writes it**. If you remove the
factors without the event, the audit trail will say the person's protection
vanished on its own.

`app.record_security_event` is granted to `service_role` only; the SQL editor
runs as the function's owner, which may execute it. Do not grant it to anything
else to make this easier.

---

## 5. Tell them what happens next

The reset does not sign them in — it removes what was blocking them.

1. They sign in with their password.
2. Pevvy sends them to **set up two-factor authentication**, because an account
   with no factor can reach nothing until it has one.
3. They scan a fresh authenticator and are shown **ten new recovery codes**.
   Those replace any old ones, so a recovery code they later find will not work.

Tell them to save the new codes somewhere that is not the phone holding the
authenticator. That is the thing that stops this happening again.

---

## Risks, in plain terms

- **This is the whole account.** Between the delete and their new enrolment,
  their password is the only thing protecting every agency they belong to. Do it
  while they are reachable, not overnight.
- **It reaches agencies you were not asked about.** A factor is per person. Step
  3 lists them; the events in step 4 are what makes that visible to the owners
  of each one, and they deliberately do not name the other agencies.
- **A wrong `v_user` is silent.** It removes a stranger's second factor and
  records the reset against them. Copy the id from step 3's output, never from
  the request.
- **Impersonation is the real attack.** Everything above is sound only as far as
  step 2 was. If the verification was weak, you have handed the account over.
- **Nothing here is reversible.** A removed factor cannot be put back; the
  person must enrol again.

If you believe this was used against an account rather than for it, treat it as
an incident: [`incident-response.md`](incident-response.md).

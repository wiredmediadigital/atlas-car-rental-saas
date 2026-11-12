# Two-Factor Authentication — Design

**Date:** 2026-11-11
**Status:** awaiting approval

---

## Intent

Pevvy stores the kind of customer data that makes a breach a legal event, not just an
embarrassment: full names, dates of birth, identity document numbers, and driver's licence
numbers. Today a single stolen or reused password is the only thing between an attacker and
all of it.

The agency owner account is the worst case — an owner can see every booking and every
customer record in their organization. But staff accounts reach the same personal data:
dates of birth and driver's licence details are visible to anyone with the `staff` role.
There is no account in Pevvy that does not warrant a second factor.

Every account in Pevvy belongs to agency personnel. There are four roles — `owner`,
`admin`, `manager`, `staff` — and renters have no logins at all. Mandatory 2FA is therefore
a policy over a small, known, professional population, not a tax on consumer signup.

## The decision

**Two-factor authentication is mandatory for every Pevvy user, in every role.** It is not
a per-organization setting, not a per-role setting, and there is no opt-out. A user without
an enrolled factor cannot reach the application.

Enrolment happens in one of two places: during onboarding, at the first sign-in after a user
has no factor, or voluntarily from settings before then.

*This is the user's decision, stated directly: "mandatory 2fa for all users regardless of
role. we just need to wire up 2fa into our app and have them enroll to 2fa during or in
settings."*

## Goals

- Every Pevvy user, in every role, authenticates with a second factor.
- The second factor is enforced in the database, not only in the UI. A stolen session or a
  direct API call with a valid token must not reach customer personal data without it.
- Nobody is permanently locked out of their own agency's data by a lost phone.
- Existing users are carried into the requirement without a support incident.
- Every change to a user's second factor leaves an auditable record.

## Non-goals

- SMS or phone factors. Not in this work.
- Passkeys / WebAuthn. Supabase ships it only as a commented-out config stub today
  (`supabase/config.toml:397`); revisit when it is real.
- Renter- or customer-facing authentication. No such accounts exist.
- Per-organization or per-role 2FA policy. The requirement is universal, so there is no
  policy to store, no grace-period clock, and no countdown banner. All of that machinery
  is deliberately not built.
- Device trust, or "remember this browser for 30 days". A meaningful weakening; its own
  decision, not this one.
- Any change to the password, invitation, or account-closure flows beyond what 2FA requires.

## Anti-goals

Failure conditions even if the feature technically works. The first is the user's stated
concern; the rest are the author's inference.

- **Locking a working agency out of its own data.** Forced *enrolment* does not do this —
  the user enrols on the spot and continues. Enforcing `aal2` in RLS before a user has had
  the chance to enrol does. The ordering in "Rollout" exists for exactly this reason.
- **A support burden that lands on the operator.** If every lost phone becomes an email to
  one person, the feature has moved a cost rather than removed a risk.
- **Security theatre.** A second factor that shares a channel with password recovery, or an
  enforcement predicate with a bypass in it, protects nothing while everyone believes
  otherwise.

## Factor type

**Authenticator app (TOTP).** Users scan a QR code with Google Authenticator, Microsoft
Authenticator, 1Password, Authy, or any TOTP app, and enter a 6-digit code at sign-in.
A desktop password manager satisfies this, so no user is required to own a smartphone.

Email codes were considered and rejected. Pevvy's password reset already goes to email, so
an attacker holding the inbox would hold both factors: they reset the password *and*
receive the code, through the same channel. It is one factor counted twice. Supabase does
not offer an email factor type, so it would also have to be hand-rolled — and a hand-rolled
factor does not produce the `aal2` session claim that makes database-level enforcement
possible. The weaker option is also the more expensive one to build.

SMS was rejected for cost (a per-message bill on every sign-in across every agency,
forever) and for SIM-swap exposure.

## What Supabase provides

Verified against the installed `@supabase/supabase-js` 2.112.3 and `supabase/config.toml`:

- Factor types `totp` and `phone`.
- Client methods: `enroll`, `challenge`, `verify`, `challengeAndVerify`, `unenroll`,
  `listFactors`, `getAuthenticatorAssuranceLevel`.
- Secret storage and code verification — `auth.mfa_factors` and `auth.mfa_challenges`
  are managed by Supabase.
- The `aal` claim on the JWT (`aal1` / `aal2`), readable from SQL as `auth.jwt() ->> 'aal'`.
- A ceiling of 10 enrolled factors per user (`auth.mfa.max_enrolled_factors`).

**It is currently switched off.** `supabase/config.toml:385-387` has
`[auth.mfa.totp] enroll_enabled = false, verify_enabled = false`. Turning it on is a change
to the live Supabase project and requires the user's explicit approval before it is pushed.

**No paid plan is required.** The comment at `supabase/config.toml:379` ("Multi-factor
authentication is available to Supabase Pro plan") is from the Supabase CLI template and
refers to Supabase enforcing MFA on its *own dashboard* organization members. TOTP for an
application's end users is free and enabled on all projects.

**Supabase does not provide:** recovery codes, any enrolment policy, any UI, or any
org-level visibility. All of that is ours.

## Constraints

- **Migrations are append-only.** A schema change is a new, later-dated file in
  `supabase/migrations/`. Never edit an existing one.
- **The config change needs approval.** Enabling TOTP touches the live project; stop and ask.
- **Views are `security_invoker = true`** and `app.assert_views_are_security_invoker()`
  enforces it. Load-bearing: a check added to the RLS helper functions propagates through
  every view automatically.
- **`npm run verify`** (format, lint, typecheck, unit + PGlite database tests, build) must
  pass. Database tests replay every migration on a fresh in-memory Postgres.
- **The PGlite harness has no `auth.jwt()` double** — tests currently set
  `request.jwt.claim.sub`. Testing the `aal` predicate needs that double extended.
  (`supabase/tests/support/supabase-doubles.sql`)
- Customer personal data is reachable through more than the `customers` table: read-model
  views (`customer_directory`, the occupancy views), and the rental-contract generator,
  which embeds `date_of_birth` into contract JSON
  (`supabase/migrations/20260815100100_rental_contracts.sql:863`). Enforcement must be
  central enough to cover all of these. `public.rental_issue_contract` is not
  `SECURITY DEFINER`, and the report read models route through `app.assert_report_access`
  → `app.has_min_role`, so the chokepoints below do reach them.
- **Pevvy ships as source that each operator installs into their own Supabase project.**
  A fresh install applies every migration in one block. The enforcement migration must
  therefore be safe on an empty database where the very first owner has no factor yet —
  it must gate on the user's own enrolment state, never on a deployment-wide stage flag.

## Enforcement

Two authorization chokepoints already exist and are used by essentially every policy:

- `app.is_org_member(organization_id)`
- `app.has_min_role(organization_id, role)`

Requiring `aal2` at this level is what makes enforcement universal — including through
every `security_invoker` view — without touching each policy by hand.
`app.billing_can_write` / `app.assert_can_write` (from
`20261103100000_billing_restricted_access.sql`) already establish the sibling-helper
pattern if a separate helper turns out to be the better placement.

**The carve-out is the hard part.** Because enrolment is mandatory and universal, the rule
is simple to state: an `aal1` session may reach *only* what the enrolment and recovery
screens need — the user's own identity and factor list — and nothing else. No customer
data, no bookings, no fleet. Getting this boundary wrong in either direction is the main
technical risk: too tight and a user cannot load the page where they would enrol, too loose
and the enforcement is decorative.

## Recovery

**Author's call throughout. The user was asked twice and did not specify; these are the
cheapest options that satisfy the "nobody permanently locked out" goal.**

A correction that shapes all of this: **a recovery code cannot grant access directly.**
Supabase raises a session to `aal2` only when GoTrue itself verifies an enrolled factor.
A code Pevvy stores and checks in its own SQL leaves the session at `aal1`, and building a
parallel "`aal2` OR recovery-grant" predicate in RLS would be a full bypass of the
protection — a stolen recovery code would read every customer record. So:

- **Recovery codes remove the factor; they do not replace it.** Single-use codes, generated
  and displayed once at enrolment, stored hashed. Spending one unenrols the lost factor and
  drops the user into enrolment for a new one. Practically: a lost phone means re-enrolling
  with a new authenticator, not a code that waves you through.
- **An owner can reset any member's factor in their own organization.** The common case,
  resolved inside the agency, same day, without contacting the operator.
- **The last-resort case is a runbook, not a feature.** A sole owner who has lost both the
  phone and the codes is unblocked by the operator running a documented SQL statement
  against their own project with the service key. There is no operator login, no
  platform-admin role and no inbound operator path anywhere in Pevvy today — building one
  is a larger piece of work than the rest of this feature and is not justified by this case.
  *If the user wants a self-service break-glass flow instead, that changes this section.*
- **A factor reset is a security event and is recorded.** Pevvy has no general audit table
  today; one is created as part of this work. *User's decision: "we also need an audit
  table."* At minimum it records enrolment, factor removal, recovery-code use, and a reset
  performed by an owner or the operator — who acted, on whom, when, and from where if
  available. It is written by `SECURITY DEFINER` functions so a user cannot forge or delete
  their own entries, and is readable by owners for their own organization.

## Rollout

Two steps. The order is the safety property, and there is no clock in either.

1. **Ship enrolment, challenge, recovery and forced enrolment.** Enabling TOTP in the
   Supabase project, the enrolment screen with QR code, the 6-digit challenge at sign-in,
   the settings page to view and replace a factor, recovery codes, and the owner's reset
   control. Any signed-in user without a factor is routed to enrolment and cannot reach the
   application until they finish. Nobody is locked out — they enrol on the spot.
2. **Then tighten RLS to require `aal2`.** The step that actually protects the data against
   a stolen token or a direct API call. It goes second because by then every active user has
   a factor, so it changes nothing for anyone legitimate.

Both steps can ship on the same day. They are separate because step 2 is the one that is
dangerous to get wrong, and it should be reviewed and tested on its own.

## Left to the builder

- Where the `aal2` requirement attaches: inside the existing helper functions versus a new
  sibling used by the sensitive policies. Constraint: it must reach the read-model views and
  the contract generator.
- The precise `aal1` carve-out surface — the minimum set of reads the enrolment and recovery
  screens need.
- Recovery code count, length, format, and hashing choice, consistent with existing practice
  in the repo.
- Extending the PGlite `auth.jwt()` double to carry an `aal` claim.
- Screen design and copy, following the existing auth pages in `src/pages/auth/`.
- Whether step 2 gates whole rows or only the sensitive columns.
- Test coverage proving an `aal1` session cannot read `date_of_birth` or
  `driver_license_number` through any path — table, view, or function.

## Known consequence worth stating

A TOTP factor is per user, not per organization, and `organization_members` allows one user
to belong to several agencies. A user who works for two agencies enrols once and is covered
at both. This is correct behaviour, not a gap, but it means enrolment is an account-level
event rather than something an agency grants or revokes.

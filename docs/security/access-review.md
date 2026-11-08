# Access review

**Owner:** Adera Labs Inc
**Applies to:** the Pevvy production deployment
**Version:** draft 1 — 8 November 2026
**Cadence:** quarterly, and within 5 working days of anyone leaving

This records who can reach production, and how that is checked. It is short on
purpose: a one-person company does not need a process, it needs a list and a
date. The value is that the list is written down before anyone asks, and that
each review leaves a dated record.

Operational document, not legal advice.

---

## 1. Why this one matters more than it looks

Access review is the control an auditor reaches for first, because it is the
easiest to fake retrospectively and the easiest to prove honestly. A commit
dated last quarter saying "reviewed, no changes" is evidence. A memory of
having thought about it is not.

---

## 2. What has to be reviewed

### 2.1 Production systems

| System | What access there grants | Who should hold it |
|---|---|---|
| **Supabase dashboard** (project `ysnumxtzcgzyabrghxwq`) | Everything: all agencies' data, storage, logs, secrets | Named individuals only |
| **Supabase service-role key** | Bypasses row-level security entirely — every agency at once | No human; held only as an Edge Function secret |
| **Stripe dashboard** | Customer billing, payouts, refunds | Named individuals only |
| **GitHub** (`wiredmediadigital/atlas-car-rental-saas`) | The code, and push to `main` deploys | Named individuals only |
| **Hostinger** | The live site and its environment variables | Named individuals only |
| **Resend** | Outgoing mail, and the sending domain | Named individuals only |
| **Domain registrar** (`pevvy.io`) | DNS — the keys to the kingdom | Named individuals only |
| **Wialon or other GPS provider** | Where an agency has connected one, per that agency's account | Agency's own credentials |

### 2.2 Secrets held on the Supabase project

Reviewed as a list, because a secret nobody remembers setting is a secret
nobody will remember rotating. As of this version:

`BILLING_APP_URL`, `BILLING_PLAN_CATALOGUE`, `BILLING_STRIPE_SECRET_KEY`,
`BILLING_STRIPE_WEBHOOK_SECRET`, `BILLING_TRIAL_DAYS`, `SUPABASE_ANON_KEY`,
`SUPABASE_DB_URL`, `SUPABASE_JWKS`, `SUPABASE_PUBLISHABLE_KEYS`,
`SUPABASE_SECRET_KEYS`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`,
`TEAM_APP_URL`, `TEAM_EMAIL_API_KEY`, `TEAM_EMAIL_FROM`, `TEAM_EMAIL_PROVIDER`

List them with `npx supabase secrets list` — it returns names and digests,
never values.

### 2.3 Inside the product

Agencies manage their own members; Adera Labs does not review an agency's
roster. The four roles are `owner`, `admin`, `manager` and `staff`, enforced
in the database by row-level security rather than only in the interface, and
every agency must keep at least one active owner.

What **is** reviewed here: whether any Adera Labs person holds a membership in
a customer agency. Support access to a customer's live data should be
exceptional, time-boxed, and agreed with that agency — not standing.

---

## 3. Doing a review

1. For each system in §2.1, list everyone who can sign in. Include anything
   signing in through a shared or personal account rather than a named one —
   that is itself a finding.
2. For each person, ask whether they still need it, and whether they need it
   at that level.
3. Remove what is not needed. Do it during the review, not afterwards.
4. Confirm no human holds the service-role key, and that it appears only as an
   Edge Function secret.
5. Check multi-factor authentication is on for every account that offers it —
   particularly GitHub, Stripe and the registrar.
6. Note anything rotated, and when each credential was last rotated.
7. Record the result.

**Recording it:** append a dated line to §5 and commit. The commit date is the
evidence; the line is the detail. Two minutes.

---

## 4. Leaving

Within five working days of anyone leaving: remove them from all systems in
§2.1, rotate any shared credential they could have held, and record it in §5
as its own entry.

---

## 5. Review log

| Date | Reviewer | Changes made | Next due |
|---|---|---|---|
| — | — | *No review has been performed yet. The first is due on adoption of this procedure.* | — |

---

## 6. Gaps — known, and not yet closed

### Gap 1 — the holders are not named

§2.1 says "named individuals only" without naming them, which is a placeholder
dressed as a control. The first review closes this by writing the actual names
in, including for a company of one.

### Gap 2 — rotation has no schedule

Credentials are rotated on exposure (the incident procedure covers that) but
not on a cycle, and no record exists of when each was last rotated. The
Stripe secret key and the service-role key are the two that matter most.

### Gap 3 — MFA is unverified

This procedure requires it; nobody has confirmed it is on everywhere. That is
a five-minute check at the first review, and the single highest-value item in
this document.

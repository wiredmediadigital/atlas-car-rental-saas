# Security incident response

**Owner:** Adera Labs Inc
**Applies to:** the Pevvy production deployment
**Version:** draft 1 — 8 November 2026
**Review:** annually, and after every declared incident

This is the procedure to follow when something has gone wrong with security or
personal data. It exists because there is a clock: under GDPR a notifiable
breach must reach the supervisory authority **within 72 hours of becoming
aware of it**, and an agency that discovers a problem at 02:00 should not find
Adera Labs deciding who decides.

It is an operational document, not legal advice. Whether a given incident is
notifiable, and to whom, is a question for a lawyer — the point of this
procedure is to have the facts assembled before that call is made, not to
make it.

---

## 1. What counts as an incident

Declare an incident for any of the following. When unsure, **declare it** —
standing one down costs an hour, and the clock starts at *awareness*, not at
declaration.

- Personal data disclosed to, or reachable by, anyone not entitled to it —
  including one agency seeing another's records.
- A credential exposed: a Supabase service-role key, the Stripe secret key,
  the webhook signing secret, an email API key, or GPS provider credentials.
- Unauthorised access to the production database, storage buckets, the
  Supabase dashboard, the GitHub repository or the hosting account.
- Document scans — passports, identity cards, driving licences — reachable
  without a valid signed link.
- Data loss or corruption that a restore would be needed for.
- A dependency or provider compromise that reaches our data.
- A report from a provider (Supabase, Stripe, Resend, Wialon) of a breach on
  their side affecting us.

**Not an incident:** ordinary downtime, a failed deploy, or a bug with no
data-protection consequence. Those are operational problems.

---

## 2. Who does what

Adera Labs is small, so these are roles rather than people, and one person may
hold several. What matters is that each is named before an incident, not
during one.

| Role | Responsibility |
|---|---|
| **Incident lead** | Declares the incident, owns the timeline, decides when it is closed. The only role that cannot be shared. |
| **Technical responder** | Investigates, contains, fixes. |
| **Communications** | Tells affected agencies, and handles their replies. |
| **Decision maker** | Approves notification to regulators, and any public statement. |

**Reporting point:** `help@pevvy.io`. Anyone — customer, researcher, member of
the public — can report a suspected problem there. It is monitored, and a
report of a security problem goes to the incident lead the same working day.

---

## 3. The procedure

### Step 1 — Record the clock (immediately)

Write down the time you became aware, and what you were told. **The 72 hours
runs from awareness**, not from confirmation, so this timestamp matters more
than it looks and must not be reconstructed later from memory.

### Step 2 — Contain

Stop it getting worse before working out how it happened.

- Rotate any exposed credential **first**. A service-role key bypasses row-level
  security entirely, so an exposed one reaches every agency's data at once.
  The five Edge Functions — `billing`, `billing-webhook`, `gps-provider`,
  `pricing`, `team-invitations` — all hold one.
- Revoke sessions, or suspend the account involved.
- If a storage object is exposed, remove or move it; signed links expire on
  their own (300 seconds for identity documents, 3600 for vehicle media) but
  do not wait for that if the object itself is reachable.
- Take a database backup before changing anything you might need as evidence.

### Step 3 — Assess

Establish, in writing:

- What data, whose, and how many agencies and individuals.
- Whether it includes identity documents, which raises the severity
  materially — a leaked passport scan is not comparable to a leaked email
  address.
- Whether the data was actually accessed, or only reachable.
- When it started and when it stopped.

**Evidence to draw on:** `organization_team_events` (membership and role
changes), `billing_events` and `billing_webhook_events`, `expense_change_events`,
`financing_change_events`, `gps_sync_runs`, `notification_events`, plus the
Supabase auth logs and the Edge Function logs in the dashboard.

Note a limitation honestly: **there is no application-level audit of ordinary
reads.** We can often show what changed and who was a member, but not who
viewed a record. Say so in the assessment rather than implying certainty we do
not have.

### Step 4 — Notify

**Agencies affected:** tell them without undue delay. They are the controller
for their renters' data and cannot meet *their* obligations until we have met
ours. Give them what happened, what data, what we have done, what they should
do, and a named contact. Do not wait for a complete picture — send what is
known and update.

**Supervisory authority:** where the breach is notifiable, within **72 hours**
of awareness. If the picture is still incomplete at that point, notify anyway
and supplement later; a late notification is a separate infringement from the
breach itself.

**Individuals:** where there is high risk to them — leaked identity documents
usually qualify — they are told directly. Normally through the agency, who
holds the relationship, with our support.

**Stripe, Supabase, Resend, Wialon:** where the incident touches their
systems or credentials.

### Step 5 — Fix and close

Remove the cause, not just the symptom. Where the fix is code, it goes through
the usual review — an incident is not a reason to skip it, and a rushed
unreviewed fix is how the second incident starts.

The incident lead closes it, and records: the timeline, what was affected, who
was told and when, the root cause, and what changed so it cannot recur.

### Step 6 — Review

Within two weeks, write down what happened and what we are changing. Blameless:
the purpose is a system that fails less, not a person who failed. Update this
procedure if it proved wrong — a procedure that survives an incident unchanged
usually was not followed.

---

## 4. Where records live

Incident records go in a dated file under `docs/security/incidents/`, in the
repository, so the history is version-controlled, attributable and provable.
Records that would themselves disclose personal data name the affected records
by identifier rather than reproducing them.

---

## 5. Gaps — known, and not yet closed

### Gap 1 — no read-level audit trail

We can reconstruct changes, not views. If the question is "did anyone look at
this customer's passport scan", the honest answer today is that we cannot say.
Closing this means logging document-access events; it is not free, and the
decision has not been taken.

### Gap 2 — roles are unassigned

The table in §2 names roles but not people. For a company of one, the lead is
the founder — but it should say so, and name a deputy for the case where the
founder is unreachable.

### Gap 3 — never rehearsed

This procedure has not been tested. A thirty-minute walkthrough of one
plausible scenario — an exposed service-role key, say — would find the steps
that do not survive contact.

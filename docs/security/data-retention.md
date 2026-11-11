# Data retention and deletion

**Owner:** Adera Labs Inc
**Applies to:** the Pevvy production deployment
**Version:** draft 1 — 8 November 2026
**Review:** annually, or when a new table or storage bucket holding personal data is added

This procedure exists because the published privacy policy makes retention
commitments to customers. It records what those commitments mean in practice,
who acts on them, and — in the Gaps section — where the product does not yet
keep them. It is written from the schema, so a claim here can be checked
against the code.

It is an operational document, not legal advice. The statutory periods marked
**TO CONFIRM** need a Delaware and federal tax opinion before they are relied on.

---

## 1. Roles

Pevvy holds two kinds of data under two different responsibilities, and the
retention rules differ accordingly.

| | Adera Labs is… | Who decides how long it is kept |
|---|---|---|
| Agency account, members, settings, billing | **Controller** | Adera Labs |
| Renter and fleet records an agency enters | **Processor** | The agency |

For processor data, Adera Labs does not decide retention. It provides the
means — deletion, archival and export — and acts on the agency's instruction.
Deleting an agency's records on our own initiative would be acting outside
that instruction.

---

## 2. What is held, and for how long

### 2.1 Agency account data (controller)

| Record | Where | Kept |
|---|---|---|
| Agency, settings, branding | `organizations`, `organization_settings` | While the account is open |
| Members and roles | `organization_members`, `profiles` | While the account is open |
| Invitations | `organization_invitations` | Until accepted, revoked or expired |
| Team activity | `organization_team_events` | While the account is open |
| Subscription and billing | `billing_customers`, `billing_subscriptions`, `billing_checkout_sessions`, `billing_events` | **TO CONFIRM** — proposed 7 years after the last transaction, for tax |
| Stripe webhook deliveries | `billing_webhook_events` | 90 days; operational only |

### 2.2 Agency-entered records (processor)

| Record | Where | Kept |
|---|---|---|
| Renters and drivers | `customers`, `rental_drivers` | Agency's choice; archived rather than deleted once referenced |
| Identity and licence documents | `customer_documents` + `customer-documents` bucket | Agency's choice |
| Rentals, contracts, charges | `rentals`, `rental_contracts`, `rental_line_items` | Agency's choice; a draft with no money or issued document can be deleted outright |
| Condition photographs | `rental_condition_photos` + `rental-documents` bucket | Agency's choice |
| Payments and refunds | `payments` | **Never deleted.** A mistake is voided (`voided_at`) and stays visible |
| Vehicles and their documents | `vehicles`, `vehicle_documents`, `vehicle_images` + buckets | Agency's choice |
| Expenses and receipts | `expenses`, `expense_attachments` + `expense-receipts` bucket | Agency's choice |
| Financing | `financing_*` + `financing-documents` bucket | Agency's choice |
| Vehicle location history | `gps_positions` | **No limit while the account is open — see Gap 1, still open**; deleted when the account is purged |
| GPS sync attempts | `gps_sync_runs` | Newest 50 per connection, enforced by a database trigger |
| GPS provider credentials | `gps_provider_credentials` | Until the connection is removed |
| Notifications | `notifications`, `notification_events`, `notification_states` | While the account is open |

### 2.3 Principles already enforced in the product

- **Money is never deleted.** Payments are voided with a reason and remain on
  the contract. This is deliberate and must not be "fixed" by a retention rule.
- **Referenced records are archived, not deleted.** 96 columns across the
  schema carry `archived_at`; a customer or vehicle attached to history is
  hidden rather than destroyed, so the history stays readable.
- **Only untouched drafts are hard-deleted.** A draft rental with no payment
  and no issued contract can be removed outright, because there is no history
  to preserve.

---

## 3. Access to stored documents

Uploaded files are held in private buckets — `customer-documents`,
`rental-documents`, `vehicle-documents`, `expense-receipts`,
`financing-documents`, `organization-logos` — and are never public. They are
opened through time-limited signed links:

| Bucket class | Link lifetime |
|---|---|
| Customer identity documents | **300 seconds** (`src/features/customers/documents.ts`) |
| Vehicle media and documents | **3600 seconds** (`src/features/vehicles/media.ts`) |

A copied link therefore stops working rather than becoming a permanently
reachable passport page. The shorter lifetime on identity documents is
intentional and should not be raised to match the other.

---

## 4. Deletion on request

**From an agency, about its own account:** Adera Labs responds within 30 days.

**From a renter, about their own records:** the agency is the controller.
Adera Labs refers the request to that agency and assists them in answering it,
rather than acting on the renter's instruction directly. This is what the
privacy policy tells renters to expect.

**Export before deletion:** an agency can export its data at any time, and is
offered the chance to do so before an account is closed.

---

## 5. Gaps — known, and whether they are closed

These are recorded because an undocumented gap is the one an auditor finds.

### Gap 1 — `gps_positions` has no retention rule

Vehicle location history accumulates without limit. It is among the more
sensitive data the product holds, and the schema elsewhere already states the
principle: *"A retention rule that exists only in a runbook is a table that
grows for three years."* `gps_sync_runs` is trimmed by a trigger;
`gps_positions` is not.

**Proposed:** an agency-configurable retention window, defaulting to 12
months, enforced in the database rather than by a scheduled script.
**Until then:** location history is kept indefinitely, and the privacy policy
should not imply otherwise. **Gap 1 remains open.** Account closure deletes
`gps_positions` along with the rest of an agency's data, but only when the agency
closes; it is not a retention rule for an agency that stays.

### Gap 2 — there is no account-closure path — **CLOSED**

Closed by the account-closure feature (design:
`docs/superpowers/specs/2026-11-08-account-closure-design.md`). An owner requests
closure; the agency is suspended (read-only, labelled, purge date shown,
restorable in one click) and a runner purges it 30 days later, or sooner only
when Adera Labs actions it. The purge deletes the tenant's rows and storage
objects, and its members' sign-ins where this was their last agency; it retains
the billing records tax law requires and leaves a counts-only evidence record.
The Terms and privacy policy now describe it. A daily scheduled workflow
(`.github/workflows/account-closure.yml`) drains the operator notices and runs
the purge.

**Subscription cancellation is the agency's, not automatic.** Closing never
cancels the Stripe subscription, so that restoring stays a clean undo. The agency
is told in the closure dialog, the suspension banner and the Terms to cancel it
itself from Manage billing, which stays available while it is suspended. Only an
owner can open Billing, so the banner tells everyone else that an owner can. The
purge refuses to run while a live subscription exists, so deletion waits for it.
The operator is emailed when closure is requested as a backstop: if the
subscription is still live past the purge date, the operator cancels it so the
deletion can proceed.

### Gap 3 — statutory billing periods unconfirmed

The 7-year figure in §2.1 is a common default, not a researched one. It needs
confirming against Delaware and US federal requirements.

---

## 6. Review

Reviewed annually, and whenever a migration adds a table or bucket holding
personal data. The reviewer records the date and what changed in the commit
message, so the history of this procedure is the git history of this file.

# Help Centre — Screenshot Shot List

**Date:** 2026-11-06
**For:** the Pevvy owner, capturing images by hand
**Companion to:** `2026-11-06-pevvy-help-centre-design.md`

---

## Read this first

### These images go on a public URL

`/help` is readable by anyone on the internet, signed in or not. Every
screenshot is published there permanently.

**Capture from an agency holding invented data.** If you capture from an agency
with real records, redact every one of these before handing the image over:

- customer names
- licence and ID numbers
- phone numbers and email addresses
- home addresses
- number plates
- your own staff's names and email addresses in Team

No automated check can find a real person's name inside a PNG. You are the
control.

### Settings for every shot

| | |
|---|---|
| Browser width | 1440px, desktop layout |
| Zoom | 100% |
| Theme | whichever Pevvy opens in — just keep it the same across all shots |
| Browser chrome | not included — capture the page, not the window |
| Format | PNG |

Two shots are mobile; they are marked.

### Naming

`<page>-<number>-<what-it-is>.png` — lower case, hyphens.
Examples: `rentals-01-list.png`, `rentals-04-handover-dialog.png`.

The number is the order it appears on the help page.

### Cropping

Most shots are a **crop**, not the full page — just the panel or dialog being
described, with a little breathing room. Shots marked **full** mean the whole
content area.

### If a shot isn't possible

Skip it and say which. Several depend on having data or a connected provider.
Nothing here is mandatory — a missing image leaves a gap in the page, it doesn't
break anything.

---

## The list

Roughly 30 images. Grouped by help page.

### Rentals

| # | Shot | Where | Must show |
|---|---|---|---|
| 01 | Rentals list | Rentals | **full** — a few rentals across different statuses, so the badges are visible |
| 02 | New rental form | Rentals → New rental | crop — customer and vehicle pickers, dates |
| 03 | Quote summary | same screen | crop — the price breakdown as it updates |
| 04 | Handover dialog | a reserved rental → hand over | crop — the dialog as it opens |
| 05 | Condition photos | handover | crop — the photo grid |
| 06 | Signature pad | handover | crop — with a signature drawn |
| 07 | Payment dialog | a rental → take payment | crop — amount and method |
| 08 | Payments panel | rental detail | crop — ideally a partially-paid rental, so the split is visible |
| 09 | Extend dialog | an active rental → extend | crop |
| 10 | Substitute vehicle dialog | an active rental | crop |

### Calendar

| # | Shot | Where | Must show |
|---|---|---|---|
| 01 | Fleet timeline | Calendar | **full** — several vehicles with overlapping bookings |
| 02 | Rental quick view | click a block | crop — the popover |
| 03 | Availability search | Calendar toolbar | crop |
| 04 | Reschedule dialog | drag or open a booking | crop |

### Customers

| # | Shot | Where | Must show |
|---|---|---|---|
| 01 | Customer list | Customers | **full** — invented names |
| 02 | Customer form | Customers → New | crop — the identity fields |
| 03 | Duplicate warning | trigger by entering an existing customer's details | crop — skip if hard to reproduce |
| 04 | Documents panel | a customer's detail page | crop |
| 05 | Activity panel | same page | crop — their rental history |

### Vehicles

| # | Shot | Where | Must show |
|---|---|---|---|
| 01 | Fleet list | Vehicles | **full** — a mix of available, rented, maintenance |
| 02 | Fleet summary | top of Vehicles | crop — the counts |
| 03 | Vehicle form | Vehicles → New | crop |
| 04 | Compliance panel | a vehicle's detail page | crop — insurance and inspection dates |
| 05 | Vehicle documents | same page | crop |
| 06 | Import dialog | Vehicles toolbar | crop |

### GPS tracking

Empty states are expected and fine here — capture what a new agency sees.

| # | Shot | Where | Must show |
|---|---|---|---|
| 01 | Not connected | GPS tracking, no provider | **full** — the empty state |
| 02 | Connection dialog | connect a provider | crop — **blank or fake credentials only** |
| 03 | Fleet map | if you have a provider connected | **full** — skip if not |
| 04 | Assign device dialog | if available | crop — skip if not |

### Expenses

| # | Shot | Where | Must show |
|---|---|---|---|
| 01 | Expenses list | Expenses | **full** |
| 02 | New expense form | Expenses → New | crop — with the allocation choice visible (overhead / vehicle / rental) |
| 03 | Receipt panel | an expense's detail page | crop |
| 04 | Import dialog | Expenses toolbar | crop |

### Financing

| # | Shot | Where | Must show |
|---|---|---|---|
| 01 | Agreements list | Financing | **full** |
| 02 | Agreement wizard | Financing → New | crop — the first step |
| 03 | Schedule table | an agreement's detail page | crop — the instalment schedule |
| 04 | Lender manager | Financing | crop |

### Reports

Empty or thin is fine — this is what a new agency sees.

| # | Shot | Where | Must show |
|---|---|---|---|
| 01 | Reports page | Reports | **full** |
| 02 | Performance chart | Reports | crop |
| 03 | Fleet performance table | Reports | crop |
| 04 | Report toolbar | Reports | crop — the date range control |

### Team

Use invented staff names and email addresses, or redact.

| # | Shot | Where | Must show |
|---|---|---|---|
| 01 | Members table | Team | **full** — ideally one of each role |
| 02 | Invite dialog | Team → Invite | crop — the role selector open |
| 03 | Invitations panel | Team | crop — a pending invitation |
| 04 | Team activity | Team | crop |

### Billing

Empty state expected.

| # | Shot | Where | Must show |
|---|---|---|---|
| 01 | Billing page | Billing | **full** — whatever state yours is in |

### Settings

| # | Shot | Where | Must show |
|---|---|---|---|
| 01 | Settings | Settings | **full** |
| 02 | Logo uploader | Settings | crop |

### Notifications

| # | Shot | Where | Must show |
|---|---|---|---|
| 01 | Notifications list | Notifications | **full** — a few of different kinds |

### Getting started

| # | Shot | Where | Must show |
|---|---|---|---|
| 01 | Sign-in screen | sign out first | **full** |
| 02 | Accept invitation screen | an invite link | **full** — **blank fields, no real token visible in the address bar** |
| 03 | Create agency screen | from a fresh sign-up if you can | **full** — skip if not |
| 04 | The sidebar | any page | crop — the full navigation tree, expanded |
| 05 | Sidebar on mobile | **mobile** — 390px wide, menu open | crop |
| 06 | A module page on mobile | **mobile** — Rentals at 390px | **full** |

---

## Handing them over

Drop them in one folder, named as above. Tell me which ones you skipped and
why — a skipped shot changes the prose on that page, so I'd rather write around
a gap than describe something that isn't pictured.

If any image needed redaction, say so, so I can look at those ones specifically
before they go in the repo.

---

# Capture log — 2026-11-06

Captured by Claude driving Chrome against `npm run dev` on `localhost:5173`,
signed in as Owner of the demo agency **John Auto rental** (21 vehicles,
`DEMO-0xx` plates, invented customers).

**19 images** are in `docs/help-screenshots/`.

## Format notes for the builder

- **1568×726 JPEG.** The extension's capture viewport is fixed at that size and
  did not follow window resizing, so these are viewport shots, not tall
  full-page ones, and the format is JPEG rather than the PNG this list asked
  for. Small UI text is slightly soft as a result. Good enough to ship; worth
  recapturing as PNG if a sharper pass is ever wanted.
- No `2×` variants exist. Either accept these at `1×` or recapture.

## Captured

| File | Page |
|---|---|
| `overview-01-dashboard.jpg` | Overview |
| `rentals-01-list.jpg` | Rentals list, four contracts across Out/Reserved |
| `rentals-02-detail.jpg` | Rental detail — hire, people, hand-over, contract |
| `rentals-03-charges-and-money.jpg` | Charges breakdown, add-charge row, Money panel |
| `rentals-04-new-rental-period.jpg` | New rental, step 1 of 5, with live Quote |
| `calendar-01-fleet-timeline.jpg` | Week timeline with bookings |
| `customers-01-list.jpg` | Customers list |
| `customers-02-add-customer.jpg` | Add a customer |
| `vehicles-01-fleet-list.jpg` | Fleet list with status counts |
| `vehicles-02-add-vehicle.jpg` | Add a vehicle |
| `gps-01-no-provider-connected.jpg` | GPS empty state |
| `expenses-01-list.jpg` | Expenses list with "Where it went" |
| `expenses-02-record-a-cost.jpg` | Record a cost, incl. the allocation choice |
| `financing-01-agreements.jpg` | Financing list, one draft agreement |
| `reports-01-business.jpg` | Reports, Business tab |
| `team-01-members.jpg` | Team, with the role explainer |
| `billing-01-active-subscription.jpg` | Billing — **active** Pro monthly, not empty |
| `settings-01-general.jpg` | Settings, General |
| `notifications-01-list.jpg` | Notifications |

Billing came out better than planned: the demo agency has a live subscription,
so that page gets a populated shot rather than the empty state agreed earlier.

## Redaction applied — 2026-11-06

The owner confirmed the customer data is dummy, then asked for redaction at
discretion. **Every email address has been blanked** in place; the files in
`docs/help-screenshots/` are the redacted versions.

Blanked:

- **All 19 images** — the account email in the sidebar footer
- `customers-01-list.jpg` — all three addresses in the Contact column
- `team-01-members.jpg` — the member address
- `billing-01-active-subscription.jpg` — the "Invoices go to" address
- `settings-01-general.jpg` — the agency email field

Left visible, because it is plainly dummy and removing it would make the
screenshots less useful as documentation: phone numbers (`5555555555`), the tax
identifier, the business address (`5 John St, Los Angeles`), the agency name,
customer names and `DEMO-0xx` plates.

Redaction is a filled block in the surrounding surface colour, not a blur —
blurred text can sometimes be recovered, a filled block cannot.

## Not captured

**Needs signing out** — skipped rather than disturb the live session:
sign-in screen, accept-invitation screen, create-agency screen, marketing home.

**Mobile (2 shots)** — the capture viewport would not resize below 1568px.

**Dialogs and detail panels** — each needs a click path and some open over live
records: hand-over, signature pad, condition photos, payment, extend,
substitute vehicle, invite member, reschedule, availability search, duplicate
warning, import dialogs (vehicles/customers/expenses), GPS connection, lender
manager, financing wizard, financing schedule, customer detail, vehicle detail.

These are all reachable; they just need a second pass with interaction rather
than straight navigation.

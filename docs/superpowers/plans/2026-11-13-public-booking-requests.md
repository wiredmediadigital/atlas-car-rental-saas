# Public Booking Requests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each agency a public page, linked from their own website, that shows their fleet and real availability and lets a renter ask for a car, with the request landing in a new Leads section a staff member converts into a customer and a rental.

**Architecture:** One Edge Function is the entire public surface — the browser never touches the database. It holds the service role, calls `security definer` functions granted to `service_role` alone, mints short-lived signed URLs for the logo and opted-in vehicle photos, and is where rate limiting lives. `anon` keeps having no database grants, so the product's existing self-checks stay true. Inside the product, leads are an ordinary RLS-protected table behind the same membership and second-factor chokepoints as everything else.

**Tech Stack:** Postgres migrations (append-only), Supabase Edge Functions (Deno), React 19 + TypeScript + Vite, Vitest with the PGlite harness in `supabase/tests/support/harness`.

**Spec:** `docs/superpowers/specs/2026-11-13-public-booking-requests-design.md`

## Global Constraints

- **The public surface is one Edge Function.** `anon` is granted nothing — not tables, not functions. Every new `security definer` function is `grant execute ... to service_role` and nothing else.
- **Edge Function entrypoints decide nothing.** All logic lives in `supabase/functions/_shared/`, because entrypoints are outside tsconfig and no test can reach them. Follow `pricing/index.ts` + `_shared/public-pricing.ts`.
- **Narrow projections.** The public read never returns: `registration_plate`, `vin`, `odometer`, any cost or acquisition field, documents, `insurance_expires_on`, `inspection_expires_on`, `registration_expires_on`, `next_service_on`, customers, or any rental row.
- **No utilisation figure on the public page.** No "N of M free", no count of unavailable vehicles.
- **Exact copy, unavailable vehicle:** `not free for these dates`
- **Exact copy, billing-restricted agency:** `To book, please call us`
- **Migrations are append-only.** New dated files only; never edit an existing migration.
- **Leads are not billing-exempt.** A restricted agency cannot receive new leads; `app.billing_require_write` applies.
- **Retention:** unconverted leads are purged 12 months after creation.
- **No third-party CAPTCHA.** Rate limiting, honeypot and minimum time-on-form only.
- **One acknowledgement email per request**, fixed template, never echoing the renter's note. The agency notification email carries no renter personal data.

## Review Focus

Failure modes the spec implies that no task's happy path exercises. Each has a test in the task that owns the code.

1. **A slug that does not exist, or an agency with the feature off** — the page must answer neutrally, not 500 and not reveal whether the agency exists. (Task 4)
2. **A date range that is inverted, starts in the past, or runs for years** — refused with a message, never a crash or a ten-year quote. (Task 9)
3. **A vehicle opted out, deleted, or sold between page load and submit** — the request is refused cleanly rather than creating a lead against a car nobody offers. (Task 5)
4. **Conversion of a lead that is already converted, or whose vehicle is no longer free** — must never produce two rentals or a double booking. (Task 6)
5. **Timezone** — the default date window and `billable_days` are computed in the agency's `time_zone`, not the server's or the renter's. (Task 4)

---

## File Structure

**Migrations** (`supabase/migrations/`, append-only)

| File                                            | Responsibility                                                       |
| ----------------------------------------------- | -------------------------------------------------------------------- |
| `20261113100000_legal_document_versions.sql`    | `app.current_terms_version()` tracks the Terms date alone            |
| `20261113100100_public_booking_opt_in.sql`      | Opt-in columns on `organizations` and `vehicles`, plan entitlement   |
| `20261113100200_booking_leads.sql`              | `public.booking_leads`, its enum, RLS, purge-list membership         |
| `20261113100300_public_booking_reads.sql`       | Definer read functions for the public surface                        |
| `20261113100400_public_booking_request.sql`     | Definer write function that creates a lead                           |
| `20261113100500_booking_lead_conversion.sql`    | `public.convert_booking_lead` — customer + rental + lead, atomically |
| `20261113100600_booking_lead_notifications.sql` | New `notification_kind`, event on lead creation                      |
| `20261113100700_booking_lead_retention.sql`     | `app.purge_expired_booking_leads()`                                  |

**Edge Function**

| File                                                 | Responsibility                                                               |
| ---------------------------------------------------- | ---------------------------------------------------------------------------- |
| `supabase/functions/_shared/public-booking.ts`       | Every decision: request parsing, validation, rate limiting, response shaping |
| `supabase/functions/_shared/public-booking-rates.ts` | The rate-limit and honeypot rules, isolated so they are testable alone       |
| `supabase/functions/public-booking/index.ts`         | Deno shim: dispatch, build effects, hand to `_shared`                        |
| `supabase/config.toml`                               | `[functions.public-booking] verify_jwt = false`                              |

**Frontend — public page** (outside `RequireAuth`, `WithWorkspace` and the second-factor guard)

| File                                              | Responsibility                                            |
| ------------------------------------------------- | --------------------------------------------------------- |
| `src/pages/booking/BookingPage.tsx`               | The page at `/book/:slug`                                 |
| `src/features/booking/api.ts`                     | Calls the Edge Function; no Supabase client               |
| `src/features/booking/dates.ts`                   | Default window and billable days in the agency's timezone |
| `src/features/booking/components/VehicleCard.tsx` | One vehicle, available or dimmed                          |
| `src/features/booking/components/RequestForm.tsx` | Name, email, phone, note, honeypot                        |

**Frontend — in-app**

| File                                                   | Responsibility                           |
| ------------------------------------------------------ | ---------------------------------------- |
| `src/pages/leads/LeadsPage.tsx`                        | The Leads list                           |
| `src/features/leads/api.ts`                            | Queries and the conversion call          |
| `src/features/leads/components/LeadTable.tsx`          | List with status and collision flag      |
| `src/features/leads/components/ConvertLeadDialog.tsx`  | Conversion, with the price-drift warning |
| `src/features/settings/components/BookingPageCard.tsx` | Master switch and the public link        |
| `src/features/vehicles/components/VehicleForm.tsx`     | Per-vehicle opt-in toggle (modify)       |

**Legal**

| File                                     | Responsibility                                         |
| ---------------------------------------- | ------------------------------------------------------ |
| `src/pages/legal/legal-config.ts`        | Separate dates per document (modify)                   |
| `src/pages/legal/PrivacyPolicyPage.tsx`  | Renter-submitted data (modify)                         |
| `src/pages/legal/DataProcessingPage.tsx` | Renter as a data subject reaching us directly (modify) |

---

### Task 1: Legal document versions

Independently shippable. Everything later depends on it, because updating the privacy policy must not churn the Terms version every agency has accepted.

**Files:**

- Modify: `src/pages/legal/legal-config.ts`
- Create: `supabase/migrations/20261113100000_legal_document_versions.sql`
- Test: `supabase/tests/terms-acceptance.test.ts`, `src/pages/legal/legal-pages.test.tsx`

**Interfaces:**

- Produces: `LEGAL().lastUpdated` becomes `LEGAL().termsUpdated`, `LEGAL().privacyUpdated`, `LEGAL().dataProcessingUpdated` — all `string`, format `'13 November 2026'`. `app.current_terms_version()` returns `termsUpdated` only.

- [ ] **Step 1: Write the failing tests**

```ts
it('returns the Terms date, not the privacy date', async () => {
  // current_terms_version() equals LEGAL().termsUpdated
})
it('keeps the Terms version unchanged when only the privacy date moves', async () => {
  // privacyUpdated differs from termsUpdated; current_terms_version() still equals termsUpdated
})
```

- [ ] **Step 2: Run them and watch them fail** — `npm run test -- terms-acceptance` — expected: fails on `lastUpdated` no longer existing.
- [ ] **Step 3: Split the three dates in `legal-config.ts`** and update every reader. `LegalLayout` prints each page's own date.
- [ ] **Step 4: Write the migration** so `app.current_terms_version()` returns the Terms date. Keep the existing signature and return type; only the value's source changes.
- [ ] **Step 5: Run `npm run verify`** — expected: all green, lint count unchanged.
- [ ] **Step 6: Commit** — `feat: give each legal document its own version`

---

### Task 2: Opt-in and plan entitlement

**Files:**

- Create: `supabase/migrations/20261113100100_public_booking_opt_in.sql`
- Test: `supabase/tests/public-booking-opt-in.test.ts`

**Interfaces:**

- Produces: `public.organizations.public_booking_enabled boolean not null default false`; `public.vehicles.public_booking_enabled boolean not null default false`; `app.plan_allows_public_booking(p_organization_id uuid) returns boolean` — `security definer`, `stable`, granted to `service_role` and `authenticated`.

- [ ] **Step 1: Write the failing tests**

```ts
it('defaults both switches to off', async () => {
  /* new org and new vehicle both false */
})
it('refuses to turn the agency switch on without an entitled plan', async () => {
  /* raises 42501 */
})
it('lets an owner turn a vehicle on and a staff member not', async () => {
  /* role boundary */
})
```

- [ ] **Step 2: Run and watch fail** — `npm run test -- public-booking-opt-in`
- [ ] **Step 3: Write the migration.** Entitlement follows `20261109100000_plan_vehicle_limits.sql`: the plan carries the allowance, and a trigger on `organizations` refuses the switch when the plan does not include it.
- [ ] **Step 4: Run and watch pass**
- [ ] **Step 5: Commit** — `feat: let an agency choose which vehicles the public can request`

---

### Task 3: The leads table

**Files:**

- Create: `supabase/migrations/20261113100200_booking_leads.sql`
- Test: `supabase/tests/booking-leads.test.ts`

**Interfaces:**

- Produces: `public.booking_lead_status` enum — `'new' | 'contacted' | 'converted' | 'declined' | 'lapsed'`. `public.booking_leads` with: `id`, `organization_id`, `vehicle_id`, `reference text not null`, `status`, `starts_at`, `ends_at`, `full_name`, `email`, `phone`, `note`, the price snapshot (`currency`, `daily_rate_minor`, `billable_days`, `quoted_total_minor`), `converted_customer_id`, `converted_rental_id`, `created_at`, `updated_at`.

- [ ] **Step 1: Write the failing tests**

```ts
it('is invisible to another agency', async () => {
  /* agency B reads zero rows */
})
it('is unreadable at aal1', async () => {
  /* password-only session reads zero rows */
})
it('appears in both closure purge lists', async () => {
  // app.organization_purge_lists_agree() does not raise
})
```

- [ ] **Step 2: Run and watch fail**
- [ ] **Step 3: Write the migration.** Policies `for select/update to authenticated using (app.is_org_member(organization_id))` and writes at `app.has_min_role(organization_id, 'staff')`, matching `rental_line_items`. Add the table to both closure purge lists in the same migration — `app.organization_purge_lists_agree()` raises otherwise.
- [ ] **Step 4: Run and watch pass**
- [ ] **Step 5: Commit** — `feat: add the table a booking request lands in`

---

### Task 4: The public read functions

**Files:**

- Create: `supabase/migrations/20261113100300_public_booking_reads.sql`
- Test: `supabase/tests/public-booking-reads.test.ts`

**Interfaces:**

- Produces:
  - `app.public_booking_agency(p_slug text)` → one row: `organization_id`, `name`, `logo_path`, `phone`, `time_zone`, `default_currency`, `accepts_requests boolean`. Returns no row when the agency does not exist, the master switch is off, or closure has been requested. `accepts_requests` is false when billing is restricted.
  - `app.public_booking_vehicles(p_organization_id uuid, p_from timestamptz, p_to timestamptz)` → `vehicle_id`, `make`, `model`, `model_year`, `category`, `transmission`, `fuel_type`, `seats`, `doors`, `image_path`, `currency`, `daily_rate_minor`, `billable_days`, `quoted_total_minor`, `is_available boolean`.
  - Both `security definer`, `stable`, `grant execute ... to service_role` only.

- [ ] **Step 1: Write the failing tests**

```ts
it('returns nothing for a slug that does not exist', async () => {
  /* zero rows, no raise */
})
it('returns nothing when the master switch is off', async () => {
  /* same shape as above — indistinguishable */
})
it('lists opted-in vehicles only', async () => {
  /* an opted-out vehicle is absent entirely */
})
it('marks a vehicle in maintenance exactly as it marks a booked one', async () => {
  // is_available false for both; no column distinguishes why
})
it('counts billable days in the agency timezone', async () => {
  // Pacific/Auckland agency, a window that spans a UTC date boundary
})
it('is unreachable by anon', async () => {
  /* execute denied */
})
```

- [ ] **Step 2: Run and watch fail**
- [ ] **Step 3: Write the migration.** `public_booking_vehicles` calls `public.vehicles_available_between` for the free set and left-joins the opted-in fleet onto it, so unavailable vehicles are still returned with `is_available false`. The primary image comes from `public.vehicle_images`.
- [ ] **Step 4: Run and watch pass**
- [ ] **Step 5: Commit** — `feat: project the fleet for a visitor who is not signed in`

---

### Task 5: The public write function

**Files:**

- Create: `supabase/migrations/20261113100400_public_booking_request.sql`
- Test: `supabase/tests/public-booking-request.test.ts`

**Interfaces:**

- Produces: `app.public_booking_create_lead(p_organization_id uuid, p_vehicle_id uuid, p_from timestamptz, p_to timestamptz, p_full_name text, p_email text, p_phone text, p_note text)` → `table(lead_id uuid, reference text)`. `security definer`, `volatile`, `service_role` only. Calls `app.billing_require_write`. Takes its own price snapshot rather than trusting the caller.

- [ ] **Step 1: Write the failing tests**

```ts
it('refuses a vehicle that is not opted in', async () => {
  /* raises; no row created */
})
it('refuses a vehicle that was deleted after the page loaded', async () => {
  /* raises cleanly */
})
it('refuses when the agency is billing-restricted', async () => {
  /* 42501 */
})
it('never takes the price from the caller', async () => {
  // a call passing a wrong rate still stores the vehicle's real rate
})
it('creates a lead whose status is new', async () => {
  /* status === 'new' */
})
it('leaves the vehicle available to the next visitor', async () => {
  // after the lead exists, app.public_booking_vehicles still reports is_available true
  // for the same window — a request holds nothing
})
```

- [ ] **Step 2: Run and watch fail**
- [ ] **Step 3: Write the migration.** The function has no price parameters at all — the snapshot is read from `vehicles` inside it. The reference follows the format `rentals.reference` already uses.
- [ ] **Step 4: Run and watch pass**
- [ ] **Step 5: Commit** — `feat: accept a booking request from outside the product`

---

### Task 6: Converting a lead

**Files:**

- Create: `supabase/migrations/20261113100500_booking_lead_conversion.sql`
- Test: `supabase/tests/booking-lead-conversion.test.ts`

**Interfaces:**

- Consumes: `public.booking_leads` (Task 3), `public.rental_period_conflicts`.
- Produces: `public.convert_booking_lead(p_lead_id uuid, p_customer_overrides jsonb default '{}'::jsonb)` → `table(customer_id uuid, rental_id uuid)`. `security definer`, gated on `app.has_min_role(organization_id, 'staff')` and therefore on a second factor. One transaction: customer, rental, lead marked converted.

- [ ] **Step 1: Write the failing tests**

```ts
it('creates one customer and one rental', async () => {
  /* both exist, rental.customer_id matches */
})
it('refuses a lead that is already converted', async () => {
  // second call raises; still exactly one rental for that lead
})
it('refuses when the vehicle is no longer free for those dates', async () => {
  // a confirmed rental now overlaps; raises and creates nothing
})
it('prices the rental from the vehicle now, not from the snapshot', async () => {
  // rate changed after the lead; rental carries the current rate
})
it('is refused at aal1', async () => {
  /* password-only session raises */
})
```

- [ ] **Step 2: Run and watch fail**
- [ ] **Step 3: Write the migration.** The lead's own row is locked (`for update`) before the status check, so two clicks cannot both pass it.
- [ ] **Step 4: Run and watch pass**
- [ ] **Step 5: Commit** — `feat: turn a lead into a customer and a rental`

---

### Task 7: Telling the agency

**Files:**

- Create: `supabase/migrations/20261113100600_booking_lead_notifications.sql`
- Test: `supabase/tests/booking-lead-notifications.test.ts`

**Interfaces:**

- Consumes: `app.public_booking_create_lead` (Task 5), `public.notification_events`.
- Produces: `notification_kind` gains `'booking_lead_received'`. The lead write records one event per lead, recipients being active owners and administrators.

- [ ] **Step 1: Write the failing tests**

```ts
it('records one event per lead', async () => {
  /* exactly one row, kind booking_lead_received */
})
it('reaches owners and administrators only', async () => {
  /* staff and manager are not recipients */
})
it('carries no renter contact details in the event', async () => {
  // context jsonb has no email, phone, or full name
})
```

- [ ] **Step 2: Run and watch fail**
- [ ] **Step 3: Write the migration.** Enum value added in its own statement before use, matching how `20260822100000` guards the type.
- [ ] **Step 4: Run and watch pass**
- [ ] **Step 5: Commit** — `feat: notify an agency that a request arrived`

---

### Task 8: Retention

**Files:**

- Create: `supabase/migrations/20261113100700_booking_lead_retention.sql`
- Modify: `.github/workflows/account-closure.yml`
- Test: `supabase/tests/booking-lead-retention.test.ts`

**Interfaces:**

- Produces: `app.purge_expired_booking_leads()` → `integer` (rows removed). Removes unconverted leads older than 12 months. `service_role` only.

- [ ] **Step 1: Write the failing tests**

```ts
it('removes an unconverted lead older than twelve months', async () => {
  /* returns 1 */
})
it('keeps a converted lead of any age', async () => {
  /* returns 0, row remains */
})
it('keeps an unconverted lead one day short of twelve months', async () => {
  /* returns 0 */
})
```

- [ ] **Step 2: Run and watch fail**
- [ ] **Step 3: Write the migration and add the call to the existing scheduled workflow.** No new scheduler — `pg_cron` is deliberately not installed.
- [ ] **Step 4: Run and watch pass**
- [ ] **Step 5: Commit** — `feat: stop holding a stranger's details forever`

---

### Task 9: The public surface, decisions

**Files:**

- Create: `supabase/functions/_shared/public-booking.ts`, `supabase/functions/_shared/public-booking-rates.ts`
- Test: `supabase/functions/tests/public-booking.test.ts`, `supabase/functions/tests/public-booking-rates.test.ts`

**Interfaces:**

- Consumes: Tasks 4 and 5 by name, through injected effects.
- Produces:
  - `parseBookingQuery(url: URL): BookingQuery | BookingError` — validates slug and the date window.
  - `parseRequestBody(raw: unknown): RequestSubmission | BookingError` — validates the four fields and the honeypot.
  - `serveBooking(deps: BookingDeps, request: BookingQuery): Promise<BookingDecision>` — `{ status, body }`.
  - `serveRequest(deps: BookingDeps, submission: RequestSubmission): Promise<BookingDecision>`
  - `checkRate(state: RateState, key: string, now: number): RateVerdict` in the rates module.

- [ ] **Step 1: Write the failing tests**

```ts
it('refuses a window whose return is before its pick-up', () => {
  /* 400 */
})
it('refuses a window starting in the past', () => {
  /* 400 */
})
it('refuses a window longer than the maximum', () => {
  /* 400 */
})
it('answers 404 identically for an unknown slug and a switched-off agency', () => {
  // byte-identical bodies
})
it('omits any count of unavailable vehicles from the body', () => {
  /* no totals field */
})
it('rejects a submission whose honeypot is filled', () => {
  /* 400, no write attempted */
})
it('rejects a submission faster than the minimum time on form', () => {
  /* 400 */
})
it('rate limits by email address and by IP independently', () => {
  /* both keys enforced */
})
```

- [ ] **Step 2: Run and watch fail** — `npm run test -- public-booking`
- [ ] **Step 3: Implement both modules.** Effects are injected as in `_shared/public-pricing.ts`; neither module imports a Supabase client directly.
- [ ] **Step 4: Run and watch pass**
- [ ] **Step 5: Commit** — `feat: decide what the public booking surface answers`

---

### Task 10: The public surface, entrypoint

**Files:**

- Create: `supabase/functions/public-booking/index.ts`
- Modify: `supabase/config.toml`

**Interfaces:**

- Consumes: Task 9's exports.
- Produces: `GET /public-booking?slug=&from=&to=` and `POST /public-booking`. Signed URLs for the logo and vehicle images are minted here with the service role, TTL 300 seconds, matching `SIGNED_URL_TTL_SECONDS`.

- [ ] **Step 1: Write the shim.** Dispatch on method, build effects, hand to `_shared`. No branch that a test cannot reach, per the comment at the top of `pricing/index.ts`.
- [ ] **Step 2: Add `[functions.public-booking] verify_jwt = false`** to `supabase/config.toml` with a comment saying why, following the `pricing` entry.
- [ ] **Step 3: Run `npm run verify`** — expected: green.
- [ ] **Step 4: Commit** — `feat: serve the public booking endpoint`

---

### Task 11: The booking page

**Files:**

- Create: `src/pages/booking/BookingPage.tsx`, `src/features/booking/api.ts`, `src/features/booking/dates.ts`, `src/features/booking/components/VehicleCard.tsx`
- Modify: `src/app/routes/paths.ts`, `src/app/routes/guards.tsx`
- Test: `src/features/booking/dates.test.ts`, `src/pages/booking/booking-page.test.tsx`

**Interfaces:**

- Consumes: Task 10's endpoint.
- Produces: route `booking: '/book/:slug'` and `bookingPath(slug)`. `defaultWindow(timeZone: string, now: Date): { from: Date; to: Date }` — tomorrow, three days.

- [ ] **Step 1: Write the failing tests**

```ts
it('renders vehicles without asking for dates first', async () => {
  /* cards present on first paint */
})
it('shows a dimmed card reading exactly "not free for these dates"', async () => {})
it('shows no count of how many vehicles are unavailable', async () => {})
it('renders outside the workspace and second-factor guards', async () => {
  // no redirect to sign-in or enrolment
})
it('shows "To book, please call us" with the phone number when requests are off', async () => {})
```

- [ ] **Step 2: Run and watch fail**
- [ ] **Step 3: Build the page.** The route is registered above `RequireAuth`, beside `/terms` and `/privacy`.
- [ ] **Step 4: Run and watch pass**
- [ ] **Step 5: Commit** — `feat: show an agency's fleet to the public`

---

### Task 12: Requesting a car

**Files:**

- Create: `src/features/booking/components/RequestForm.tsx`
- Modify: `src/pages/booking/BookingPage.tsx`
- Test: `src/features/booking/components/request-form.test.tsx`

**Interfaces:**

- Consumes: Task 10's `POST`, Task 11's page.
- Produces: the confirmation state, carrying the reference, the car, the dates, the total, the agency's phone number, and the sentence that the car is not held.

- [ ] **Step 1: Write the failing tests**

```ts
it('asks for name, email and phone and nothing else', async () => {
  // no date of birth, licence, or file input anywhere in the form
})
it('says the request is not confirmed and the car is not held', async () => {})
it('keeps what was typed when the request fails', async () => {})
it('carries a honeypot field hidden from assistive technology', async () => {})
```

- [ ] **Step 2: Run and watch fail**
- [ ] **Step 3: Build the form.**
- [ ] **Step 4: Run and watch pass**
- [ ] **Step 5: Commit** — `feat: let a renter ask for a car`

---

### Task 13: The Leads section

**Files:**

- Create: `src/pages/leads/LeadsPage.tsx`, `src/features/leads/api.ts`, `src/features/leads/components/LeadTable.tsx`
- Modify: `src/app/routes/paths.ts`, the navigation in `src/features/workspace/`
- Test: `src/features/leads/leads.test.ts`, `src/features/leads/components/lead-table.test.tsx`

**Interfaces:**

- Consumes: `public.booking_leads` (Task 3).
- Produces: route `leads: '/leads'`. `overlappingLeadIds(leads: Lead[]): Set<string>` — live leads sharing a vehicle and an overlapping window.

- [ ] **Step 1: Write the failing tests**

```ts
it('lists new leads oldest first', async () => {})
it('flags two live leads on the same vehicle with overlapping dates', async () => {})
it('does not flag leads on the same vehicle with separate dates', async () => {})
it('does not flag a converted lead against a new one', async () => {})
it('lets a manager delete a lead and a staff member not', async () => {
  // the DPA promises an agency can act on a renter's own request;
  // without this button that promise is empty
})
```

- [ ] **Step 2: Run and watch fail**
- [ ] **Step 3: Build the page and the table.**
- [ ] **Step 4: Run and watch pass**
- [ ] **Step 5: Commit** — `feat: give staff somewhere to work booking requests`

---

### Task 14: Converting, in the product

**Files:**

- Create: `src/features/leads/components/ConvertLeadDialog.tsx`
- Modify: `src/pages/leads/LeadsPage.tsx`, `src/features/leads/api.ts`
- Test: `src/features/leads/components/convert-lead-dialog.test.tsx`

**Interfaces:**

- Consumes: `public.convert_booking_lead` (Task 6).

- [ ] **Step 1: Write the failing tests**

```ts
it('warns when the vehicle rate has moved since the request', async () => {
  // both figures shown; neither applied silently
})
it('explains plainly when the vehicle is no longer free', async () => {})
it('cannot be submitted twice', async () => {
  /* disabled while in flight */
})
it('lands on the new rental when it succeeds', async () => {})
```

- [ ] **Step 2: Run and watch fail**
- [ ] **Step 3: Build the dialog.**
- [ ] **Step 4: Run and watch pass**
- [ ] **Step 5: Commit** — `feat: confirm a booking request`

---

### Task 15: Turning it on

**Files:**

- Create: `src/features/settings/components/BookingPageCard.tsx`
- Modify: `src/features/vehicles/components/VehicleForm.tsx`, `src/pages/settings/SettingsPage.tsx`
- Test: `src/features/settings/components/booking-page-card.test.tsx`

**Interfaces:**

- Consumes: Task 2's columns, Task 11's `bookingPath(slug)`.

- [ ] **Step 1: Write the failing tests**

```ts
it('shows the public link and copies it', async () => {})
it('explains why the switch is unavailable on a plan without it', async () => {})
it('is hidden from staff and managers', async () => {})
it('shows a vehicle toggle that defaults to off', async () => {})
```

- [ ] **Step 2: Run and watch fail**
- [ ] **Step 3: Build the card and the toggle.**
- [ ] **Step 4: Run and watch pass**
- [ ] **Step 5: Commit** — `feat: let an agency switch its booking page on`

---

### Task 16: The legal pages

**Files:**

- Modify: `src/pages/legal/PrivacyPolicyPage.tsx`, `src/pages/legal/DataProcessingPage.tsx`, `src/pages/legal/legal-config.ts`
- Test: `src/pages/legal/legal-pages.test.tsx`

**Interfaces:**

- Consumes: Task 1's separate dates.

- [ ] **Step 1: Write the failing tests**

```ts
it('says what happens to details a renter submits themselves', async () => {})
it('names the agency as controller of a booking request', async () => {})
it('states how long an unconverted request is kept', async () => {
  /* twelve months */
})
it('leaves the Terms date untouched', async () => {})
```

- [ ] **Step 2: Run and watch fail**
- [ ] **Step 3: Write the copy.** The renter is the agency's data subject; Pevvy processes on the agency's instructions, as everywhere else in the DPA.
- [ ] **Step 4: Run `npm run verify`**
- [ ] **Step 5: Commit** — `docs: say what happens to a booking request`

---

### Task 17: The two emails

**Files:**

- Create: `supabase/functions/_shared/booking-lead-email.ts`
- Modify: `supabase/functions/public-booking/index.ts`, `scripts/build-email-templates.mjs`
- Test: `supabase/functions/tests/booking-lead-email.test.ts`, `supabase/tests/email-templates.test.ts`

**Interfaces:**

- Consumes: Task 5's return value, Task 7's recipients, Task 9's `BookingDecision`.
- Produces: `renterAcknowledgement(lead: LeadSummary, agency: AgencySummary): EmailMessage` and `agencyNotification(lead: LeadSummary, agency: AgencySummary): EmailMessage`. Sent inline from the entrypoint after a successful write, following `account-closure-notice` — nothing in this deployment drains a queue.

- [ ] **Step 1: Write the failing tests**

```ts
it('never puts the renter note in the acknowledgement', () => {
  // a note containing a URL and a sentence appears nowhere in the body
})
it('tells the renter the car is not held', () => {})
it('puts no renter name, email or phone in the agency email', () => {
  // body and subject carry the vehicle, the dates and a link — nothing else
})
it('sends the agency email to active owners and administrators only', () => {})
it('sends one acknowledgement per request', () => {
  /* a retry does not send a second */
})
```

- [ ] **Step 2: Run and watch fail** — `npm run test -- booking-lead-email`
- [ ] **Step 3: Build both messages and wire them into the entrypoint.** A send that fails must not fail the request — the lead already exists and the renter has their confirmation on screen.
- [ ] **Step 4: Run `npm run verify`**
- [ ] **Step 5: Commit** — `feat: tell both sides a request arrived`

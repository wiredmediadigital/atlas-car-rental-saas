# Public booking requests — design

**Date:** 13 November 2026
**Status:** design, awaiting approval

---

## Why this exists

Every vehicle in Pevvy is invisible to the public. An agency can see its own fleet
and its own availability; nobody else can see either. An agency with a website has
nothing to link to — no page that says "here is what we rent, and here is what is
free next weekend." They answer that question on the phone, one caller at a time.

This gives each agency a page they can link to from their own site: their fleet,
their availability, their prices, served by Pevvy, wearing their name. A renter who
likes what they see can ask for a car. The asking is the smaller half. **The point
is the window.**

---

## What it is

An agency keeps its own website. Somewhere on it is a link — "Book now", "Our
fleet" — that lands the renter on a page Pevvy serves, found by the agency's
existing `organizations.slug`, showing the agency's name and logo rather than
Pevvy's.

The page shows vehicles immediately. Dates are already filled in with a sensible
default window, so nobody arrives at an empty form, and every price on the page is
a real total for those days rather than a "from" figure that changes later. Change
the dates and the list re-prices.

Every vehicle the agency has opted in appears on the page, always. The dates decide
which ones can be requested, never which ones exist. A vehicle that cannot be
requested for the chosen dates is shown, dimmed, saying only **"not free for these
dates"** — never when it frees up, never why it is out, so a car in for repairs
looks identical to a car on hire.

Requesting one asks for a name, an email, a phone number and an optional note.
Nothing else. The renter is told plainly that this is a request, that it is not
confirmed, and that the car is not being held for them, with the agency's phone
number beside that sentence.

Inside Pevvy the request arrives in a new **Leads** section. Staff work it the way
they work an enquiry today — ring the person, take the licence details, judge
whether they will rent to them. When the renter agrees, one button turns the lead
into the real thing: a customer record is created, a rental is written against that
customer and vehicle, and the lead is marked converted.

---

## Goals

- An agency has a public address they can link to that shows their fleet and their
  real availability.
- A renter can see what is available and ask for it without phoning.
- Staff learn about a request quickly and can act on it in one place.
- Nothing about the existing product's security posture is weakened to achieve it.

## Non-goals

These are deliberately out, not forgotten:

- **Payment of any kind.** No deposits, no card capture, no Stripe Connect. Money
  between renter and agency stays exactly where it is today.
- **Renter accounts.** No sign-in, no password, no "my bookings", no link between a
  renter and an `auth.users` row.
- **Automatic confirmation.** A human allocates every car. The page never promises
  one.
- **Licence and identity capture.** No date of birth, no licence number, no
  document upload from the public page.
- **SMS**, and any promised response time the agency has not agreed to.
- **Embedding.** No iframe or JavaScript widget for the agency's own site. They
  link out.
- **Discovery.** This is not a marketplace and not a directory. There is no page
  listing agencies, and no search across them. Traffic arrives from the agency's own
  site.
- **Extras, taxes and discounts in the quoted price** (see "Open to the builder").

## Anti-goals

Ways this fails even if every part works:

- **The page makes an agency look shut.** No vehicles opted in, everything out that
  week, a date range with nothing free — each must read as "nothing free for these
  dates, try others, here is the phone number," not as a broken or abandoned site.
- **A stranger can take an agency's fleet off the market.** Any design where a
  public action makes a vehicle unavailable to other renters is wrong.
- **Renter personal data leaks out of the protected product** — into email bodies,
  into URLs, into anything that a password alone can reach.
- **Enquiries pollute the customer list.** A request is not a customer until a
  person decides it is.

---

## Constraints the builder cannot design around

**1. The public surface cannot use row-level security.** Every table policy in
Pevvy reads `for select to authenticated using (app.is_org_member(organization_id))`,
and since 12 November `app.is_org_member` is `app.has_second_factor() and exists
(...)`. A renter fails that twice: they are not a member of the organization, and
they will never hold `aal2`. The `anon` role has had its default grants
deliberately stripped — several migrations exist purely to do that.

So everything the public page reads or writes goes through narrow `security
definer` functions with their own contract, and never through table access. The
tables keep saying "staff, with a second factor," which is correct and must stay
that way.

**1a. `anon` gets no database grants at all.** The obvious shape — grant `anon`
execute on the new functions — would quietly retire a posture this product has
stated and self-checked since August: `20260814110000_function_privileges.sql` and
`20260814120100_customer_read_models.sql` both end by raising if any function in
`public` is reachable by `anon`.

Instead, **a single Edge Function is the whole public surface.** The browser talks
only to it. It holds the service role, calls the definer functions, and is the one
place where rate limiting, abuse control and request shaping live. The database
keeps its existing answer to the anonymous role, which is nothing.

This also settles something the first draft got wrong. **Images cannot come from a
`security definer` SQL function** — every bucket in this product is private
(`organization-logos` and `vehicle-photos` are both created `public = false`), SQL
cannot mint a signed URL, and `anon` has no storage policy. The Edge Function mints
short-lived signed URLs for the logo and for the photos of opted-in vehicles only,
exactly as the signed-in product already does. No new world-readable bucket, no
second copy of any file, and no loosening of the storage policies — the boundary
does not move.

**2. `public.vehicles_available_between` cannot be called directly by the public.**
It is `security invoker` and returns `setof uuid`, so for `anon` it reads nothing.
The public availability function calls it as definer and projects a deliberately
narrow row.

**3. Narrow projections are a requirement, not a preference.** The public functions
return only what a stranger may see: make, model, year, category, transmission,
fuel, seats, doors, a photo, and the price for the chosen dates. Never registration
plates, VINs, odometers, costs, documents, insurance or service dates, customer
names, or any other rental.

**4. No utilisation figure anywhere on the page.** No "7 of 11 free", no count of
what is out. The cards already tell the renter what they need; a headline occupancy
number is the one genuinely useful fact to a competitor.

**5. This is the first endpoint in Pevvy reachable without a password and a second
factor.** Rate limiting and abuse control on the write path are part of the feature,
not a follow-up.

**6. Migrations are append-only.** New migration files, never edits to existing
ones.

**7. The legal pages need updating as part of this work.** The published privacy
policy and DPA describe Pevvy as processing records _the agency_ puts in. A renter
typing their own details into a page Pevvy serves changes that, and the documents
have to say so before the feature is live.

The three legal documents currently share one `lastUpdated` date in
`legal-config.ts`, and `app.current_terms_version()` returns that same string, with
a test failing if they drift. **Split them.** The privacy policy and the DPA get
their own date; `current_terms_version()` tracks the Terms alone.

The reason is the distinction the sign-up checkbox already makes: you _agree to_ the
Terms and you _have read_ the Privacy Policy. A notice is not accepted, so amending
one must not churn the version of something that was. With the dates split, this
work needs no re-acceptance flow — only the notice to existing agencies.

---

## Decisions already made

Decided in conversation, with the reasoning, so nobody relitigates them:

| Decision                                                   | Why                                                                                                                                                                                    |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pevvy-served page under the agency's slug, not an embed    | The vehicles come from the agency's Pevvy account; a link-out keeps one source of truth and no cross-site code                                                                         |
| Fleet visible on arrival, dates prefilled                  | The reason for building this is that the fleet is invisible; a page that waits for dates is an empty window                                                                            |
| Whole opted-in fleet always shown, unavailable ones dimmed | A busy agency showing two cars looks like a two-car agency — that is the failure mode of the goal itself                                                                               |
| Dimmed card says only "not free for these dates"           | Limits what occupancy a passer-by can read, and makes maintenance indistinguishable from hire                                                                                          |
| Real totals for the chosen dates, never "from" prices      | A price that changes when the renter gets specific is the dead end this design exists to avoid                                                                                         |
| Opt-in per vehicle                                         | Nothing reaches the public by accident; agencies keep cars back for trade or family use                                                                                                |
| Name, email, phone, optional note — nothing more           | The request is an enquiry; licence and identity stay with the person at the counter, and declining a request should not leave you holding a stranger's licence number                  |
| No hold on the vehicle                                     | A public form that reserves inventory lets a stranger empty a fleet with a script, and there is no account to ban                                                                      |
| Staff confirmation is what allocates                       | Matches how agencies work today; the occasional "sorry, just gone" is the same disappointment a late phone call already produces                                                       |
| Requests land in Leads, not as draft rentals or customers  | A rental cannot exist without a `customer_id`, and an enquiry should not mint a half-filled customer record                                                                            |
| Availability re-checked at the moment of confirmation      | `public.rental_period_conflicts` already exists; a lead confirmed late must fail cleanly rather than double-book                                                                       |
| Agency notification email carries no renter data           | Mandatory 2FA would be undone for every lead if contact details were piped into whatever inbox the agency uses. The email says a request arrived and links into Pevvy; Pevvy shows who |
| Renter email never echoes their own free-text note         | A form that mails arbitrary text to an address a stranger typed is a spam relay                                                                                                        |

---

## Billing, plans and closure

**This is a paid feature, gated by plan the way vehicle limits are**
(`20261109100000_plan_vehicle_limits.sql`). Which plans include it is configuration,
set the same way the vehicle allowances are.

**When an agency's billing is restricted, the page keeps serving and stops taking
requests.** The existing rule already says the right thing — a restricted agency
keeps what it can read and loses what it can write — so apply it literally. The
fleet still shows, the prices still show, and the Request button is replaced by "To
book, please call us" beside the agency's number. Nobody is stranded, nothing looks
broken, and a non-paying agency is not quietly still selling. A lead is therefore
**not** added to the `app.billing_require_write` exempt list; it follows the normal
restriction, and `supabase/tests/billing-restricted-access.test.ts` should say so.

Worth knowing while building: `past_due` and `incomplete` are deliberately _not_
restricted, so an agency in the middle of a card retry never hits any of this.
Restriction means `unpaid`, `canceled` or `incomplete_expired`.

**Once closure is requested, the page stops entirely** and serves a neutral "this
page is no longer available." An agency that has asked to shut should not still have
Pevvy advertising on its behalf. After deletion there is nothing to serve.

---

## Anti-abuse

**First-party only. No CAPTCHA vendor in the first build.** Rate limit by IP and by
email address, add a honeypot field and a minimum time-on-form, and cap requests per
agency per hour. All of it lives in the Edge Function that fronts the feature.

The reason is not purity: a third-party challenge is a new subprocessor appearing on
a page agencies send their own customers to, and the privacy policy names its
subprocessors in a list a test pins, while the DPA promises agencies are told before
a new one starts processing. Turnstile or hCaptcha remains a contained addition if
real abuse appears — made deliberately, with that disclosure done.

**The renter gets one acknowledgement email per request**, fixed template, capped per
address per day, never echoing their own note. It is deliberately **not** gated
behind a confirmation link: a token table, an expiry and a second public endpoint is
a lot of machinery to buy protection the rate limiting already provides, and it
delays the one thing the feature exists for — staff seeing the request quickly.

---

## How long a lead lives

**Twelve months from creation for anything not converted**, then purged. Long enough
that an agency can say "you enquired last spring," short enough that strangers'
contact details are not held indefinitely. Staff can delete one sooner, and leads
are in the account-closure purge lists.

Nothing in this deployment sweeps on a schedule — `pg_cron` is deliberately not
installed — so the purge rides the existing `.github/workflows/account-closure.yml`
run rather than introducing a second scheduler.

---

## My calls, not theirs

Settled while writing this up. Worth a glance — they are reversible:

- **A master switch per agency**, alongside the per-vehicle opt-in, with the public
  link shown in Settings so the agency can copy it. Without one, an agency cannot
  turn the page off without un-ticking every vehicle.
- **Opted-in vehicles in `maintenance` or `unavailable` status render as "not free
  for these dates"** like any other unavailable car, rather than being hidden. One
  rule, one appearance, nothing to infer.
- **Lead states:** new, contacted, converted, declined, lapsed. Enough to work a
  queue; fewer than a CRM.
- **Overlapping live leads on the same vehicle and dates are flagged to staff**,
  because that is the moment speed matters.
- **The quoted total is the vehicle's daily rate times the billable days**, shown as
  an estimate the agency confirms.
- **The lead stores a price snapshot** — rate, days, total, currency — taken when
  the request was made. The rental is priced fresh at conversion from the vehicle's
  current rate, and staff are warned when the two differ rather than silently
  getting one or the other. Adding price columns later is awkward under the
  append-only migration rule, so they go in from the start.
- **A lead records a `notification_events` row** so it reaches the existing in-app
  feed, and the same Edge Function sends the agency email inline — the pattern
  `account-closure-notice` already uses, because nothing in this deployment sweeps
  a queue (`pg_cron` and `pg_net` are deliberately not installed).
- **The agency email goes to every active owner and administrator**, not to
  `organizations.email`, which is frequently a shared address nobody watches. No
  digesting in the first build, but a per-agency cap on notification mail per hour
  so a burst of leads cannot become a burst of mail.
- **Leads join the account-closure purge lists.** `20261110100400` and its test
  require the lists to agree, and a new table holding personal data is exactly what
  that check exists for. Staff can also delete an individual lead — the DPA promises
  an agency can act on a renter's own request, and without a delete action that
  promise is empty.

---

## Open to the builder

- Exact function signatures, table and column names, and migration ordering.
- How the default date window is chosen, and how it behaves in the agency's
  timezone.
- The rate-limiting and anti-abuse mechanism, and where it lives.
- Page layout within Pevvy's existing design system, responsive behaviour, and
  accessibility.
- Pagination or lazy loading if a fleet is large.
- Currency and date formatting for the agency's locale.
- Whether extras, taxes and discounts ever reach the quote, and what the page says
  about them in the meantime.
- Which roles may see and act on leads.

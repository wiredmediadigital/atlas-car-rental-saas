# Pevvy Help Centre — Design

**Date:** 2026-11-06
**Status:** Approved 2026-11-06
**Author:** drafted with Claude, from conversation with the Pevvy owner

---

## Intent

Pevvy has twelve modules and four roles, and nothing in the product that teaches
an agency's staff how to use it. A new front-desk hire who is handed a login
today has the README (written for the person *deploying* Pevvy) or nothing.

This builds a public Help Centre at `/help` — one page per tab of the app
sidebar — so that a person who is stuck mid-task can find the one answer they
need and get back to work.

### Why now

There is no support backlog driving this; the owner's words were "I havent been
asked for question right now, just want to create an help page." So this is
pre-emptive, which shapes two things:

- There is no list of known problem areas to prioritise. Coverage is therefore
  even across modules rather than weighted toward known pain.
- The content is derived from what the code actually does, not from recorded
  support conversations. Accuracy against the codebase is the quality bar.

### What success looks like

A staff member with a question can reach a correct answer in under a minute,
without asking a colleague and without the owner writing the answer twice.

---

## Audience

**Agency staff only.** People inside a tenant: owners, administrators, managers
and front-desk staff running a car rental business on Pevvy.

**Explicitly not** the self-hosting deployer. `README.md`, `RELEASE.md` and
`supabase/README.md` already serve that person and stay exactly where they are.
Mixing the two audiences is the single most common way SaaS documentation
becomes unreadable, and it is a named anti-goal below.

---

## Goals

1. One page per sidebar tab, grouped exactly as the app groups them, so a reader
   can find a page from where they are standing in the product.
2. Task-shaped prose — "Hand the vehicle over", not "Handover feature".
3. Reachable without signing in.
4. Every page states plainly which roles can do the thing it describes.
5. Editing help text is editing prose, not editing React.

## Non-goals

- Deployment, hosting, Supabase, Stripe or Wialon configuration.
- An API reference or any developer-facing documentation.
- Per-tenant or white-labelled help content.
- Translations. English only in v1.
- Video walkthroughs.
- A ticketing, chat or contact-form system.

## Anti-goals

Things that would make this a failure even if it shipped and technically worked:

- **It becomes a second README.** The moment deployment instructions appear at
  `/help`, the audience separation is gone and both audiences are worse off.
- **It goes stale silently.** Documentation that confidently describes a flow
  the product no longer has is worse than no documentation.
- **It leaks.** A screenshot containing a real customer name, licence number,
  plate or address, published on a public URL. Since the owner has asked for
  screenshots, this is the sharpest risk in the whole piece of work, and the
  demo-agency rule below exists specifically to close it.
- **It is unfindable.** Pages nobody can reach from inside the app are close to
  worthless, however well written.

---

## Constraints

Established by reading the codebase:

- **`/` is already overloaded.** `RequireAuth publicHome={<MarketingHomePage/>}`
  serves the marketing page to signed-out visitors and the Overview to
  signed-in ones. Help must sit *outside* every guard, the way
  `paths.acceptInvite` does, so it resolves identically in both states.
- **Routes live in one file.** `src/app/routes/paths.ts` is the single source of
  route strings; new paths are added there, never inline.
- **Routes are code-split deliberately.** The router's comments are explicit
  that a signed-out visitor must not download the authenticated shell. Help must
  be its own lazy chunk and must not import `AppShell` or any feature module.
- **The permission matrix is machine-readable.** `src/lib/authz/permissions.ts`
  exports `PERMISSIONS` as `<resource>.<action>` → minimum role, plus
  `ROLE_LABELS` and `ROLE_DESCRIPTIONS`. It mirrors the RLS policy matrix and is
  tested against live Postgres policies for drift.
- **Build and checks are fixed.** Vite + React 19 + TypeScript, Tailwind,
  Prettier, ESLint, Vitest. `npm run verify` must stay green.
- **No new backend.** Static build out of `dist/`; no Supabase tables,
  migrations or Edge Functions. Security boundaries are out of scope, per
  `CLAUDE.md`.

---

## Decisions already made

These were settled in conversation. The builder implements them rather than
reconsidering them.

### Public, not behind sign-in

`/help` is readable by anyone. The deciding case is Pevvy's own invitation flow:
an invitee clicking an invite email is not signed in, and the page they most
need — accepting the invitation and setting a password — is precisely the one an
authenticated help centre would hide. Password-reset failures have the same
shape. Public docs also serve prospects and are indexable.

The cost is that the sidebar cannot be personalised per role. That is accepted
deliberately: see "Role labels" below.

### Layout: card index, article pages beneath

The owner picked the card-grid front door in the browser mockup and the classic
docs layout in the terminal. Both ship, because they are different levels:

- **`/help`** — a grid of cards, one per navigation group, plus search.
- **`/help/<page>`** — persistent left sidebar (full tree, grouped as the app
  groups it), article in the centre, "On this page" jump links on the right.

Mockups are in `.superpowers/brainstorm/449-1793994446/content/`
(`layout.html`, `anatomy.html`). That directory is git-ignored; it is a
reference for the builder, not an artefact to maintain.

### Content is Markdown

Pages are Markdown files in the repo, rendered by one layout component. Editing
a help page is editing prose. Writing pages as React components is rejected: it
puts a build-and-review cycle between the owner and a typo fix.

### A client-rendered route, not a prerendered site

An earlier draft justified public access partly by "indexable", which overstated
what this build delivers. Pevvy is a single-`index.html` SPA: `public/.htaccess`
rewrites every non-file path to it, no route sets `document.title`, and there is
no robots.txt or sitemap.

v1 adds a per-route `<title>` and `<meta name="description">` set at runtime, a
robots.txt and a sitemap listing the help URLs. That is enough for modern
crawlers and is a small addition to a lazy route.

v1 does **not** add a prerender or static-site-generation step. Emitting
nineteen static HTML files would change the Markdown pipeline, the Vite build,
`npm run verify` and the `.htaccess` rewrite rules all at once — a different and
much larger job. If search traffic to help pages turns out to matter, that is a
deliberate follow-up, not something to smuggle in here.

### Help text survives rebranding

Pevvy is self-hosted and rebrandable: `VITE_APP_NAME` renames the running
product and `src/lib/config/brand.ts` exposes `getAppName()` for exactly this.
Markdown prose therefore uses a product-name token rather than the literal
string "Pevvy", resolved at render time through the same helper the rest of the
app uses. This is nearly free now and expensive to retrofit across nineteen
pages later.

The non-goal above rules out *per-tenant* help content. This is different: it is
one deployment's own name, resolved once.

Screenshots are the exception and cannot be tokenised — they carry the Pevvy
wordmark and colours as captured. See the open questions.

### Search is client-side

An index built from the Markdown at build time, searched in the browser. No
third-party search service: it would add an external dependency, a key to
manage and a per-tenant privacy question, for a corpus of roughly nineteen
pages.

### Screenshots, captured from a demo agency

The owner asked for screenshots, so pages carry them. The two real risks were
raised and accepted, and are managed rather than avoided:

**Leaking customer data.** Every screenshot is captured from a purpose-made demo
agency containing invented vehicles, customers and rentals. No screenshot is
ever taken against a live tenant, and no capture runs against a Supabase project
that holds real data. This is a hard rule, not a preference — the images are
published on a public URL.

**Going stale.** Mitigated by making recapture cheap rather than by capturing
less:

- Screenshots are illustrative, never load-bearing. The prose says what to do;
  the image shows what it looks like. A reader who ignores every image still
  gets a complete answer, and a slightly out-of-date image is then a cosmetic
  problem rather than a wrong instruction.
- Images never contain text the reader must read to follow a step — no
  screenshot of an error message standing in for quoting it.
- Capture is scripted, not manual, so a UI change means re-running the script
  rather than retaking nineteen pages of images by hand.
- Each image records the app version it was captured at, so staleness is
  visible to whoever maintains the pages.

**Capture mechanism: the owner supplies the images.** There is no scripted
capture, no demo Supabase project and no Playwright harness in this work. The
owner takes the screenshots and hands them over against a written shot list.

This removes the largest unknown in the original plan — `CLAUDE.md` forbids
running against any project not explicitly given, and there was no demo stack to
run against — and it replaces it with two obligations:

1. **The owner is the privacy control.** Images are captured from an agency
   holding invented data, or any real names, licence numbers, plates, addresses,
   phone numbers and email addresses are redacted before handover. This is
   stated plainly in the shot list, because these images go on a public URL and
   nothing downstream can detect a real customer name inside a PNG.
2. **Recapture is manual, so the shot list is the durable artefact.** It names
   each image, where it is taken and what must be visible, so a UI change means
   re-running a list rather than reconstructing what the images were.

The shot list lives at `docs/superpowers/specs/2026-11-06-help-screenshot-shot-list.md`.

Images are cropped to the region under discussion rather than full-page, served
at 2× for sharpness, lazy-loaded below the fold, given explicit dimensions to
avoid layout shift, and carry alt text describing what the image shows.

### Role labels, not hidden sections

Nothing is hidden. A manager who can see that transferring ownership is
owner-only knows who to ask; a manager who sees nothing files a support request.

**Labels are per task section, not per page.** Most modules span several minimum
roles — Team is `team.view: staff` but `team.invite: admin` and
`team.transferOwnership: owner`; Expenses is `view: staff`, `create: manager`,
`delete: admin`; Financing is `view: manager`, `create: admin`, `delete: owner`.
A single page-level label would be either true and useless ("Staff and above",
which describes who may open the page, not who may do the thing) or precise and
wrong for most of the page.

So each task section declares its own permission key and renders its own label.
A page-level label still appears under the title, derived from the view
permission, stating who can open the module at all.

A label is suppressed when the minimum is `staff`, since every member has it and
the label would be noise on the majority of sections.

### Content in two passes

Rentals, Vehicles and Team are written first, reviewed by the owner for tone and
accuracy, and only then are the remaining pages written. This exists so that a
voice disagreement costs three pages of rework instead of nineteen.

---

## The content

### Page inventory

Nineteen pages. Group names match `src/components/layout/navigation.ts`.

**Getting started**
1. How Pevvy is organised — agencies, the sidebar, roles, where things live
2. Accept your invitation and sign in — *must be useful to a signed-out reader*
3. Set up your agency — first run, logo, currency, details
4. Your first vehicle and your first rental — the shortest path to value

**Overview**
5. Overview — what the dashboard is counting and over what period

**Operations**
6. Rentals — quote, book, hand over, extend, substitute, close
7. Calendar — reading availability, spotting clashes
8. Customers — records, identity documents, additional drivers

**Fleet**
9. Vehicles — adding, status, documents, availability
10. GPS tracking — connecting a provider, assigning a device, reading positions

**Finance**
11. Expenses — recording a cost, allocation, receipts, voiding
12. Financing — agreements, schedules, how instalments reach Expenses
13. Reports — what each report answers, exporting

**Agency**
14. Team and roles — inviting, changing roles, removing, ownership transfer
15. Billing — subscription state, payment method, invoices
16. Settings — agency details, preferences
17. Notifications — what generates one, how to act on it

> Notifications is not a sidebar tab: `navigation.ts` has twelve items and the
> route is reached from the bell. It is grouped under Agency here because that
> is where a reader will look for it. Consequence: the help sidebar tree is
> hand-authored, not generated from `navigationGroups`.

**Reference**
18. Who can do what — the full role matrix
19. Troubleshooting — invitations not arriving, sign-in and reset problems,
    GPS not reporting, payment questions

### Page anatomy

Every module page, in this order:

1. Breadcrumb — `Operations › Rentals`
2. Title and a one-line statement of purpose
3. Role label
4. **In short** — a short box answering the most common visit without scrolling
5. One orientation screenshot of the module as the reader will first see it
6. Task sections, named as actions, each with a cropped screenshot where the
   step is hard to describe in words (a dialog, a picker, a signature pad) and
   none where it is not
7. **If it goes wrong** — the failure cases for that module
8. Next and related links

### Grounding

Content is written from the code, not from assumption. Worked example — the
Rentals page is accurate to `src/features/rentals/` and `src/types/database.ts`:
the lifecycle is `draft → reserved → active → completed → cancelled`; payment
status (`unpaid`/`partially_paid`/`paid`/`overpaid`) is tracked separately from
rental status, so a completed rental can still be unpaid; handover involves
condition photos, a captured signature and a generated contract PDF; extension
and vehicle substitution are distinct flows.

The same standard applies to every page. Where behaviour cannot be established
from the code, the builder asks rather than inventing.

### Role labels are derived, not typed

`PERMISSIONS` in `src/lib/authz/permissions.ts` already holds the minimum role
for every gated action and is kept honest against the database by its own test.
Help pages therefore name permission keys and never role names, and every label
is derived from `PERMISSIONS` + `ROLE_LABELS` at build time.

A page declares its view permission in front matter, and each task section
declares its own:

```yaml
---
title: Rentals
group: Operations
permission: rentals.view
---
```

```markdown
## Close a rental and take final payment
<!-- permission: rentals.update -->
```

The exact syntax for the per-section key is the builder's call — front matter on
a section, a directive, or a convention the Markdown loader recognises. What
matters is that the author writes a permission key and never a role name.

This is the one piece of mechanism worth insisting on. Hand-typed role labels
would be a second copy of the matrix, free to drift from the first; derived
labels cannot. If a permission key in front matter does not exist, the build
fails.

---

## Entry points

Pages nobody can reach are the named anti-goal, so these ship with v1.

**Correction to an earlier draft of this document:** there is no authenticated
top bar to put a `?` in. `AppShell`'s header is `lg:hidden`, and `Sidebar.tsx`
says why: *"The desktop layout has no top header and does not grow one for this:
a full-width bar for a single icon would cost every page a strip of vertical
space."* That decision stands. This work does not reverse it.

Instead:

- A **Help** entry in the sidebar footer, beside `UserMenu`, where the bell and
  the account menu already live.
- A contextual link to the module's help page via the existing `actions` slot on
  the shared `src/components/ui/PageHeader.tsx`, so one change reaches every
  module rather than twelve separate edits.
- A link in the marketing footer.
- A link on the invitation-acceptance and password-reset screens.

Deep links from empty states are a good idea and are explicitly **deferred** —
they touch many feature components individually and would widen this change
considerably. Routing the module link through `PageHeader` is what keeps this
entry point out of that category.

---

## Left to the builder

The following are genuinely open, and a sensible implementer should decide them
while building:

- The Markdown pipeline. A Vite Markdown plugin, MDX, or parsing at build time
  into a typed module — whichever fits the existing Vite config most quietly.
- The search index format and matching strategy.
- Component decomposition and file layout, within the repo's existing
  conventions (feature-grouped, under the 800-line ceiling).
- URL shape beneath `/help` — flat (`/help/rentals`) or grouped
  (`/help/operations/rentals`). Flat is suggested; it survives the nav being
  regrouped later.
- Exact wording throughout, subject to the two-pass review above.
- Image handling: where supplied images are committed, whether they are
  optimised or converted at build time, and how `2×` variants are produced from
  whatever the owner hands over.
- How a missing image behaves during authoring — pages should render with a
  visible gap rather than fail, so prose can be written before every screenshot
  has arrived.

### Checks

`npm run verify` stays green. Beyond that: unit tests for the Markdown loader,
the search index and the permission-label derivation (including the
fail-the-build case for an unknown permission key); a rendering test per page
group; and an accessibility pass on the sidebar and search, since this ships
publicly.

For screenshots specifically: a check that every image referenced by a Markdown
page exists and has alt text, and that every page expected to carry an
orientation image has one.

Note what cannot be automated. With the owner supplying images, no script stands
between a real customer's name and a public URL. The shot list carries the
redaction rule, and whoever commits the images reads each one before committing
it. That is a weaker control than a seeded demo project and the plan should not
pretend otherwise.

---

## Open questions for the owner

None outstanding. Everything the builder needs is settled.

---

## Answered by the owner

**The owner supplies the screenshots.** No demo Supabase project, no capture
script, no Playwright. Images are taken by hand against the shot list. The
privacy rule moves with them: invented data, or redaction before handover.

**GPS tracking, Billing and Reports get empty-state screenshots.** These three
cannot be populated from seed data — GPS needs Wialon credentials and a device
reporting positions, Billing needs Stripe state through the Edge Functions,
Reports needs real history. Rather than widen the capture harness with
third-party credentials, they are captured exactly as a new agency genuinely
sees them: "no provider connected", "no subscription". This is honest, costs
nothing extra, and is very often the state the reader is actually in when they
open that page and come looking for help.

The orientation-image check applies to these pages like any other — an
empty-state capture satisfies it.

**The support contact is `help@pevvy.io`.** The Troubleshooting page names it
where self-service runs out.

Two consequences for the builder. It is a single address serving every
deployment, so it is written as one constant that the Markdown references rather
than a string repeated across pages — a self-hoster who wants to point at their
own desk then has one line to change. And because it is published on a page
anyone can read, the page says plainly what that address is for: a problem with
Pevvy itself. A renter chasing a deposit, or a staff member who needs a
permission granted, is directed to their own agency's owner or administrator,
which is the honest answer in a multi-tenant product and keeps `help@pevvy.io`
from becoming the first line of support for every tenant's front desk.

**Screenshots stay Pevvy-branded.** Rebranded deployments will show the Pevvy
wordmark in help images. Accepted: the layouts still match what the reader sees,
and neutral-branded captures would look generic for the majority who do not
rebrand. The product-name token still applies to all prose.

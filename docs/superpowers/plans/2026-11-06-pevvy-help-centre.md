# Pevvy Help Centre Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a public Help Centre at `/help` — nineteen Markdown pages, one per app sidebar tab, with search, derived role labels and entry points from inside the product.

**Architecture:** Markdown files under `src/content/help/` are loaded eagerly through `import.meta.glob`, parsed by a hand-rolled front-matter parser, and rendered with `react-markdown`. Role labels are derived from the existing `PERMISSIONS` matrix rather than typed. The help routes sit outside every router guard in their own lazy chunk, so a signed-out visitor never downloads the authenticated shell.

**Tech Stack:** Vite 8, React 19, TypeScript, Tailwind, react-router-dom, Vitest. Two new runtime dependencies: `react-markdown`, `remark-gfm`.

**Spec:** `docs/superpowers/specs/2026-11-06-pevvy-help-centre-design.md`
**Shot list / image inventory:** `docs/superpowers/specs/2026-11-06-help-screenshot-shot-list.md`

## Global Constraints

- Help routes sit **outside every guard**, like `paths.acceptInvite`, and resolve identically signed in or out.
- Help must be its **own lazy chunk** and must not import `AppShell` or any module under `src/features/<module>/` other than `src/features/help/`.
- Every route string is added to `src/app/routes/paths.ts`; never written inline elsewhere.
- Markdown prose never contains the literal `Pevvy`. It uses the `{{productName}}` token, resolved through `getAppName()` from `src/lib/config/env.ts`.
- Markdown prose never names a role. It names a permission key from `PERMISSIONS` in `src/lib/authz/permissions.ts`.
- Support address is the single constant `SUPPORT_EMAIL = 'help@pevvy.io'`, referenced in prose as `{{supportEmail}}`.
- No Supabase tables, migrations or Edge Functions. No change to RLS, authorization functions or payment logic.
- Source files stay under the 800-line ceiling.
- `npm run verify` (format:check, lint, typecheck, vitest, build) stays green at every commit.

## Review Focus

Five conditions the spec implies that no task's happy path exercises. Each has a test, placed in the task that owns the code.

1. **Front matter missing `permission` or `group`** — the loader must throw naming the file, not render a page with an undefined label. *(Task 1)*
2. **An unknown help slug (`/help/nonsense`)** — must render a help-shaped not-found inside the help layout for a signed-out visitor, never fall through to a guarded route. *(Task 4)*
3. **A signed-out visitor deep-linking to `/help/rentals`** — renders fully, with no auth call and no redirect. *(Task 4)*
4. **`VITE_APP_NAME` unset or the environment invalid** — `{{productName}}` still resolves to the default product name, never an empty string or a visible token. *(Task 3)*
5. **An image referenced by Markdown that is not on disk** — the page renders with a visible gap and the rest of the prose intact, rather than throwing. *(Task 7)*

---

### Task 1: Markdown loading and front matter

**Files:**
- Create: `src/features/help/types.ts`
- Create: `src/features/help/frontmatter.ts`
- Create: `src/features/help/content.ts`
- Create: `src/content/help/rentals.md` (placeholder body; real prose lands in Task 10)
- Test: `src/features/help/frontmatter.test.ts`, `src/features/help/content.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface HelpFrontMatter { title: string; group: HelpGroup; permission: string; summary: string }`
  - `type HelpGroup = 'Getting started' | 'Overview' | 'Operations' | 'Fleet' | 'Finance' | 'Agency' | 'Reference'`
  - `interface HelpPage { slug: string; frontMatter: HelpFrontMatter; body: string }`
  - `parseFrontMatter(raw: string, fileName: string): { frontMatter: HelpFrontMatter; body: string }`
  - `loadHelpPages(): readonly HelpPage[]` — eager `import.meta.glob('../../content/help/*.md', { query: '?raw', import: 'default', eager: true })`, slug from basename
  - `getHelpPage(slug: string): HelpPage | undefined`

- [ ] **Step 1: Write the failing tests for `parseFrontMatter`**

```ts
test('parses title, group, permission and summary from front matter', () => {})
test('returns the body with the front matter block removed', () => {})
test('throws naming the file when the front matter block is absent', () => {})
test('throws naming the file and the missing key when permission is absent', () => {})
test('throws naming the file and the missing key when group is absent', () => {})
test('throws naming the file when group is not one of the seven known groups', () => {})
```

Assert the thrown message contains the `fileName` argument and the offending key.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/features/help/frontmatter.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/features/help/types.ts` and `parseFrontMatter` in `src/features/help/frontmatter.ts`**

Delimiter is a line of exactly `---`. Keys are `key: value`, one per line, values unquoted and trimmed. No nesting, no arrays — the four keys above are the whole schema. Reject rather than default anything.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/features/help/frontmatter.test.ts`
Expected: PASS

- [ ] **Step 5: Write the failing tests for `loadHelpPages` / `getHelpPage`**

```ts
test('loads every markdown file in src/content/help as a page', () => {})
test('derives the slug from the file name without its extension', () => {})
test('getHelpPage returns undefined for a slug with no file', () => {})
```

- [ ] **Step 6: Run to verify they fail, create `src/content/help/rentals.md` with valid front matter and a one-line placeholder body, implement `content.ts`, run to verify they pass**

Run: `npx vitest run src/features/help/content.test.ts`

- [ ] **Step 7: Commit**

```bash
git add src/features/help src/content/help
git commit -m "feat(help): load help markdown with validated front matter"
```

---

### Task 2: Role labels derived from the permission matrix

**Files:**
- Create: `src/features/help/permission-labels.ts`
- Create: `src/features/help/content-validation.test.ts`
- Test: `src/features/help/permission-labels.test.ts`

**Interfaces:**
- Consumes: `HelpPage` (Task 1); `PERMISSIONS`, `ROLE_LABELS`, `ROLE_DESCRIPTIONS`, `OrgRole` from `@/lib/authz/permissions`.
- Produces:
  - `type PermissionKey = keyof typeof PERMISSIONS`
  - `isPermissionKey(value: string): value is PermissionKey`
  - `roleLabelFor(permission: PermissionKey): string | null` — `null` when the minimum role is `staff`
  - `SECTION_PERMISSION_PATTERN: RegExp` matching `<!-- permission: <key> -->`
  - `sectionPermissions(body: string): readonly string[]`

- [ ] **Step 1: Write the failing tests**

```ts
test('returns null when the minimum role is staff', () => {
  expect(roleLabelFor('rentals.view')).toBeNull()
})
test('names the minimum role and above for a manager-minimum permission', () => {
  expect(roleLabelFor('expenses.create')).toBe('Manager and above')
})
test('names owner only for an owner-minimum permission', () => {
  expect(roleLabelFor('team.transferOwnership')).toBe('Owner only')
})
test('sectionPermissions extracts every permission comment in document order', () => {})
```

Copy the expected minimum roles from `PERMISSIONS` rather than assuming them.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/features/help/permission-labels.test.ts`

- [ ] **Step 3: Implement `permission-labels.ts`**

`roleLabelFor` reads the minimum from `PERMISSIONS`, maps through `ROLE_LABELS`, and returns `'Owner only'` for `owner`, `` `${label} and above` `` otherwise, `null` for `staff`.

- [ ] **Step 4: Run to verify they pass**

- [ ] **Step 5: Write the build-gate test in `content-validation.test.ts`**

This is the test that makes an unknown permission key fail `npm run verify`.

```ts
test('every page front-matter permission key exists in PERMISSIONS', () => {})
test('every section permission comment names a key that exists in PERMISSIONS', () => {})
test('every page declares one of the seven known groups', () => {})
```

Iterate `loadHelpPages()`; on failure the assertion message names the slug and the bad key.

- [ ] **Step 6: Run to verify it passes against the current content**

Run: `npx vitest run src/features/help/content-validation.test.ts`

- [ ] **Step 7: Commit**

```bash
git add src/features/help
git commit -m "feat(help): derive role labels from the permission matrix"
```

---

### Task 3: Token substitution for product name and support address

**Files:**
- Create: `src/features/help/constants.ts`
- Create: `src/features/help/tokens.ts`
- Test: `src/features/help/tokens.test.ts`

**Interfaces:**
- Consumes: `getAppName` from `@/lib/config/env`.
- Produces:
  - `SUPPORT_EMAIL = 'help@pevvy.io'` in `constants.ts`
  - `resolveTokens(markdown: string): string`

- [ ] **Step 1: Write the failing tests**

```ts
test('replaces every {{productName}} occurrence with the configured app name', () => {})
test('replaces {{supportEmail}} with SUPPORT_EMAIL', () => {})
test('leaves text containing no tokens unchanged', () => {})
test('falls back to the default product name when the environment is invalid', () => {})
```

The last one is **Review Focus item 4**: stub `getAppName` to its fallback path and assert the output contains `Pevvy` and no `{{`.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/features/help/tokens.test.ts`

- [ ] **Step 3: Implement `constants.ts` and `resolveTokens`**

Global replace of the two tokens. Unknown `{{...}}` sequences are left alone rather than blanked, so a typo is visible in review instead of silently vanishing.

- [ ] **Step 4: Run to verify they pass**

- [ ] **Step 5: Commit**

```bash
git add src/features/help
git commit -m "feat(help): resolve product-name and support-address tokens"
```

---

### Task 4: Help routes and the article page

**Files:**
- Create: `src/features/help/navigation.ts` (hand-authored tree — see the spec's page inventory)
- Create: `src/features/help/components/HelpLayout.tsx`
- Create: `src/features/help/components/HelpSidebar.tsx`
- Create: `src/features/help/components/HelpArticle.tsx`
- Create: `src/features/help/components/OnThisPage.tsx`
- Create: `src/pages/help/HelpArticlePage.tsx`
- Create: `src/pages/help/HelpNotFound.tsx`
- Modify: `src/app/routes/paths.ts`
- Modify: `src/app/routes/AppRouter.tsx`
- Test: `src/features/help/help-routing.test.tsx`

**Interfaces:**
- Consumes: `getHelpPage`, `loadHelpPages` (Task 1); `roleLabelFor`, `sectionPermissions` (Task 2); `resolveTokens` (Task 3).
- Produces:
  - `paths.help = '/help'`, `paths.helpArticle = '/help/:slug'`, `helpArticlePath(slug: string): string`
  - `HELP_NAVIGATION: readonly { group: HelpGroup; slugs: readonly string[] }[]`

- [ ] **Step 1: Install the two rendering dependencies**

```bash
npm install react-markdown remark-gfm
```

- [ ] **Step 2: Write the failing routing tests**

```tsx
test('renders the Rentals article for a signed-out visitor at /help/rentals', () => {})
test('makes no Supabase auth call while rendering a help article', () => {})
test('renders a help-shaped not found for /help/nonsense without redirecting', () => {})
test('renders the page title, breadcrumb group and the section role labels', () => {})
```

Tests two and three are **Review Focus items 3 and 2**. Render through `MemoryRouter` with no session; assert against a spy on the Supabase client that it was never called.

- [ ] **Step 3: Run to verify they fail**

Run: `npx vitest run src/features/help/help-routing.test.tsx`

- [ ] **Step 4: Add `help` and `helpArticle` to `paths.ts` with `helpArticlePath(slug)`**

- [ ] **Step 5: Register both routes in `AppRouter.tsx` as their own lazy chunk, outside every guard**

Place them beside `paths.acceptInvite`, with the same reasoning in a comment: a signed-out reader must resolve them. `HelpArticlePage` renders `HelpNotFound` inside `HelpLayout` when `getHelpPage` returns `undefined`.

- [ ] **Step 6: Implement the layout, sidebar, article and on-this-page components**

`HelpArticle` pipes the body through `resolveTokens`, then `react-markdown` with `remark-gfm`. Never `dangerouslySetInnerHTML`. A heading carrying a `<!-- permission: ... -->` comment renders `roleLabelFor` beside it, omitting the label when that returns `null`. `OnThisPage` lists the `##` headings.

- [ ] **Step 7: Run the tests to verify they pass**

- [ ] **Step 8: Commit**

```bash
git add src/features/help src/pages/help src/app/routes
git commit -m "feat(help): add public help routes and the article layout"
```

---

### Task 5: The `/help` card index

**Files:**
- Create: `src/pages/help/HelpIndexPage.tsx`
- Create: `src/features/help/components/HelpGroupCard.tsx`
- Modify: `src/app/routes/AppRouter.tsx`
- Test: `src/pages/help/help-index.test.tsx`

**Interfaces:**
- Consumes: `HELP_NAVIGATION`, `loadHelpPages`, `HelpLayout` (Task 4).
- Produces: nothing used by later tasks.

- [ ] **Step 1: Write the failing tests**

```tsx
test('renders one card per navigation group', () => {})
test('each card lists the page titles in that group', () => {})
test('each page title links to its help article path', () => {})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/pages/help/help-index.test.tsx`

- [ ] **Step 3: Implement the index page and group card, and register `paths.help`**

- [ ] **Step 4: Run to verify they pass**

- [ ] **Step 5: Commit**

```bash
git add src/pages/help src/features/help src/app/routes
git commit -m "feat(help): add the help centre index"
```

---

### Task 6: Client-side search

**Files:**
- Create: `src/features/help/search.ts`
- Create: `src/features/help/components/HelpSearch.tsx`
- Modify: `src/features/help/components/HelpLayout.tsx`
- Test: `src/features/help/search.test.ts`, `src/features/help/help-search.test.tsx`

**Interfaces:**
- Consumes: `loadHelpPages` (Task 1).
- Produces:
  - `interface HelpSearchResult { slug: string; title: string; excerpt: string }`
  - `searchHelp(query: string, pages?: readonly HelpPage[]): readonly HelpSearchResult[]`

- [ ] **Step 1: Write the failing tests**

```ts
test('returns an empty list for a blank or single-character query', () => {})
test('matches a page by a word in its title before one that matches only in the body', () => {})
test('matches case-insensitively', () => {})
test('returns an excerpt containing the matched term', () => {})
test('returns an empty list when nothing matches', () => {})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/features/help/search.test.ts`

- [ ] **Step 3: Implement `searchHelp`**

Tokenise query and content on non-word characters, score title matches above summary above body, cap results at ten. No search dependency — nineteen pages do not need one.

- [ ] **Step 4: Run to verify they pass**

- [ ] **Step 5: Write and pass the component test**

```tsx
test('typing a query lists matching pages as links', () => {})
test('the search input is labelled for screen readers', () => {})
```

Run: `npx vitest run src/features/help/help-search.test.tsx`

- [ ] **Step 6: Commit**

```bash
git add src/features/help
git commit -m "feat(help): add client-side help search"
```

---

### Task 7: Images — manifest, component and existence check

**Files:**
- Create: `scripts/build-help-image-manifest.mjs`
- Create: `src/features/help/image-manifest.json` (generated)
- Create: `src/features/help/components/HelpImage.tsx`
- Move: `docs/help-screenshots/*.jpg` → `public/help/`
- Modify: `package.json` (add `help:images` script)
- Test: `src/features/help/help-image.test.tsx`, `src/features/help/image-references.test.ts`

**Interfaces:**
- Consumes: `loadHelpPages` (Task 1).
- Produces: `HelpImage` used by `HelpArticle`'s `img` renderer override.

**Deviation from the spec, deliberate:** the spec asks for images "served at 2×
for sharpness". The nineteen captures that exist are 1568×726 at 1×, because the
capture viewport could not be enlarged, and upscaling them would add weight
without adding detail. v1 therefore ships at 1×. If a sharper pass is ever
wanted, it is a recapture against the shot list, not a build change — note it
and move on rather than inventing a 2× pipeline with no 2× source.

- [ ] **Step 1: Write the failing tests**

```tsx
test('renders width and height from the manifest so the layout does not shift', () => {})
test('renders loading="lazy" and decoding="async"', () => {})
test('renders a visible placeholder when the source is absent from the manifest', () => {})
test('throws when alt text is missing', () => {})
```

The third is **Review Focus item 5**: a missing image leaves a visible gap and the surrounding prose renders.

```ts
test('every image referenced by a help page exists in public/help', () => {})
test('every image referenced by a help page has alt text', () => {})
test('every page outside the Reference group carries an orientation image', () => {})
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/features/help/help-image.test.tsx src/features/help/image-references.test.ts`

- [ ] **Step 3: Move the nineteen captures to `public/help/` and write `scripts/build-help-image-manifest.mjs`**

The script reads each file's intrinsic dimensions from its JPEG/PNG header and writes `{ "<filename>": { "width": n, "height": n } }`. Wire it as `"help:images": "node scripts/build-help-image-manifest.mjs"`.

- [ ] **Step 4: Run the script, implement `HelpImage`, wire it as the `img` renderer in `HelpArticle`**

- [ ] **Step 5: Run the tests to verify they pass**

The orientation-image assertion will fail until Task 11 adds the remaining pages. Scope it to the slugs that exist, so it grows with the content rather than blocking.

- [ ] **Step 6: Commit**

```bash
git add scripts package.json public/help src/features/help
git rm -r docs/help-screenshots
git commit -m "feat(help): serve help screenshots with explicit dimensions"
```

---

### Task 8: Per-route metadata, robots and sitemap

**Files:**
- Create: `src/features/help/useDocumentMeta.ts`
- Create: `public/robots.txt`
- Create: `scripts/build-help-sitemap.mjs`
- Create: `public/sitemap.xml` (generated)
- Modify: `package.json`, `src/pages/help/HelpArticlePage.tsx`, `src/pages/help/HelpIndexPage.tsx`
- Test: `src/features/help/use-document-meta.test.tsx`

**Interfaces:**
- Consumes: `HelpPage` (Task 1), `resolveTokens` (Task 3).
- Produces: `useDocumentMeta(title: string, description: string): void`

- [ ] **Step 1: Write the failing tests**

```tsx
test('sets document.title to the page title and the product name', () => {})
test('sets the meta description to the page summary', () => {})
test('restores the previous title when the component unmounts', () => {})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/features/help/use-document-meta.test.tsx`

- [ ] **Step 3: Implement the hook and call it from both help pages**

- [ ] **Step 4: Run to verify they pass**

- [ ] **Step 5: Add `public/robots.txt` allowing all and pointing at the sitemap, and `scripts/build-help-sitemap.mjs` emitting one `<url>` per help slug**

Wire as `"help:sitemap"`. The site origin comes from an argument with a documented default, since a self-hosted deployment is on its own domain.

- [ ] **Step 6: Commit**

```bash
git add public scripts package.json src/features/help src/pages/help
git commit -m "feat(help): add per-route metadata, robots.txt and a sitemap"
```

---

### Task 9: Entry points from inside the product

**Files:**
- Modify: `src/components/layout/Sidebar.tsx:196` (beside `UserMenu`)
- Modify: `src/components/ui/PageHeader.tsx`
- Modify: `src/pages/marketing/components/MarketingFooter.tsx`
- Modify: `src/pages/auth/AcceptInvitePage.tsx`, `src/pages/auth/ResetPasswordPage.tsx`
- Create: `src/features/help/route-topics.ts`
- Test: `src/features/help/entry-points.test.tsx`

**Interfaces:**
- Consumes: `paths.help`, `helpArticlePath` (Task 4).
- Produces: `helpSlugForRoute(pathname: string): string | null`

- [ ] **Step 1: Write the failing tests**

```tsx
test('the sidebar footer links to the help centre', () => {})
test('PageHeader renders a help link for a route that maps to a help page', () => {})
test('PageHeader renders no help link on a route with no help page', () => {})
test('the marketing footer links to the help centre', () => {})
test('the accept-invite screen links to the invitation help page', () => {})
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/features/help/entry-points.test.tsx`

- [ ] **Step 3: Implement `helpSlugForRoute` mapping each `paths.*` module route to its help slug**

Returns `null` for anything unmapped, so detail and creation routes inherit their module's page only where that is right.

- [ ] **Step 4: Add the link to `PageHeader` via `useLocation` + `helpSlugForRoute`, rendered inside the existing `actions` row**

One change reaches every module; do **not** edit the twelve module pages.

- [ ] **Step 5: Add the sidebar-footer, marketing-footer and auth-screen links**

The sidebar entry respects `isCollapsed` the way `UserMenu` and `NotificationBell` already do.

- [ ] **Step 6: Run the tests to verify they pass**

- [ ] **Step 7: Commit**

```bash
git add src/components src/pages src/features/help
git commit -m "feat(help): link to the help centre from inside the product"
```

---

### Task 10: Content pass one — Rentals, Vehicles, Team

**Files:**
- Modify: `src/content/help/rentals.md`
- Create: `src/content/help/vehicles.md`, `src/content/help/team.md`
- Modify: `src/features/help/navigation.ts`

**Interfaces:**
- Consumes: everything above.
- Produces: the house style the remaining sixteen pages follow.

- [ ] **Step 1: Write the three pages against the spec's page anatomy**

Breadcrumb group, title, one-line purpose, page role label, **In short** box, orientation image, task sections named as actions each with its `<!-- permission: -->` comment, **If it goes wrong**, next and related links.

Ground every statement in the code, not assumption: `src/features/rentals/` and `src/types/database.ts` for the `draft → reserved → active → completed → cancelled` lifecycle and the separate `unpaid`/`partially_paid`/`paid`/`overpaid` payment status; `src/features/vehicles/` for status, compliance and documents; `src/features/team/` plus `PERMISSIONS` for invitation, role change, removal and ownership transfer. Where behaviour cannot be established from the code, **ask rather than invent**.

- [ ] **Step 2: Run the full check**

Run: `npm run verify`
Expected: PASS — including the Task 2 content-validation gate and the Task 7 image checks.

- [ ] **Step 3: Commit**

```bash
git add src/content/help src/features/help
git commit -m "docs(help): add Rentals, Vehicles and Team pages"
```

- [ ] **Step 4: STOP — owner review gate**

The spec requires these three to be reviewed for tone and accuracy before the remaining sixteen are written. Present them and wait. Do not start Task 11 until the owner has responded.

---

### Task 11: Content pass two — the remaining sixteen pages

**Files:**
- Create: the sixteen remaining files in `src/content/help/`
- Modify: `src/features/help/navigation.ts`

**Interfaces:**
- Consumes: the house style established in Task 10.

- [ ] **Step 1: Write the remaining sixteen pages**

Getting started (4): `how-pevvy-is-organised`, `accept-your-invitation`, `set-up-your-agency`, `first-vehicle-first-rental`. Overview (1): `overview`. Operations (2): `calendar`, `customers`. Fleet (1): `gps-tracking`. Finance (3): `expenses`, `financing`, `reports`. Agency (3): `billing`, `settings`, `notifications`. Reference (2): `who-can-do-what`, `troubleshooting`.

`accept-your-invitation` must read correctly for someone who is **not** signed in. `troubleshooting` names `{{supportEmail}}` for problems with the product itself and directs permission and deposit questions to the reader's own owner or administrator. `who-can-do-what` renders the full matrix from `PERMISSIONS` rather than restating it in prose.

- [ ] **Step 2: Tighten the orientation-image assertion from Task 7 to cover every non-Reference page**

- [ ] **Step 3: Run the full check**

Run: `npm run verify`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/content/help src/features/help
git commit -m "docs(help): add the remaining help centre pages"
```

---

### Task 12: Accessibility pass and final verification

**Files:**
- Modify: whichever help components the audit finds wanting
- Test: `src/features/help/help-a11y.test.tsx`

- [ ] **Step 1: Write the failing accessibility tests**

```tsx
test('the help sidebar is a nav with an accessible name', () => {})
test('the current page is marked aria-current in the sidebar', () => {})
test('on-this-page links resolve to heading ids that exist', () => {})
test('every help image has non-empty alt text', () => {})
test('headings descend without skipping a level', () => {})
```

- [ ] **Step 2: Run to verify failures**

Run: `npx vitest run src/features/help/help-a11y.test.tsx`

- [ ] **Step 3: Fix what the tests catch**

- [ ] **Step 4: Run the whole suite**

Run: `npm run verify`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/features/help
git commit -m "fix(help): accessibility corrections for the help centre"
```

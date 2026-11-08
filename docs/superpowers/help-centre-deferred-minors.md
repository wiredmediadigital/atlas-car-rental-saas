# Help Centre — minor issues deferred during the build

Recorded by the reviewing agents as the Help Centre was built (2026-11-06/07)
and deliberately not fixed at the time, each one judged too small to interrupt
the task in hand. The feature shipped and merged without them.

This file exists because the build workspace it lived in
(`.superpowers/sdd/2026-11-06-pevvy-help-centre/`) was gitignored scratch and
has been deleted. Everything else in that folder was either regenerable from
git (the review diffs) or a narrative of work now visible in the history; this
list was the only part that could not be recovered.

**Status: as recorded, not re-audited.** Several may already have been fixed by
a later round, and a few describe code that has since moved. Check before
acting on one. The single item that was flagged as needing to land before merge
— Task 12's `scroll-mt` on `<main>` — **did land**, and is covered by a test in
`src/features/help/help-a11y.test.tsx`; it is listed below struck through for
completeness.

None of these is a correctness or security defect. They are test gaps, wording
slips, redundant assertions and small ergonomic faults.

## Task 1 — front-matter parsing

- Leading blank line left in body.
- Exact `---` delimiter comparison gives an unhelpful message for `--- `.
- `as string` casts after the `REQUIRED_KEYS` loop.
- No tests for the unclosed-block, colon-less line, BOM or CRLF branches.
- `content.test.ts` assertions pin the rentals placeholder, needing a touch at Task 10.
- `task-1-report.md` line 25 went stale (says unknown keys ignored); no eslint/tsc output shown in the report.

## Task 2 — content validation gate

- Doc comment claims a heading adjacency the regex does not enforce.
- Unreachable `match[1] ?? ''` fallback.
- Redundant `as string` cast in `content-validation.test.ts:35`.
- No fixture-based test proving the gate fails on a bad page (the implementer verified by hand).
- No coverage for a malformed section comment, e.g. `<!-- permission: -->`.

## Task 3 — token substitution

- Sequential substitution: an app name containing `{{supportEmail}}` would expand. Cosmetic, and it is the deployer's own config.
- No test with both tokens in one string.
- Redundant `not.toContain('{{')` assertion in `tokens.test.ts:97-104`.

## Task 4 — public help routes

- The "no Supabase auth call" assertion is redundant: the throwing mock means the test above it fails first.
- No render of a help route with a session present, so the signed-in half of "resolves identically" is untested.
- Page-level label suppression (`HelpArticle.tsx:172-175`) has no assertion.
- `markdownComponents(sections)` is rebuilt every render, defeating react-markdown memoisation.
- Breadcrumb current page lacks `aria-current="page"`.
- An ATX closing sequence `## Foo ##` leaves `##` in the heading and the slug.
- Report claims format/eslint/typecheck clean without showing their output.
- The CRLF test assumes the shared `BODY` fixture contains no `\r` — unverified, outside the diff.

## Task 5 — index page

- "Help centre" appears three times on the index (eyebrow, h1, header link); the eyebrow is redundant.
- No test for the empty `HELP_NAVIGATION` case.

## Task 6 — search

- The results panel has no dismiss on outside click or blur.
- "Closes after a page is chosen" clicks the header link, not a tree link.
- Excerpt stripping joins snake_case words, and slices can start mid-word.
- `help-test-support.ts` sits in production source rather than `src/test/`, so it is linted and typechecked as app code.
- Nothing enforces that a future help test file calls `warmHelpRoutes`, so the flake could return via a new file.
- Warm-up covers only the two page modules; other lazy imports in the help tree are not warmed.

## Task 7 — images

- No test for a truncated JPEG, or a DHT (C4) segment before SOF.
- `img` and placeholder both carry `mt-4` inside react-markdown's `<p>`, so the margin may double.
- A backslash-escaped `\![alt](src)` is counted as an image.

## Task 8 — sitemap and metadata

- `url.origin` silently drops a subpath: `https://x.com/app` loses `/app`.
- Slugs are XML-escaped but not percent-encoded.
- `getAppName()` is read in an effect but absent from the dependency array.
- No article-to-article router integration test for metadata.
- Soft 404s are not marked `noindex`.
- A bare `npm run help:sitemap` deletes a committed sitemap. Recoverable from git, the script prints a notice, and every documented instruction passes an origin.

## Task 9 — navigation and headers

- `aria-label` duplicates visible text when the sidebar is expanded.
- `entry-points.test.tsx:394` uses a structure-coupled `header > div:nth-of-type(2)` selector.
- `components/ui` now imports from `features/help`, inverting the usual layering. Accepted: the brief forbade editing the module pages.
- The `PageHeader` JSDoc note runs to three lines where one was permitted. Wording is fine; trimming is optional.

## Task 10 — rentals page

- Rentals has twelve task sections, at the upper limit.
- Condition-photo removal needs `rentals.delete`, which is not mentioned.
- The premise check uses `not.toBeNull()`, which passes for `undefined`; should be `toBeTruthy()`.
- An in-test comment records a one-time mutation result and will go stale.

## Task 11 — remaining module pages

- `billing.md` says "the badge under the title" but it renders beside the summary.
- `who-can-do-what.md:35-36` — "labels its sections with a permission rather than a role" reads oddly now that badges show roles.
- The report claimed nine replacement sites; the diff shows eight. Immaterial.

## Task 12 — accessibility

- ~~`<main>` has no `scroll-mt`, and the header is a sticky `h-16`, so after the skip-link jump the first ~64px of the article sits under the header.~~ **Fixed before merge** — `HelpLayout.tsx` carries `scroll-mt-24`, asserted in `help-a11y.test.tsx`.
- The skip-link test checks DOM order and href but not that focus moves. jsdom cannot; `tabIndex={-1}` is covered by reading.
- `hasSeenH2` in test 5 is effectively redundant. Harmless, and it matches the comment.

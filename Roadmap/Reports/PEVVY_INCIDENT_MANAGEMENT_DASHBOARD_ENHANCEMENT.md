# Pevvy — Incident Management dashboard enhancement

**Date:** 2026-11-26
**Worktree:** `E:\pevvy-maintenance-acceptance-20261125`
**Project:** Pevvy-Staging `yeklucfthspvejlkffln`
**Prompt archived at:** `Roadmap/Prompts/PEVVY_INCIDENT_MANAGEMENT_DASHBOARD_ENHANCEMENT_PROMPT.md`

| Commit | What |
|---|---|
| `a2861b8` | Maintenance Management recorded as functionally accepted and closed |
| `b163cc6` | The Incidents page becomes a dashboard |

Frontend only. **No migration was created**, and none was needed. Production was
not linked, queried or deployed to.

---

## 1. What was built

The Incidents page was a flat card list with three controls. It is now a dashboard built
on the **accepted Maintenance dashboard** — not beside it. It reuses the same page
skeleton (`PageHeader` → summary grid → toolbar → `Card`), the same period stepper, the
same 250 ms debounced search, the same filter drawer with an active-filter count, the same
clamped `ListPagination`, the same `lg` breakpoint split between a table and a card list,
and the same loading, empty and error treatments. An operator who has learnt Maintenance
has learnt this.

The Incidents route and the **Report incident** action are unchanged. No navigation module
was added.

| File | Role |
|---|---|
| `src/features/incidents/api.ts` | Two complete, paged reads; the outstanding-work rule |
| `src/features/incidents/dashboard.ts` | **New.** All six figures and the list filter, pure |
| `src/features/incidents/components/IncidentSummary.tsx` | **New.** Six tiles, each a filter control |
| `src/features/incidents/components/IncidentToolbar.tsx` | **New.** Period, search, filter drawer |
| `src/features/incidents/components/IncidentTable.tsx` | **New.** Table + card list |
| `src/pages/incidents/IncidentsPage.tsx` | Rewritten |

---

## 2. Metric definitions

The six figures are **two kinds**, and the page says which on every tile.

### Period figures — the selected window

| Tile | Counts | Filter it applies |
|---|---|---|
| **Total incidents · _period_** | Incidents whose `occurred_at` falls in the window | the period, unchanged |
| **Resolved · _period_** | …of those, `status = 'resolved'` | `status = resolved` |
| **Rental-related · _period_** | …of those, `rental_id is not null` | `rental = rental-related` |

### Current-state figures — now, whenever it happened

| Tile | Counts | Filter it applies |
|---|---|---|
| **Open incidents** | `status <> 'resolved'`, **all time** | All time + `status = unresolved` |
| **Vehicles affected** | **Distinct** `vehicle_id` among those, counted once each | All time + `status = unresolved` |
| **Outstanding maintenance** | Incidents with ≥1 maintenance record `scheduled` or `in_progress`, **counted once per incident** | All time + `maintenance = outstanding` |

**The split is the point, not a detail.** The brief requires open work and outstanding
maintenance to stay discoverable regardless of the incident date. An incident opened in
March and never closed is the most actionable row in the product; a dashboard that hid it
behind a month selector would be worse than no dashboard. The three state figures are
therefore deliberately unbounded by the period, and their captions say so on screen.

**No double-counting.** Vehicles are a `Set`. An incident with three maintenance records
counts **once** towards outstanding maintenance — the figure counts incidents, not jobs.
Cancelled work is not outstanding (nobody will do it) but still counts towards the
incident's record total, because the record exists and an operator will see it.

**Lifecycle independence is preserved as a number.** A **resolved** incident with open
maintenance is still counted under Outstanding maintenance. Omitting it would quietly lose
jobs the moment somebody tidied up the incident.

---

## 3. Accuracy: one complete list, not a page of one

Every figure and every row comes from **one** read, `fetchIncidentDashboard`.

- **Complete, not the first page.** PostgREST stops at `max_rows = 1000` and says nothing
  about it. The read pages to the end, so a total is not computed from whatever the first
  thousand rows happened to be.
- **One source, so the page cannot contradict itself.** Counting server-side with one
  query and listing with another would let "Open incidents: 4" sit above a list of five
  whenever the two ran a moment apart. A summary that contradicts the thing it summarises
  poisons every other number on the page.
- **No per-record requests.** Vehicle, rental and customer names are resolved with batched
  `.in(...)` lookups over the distinct ids, chunked at 300 — three round trips, not one
  per row.
- **De-duplicated by id.** Offset paging asks for rows 0–999 then 1000–1999 as two
  requests against live data. An incident reported between them shifts every later row
  down one, so the last row of page one returns again as the first of page two — and a
  dashboard that counts rows would count it twice. Rows are keyed by primary key and
  delivered once.

A second read, `fetchIncidentMaintenanceLinks`, pages `maintenance_records` once for the
incident link rather than per incident.

### Failed reads never render as zero

The two queries fail independently, and that is handled explicitly:

- Incident read fails → every tile shows **—**, with an error on the list.
- **Maintenance read fails** → only the Outstanding maintenance tile shows **—**, saying
  which read failed; rows show **Unavailable**; and the Maintenance filter is **disabled**.
  Left enabled over an empty link map, "No maintenance raised" would have matched every
  incident in the agency and looked like a confident answer.
- Still loading → rows show **…**, which is distinct from **None**. "None" would read as
  an incident nobody had raised any work for.

---

## 4. The records table

Replaces the card list. Eight columns, business identifiers throughout — **no UUIDs**:

Reference (links to Incident Details) with vehicle and plate beneath · Type · Rental
reference · Customer · Responsibility · Occurred · Maintenance · Status.

The Maintenance cell shows outstanding work as a caution badge with the record total
beside it, so a resolved incident with a completed repair still reads as "1 record" rather
than as nothing having been done. Below `lg`, the same rows render as a card list.

Navigation is unchanged: every row reaches **Incident Details**, the accepted screen that
already shows related maintenance, documents, insurance and towing. This table
deliberately duplicates none of it.

---

## 5. Search and filtering

Search covers the incident reference, the vehicle as it is read (plate, make, model), the
rental reference, the customer's name, **and the free text of the report**. The scan
carries `location` and `description` although the table never shows them: the list this
replaces searched both, and a search somebody used last week must not quietly stop
matching. Those bytes cost nothing new — the page being replaced selected `*`.

Filters: status (including an explicit **Unresolved**), type, responsibility, vehicle,
rental-related, outstanding maintenance, and an occurred-from/to range. All live in the
URL, so a filtered view can be shared and survives a reload. **Clear all filters** resets
every one, and the Filters button carries a count of those active.

**All time** sits beside the period stepper rather than in the drawer, so it is visible
without opening anything. It is the period switched off, not a filter; the month controls
are disabled while it is on, because stepping a period that is not in use reads as a
broken control.

---

## 6. Three defects found and fixed before publication

Two were found while wiring the tiles up, one by adversarial review.

**The period tiles reset the period.** Clicking "Total incidents · **All time**" deleted
the all-time flag, dropping the list back to the current month under a figure that had
just counted every year on record. The period tiles now leave the window exactly as it is.

**The Open incidents tile contradicted its own drill-down.** It counts everything not
resolved — open *and* in progress — but filtered the list to the literal status `open`,
so every in-progress incident was counted and then hidden. There was no filter value that
reproduced the counted set. The filter now has an explicit `unresolved` value, and the
toolbar offers it as "Unresolved (open or in progress)".

**The date filter read the wrong day.** `occurred_at` is a `timestamptz`; slicing the
first ten characters of its UTC spelling gives the UTC day, while the table displays the
agency's. For any agency east of UTC an incident at 23:30 is displayed as the 11th and
excluded by a filter for the 11th, with nothing on screen to explain where it went. It now
resolves the agency's calendar day through `toIsoDateInTimeZone`.

### From the review, also fixed

| Finding | Fix |
|---|---|
| A failed maintenance read rendered a confident **0** on the Outstanding tile while the table in the same card honestly showed "…" | The two failures are tracked separately; the tile shows **—** and names the failed read |
| "No maintenance raised" silently matched **every** incident when the link read failed | The filter is disabled and says why |
| Rows showed "…" for ever after a failed link read, reading as "still loading" | A failed read shows **Unavailable** |
| `hover:border-line-strong` on a button with no border — the clickable tiles had **no** hover or cursor affordance | A ring and `cursor-pointer`. This is the dead-class defect that has shipped here before |
| `aria-label` on the tiles **replaced** the accessible name, withholding the figure from screen readers | Removed; the name comes from the content, with a visually hidden "Filter the list by …" |
| Offset paging could double-count a row across a page boundary | De-duplicated by primary key |
| `fetchIncidents`, `useIncidents` and `IncidentFilters` left unreachable by the rewrite | Removed, with the query key they alone used |

The review also reported six test gaps — no tile's **value** was asserted, and date
navigation, pagination, page-level search and the outstanding-work rule were untested.
All are now covered (§7).

---

## 7. Tests

| Suite | Tests |
|---|---|
| `src/features/incidents/dashboard.test.ts` | **38** — figures, period boundaries, distinct vehicles, double-counting, resolved-with-outstanding, all filters, search, the outstanding-work rule |
| `src/pages/incidents/IncidentsPage.test.tsx` | **17** — tile values, tile filtering, date navigation, pagination and clamping, search, failed reads, empty states, detail navigation |
| `src/features/incidents/queries.test.ts` | **5** — the query-key prefixes refresh depends on |
| `supabase/tests/incident-dashboard.test.ts` | **5** — tenant isolation, both directions |
| **Total new** | **65** |

Every required validation case from the brief is covered. Three deserve naming:

- **Tenant isolation is proved, not assumed.** Both new reads filter on `organization_id`,
  but a filter in a query is a client's promise. Each read is run twice as the same
  signed-in user — once for their own agency, once with a second agency's id substituted,
  which is what a tampered request looks like. The second returns nothing, in both
  directions.
- **Refresh after resolution** is a property of where the keys sit. Both dashboard keys are
  under `['organization', org, 'incidents']`, the prefix every incident mutation
  invalidates — and `invalidateVehicleRestrictions`, which every maintenance mutation runs,
  invalidates that same prefix. One namespace, both directions. The test pins it.
- **The agency-day filter** is asserted against two zones, so the UTC-day bug cannot return.

Regression suites run, all passing:

| Suite | Result |
|---|---|
| `supabase/tests/maintenance-acceptance.test.ts` (the 22 accepted scenarios) | **pass, unmodified** |
| `supabase/tests/permission-matrix.test.ts`, `analytics-security.test.ts`, `incident-management.test.ts` | **pass** |
| Frontend: incidents, maintenance, vehicles, compliance | **252 passing before the review fixes; 63 in the incident suites after** |
| `npm run typecheck` | **clean** |
| `eslint` on every changed file | **clean** |
| `prettier --check` on the project gate | **clean** |

The full repository suite was not re-run, as instructed.

**Pre-existing lint debt, untouched:** `IncidentNewPage.tsx` still has two
`react-hooks/set-state-in-effect` errors. That file is incident *reporting*, which §7 of
the brief forbids changing, so they stand. The nine auto-fixable
`no-unnecessary-type-assertion` errors in `incidents/api.ts` **were** fixed, because the
changed-file lint gate has to pass on a file this work modifies.

---

## 8. Preserved, and not touched

Incident reporting, editing, resolution and its warnings; rental and customer association;
vehicle-first creation; documents and photographs; insurance; towing; responsibility;
maintenance creation from incidents; related maintenance on Incident Details; tenant
isolation and authorization. No incident statuses were added. No lifecycle was redesigned.
Nothing here reopens an incident, completes maintenance, or changes vehicle availability.

**Maintenance Management was not reopened.** Its scope is frozen by the 28/28 acceptance;
this package reads its records and changes none of its code.

One observation, deliberately **not** acted on: the accepted
`MaintenanceSummary.tsx` still captions an unavailable downtime tile "Needs the maintenance
service plan migration to be applied to this project." That migration is now applied, so
the wording is stale for any other cause of failure. Changing it would reopen frozen,
accepted code for a caption, which the scope freeze forbids. Recorded here for the owner
to decide.

---

## 9. Staging deployment

Baseline: `origin/staging` at `131ac9a`, the verified tip from the preventive servicing
closure. All Maintenance dashboard and preventive servicing changes are preserved — the
regression probes in §9.2 confirm it on the deployed bundle, not just in the source.

### 9.1 Build and publish

```
Staging artifact verified: 199 files; SHA-256
ca53ce34b47cd5d238f1bf0c8cc5dda24f9a9f8916dba9f15f434fc2b9454461
```

The artifact was scanned directly: **no production project reference, no secret key.**

```
131ac9a..b163cc6  HEAD -> staging
```

- Fast-forward confirmed before pushing (`git merge-base --is-ancestor` returned 0).
- **No force, no history rewrite.**
- **`origin/main` is untouched at `31383a97eb8e000f9189913b255af4da22bf3a26`.**

### 9.2 Deployed frontend — verified by content

The host serves HTTP 200 for unknown paths, so a status code proves nothing. 173 real
asset files were crawled and read.

| Check | Result |
|---|---|
| Manifest | `e4c58644…`/199 → **`ff41ee11dbe87b6b2b230f0a44a9f09f5ea2cfb3bedaba8923742fc5f70b76a2`/199** |
| Project reference | `yeklucfthspvejlkffln` |
| `.js` served as JavaScript | **171 of 171** |
| Production project references | **0** |
| Leaked secret keys | **0** |
| Eight strings unique to this release | **all 8 found**, in `IncidentsPage-DEuylQ7r.js` |
| Six strings from the accepted maintenance release | **all 6 still present** |

**RESULT: PASS.** The eight new strings include `Unresolved (open or in progress)` and
`Filter the list by` — both products of defects fixed in §6, so their presence shows the
corrected code is what shipped, not merely that something shipped.

The deployed hash differs from the locally guarded one, as it has every time: Hostinger
rebuilds from source rather than publishing the reviewed artifact. The file count matches
at 199.

---

## 10. Acceptance

**Scenario 29 — Incident Management dashboard.** A new, separate scenario. Nothing is
marked accepted; the Maintenance register stands at 28/28 and no accepted incident
functionality was reopened.

### Manual acceptance script

1. Open **Incidents**. Confirm six summary figures: three labelled with the period, three
   labelled as current state, each with a caption saying which it is.
2. Confirm the **Report incident** button still works and reaches the existing form.
3. Click **Open incidents**. The list must narrow to unresolved incidents, switch to **All
   time**, and the number of rows must match the tile. Confirm an **in-progress** incident
   is included, not only "open" ones.
4. Click **Outstanding maintenance**. Confirm every row shows outstanding work, and that an
   incident with several maintenance records appears **once**.
5. Find a **resolved** incident that still has scheduled maintenance. Confirm it is counted
   under Outstanding maintenance and that resolving it did not complete the work.
6. Step the period back a month and forward again; confirm the three period figures change
   and the three state figures do not.
7. Switch **All time** on and find an unresolved incident older than the current month.
   Confirm the month controls are disabled while it is on.
8. Search a vehicle plate, then a customer name, then a rental reference. Open the filter
   drawer and apply status, type, responsibility, vehicle, rental and maintenance filters;
   confirm the Filters button shows a count and **Clear all filters** resets them.
9. Set an occurred-from/to range around a known incident date and confirm the row shown is
   the one whose displayed date is in range.
10. Page past 25 incidents, if the agency has them, and confirm the pager works.
11. Open any row and confirm **Incident Details** is unchanged — related maintenance,
    documents, insurance, towing and resolution all behave as accepted.
12. Resolve an incident and return to the dashboard; confirm the figures have refreshed
    without a reload.
13. On a phone-width window, confirm the table becomes a readable card list.

Report a failure against the step number.

---

## 11. Outstanding — carried forward, unchanged

- Owner acceptance of **scenario 29**.
- The two pre-existing `IncidentNewPage.tsx` lint errors.
- Six of nine Edge Functions remain undeployed on staging.
- The deployed artifact hash is still not reproducible by the deploying party.
- Independent concurrency verification.
- The STG-02 assignment-activation decision, and the `app.billing_require_write` decision.

**Production release: NO-GO.** Production `ysnumxtzcgzyabrghxwq` was not linked, queried or
deployed to. **Rental Financial Adjustments has not been started**, and per the brief,
owner acceptance of this dashboard is requested first.

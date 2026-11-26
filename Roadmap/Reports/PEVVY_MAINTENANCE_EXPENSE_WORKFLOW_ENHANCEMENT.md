# Pevvy — Maintenance expense workflow enhancement

**Date:** 2026-11-26
**Baseline:** `origin/staging` at `f7e331e`
**Published:** `origin/staging` at `f41ea5e` (two fast-forwards, no force)
**Supabase project:** `yeklucfthspvejlkffln` (staging)
**Migrations:** none. No schema change was needed or made.
**Production:** untouched. `origin/main` stayed at `31383a9` throughout.

---

## 1. What was asked and what was built

The owner's finding was that linking a maintenance cost works, but only if
somebody has already created the vehicle expense somewhere else. An operator
holding a garage invoice had to leave the record, open Finance, retype the
vehicle, the reference and the description, choose a category, come back and
link it. This change removes that round trip without creating a second place
where money lives.

| # | Requirement | Where |
|---|---|---|
| 1 | Create expense action inside the Costs section | `MaintenanceExpenses.tsx` header action → `RecordMaintenanceCost.tsx` |
| 2 | Reuse the existing form and ledger | Renders `ExpenseForm`; writes through `createExpense` into `public.expenses` |
| 3 | Prefill vehicle, maintenance reference, description, category | `expense-prefill.ts` |
| 4 | Associate on success | `useCreateMaintenanceExpense` calls `maintenance_link_expense` |
| 5 | Keep Link existing expense | Kept, and corrected (§4) |
| 6 | Informative empty state, not a hidden workflow | `MaintenanceExpenses.tsx`, the picker's `else` branch |
| 7 | Works after completion | Nothing on the card or in the RPC is gated on status (§5) |
| 8 | Refresh actual cost and linked expenses | `invalidateExpenses` + `invalidateMaintenance` on success |
| 9 | No duplicate expenses or associations | §6 |
| 10 | Permissions, tenancy and audit preserved | §7 |

### The prefill

`buildMaintenanceExpenseForm` returns an ordinary `ExpenseFormInput`:

- **Allocation** `vehicle`, **vehicle** the record's own, with the relation
  locked in the form so it cannot be pointed somewhere else by accident.
- **Description** `MNT-2026-00014 — Front brake pads`: the maintenance
  reference and title.
- **Category** resolved from the agency's own category list by `system_key`,
  mapped from the maintenance category (`tire_service` → Tyres,
  `mechanical_repair` → Repairs, `preventive` → Maintenance, and so on).
  Matching the handle rather than the name means a renamed category still
  resolves; an archived one falls back to Maintenance; an agency that has
  neither gets no category and the form asks for one.
- **Currency** the maintenance record's, so estimated and actual are in the
  same money.
- **Amount, supplier, invoice number** left blank. Nothing that costs money is
  filled in for anybody.

Two deliberate choices worth flagging, because both run against something
already in the codebase:

**The maintenance reference goes in the description, not in `reference`.**
That field is the supplier's document number and half of the duplicate-expense
probe. Putting ours there would mean the operator deletes it before typing the
invoice number, and would weaken the duplicate check. The reference reads in
the ledger either way, and the real association is the `maintenance_id` column,
not a string anyone can edit.

**A category is preselected here, and the Record a cost page says not to.**
That page's reasoning is that a default nobody read makes every cost drift to
whichever category sorts first. The objection is to an *arbitrary* default.
This one is read off the maintenance record's own category — a fact the
operator already stated — and it still shows in the field for them to change.
If you disagree, `MAINTENANCE_EXPENSE_CATEGORY_KEYS` is one constant to empty.

---

## 2. Files

| File | Change |
|---|---|
| `src/features/maintenance/expense-prefill.ts` | New. Pure: the category map and the prefilled form. |
| `src/features/maintenance/expense-prefill.test.ts` | New. 13 tests. |
| `src/features/maintenance/components/RecordMaintenanceCost.tsx` | New. The dialog. |
| `src/features/maintenance/components/maintenance-expenses.test.tsx` | New. 4 tests. |
| `src/features/maintenance/components/MaintenanceExpenses.tsx` | Create action, real empty state, corrected picker, corrected label. |
| `src/features/maintenance/api.ts` | New `fetchLinkableExpenses`. |
| `src/features/maintenance/queries.ts` | `useLinkableMaintenanceExpenses`, `useCreateMaintenanceExpense`. |
| `src/features/expenses/queries.ts` | `invalidateExpenses` exported (was module-private). |
| `src/pages/maintenance/MaintenanceDetailPage.tsx` | Passes the record's own fields; the old `useExpenseList` lookup removed. |

875 insertions, 53 deletions. No file over 250 lines.

---

## 3. The failure that would have caused a duplicate

`createExpense` and `maintenance_link_expense` are two calls. The second can
fail on its own — a stale page, a record cancelled in another tab, a dropped
connection — and by then the cost exists.

The obvious implementation throws, and `ExpenseForm` renders its error inside
an alert headed **"The cost was not saved"**. That sentence would be false, and
an operator who believes it records the invoice a second time. The duplicate
then counts twice in the vehicle's economics and in every report that reads
the ledger.

So the mutation returns the failure instead of throwing, and the dialog says
**"The cost was recorded but not attached"**, names the reason, disables the
Record cost button, and the picker behind the dialog now offers the orphan for
linking. One of the four component tests asserts exactly this — that the
"not saved" wording never appears over a saved cost, and that a second click
cannot reach `createExpense`.

---

## 4. Two defects found in the existing Link workflow

Both pre-date this change and are fixed here because the change touches the
same twenty lines.

**The picker offered costs that were already attached.** It read
`expense_ledger` filtered to the vehicle. That view predates maintenance and
carries no `maintenance_id`, so there was nothing to filter on — the dropdown
listed costs already linked to *this* record and costs linked to a *different*
maintenance record on the same vehicle. Linking the latter silently moved it:
`maintenance_link_expense` overwrites `maintenance_id` without complaint, so
another record's actual cost quietly dropped. The new `fetchLinkableExpenses`
reads `public.expenses` directly with `maintenance_id is null`, and also drops
voided costs, which contribute nothing to `maintenance_actual_cost`. No
migration: the column has existed since `20261125110000`, only the view lacks
it.

**The picker's label pointed at nothing.** `Field` generates its own control id
and hands it to the control through context; the `id` prop it accepts is
destructured away and ignored. The Costs card passed `id="link-expense"` to
both `Field` and `Select`, so the `<label for>` named an element that did not
exist and a screen reader read an unlabelled combobox. Removing both ids lets
the context do what it is for. This is why the component test queries by label
text — it would have failed before.

---

## 5. After completion

Requirement 7 needed no code. Nothing on the Costs card and nothing in
`maintenance_link_expense` or the `expenses` insert looks at
`maintenance_records.status`. A garage invoice arriving a week after sign-off
records and attaches normally, which is correct: a record that refused it
would have a permanently wrong actual cost.

---

## 6. Duplicates

- **Duplicate associations are structurally impossible.** The association is
  one `maintenance_id` column on the expense, not a join table. The same cost
  cannot appear twice under one record.
- **Stealing another record's cost** is now prevented by the picker filter
  (§4).
- **Double submission** is blocked by the pending guard and by the button's
  loading state, and after a failed attachment the button stays disabled.
- **The same invoice entered twice** is handled by the duplicate probe already
  built into `ExpenseForm`, which warns on a matching supplier plus document
  number, or amount and date. It warns rather than refuses, because agencies do
  buy the same thing twice. That behaviour is unchanged.

---

## 7. Permissions, tenancy, audit

**One gap was found and closed.** The Record a cost button was first gated on
`maintenance.update`, which is the permission for *linking*. Inserting into the
ledger is `expenses.create`. Both are `manager` in today's matrix, so nothing
was reachable that was not reachable before — but they are separate keys and
the database checks the expense one, so the button is now gated on both. That
is the second commit, `f41ea5e`.

Everything else is reuse rather than new surface:

- The whole card is already behind `expenses.view`.
- The insert goes through `createExpense` → RLS on `public.expenses`, scoped by
  `organization_id`. No new RPC, no `security definer` function, no new grant.
- The attachment goes through `maintenance_link_expense`, which re-checks
  `app.has_min_role(organization_id, 'manager')`, that the expense belongs to
  the same organization, that it is a vehicle allocation, and that it is the
  same vehicle. The UI cannot widen any of that.
- Audit columns (`created_by`, `created_at`) are set by the same insert path as
  the Finance page.
- No change to Stripe, subscriptions, pricing, billing functions or payment
  processing. No customer is charged anything.

---

## 8. Verification

Focused, per the brief — the full database suite was not re-run, because no
migration changed.

| Check | Result |
|---|---|
| `expense-prefill.test.ts` | **13/13 pass** |
| `maintenance-expenses.test.tsx` | **4/4 pass** |
| `src/features/maintenance`, `src/features/expenses` | **97/97 pass** (5 files) |
| `src/pages`, `src/features/rentals`, `src/features/vehicles` | **448/448 pass** (32 files) |
| `tsc -b --noEmit` | clean |
| `prettier --check` | clean |
| `eslint` on every changed file | clean |
| Guarded staging build | 196 files, artifact accepted by the guard |

**`npm run lint` is red on this baseline, and was before this change.** Twelve
errors in `src/features/incidents/api.ts` (9), `src/pages/incidents/IncidentNewPage.tsx`
(2) and `src/pages/rentals/RentalNewPage.tsx` (1) — none of them files this
change touches. `npm run verify` therefore cannot pass on `origin/staging`
today. Left alone as out of scope; recorded here because a repo-wide gate that
is already failing does not catch the next regression.

---

## 9. Deployment

Published to `origin/staging` in two fast-forwards. No force push, no history
rewrite, `origin/main` untouched at `31383a9` throughout.

| Commit | |
|---|---|
| `33769b6` | feat: record a maintenance cost without leaving the record |
| `f41ea5e` | fix: ask for expenses.create before offering to record a cost |

### Build and artifact hashes

| Artifact | SHA-256 | Files |
|---|---|---|
| Local guarded build, `33769b6` | `ed68104ddedf8adb4fe55116d2a3d83be0eb0e11dcddfd614c8ebe726e4fac33` | 196 |
| Local guarded build, `f41ea5e` | `cc846b01f625048f0cd7a82333544deaf75b4035f67ea498dc51c6a883386148` | 196 |
| Deployed after `33769b6` | `9357a743449e5b6e5f10bf5bce6a947c6c5bdbb661caa27f72ab14e7fcc77e9e` | 196 |
| Deployed after `f41ea5e` | `7fec4e624cd75a62a4df1108d9cf2786a8ea83d9da6dcad2adea0b171a913bbf` | 196 |

**The deployed hash does not match the local one, and is not expected to.**
The host rebuilds from source rather than publishing the artifact that was
built and checked here; the same mismatch was recorded in the previous release
(`PEVVY_MAINTENANCE_STAGING_DEPLOYMENT_FINAL.md` §6), where a full byte
comparison traced it to Tailwind emitting LAB colour components that differ in
the sixth decimal place. The manifest hashes filenames as well as contents, so
one changed byte in `index.css` moves every content hash that depends on it.
This remains an open gate: **an artifact hash the deploying party cannot
reproduce is a control that can only pass by accident.** It should be fixed
before it is relied on for production.

Verification is therefore by content, not by hash and not by status code — the
host answers `200 text/html` for every path that does not exist, including
invented ones, so an HTTP status proves nothing here.

---

## 10. What is live

Verified against `https://quantum-lavenderblush-buffalo-97.hostingersite.com`.

Verified against `https://quantum-lavenderblush-buffalo-97.hostingersite.com`
after the published manifest changed, 140 seconds after the push.

**Deployed manifest:** `buildMode: staging`, `projectRef: yeklucfthspvejlkffln`,
`contentSha256: 7fec4e62…`, `fileCount: 196`.

**170 asset files crawled** by following the chunk graph from `index.html`
through the lazily loaded route chunks. **168 of them are `.js` and every one
is served with a JavaScript content type** — none fell through to the SPA's
HTML fallback.

### The new code is in the deployed bundle

All four strings below exist only in this change, and all four were found in
`/assets/MaintenanceDetailPage-CtoxGVS4.js`, served as real JavaScript:

| String | |
|---|---|
| `No unlinked vehicle costs for this vehicle` | the empty state (req. 6) |
| `The cost was recorded but not attached` | the partial-failure alert (§3) |
| `Recorded in the expense ledger and attached to this maintenance record` | the dialog (req. 1, 4) |
| `Link an existing vehicle expense` | the retained picker (req. 5) |

The permission gate from the second commit is live too: `expenses.create`
appears in that same deployed chunk.

### The deployed chunk is the chunk that was built here

| | |
|---|---|
| Local `MaintenanceDetailPage` chunk | 20,692 bytes |
| Deployed | 20,692 bytes |
| Differing byte positions | **37** |
| After normalising the 8-character content hashes inside import specifiers | **byte-identical** — both `be9b52eb…` |

The 37 bytes are the filenames of *other* chunks this one imports. The
`env` chunk is byte-identical outright (`65c22cbd…`, 2,620 bytes), carries the
staging project reference, and contains **no production reference and no
secret key**. The whole 170-file crawl found **0 production project references
and 0 leaked secret keys**.

### Why the artifact hash differs, with the actual bytes

The deployed stylesheet and the local one are both 69,988 bytes and differ in
**four byte positions**. The first is byte 31,304:

```
local   : ound-color:lab(8.0926% -.583477 -1.76435/.3)}
deployed: ound-color:lab(8.0926% -.583492 -1.76435/.3)}
```

A Tailwind-generated LAB colour component differing by 0.000015 — the same
artefact recorded in the previous release, reproduced here exactly. That one
changed stylesheet moves its content hash, which moves every chunk that
imports it, which moves the manifest hash. **Not one byte of JavaScript
differs.**

One note on method: the host answers `200 text/html` for paths that do not
exist, so the crawl discards any response with an HTML content type rather
than counting it as a file. A status code is not evidence on this host.

---

## 11. Not done, and why

- **No migration.** The `maintenance_id` column and the link RPC already
  existed. Adding it to the `expense_ledger` view would have been a schema
  change for a query the maintenance module can make directly.
- **No manual acceptance.** Nothing here is marked accepted. The owner's
  26-scenario baseline — **11 passed / 11 failed / 4 pending** — is unchanged
  by this work, which adds a scenario rather than resolving one.
- **Production remains NO-GO.** No production credential was used, no
  production project was contacted, `origin/main` was not touched.
- **No Edge Function deployed.** Six of the nine remain undeployed on staging,
  as before.
- **Rental Financial Adjustments not started.**

### Suggested scenario 27, for the owner's checklist

> On a **completed** maintenance record for a vehicle with no unlinked costs:
> the Costs section says so rather than hiding the picker. Press **Record a
> cost** — the form opens with the vehicle locked, the description reading
> `<reference> — <title>` and the category matching the kind of work. Enter an
> amount and record it. The dialog closes, **Actual cost** changes without a
> reload, the cost appears in the list, and it is no longer offered in the
> picker. Open it in Finance → the same row, allocated to that vehicle.

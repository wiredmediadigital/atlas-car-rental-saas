# Pevvy — Preventive servicing final correction, and the Maintenance dashboard

**Date:** 2026-11-26
**Baseline:** `origin/staging` at `0766e82` (verified against the remote before starting)
**Supabase project:** `yeklucfthspvejlkffln` (staging)
**Production:** untouched. No production credential used, no production project contacted.

---

## 1. The root cause, and what it was not

**The service plan was always being saved.** I replayed the real ordered migration
history on the repository's in-memory Postgres and called
`maintenance_set_service_plan` exactly as the form calls it:

```
PERSISTED PLAN: {"service_interval_days":180,"service_interval_odometer":5000,
                 "next_service_on":"2027-06-08T00:00:00.000Z","next_service_odometer":60200}
```

Stored, and read back, intact. The RPC name, all five parameter names, the grants,
`security definer` and the cache invalidation are all correct, and `changeMaintenance`
throws on every error rather than swallowing one. `ToastProvider` is mounted above the
router. **None of the owner's symptoms were a persistence defect.**

What was actually wrong, in order of how much it explains:

**(a) The read-back was in the wrong branch.** The summary of the stored plan rendered
only when `canManage` was **false**. The manager who saves was the one person in the
product who never saw what had been stored. The card was pixel-identical before and
after a save, and a five-second toast was the only evidence anything had happened.
That alone produces "no visible confirmation" and "the values did not stick".

**(b) Unreadable entries were written as NULL.** `toNumberOrNull` turned anything
non-numeric — `5,000`, `5 000`, `5000 km` — into `null`. The RPC **overwrites all four
columns on every call**, and the "at least one reminder" guard only fires when all four
are empty. So one mistyped box silently erased a stored interval *and reported success*.
The typed text stayed on screen looking saved until the page was reloaded, at which
point the value was gone. This is the mechanism behind "values are not retained".

**(c) Error messages were invisible.** `text-danger` is not a token in this theme.
Tailwind v4 is configured CSS-first with no config file, and `src/styles/index.css`
defines `--color-critical-*` and no `--color-danger`, so the class generated **no CSS
rule at all**. Every error using it rendered as ordinary grey body text. Nine call sites,
across maintenance, vehicles and incidents.

**(d) Nothing outside that one card read the plan.** The four columns were rendered in
exactly one file in the entire frontend. `maintenance_due_summary` — written, granted to
`authenticated` and covered by a database test — had **zero callers in `src/`**. So
"upcoming and overdue indicators are missing" was not a bug; the feature had never been
built.

**(e) Vehicle Details was reading a different column entirely.** Compliance showed
`public.vehicles.next_service_on`, a legacy field edited in the general Edit Vehicle
form and wholly unrelated to the maintenance-record plan. The two never met, which is why
a plan saved in Maintenance left Vehicle Details reading "No date recorded".

**(f) Four labels pointed at nothing.** `Field` generates its own control id and
discards the `id` prop it accepts; the card passed `id` to both `Field` and `Input`, so
each `<label for>` named an element that did not exist.

---

## 2. The authoritative data source

**`public.maintenance_records`** — `service_interval_days`,
`service_interval_odometer`, `next_service_on`, `next_service_odometer`, written only by
`maintenance_set_service_plan`. Unchanged. No second table, no second RPC, no second
reminder system.

A vehicle's plan is the soonest plan across its non-cancelled maintenance records —
`selectVehicleServicePlan`. Cancelled work is ignored, because a cancelled job's reminder
is not a commitment.

**There is now exactly one next-service date a person can edit**, on the maintenance
record. Vehicle Details reads it and links to it; it does not offer a second editor.

---

## 3. Legacy date handling

`public.vehicles.next_service_on` had one writer (the Edit Vehicle form) and one reader
(the Compliance card). Removing it was small; the write path made it dangerous.

`updateVehicle` issues `.update(toRow(values))` — **the whole form-owned column set, not
a diff** — and `optionalDate` turns a blank control into `null`. Deleting the field from
the form while leaving the key in the payload would have **nulled the column for every
vehicle anyone subsequently edited**: silently, one at a time, with no trigger, default or
constraint to stop it (`freeze_columns` guards only `id`, `organization_id`, `created_at`,
`created_by`) and no test to catch it.

So the key came out of `VehicleWritePayload` and `toRow` **first**. An UPDATE that does
not name a column cannot touch it. `createVehicle` inserts nothing into a nullable column
with no default, and `importVehicles` sends a row without the key.

| Decision | |
|---|---|
| The column | **Kept.** Dropping it is the one step that cannot be undone. |
| `vehicle_fleet` view and CSV export | **Kept**, so the stored history stays reachable. |
| Editing | **Removed** from Add and Edit Vehicle. |
| Conflicting values | A record plan always wins. The legacy date is **never** promoted into a reminder and never compared against one. |
| Where no plan exists but a legacy date does | The Service and maintenance card's empty state names the date, says it predates Maintenance and is kept for reference only, and points at scheduling. |

A test pins the invariant for update, insert and import, because the absence of a key is
exactly the kind of thing a later refactor restores helpfully.

**Flagged for your decision:** those legacy dates are now read-only. There is no way to
correct one from the interface until a maintenance-record plan covers that vehicle. The
CSV export still emits the column, and the CSV import already ignored it before this
change.

---

## 4. Service status — one rule, one home

`src/lib/compliance/service.ts`, beside `evaluateCompliance`, which already does exactly
this for renewal dates. Both screens and the fleet list call it; none of them computes
anything of its own.

Five states: `not_configured`, `up_to_date`, `due_soon`, `due`, `overdue`. Each limb is
classified on its own and **whichever threshold is reached first decides** — which is the
same sentence as "the worst of the two states", read from the other end.

Three decisions worth stating plainly:

**The date window reuses the agency's own `compliance_reminder_lead_days`, not a
hardcoded 30.** Vehicle Details already prints *"Warnings begin N days before a renewal
date"* over the row this replaces, so an agency set to 14 was already being promised 14.
Hardcoding 30 would have made the screen contradict itself. The prompt allows this: *"Use
existing warning thresholds if already established."*

**The distance window is 500 in stored odometer units, not 500 km converted.** Nothing in
this product converts an odometer — there is no factor anywhere — and introducing one
would reinterpret every reading already recorded. **For an agency working in miles this is
a wider window than 500 km would be.** It is one named constant and an explicit option, so
it changes in one place if you want it to.

**The day is read in the agency's time zone.** `new Date('2026-11-26')` is midnight UTC;
comparing it to `Date.now()` would make a service fall due at seven the previous evening
in New York. Pinned by a test.

The threshold day, and the threshold reading, are **due** rather than **overdue** —
matching how a certificate expiring today is still valid today.

---

## 5. Vehicle Details

Next service is **out** of Compliance. Insurance, technical inspection and registration
stay. In its place a **Service and maintenance** card showing current odometer, next
service date and mileage, days and distance remaining or overdue, the recurring intervals,
and the status — with **Manage service plan** going to the record that owns it.

No editor on this card, deliberately. A second place to set a next-service date is how the
product got into this state.

It reads one query for the one vehicle rather than filtering the agency's whole
maintenance history in the browser, under the maintenance key so existing invalidation
already refreshes it.

---

## 6. Recurring service calculation

**A migration was genuinely required.** I verified the gap empirically before writing a
line of SQL: completing a record carrying 180 days / 5,000 left `next_service_on` at
2026-12-10 and `next_service_odometer` at 55,200 — unchanged. Nothing anywhere advanced
them.

`supabase/migrations/20261126120000_maintenance_service_plan_advancement.sql` replaces
`maintenance_complete` with the same signature and the same guards, plus one step.

**The owner's worked example is a test:**

| | |
|---|---|
| Completed | 2026-12-10, service odometer 55,200 |
| Intervals | 180 days, 5,000 |
| **Produces** | **2027-06-08 and 60,200** |

**Qualifying** means *the record carries a recurrence rule*, not that its category is
`preventive`. The enum has eleven values and several are recurring servicing, while a
record categorised `preventive` may carry no plan at all.

**Unrelated maintenance cannot reset a plan**, and the guarantee is structural rather than
conditional: the plan columns live on the record being completed, they arrive only through
the manager-only RPC, and `maintenance_create` never populates them — so an ordinary
repair completes with all four still null and the advancement does nothing.

**No odometer is invented.** The distance limb uses only a reading taken for that job —
the completion reading, or the reading taken when the vehicle went in. Where neither
exists, the distance threshold is **left exactly as it was** while the date limb still
advances. `public.vehicles.odometer` is deliberately not borrowed: it is the fleet's last
rental hand-over reading, and using it would manufacture evidence that somebody read the
odometer at the garage.

**Advancing twice is impossible**, as it already was: completion requires `in_progress`
and sets `completed` in the same statement under a row lock, and nothing puts a completed
record back. Tested by attempting a second completion.

The completion date is read in the agency's time zone, so a completion at 23:00 is that
day and not the next.

The same migration adds `maintenance_fleet_downtime`, so the dashboard's downtime tile is
one round trip rather than one per vehicle, and the overlap merge is not reimplemented in
the browser.

---

## 7. The Maintenance dashboard

The page was 79 lines with no search, no filters and no fleet-wide visibility,
hand-rolling status labels and tones that already existed in `presentation.ts` and
formatting dates with raw `toLocaleString`. Replacing it deletes both duplicates.

### Metric definitions

The card says which figures are states and which are period totals. Mixing the two
silently is how a number ends up in a board pack that nobody can explain.

| Tile | Definition | Period? |
|---|---|---|
| Scheduled / In progress / Completed | Records in that status, counted by the database with `count: 'exact'` | No — state now |
| Service due soon | Vehicles approaching a threshold, excluding those already due or overdue | No |
| Service overdue | Vehicles past a threshold **or due today** | No |
| Vehicles in maintenance | **Distinct** vehicles with work under way — two concurrent jobs on one car is one car | No |
| Maintenance costs | `public.expenses` attached to a maintenance record, `status = 'recorded'`, `incurred_on` in the period, **summed per currency and never across currencies** | Yes |
| Actual downtime | Minutes vehicles were **actually** out of service. Overlapping jobs on one vehicle merged; separate vehicles summed; work scheduled but never started **not counted** | Yes |

Due soon and overdue **never count the same vehicle twice**. Cancelled work is counted
nowhere.

### Records tab

Search (reference, title, plate, make, model), and filters for status, vehicle, category,
priority and scheduled-date range — all held in the URL so a view can be bookmarked, using
the same `updateParams` convention as the expenses screen. House table-plus-card-list
shape, `ListPagination` verbatim. Detail navigation and lifecycle actions unchanged.

**The scheduled-date filter is deliberately separate from the period.** A records list
that silently hid next month's scheduled work would be useless to whoever is planning it.

### Preventive servicing tab

Lists the **whole fleet, including vehicles with no plan** — a car nobody has scheduled a
service for is the most actionable row on the page, and a list that quietly omitted it
would look reassuring and be wrong. Sorted worst-first.

Status comes from the same shared rule as Vehicle Details and the record's own card.
Actions go to the existing plan editor, to the vehicle, or to scheduling prefilled with
the vehicle (where the category already defaults to preventive). **Nothing here creates a
maintenance record because a service became due.**

---

## 8. A correctness defect I introduced, found, and fixed

`supabase/config.toml` sets **`max_rows = 1000`**. A read with no `.range()` stops at a
thousand rows and says nothing about it.

For a list that is a truncation an operator can see. For a **sum** or a **count** it is a
wrong number that looks authoritative — and two of mine were money. My first version of
the dashboard would have **silently under-reported maintenance spend** for any agency with
more than a thousand maintenance-linked expenses.

Fixed in `4548b99`: spend and per-record cost page explicitly until a short page; status
counts are taken by the database with `count: 'exact', head: true`, which transfers no
rows at all; the servicing tab reads a narrow, paged query of only plan-bearing records
rather than the capped history — otherwise a vehicle whose plan sat beyond the cap would
have been listed as having **no service plan at all**, the one answer on that screen that
must never be wrong by omission.

`countMaintenance` was deleted with its tests rather than left beside the database counts.
Keeping both would have been a second definition of "how many vehicles are in
maintenance", which is precisely the failure this work package exists to close.

---

## 9. Operational independence

Verified, not assumed. A due or overdue reminder does not take a vehicle off the road,
change maintenance status, cancel a rental, block availability, complete maintenance,
resolve an incident or create an expense. The service status is computed in the browser
from stored columns and rendered; it is an input to no decision anywhere.

Availability continues to be decided by `vehicles_available_between` reading maintenance
records and explicit off-road restrictions — untouched by this work. The 22 existing
maintenance-acceptance database tests, which pin that behaviour, still pass.

---

## 10. Focused test results

Focused, per the brief — the whole repository suite was not re-run.

### New tests

| Suite | | Covers |
|---|---|---|
| `src/lib/compliance/service.test.ts` | **24 pass** | Both limbs at every boundary, the lead-day boundary, the threshold day and threshold reading, time-zone correctness, first-threshold logic, unknown odometer, plan selection |
| `src/features/maintenance/service-plan-form.test.ts` | **19 pass** | Date-only, mileage-only, combined, both intervals; `5,000` / `5 000` / `1.5` / `-10` refused rather than nulled; zero intervals refused; `2027-02-30` refused; every bad field reported at once |
| `src/features/maintenance/dashboard.test.ts` | **6 pass** | Vehicles with no plan included; plans not attributed to the wrong vehicle; due-soon and overdue never counting the same vehicle twice; worst-first ordering |
| `src/features/vehicles/service-date-preservation.test.ts` | **3 pass** | `next_service_on` absent from the update, insert **and** import payloads |
| `supabase/tests/service-plan-advancement.test.ts` | **12 pass** | The owner's worked example; date-only and distance-only recurrence; time-zone correctness; fall back to the start reading; **no reading means no guess**; unrelated maintenance does not reset; one-off reminders do not advance; no double advancement; cross-agency refusal; fleet downtime merging and tenancy |

### Regression

| Suite | |
|---|---|
| `src/lib/compliance`, `src/features/maintenance`, `src/features/vehicles`, `src/features/expenses`, `src/pages` | **498 pass** (32 files) |
| `maintenance-acceptance`, `maintenance-management`, `service-plan-advancement` | **38 pass** |
| `permission-matrix`, `tenant-isolation`, `vehicles-import-batch`, `fleet-occupancy`, `expenses` | **190 pass** |
| **Total** | **726 pass, 0 fail** |

`permission-matrix` reads the live policy expressions back out of Postgres and compares
them with the TypeScript matrix, so authorization has not drifted. `tenant-isolation`
passes unchanged.

### Validation against the brief's eighteen points

| # | | Evidence |
|---|---|---|
| 1–3 | Date-only, mileage-only, combined plans | `service-plan-form.test.ts` |
| 4 | Recurring interval persistence | Harness probe + `service-plan-advancement.test.ts` |
| 5 | Success and failure feedback | Read-back summary + positive Alert + per-field errors in a colour that renders |
| 6 | Values surviving refresh | Form re-seeds from the stored row; the erase mechanism in §1(b) is fixed |
| 7 | Vehicle Details reflecting the plan | §5, same shared rule |
| 8–9 | Upcoming and overdue indicators | Dashboard tiles, servicing tab, card badges |
| 10 | Threshold boundaries | `service.test.ts`, both limbs, both sides |
| 11 | First-threshold logic | `service.test.ts`, four combinations |
| 12–14 | Advancement, non-advancement, no double advancement | `service-plan-advancement.test.ts` |
| 15–16 | Legacy preservation, editing not clearing | `service-date-preservation.test.ts` |
| 17 | Tenant isolation and authorization | `permission-matrix`, `tenant-isolation`, cross-agency cases |
| 18 | Availability unaffected by reminders alone | §9; 22 acceptance tests unchanged |

### Gates

`tsc -b --noEmit` clean · `prettier --check` clean · `eslint` clean on every changed file.

**`npm run lint` is red on this baseline and was before this change** — 12 pre-existing
errors in `src/features/incidents/api.ts`, `src/pages/incidents/IncidentNewPage.tsx` and
`src/pages/rentals/RentalNewPage.tsx`, none of them files this change touches. `npm run
verify` therefore cannot pass on `origin/staging` today. Recorded again because a
repo-wide gate that is already failing will not catch the next regression.



---

## 11. Migration requirements — ACTION NEEDED

One new migration. It is **not applied**, and the frontend is published without it.

```
supabase/migrations/20261126120000_maintenance_service_plan_advancement.sql
```

| | |
|---|---|
| Local migrations | **141** |
| Applied on staging | **140** |
| Drift | **1 — this file, by design** |

It is additive: two `create or replace` function definitions, a comment and grants. No
table DDL, no data migration, nothing dropped or renamed. It replays cleanly in order on
the harness, which is how the 12 advancement tests run.

**Until you apply it:**

- Recurring advancement does not happen. Completing a service leaves its plan where it is,
  exactly as today — no regression, just the defect still present.
- The dashboard's **Actual downtime** tile reads *"Unavailable"* and says it needs this
  migration, rather than showing a bare dash that would look like zero. It starts working
  the moment the migration lands, with no redeploy.

Everything else in this release works without it.

### To apply it

Run these yourself, from the worktree, against **staging** `yeklucfthspvejlkffln`. Confirm
the project ref before the second command, and read the dry run before approving.

```powershell
cd E:\pevvy-maintenance-acceptance-20261125
Get-Content supabase\.temp\project-ref     # must read yeklucfthspvejlkffln
npx supabase db push --dry-run
npx supabase db push
```

Then confirm the ledger reconciles at 141 / 141, and re-check the downtime tile.

I did not run these. The execution environment refused a database push in this work
package's predecessor and that restriction is respected.

<!-- REVIEW -->

<!-- DEPLOYMENT -->

---

## 13. Acceptance register

| | |
|---|---|
| Passed | **26** |
| Failed | **1** — scenario 19, Preventive servicing |
| Untested | **0** |

Scenario 19 stays **failed** until you verify it yourself. Nothing here marks it
accepted. The other 26 are not reopened: no evidence of a regression was found, and the
suites that pin them pass unchanged.

Dashboard acceptance is recorded separately as **scenario 28**, below.

### Scenario 19 — Preventive servicing

Use **Kia Forte — DEMO-004**, odometer 54,375, the vehicle from your report.

1. Maintenance → open or schedule a record for DEMO-004 → **Preventive servicing**.
2. Enter **Next service on** a date about three weeks out, **Next service at** `55,000`,
   **Repeat every** `180` days and `5,000`. Press **Save service plan**.
   - The green **Service plan saved** confirmation appears, **and** the grey summary above
     the boxes now shows those four figures. *That summary is the fix* — it is read back
     from the database, not from what you typed.
3. **Reload the page.** The four figures are still there.
4. Now type `5,000` — with the comma — into **Repeat every (km)** and save. It is
   **refused**, in red, on that field. Before this change it was accepted, stored as
   nothing, and reported success.
5. Clear every box and save. Refused with "Set at least one reminder".
6. Enter `0` in **Repeat every (days)**. Refused before it reaches the database.
7. Vehicle Details for DEMO-004:
   - **Compliance** has three rows — insurance, technical inspection, registration. No
     next service.
   - **Service and maintenance** shows the same date and mileage you just saved, the
     current odometer, days and distance remaining, the intervals and the status.
   - **Manage service plan** returns you to the record.
8. **Edit vehicle** → the **Next service due** field is gone, and insurance, inspection,
   registration and odometer are all still there. Save the vehicle, then re-check the
   Service and maintenance card: **the plan is unchanged.**
9. Set **Next service at** to `54,000` — below the current 54,375 — and save. Status
   becomes **Overdue**, triggered by distance while the date is still in the future.
10. Confirm the vehicle is **still bookable**: the reminder has not taken it off the road.

**Recurring advancement (step 11) requires the migration in §11 to have been applied.**
Start the maintenance, then complete it with a completion odometer. The plan moves to
*completion date + 180 days* and *reading + 5,000*. Complete a different, unrelated repair
on the same vehicle and confirm the plan does **not** move.

### Scenario 28 — Maintenance Management dashboard

1. Maintenance. Eight figures above two tabs. The two money-and-time tiles carry the month
   in their label; the other six do not, because they are states now.
2. Step the month back and forward. **Costs** and **Actual downtime** change; the six
   counts do not. Return with **This month**.
3. **Maintenance records** — search a reference, a plate and a make. Filter by status,
   vehicle, category, priority and a scheduled-date range. Confirm the filters survive a
   page reload (they are in the URL) and that **Clear all filters** empties them.
4. Open a record from the list: detail navigation and the lifecycle actions are unchanged.
5. **Preventive servicing** — every vehicle appears, including ones with no plan, worst
   first. Check one vehicle's date, mileage, remaining and status **match its own Vehicle
   Details card exactly**. That is the agreement this work package exists to produce.
6. **Configure** on a vehicle with no plan opens scheduling with that vehicle already
   selected and the category on Preventive.
7. Confirm nothing on this page changed a vehicle's status, a rental, or availability.

If **Actual downtime** reads *"Unavailable"*, the migration has not been applied yet. That
is expected and self-healing — see §11.

---

## 14. Not done, and why

- **Nothing is marked accepted.** 26 / 1 / 0 stands as it was.
- **Production remains NO-GO.** No production credential, no production project, no
  deployment. `origin/main` untouched.
- **No Edge Function deployed.** Six of nine remain undeployed on staging, as before.
- **The legacy `vehicles.next_service_on` column is not dropped**, and no backfill into
  `maintenance_records` was attempted. Dropping it is irreversible and backfilling it
  would invent plans nobody configured. Both are decisions for you, not side effects of
  this correction.
- **`maintenance_due_summary` is still unused.** Its `+ 30` and `- 500` are hardcoded in
  SQL and contradict the agency-configurable lead days, so wiring it in would have
  reintroduced the second definition this work removes. It is now dead SQL; retiring it
  needs its own migration.
- **Rental Financial Adjustments not started.**


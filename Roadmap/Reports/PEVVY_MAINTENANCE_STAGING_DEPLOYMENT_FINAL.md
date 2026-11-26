# PEVVY — MAINTENANCE REMEDIATION: FINAL STAGING DEPLOYMENT

**Date:** 2026-11-26
**Worktree:** `E:\pevvy-maintenance-acceptance-20261125`
**Branch:** `fix/maintenance-manual-acceptance-20261125`
**Published commit:** `caf6cd1452ed1060e010ebdd1f30daf737f364eb`
**Reviewed code commit:** `4772e242e6d3b5fb004387776645de4a7a4a62cf` (ancestor of HEAD, verified)
**Staging project:** `yeklucfthspvejlkffln` (Pevvy-Staging)
**Production `ysnumxtzcgzyabrghxwq`:** not accessed, not linked, not deployed to.

---

## 1. Result

**Staging deployment is complete and verified.** The corrective migration is applied, the
reviewed frontend is published, and the deployed bundle has been checked against the
guarded artifact file by file.

| Step | Result |
|---|---|
| Staging project verified | `yeklucfthspvejlkffln` / Pevvy-Staging |
| Migration ledger | **140 local / 140 applied / zero drift**, `20261125130000` applied |
| Reviewed commit in HEAD | **yes** — `4772e24` is an ancestor of `caf6cd1` |
| Guarded build applicability | **confirmed** — no frontend source change since `4772e24` |
| Fast-forward eligibility | **confirmed** — `origin/staging` was an ancestor of HEAD |
| Push | **done** — `977e32e..caf6cd1`, no force |
| Hostinger publication | **verified** — new build live, 196 files |
| Deployed artifact SHA | `8cfefba1…` — **differs from the expected `c09c4524…`; fully explained in §5** |
| Deployed JavaScript vs reviewed artifact | **byte-identical**, every file |
| Manual acceptance | **not performed.** Owner baseline 11/11/4 unchanged |
| Production | **NO-GO** |

**One expectation in the authorization was not met and is not treated as met:** the
deployed manifest SHA is `8cfefba1…`, not the `c09c4524…` named in step 8. §5 explains
exactly why, with evidence, and why it does not indicate a different or wrong build. The
file count matched at 196.

---

## 2. Migration ledger — independently verified

Read-only `supabase migration list` against the authorized project, reconciled against the
branch's migration directory:

```
LOCAL (branch):     140
APPLIED (staging):  140
20261125130000 applied?  YES
last applied:            20261125130000
pending (local not applied):  []
applied not in branch:        []
DRIFT: ZERO
```

### Function permissions

The owner executed the migration and reported:

| Check | Result |
|---|---|
| `authenticated_can_execute` | true |
| `service_role_can_execute` | true |
| `anon_can_execute` | false |

**Recorded as owner-verified, not independently verified.** This session can reach the
staging migration ledger read-only but cannot run arbitrary SQL there without the database
credentials, which were not used. The three results are exactly what the migration's
`revoke … from public, anon` followed by `grant execute … to authenticated, service_role`
produces, so they corroborate the correction precisely. The live functional proof is the
first availability search performed during manual acceptance — that call is the one that
would have failed had the grant been missing.

---

## 3. Source publication

- Remote confirmed as the owner's own repository, `wiredmediadigital/atlas-car-rental-saas`.
  `upstream` (the original `salhiworks/atlas-car-rental-saas`) has its push URL set to
  `DISABLED--never-push-to-original-atlas` and was not contacted.
- `origin/staging` before: `977e32eb3447af2ec886cb512e8a9f06212b4259`
- Fast-forward verified before pushing: the old tip was an ancestor of HEAD.
- Push output: `977e32e..caf6cd1  HEAD -> staging` — a fast-forward. **No force, no history rewrite.**
- `origin/staging` after: `caf6cd1452ed1060e010ebdd1f30daf737f364eb`
- **`origin/main` unchanged at `31383a97eb8e000f9189913b255af4da22bf3a26`.**
- 9 commits published.

---

## 4. Hostinger publication — verified by content, not by status code

**HTTP status is worthless on this host and was not relied on.** The staging site serves
`index.html` for every unrecognised path, so a deliberately invented asset URL returns
`200 text/html`. Verification therefore used the published manifest, the `content-type` of
each asset, and the actual bytes.

### Before and after

| | Before | After |
|---|---|---|
| `contentSha256` | `f722d3d19a84ca8a48a8ea881eef6d58aee37b7c232335064162b496063237fe` | `8cfefba1e5c966b91c3c5af667509dd4f5ee15b09b6ddf596e53260bc246b245` |
| `fileCount` | 192 | **196** |
| `projectRef` | `yeklucfthspvejlkffln` | `yeklucfthspvejlkffln` |
| `buildMode` | staging | staging |

The manifest changed and the file count moved 192 → 196, matching the reviewed artifact.
A genuinely new build was published.

### The reviewed code is live

Probes against the deployed chunks, each served as real JavaScript
(`content-type: application/x-javascript`), not the HTML fallback:

| Deployed chunk | Probe | Result |
|---|---|---|
| `assets/VehiclesPage-B9dChn6L.js` | `not available for hire` | **found** |
| `assets/VehiclesPage-B9dChn6L.js` | `Clear the Status cell` | **found** |
| `assets/VehicleDetailPage-DhwNwrF_.js` | `Return to service` | **found** |
| `assets/VehicleDetailPage-DhwNwrF_.js` | `Take off the road` | **found** |
| `assets/MaintenanceDetailPage-DxpE5Rqs.js` | `Related incident` | **found** |

The first two strings exist only in this closure's CSV import correction and did not exist
in any prior build. Their presence is positive proof that the reviewed source is deployed.

### Configuration safety on the deployed bundle

The `env` chunk — which carries the Supabase URL and the browser publishable key — is
**byte-identical to the artifact the guard verified locally**:

| Check on the deployed `assets/env-B5obPimh.js` | Result |
|---|---|
| `yeklucfthspvejlkffln` (staging) | 1 occurrence |
| **`ysnumxtzcgzyabrghxwq` (production)** | **0 occurrences** |
| `sb_secret_…` | **0 occurrences** |
| `sb_publishable_…` | 1 occurrence |
| Byte-identical to the locally guarded build | **yes** |

The deployed `index` chunk also contains **zero** production references. Hostinger built
with the same staging project and the same browser key the guard validated.

### `npm run setup:site` — the project's own check

```
✓ https://quantum-lavenderblush-buffalo-97.hostingersite.com is online
✓ Served over HTTPS with Atlas security headers
✓ Sign-up, the four sign-in links and deep links all load (10 pages)
✓ The build uses Supabase project yeklucfthspvejlkffln
! No .env.local to compare the key with; only checked that no secret key is present
✗ Edge Functions not live: account-closure, account-closure-notice, gps-provider,
  mfa-reset, public-booking, team-invitations
```

The ✗ is the **pre-existing** Edge Function gap, unchanged by this release. Per the
authorization's restrictions, **no Edge Function was deployed.** It is carried as gate 5
in §8.

---

## 5. Why the artifact SHA differs — and why it is not a different build

The authorization expected `c09c4524…`. The deployed manifest says `8cfefba1…`. This was
investigated rather than waved through, because a SHA mismatch is exactly the kind of thing
that should stop a release.

**Finding: every JavaScript file deployed is byte-identical to the guarded artifact. The
only content difference in the entire bundle is two colour values in the stylesheet,
differing in the sixth decimal place.**

### Method

Vite names each chunk by a hash of its content, and every chunk's content embeds the
hashed filenames of its imports — so a single change propagates new filenames through the
import graph. The manifest's `contentSha256` hashes **file paths as well as contents**, so
different filenames alone change it even when nothing executable differs.

To see past that, every deployed `.js`/`.css` file was downloaded and compared against the
local artifact with the 8-character content hashes normalised away, in both filenames and
in-file import paths, and matched as a collision-free multiset of (normalised name +
normalised content):

```
deployed js/css files : 167
local    js/css files : 170
MATCHED (name + content, hashes normalised): 166
deployed-only : 1   [ index-H.css ]
local-only    : 4   [ index-H.css, maplibre-gl-H.js,
                      maplibre-gl-H.css, maplibre-gl-worker-H.js ]
```

The three `maplibre` files were simply not reached by the crawl. Checked directly, they are
served by the host **under exactly the same filenames as the local build** — identical
filename means identical content hash, so they match too.

That leaves one file.

### The single real difference

`index.css`, same length (69,988 bytes), differing at byte 31,303:

```
DEPLOYED:  lab(8.0926% -.583492 -1.76435/.3)
LOCAL   :  lab(8.0926% -.583477 -1.76435/.3)
```

A difference of `0.000015` in one LAB colour component, in a Tailwind-generated fallback
for `#16181a` at 30% and 40% opacity. It is a floating-point rounding artefact of the
colour conversion running on a different machine and toolchain. It is not visually
distinguishable, and the `#16181a4d` hex fallback immediately preceding it is identical.

### Conclusion

The deployed build **is** the reviewed source. The SHA differs because chunk filename
hashes differ, and the manifest hashes filenames. No JavaScript differs by a single byte.

**This should be fixed for future releases, not because this build is wrong, but because
an artifact hash that cannot be reproduced by the deploying party is a verification control
that does not work.** Pinning the builder's Node version — or having Hostinger publish the
exact artifact that was reviewed, rather than rebuilding from source — would make the
expected-SHA check meaningful. As it stands the check can only ever be satisfied by
accident. Recorded as gate 7.

---

## 6. What this release contains

Nine commits, `977e32e..caf6cd1`:

| Commit | Content |
|---|---|
| `696cc51` | Claude Code handoff and remediation baseline |
| `be77da1` | Formatting of incident and maintenance source |
| `ac9f48f` | **The remediation** — a maintenance restriction means the period it covers |
| `51e904e` | Roadmap and release manifest |
| `87e4e7f` | Remediation report |
| `2734ade` | CSV import cannot land an off-road vehicle as bookable |
| `4772e24` | **Four defects found by the release safety review** |
| `27e9486`, `caf6cd1` | Release closure report |

The root cause remediated: the maintenance work package had rewritten
`vehicles_available_between`, losing the overdue-unreturned-hire exclusion and making any
in-progress record block every period. That single function is what the rental forms, the
calendar and public booking all ask, which is why one defect produced the standard rental
regression, the period-specific failures and the overdue-checkout failure at once.

The four review findings, all fixed before publication: a missing `EXECUTE` grant that
would have broken every availability search on staging; account closure collecting three
storage buckets its sweeper was hard-coded to refuse; `off_road_by` able to make an Auth
account undeletable; and an undisclosed second caller of the assignment self-heal.

---

## 7. Manual acceptance checklist — 26 scenarios

**STATUS: NOT ACCEPTED.** The owner's baseline of **11 passed / 11 failed / 4 pending**
stands as the historical record and is not amended by this deployment. Automated tests and
a successful deployment are **not** acceptance. Nothing below may be marked accepted until
the owner confirms it on hosted staging while signed in.

Site: `https://quantum-lavenderblush-buffalo-97.hostingersite.com`

### Previously PASSED — 11 (confirm no regression)

| # | Scenario | Confirmed |
|---|---|---|
| 1 | Fleet status synchronization | ☐ |
| 2 | Active-maintenance presentation | ☐ |
| 3 | Standalone "In maintenance" removed from Vehicle Details | ☐ |
| 4 | Early-start confirmation | ☐ |
| 5 | Early-start cancellation | ☐ |
| 6 | Actual maintenance timestamps | ☐ |
| 7 | Completion restores eligible availability | ☐ |
| 8 | Multiple restrictions | ☐ |
| 9 | Independent off-road restrictions | ☐ |
| 10 | Optional incident association | ☐ |
| 11 | Automatic Fleet / Vehicle Details refresh | ☐ |

> The acceptance register's prose enumerates **ten** distinct items against a stated count
> of eleven; "early-start confirmation and cancellation" is split above as the most likely
> reading. **Please confirm the split.** No scenario was invented to reach the count.

### Previously FAILED — 11 (what this release remediates)

| # | Scenario | Confirmed |
|---|---|---|
| 12 | Future scheduled availability | ☐ |
| 13 | Overlapping reservation prevention | ☐ |
| 14 | Immediate restriction after early start | ☐ |
| 15 | Overdue checkout restriction | ☐ |
| 16 | Incident-to-maintenance creation and prepopulation | ☐ |
| 17 | Related maintenance on Incident Details | ☐ |
| 18 | Incident-resolution lifecycle independence | ☐ |
| 19 | Preventive servicing interface | ☐ |
| 20 | Downtime presentation | ☐ |
| 21 | Supporting documents | ☐ |
| 22 | **Standard rental regression — priority zero** | ☐ |

### Previously PENDING — 4

| # | Scenario | Confirmed |
|---|---|---|
| 23 | Legacy restriction resolution | ☐ |
| 24 | Incident resolution warning | ☐ |
| 25 | Maintenance completion independence | ☐ |
| 26 | Expense integration | ☐ |

### Also worth checking in this deployment

- ☐ Vehicle Details no longer offers an Operational status dropdown
- ☐ Edit Vehicle no longer offers the legacy Status dropdown
- ☐ Maintenance Details links to the specific related incident, not a generic link
- ☐ **CSV import of a row whose Status reads `Servicing` or `Off the road` is refused with
  a message, and the vehicle does not arrive bookable** (new in this release)
- ☐ Reported examples: MNT-2026-00009, INC-2026-00002, DEMO-004, DEMO-003 (Hyundai
  Elantra), DEMO-019 (Ford Mustang), DEMO-001 (Toyota Corolla)

**Scenario 22 first.** It is the one the owner raised as priority zero, and the one the
root-cause fix most directly addresses.

---

## 8. Remaining production gates

| # | Gate | State |
|---|---|---|
| 1 | Owner manual acceptance of all 26 scenarios on hosted staging | **open** |
| 2 | Assignment activation defaults ON, contradicting the STG-02 contract | **open — owner decision** |
| 3 | Two stale pre-withdrawal swap contract tests | open — governance only, **not a security regression** |
| 4 | Eleven ungated incident/maintenance `SECURITY DEFINER` writes | **open — policy recorded, correction deferred** |
| 5 | Six of nine Edge Functions not deployed; hosted public booking blocked | open — **no function deployed, per restrictions** |
| 6 | `withdraw-active-swap.test.ts` absent from this branch — nothing asserts the swap stays withdrawn | open |
| 7 | Deployed artifact hash not reproducible by the deploying party | **open — new**, see §5 |
| 8 | Independent concurrency verification (PGlite cannot give two hosted transactions) | open |
| 9 | Promotion of `staging` → `main` with production migration and acceptance evidence | open |

**Production remains NO-GO.**

---

## 9. Restrictions honoured

- No application change, no migration, no full test suite re-run, no further review cycle.
- **No Edge Function deployed** — the six missing remain missing by instruction.
- No billing, Stripe, pricing or payment change.
- **Production not accessed, not linked, not deployed to.** `origin/main` untouched.
- **No force push.** The publication was a verified fast-forward.
- No credential printed, committed or written to disk. The staging browser key was read
  from the authorized project and held only in the process environment of the build.
- Rental Financial Adjustments not begun.
- **Manual acceptance not marked complete.**

---

*Deployment and automated verification only. Nothing in this report constitutes manual
acceptance or production approval.*

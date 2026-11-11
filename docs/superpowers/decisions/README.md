# Decision ledgers

These files record decisions made while two features were built, in the order
they were made. They are a **historical record, not current documentation.**

Read them when you need to know *why* something is the way it is — especially
where the code looks odd and the obvious alternative was considered and
rejected. Several entries overturn the plan or the spec they were working
from, and a few overturn an earlier entry in the same file.

Three cautions:

- **Later entries supersede earlier ones.** Both are kept, in order, because
  the reasoning for a reversal is usually the useful part. If two entries
  conflict, the later one won.
- **File paths and line numbers were true when written** and many have since
  moved. Treat them as pointers to the right area, not as current addresses.
- **A ruling is not a guarantee.** Each one names what it would cost if it
  turned out to be wrong. Where that cost has since been paid, the fix is in
  the git history, not here.

| File | What it covers |
| ---- | -------------- |
| `2026-11-09-vehicle-tier-pricing-ledger.md` | Three-tier pricing by fleet size: the authored limits, the database trigger, the transactional importer, the in-app change-plan flow, the public pricing page, and the deployment. Shipped. |
| `2026-11-08-account-closure-ledger.md` | Closing an agency account. **Paused mid-way**, with tasks 6 and 7 unstarted; the branch is `feat/account-closure`. |

The specs these argue from are in `../specs/`, and the plans in `../plans/`.

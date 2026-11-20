# PEVVY Staging Branch Creation Plan

This plan is not an execution authorization. No branch or worktree was created.

## Safe procedure

1. Preserve the current development worktree unchanged.
2. Start from `origin/main` at `31383a9` in an isolated release workspace or
   worktree.
3. Create local `staging` from that exact base only after owner approval.
4. Cherry-pick `fbbfe38` and review it.
5. Apply only the manifest's infrastructure, database, application, and test
   files in separate commits. Do not use `git add .`.
6. Run the full release checks on the candidate and inspect the staged diff,
   migration order, bundle references, and secret scan.
7. Review the candidate commit range and branch diff against `origin/main`.
8. Push `staging` with upstream tracking only after the first staging review.

Illustrative commands for the separately authorized next task:

```powershell
git worktree add -b staging <isolated-release-path> 31383a9
Set-Location '<isolated-release-path>'
git cherry-pick fbbfe3878826da5ee858d3a9a2280f15f0fd744f
# selectively stage only the approved manifest files
git add <approved-files>
git commit -m "feat: prepare Pevvy staging release candidate"
git status --short --branch
git diff --check origin/main...HEAD
git push --set-upstream origin staging
```

The commands are deliberately not run by this audit.

## Deployment and recovery boundary

The repository documents `origin/main` as the live `pevvy.io` deployment
trigger. A push to `main` is therefore prohibited for staging. Hostinger's
actual staging branch/build trigger and rollback control must be verified in the
owner interface before the first GitHub connection or push, because the first
connection may trigger an immediate build.

For a failed staging release, stop traffic/validation, preserve the deployment
identifier and artifact hash, and use the Hostinger-verified prior staging
artifact or revision. Do not revert production, reset Git history, or roll back
database migrations without a separately approved recovery plan.

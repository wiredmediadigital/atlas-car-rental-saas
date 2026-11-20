# PEVVY Staging Dependency Remediation Report

Date: 2026-11-20
Worktree: `E:\pevvy-staging-release`
Branch: `staging`

## Verdict

**BLOCKED — RELEASE VERIFICATION FAILED**

The dependency blocker was investigated without changing global npm settings,
the lockfile, source code, or the original development worktree.

## Diagnostics

- Node.js: `v26.13.1`
- npm: `11.20.0`
- Registry: `https://registry.npmjs.org/`
- Proxy configuration: none detected
- Disk space: sufficient on `E:`
- Initial `node_modules`: absent
- `npm ping --fetch-timeout=10000 --fetch-retries=0`: PASS
- `npm cache verify`: FAIL — `EPERM` while unlinking a file in the shared npm
  cache; npm also could not write its diagnostic log directory
- First `npm ci`: stalled for more than five minutes with no output; stopped
- Remediation `npm ci --no-audit --no-fund --cache E:\pevvy-staging-release\.npm-cache --fetch-timeout=30000 --fetch-retries=1`: also stalled without output and was stopped

## Root cause assessment

Confirmed: the shared npm cache has a filesystem/locking problem, evidenced by
the `EPERM` unlink failure. Confirmed: registry reachability is not the primary
failure because `npm ping` passed. The worktree-local-cache retry did not produce
enough evidence to distinguish package extraction, antivirus/filesystem locking,
or another npm installation hang. That remaining cause is **unknown**, not
silently treated as resolved.

No `package-lock.json` change, dependency upgrade, TLS weakening, force flag, or
legacy-peer-deps workaround was used. The partial ignored install artifacts were
not included in Git; the candidate remains clean.

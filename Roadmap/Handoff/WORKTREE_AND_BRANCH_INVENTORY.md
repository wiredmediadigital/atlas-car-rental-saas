# Worktree and branch inventory

Inspection: 2026-11-25. Existing worktrees were preserved.

| Path | Branch / commit | Purpose and state |
|---|---|---|
| `E:\\pevvy-car-rental-saas-main` | `main / fbbfe38` | Primary dirty mixed checkout; protected |
| `E:\\pevvy-billing-remediation` | `fix/staging-billing-recovery-20261123 / 5197000` | Billing recovery candidate |
| `E:\\pevvy-car-rental-saas-main\\.stg11-phase1-candidate` | `stg11-phase1-candidate / eec6fca` | Historical staging candidate |
| `E:\\pevvy-car-rental-saas-main\\.stg17-remediation` | `detached / eec6fca` | Historical remediation snapshot |
| `E:\\pevvy-car-rental-saas-main\\.stg19-mfa-release` | `stg19-mfa-release / b1c96e8` | MFA candidate |
| `E:\\pevvy-car-rental-saas-main\\.stg20l-canonical-20261122` | `stg20l/canonical-baseline-20261122 / 0b96cef` | Protected baseline |
| `E:\\pevvy-car-rental-saas-main\\.stg20l-production-repro-20261122` | `detached / 31383a9` | Production-reproduction snapshot |
| `E:\\pevvy-driver-availability-20261125` | `fix/driver-availability-20261125 / 112cc99` | Driver candidate; 9/9 owner acceptance |
| `E:\\pevvy-incident-remediation` | `fix/staging-incident-management-20261124 / b1ea08a` | Incident lineage |
| `E:\\pevvy-incident-ui-corrections-20261125` | `fix/staging-incident-ui-corrections-20261125 / a302525` | Incident UI candidate |
| `E:\\pevvy-maintenance-20261125` | `feat/maintenance-management-20261125 / 977e32e` | Recommended maintenance investigation candidate |
| `E:\\pevvy-staging-integration-20261125` | `fix/staging-integration-20261125 / 83892f2` | Staging integration candidate |
| `E:\\pevvy-staging-release` | `staging / 01edc3c` | Staging worktree; not clean baseline |

Local `main` was ahead one commit of local `origin/main`; several feature branches track or lag `origin/staging`. Do not use primary main for new work.

## Recommended continuation

Inspect `E:\\pevvy-maintenance-20261125` status, ancestry, and reports without changing it. Then create a new isolated worktree from an explicitly selected reviewed base. Preserve the dirty primary checkout and all existing worktrees. Do not merge whole historical branches; cherry-pick only reviewed commits after verifying interfaces and migrations.

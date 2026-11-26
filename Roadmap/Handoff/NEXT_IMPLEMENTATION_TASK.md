# Next implementation task

## PEVVY — MAINTENANCE MANAGEMENT MANUAL ACCEPTANCE FAILURE REMEDIATION

This is the immediate next work package. Do not begin Rental Financial Adjustments until Maintenance acceptance is complete or the owner explicitly changes priorities.

Resolved 2026-11-26. The owner supplied the complete prompt after onboarding and it is archived at `Roadmap/Prompts/PEVVY_MAINTENANCE_MANUAL_ACCEPTANCE_REMEDIATION_PROMPT.md`. It supersedes `Roadmap/Prompts/PEVVY — CONSOLIDATED MAINTENANCE MA.txt`, which predates the 26-scenario acceptance run and does not enumerate its results.

Priorities:
1. Restore standard rental lifecycle integrity.
2. Correct period-specific maintenance availability.
3. Correct immediate and overdue restrictions.
4. Remove Operational status from Vehicle Details.
5. Remove Status from general vehicle editing.
6. Preserve dedicated independent off-road actions.
7. Complete legacy restriction resolution.
8. Complete incident-to-maintenance creation.
9. Display related maintenance on Incident Details.
10. Improve related incident presentation on Maintenance Details.
11. Implement incident-resolution warning and lifecycle independence.
12. Complete preventive servicing interface.
13. Validate and expose downtime.
14. Complete supporting documents.
15. Verify expense integration.
16. Preserve accepted functionality.
17. Deploy corrected functionality to staging after focused validation.
18. Obtain owner manual acceptance and record each scenario.

Start by inspecting the maintenance worktree and reports, then create an isolated implementation workspace. Keep database, frontend, staging, and manual acceptance gates separate. No production deployment is authorized by this document.

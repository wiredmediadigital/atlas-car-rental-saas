# Database migration state

The local ordered migration inventory is under `supabase/migrations/` and ends in this checkout at `20261122100000_billing_platform_state_service_rpc.sql`. Assignment, pricing, billing-state, and historical backfill migrations are present as untracked work in the dirty primary checkout; do not assume they are part of clean main.

Relevant evidence:
- Incident Management has a candidate migration and reports; verify the selected candidate rather than infer from main.
- Driver availability closure reports staging through `20261125100000_driver_availability_conflicts`; independent concurrency remains open.
- Maintenance reports identify `20261125110000_maintenance_management.sql` and `20261125120000_maintenance_fleet_status_integration.sql`. Reconciled 2026-11-26: both are present in the staging source lineage and both are applied on staging. Their absence from the primary checkout is an artefact of that checkout being 19 commits behind, not a missing migration. The staging ledger and the staging source reconcile 139 to 139 with no drift in either direction.
- Withdrawn vehicle-swap migrations must not be revived.
- Historical billing remediation must use its isolated lineage, not mixed main.

No migration was applied or repaired here. Before any staging operation, verify the exact ref, compare local and remote ledgers read-only, run a dry run, and obtain authorization. Do not access production to establish new information.

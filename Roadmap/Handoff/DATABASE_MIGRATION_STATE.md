# Database migration state

The local ordered migration inventory is under `supabase/migrations/` and ends in this checkout at `20261122100000_billing_platform_state_service_rpc.sql`. Assignment, pricing, billing-state, and historical backfill migrations are present as untracked work in the dirty primary checkout; do not assume they are part of clean main.

Relevant evidence:
- Incident Management has a candidate migration and reports; verify the selected candidate rather than infer from main.
- Driver availability closure reports staging through `20261125100000_driver_availability_conflicts`; independent concurrency remains open.
- Maintenance reports identify `20261125110000_maintenance_management.sql` and `20261125120000_maintenance_fleet_status_integration.sql`. Reconciled 2026-11-26: both are present in the staging source lineage and both are applied on staging. Their absence from the primary checkout is an artefact of that checkout being 19 commits behind, not a missing migration. The staging ledger and the staging source reconcile 139 to 139 with no drift in either direction.
- Withdrawn vehicle-swap migrations must not be revived.
- Historical billing remediation must use its isolated lineage, not mixed main.

No migration was applied or repaired here. Before any staging operation, verify the exact ref, compare local and remote ledgers read-only, run a dry run, and obtain authorization. Do not access production to establish new information.

---

## 2026-11-27 — five unapplied hardening migrations

Local 148, hosted staging 143. The five `202611281*` migrations are developed and tested
locally and **not applied to any hosted database**. Production has not been accessed.

Checksums and apply order are in
`Reports/PEVVY_PRODUCTION_HARDENING_STAGING_MIGRATION_AUTHORIZATION.md`. Apply in
filename order; `20261128140000` is the only one that writes business rows.

**Two traps for whoever writes the next migration, both already paid for once:**

- `20261120100000` and `20261124100000` rewrite function bodies **in place** with `do`
  blocks, so several effective definitions exist in no migration file. Always start from
  `pg_get_functiondef`, never from an older file. `20261120220000` restated two functions
  from their original text and silently reverted the assignment gate; `20261124100000`
  had to undo it.
- A `replace` that does not match returns its input unchanged, and `execute` then
  recreates the function exactly as it was — a failed rewrite looks identical to a
  successful one. Every rewriting migration in this set **verifies itself against the
  catalog afterwards and raises**. That guard caught a real mismatch during development.

## 2026-11-27 — checksums superseded

`20261128100000` and `20261128130000` were **amended in place** under the owner's
instruction to amend the unpublished set rather than chain corrective migrations. Both had
never been applied anywhere.

| File | SHA-256 | Bytes |
|---|---|---|
| `20261128100000_rental_lifecycle_authorization.sql` | `43c9b2e7dbeacb218da8a15b639e649f8fdbe2b110bbb2e7f7d4de7d9c744094` | 17,063 |
| `20261128110000_billing_authorization_matrix.sql` | `60830dfab601498230f1769438ffac0b050bfdb1299aeb832d5212051db9e57f` | 11,275 |
| `20261128120000_amendment_evidence_one_to_one.sql` | `8ead334c1f96d9a8001ba2a9552875bc46680308da3ca1f11a451e1d074d7ab4` | 13,198 |
| `20261128130000_maintenance_expense_integrity.sql` | `1defc28e664f859540316015f2769496b1e4e1d1cd9c4208dd415f0ffb881b47` | 12,461 |
| `20261128140000_assignment_activation_default_off.sql` | `59135446944eed8bfd955011621cc2af076a0413f3a5f5e9f880aed9bbee2134` | 11,130 |

Superseded and **not to be used**: `36bcd48a…` (100000) and `71782326…` (130000).

Hosted ledger verified read-only at **143 applied**, latest `20261127100000`, PostgreSQL
17.12. Local **148**. Dry run lists exactly the five and nothing else.

## 2026-11-28 — applied to hosted staging

All five applied under owner authorization. **Hosted ledger 148, local 148, zero drift.**
`npx supabase db push --linked --dry-run` now reports
`{"upToDate":true,"migrations":[],"seeds":[],"roles":[]}`.

Pre-application baseline and recovery evidence:
`E:\pevvy-staging-preapply-20261128\baseline.json` — 14 business tables, **21 function
definitions as they stood before application**, 134 triggers, 129 policies, 244 indexes and
the 143-entry ledger. Supplementary to Supabase's platform backups.

No row was released, rewritten or repaired. Drainage released **0**; anomalies **0**.

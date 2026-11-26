# Pevvy project handoff

Status: documentation handoff prepared 2026-11-25. No application code, database migration, deployment, or production operation was performed.

## Purpose and architecture

Pevvy is a multi-tenant car-rental operations SaaS for organizations, fleet and vehicles, customers, rentals, drivers, incidents, maintenance, expenses, public booking leads, reporting, authentication, and Pevvy subscription billing. Rental customer money and SaaS subscription billing are separate concerns.

- Frontend: Vite, React 19, TypeScript, React Router 7, Tailwind CSS 4, TanStack React Query. Entry, providers, routes, and guards are under `src/app/`.
- Backend: Supabase PostgreSQL, ordered migrations in `supabase/migrations/`, RLS, tenant-scoped RPCs, storage policies, and Edge Functions in `supabase/functions/`.
- Auth: Supabase Auth with organization membership, roles, terms acceptance, and required second-factor flows in `src/features/auth/`.
- Tenant isolation: business rows carry `organization_id`; RLS, RPC authorization, membership checks, and tenant-aware relationships protect data. Never trust a client-supplied organization ID.
- Server state: TanStack Query; keys are in `src/lib/query/keys.ts`; Supabase access is centralized in `src/lib/supabase/` and feature APIs.
- Public booking is `/book/:slug` through the dedicated public-booking Edge Function; anonymous access must not receive service-role authority.

## Repository map

`src/features/` contains domain APIs, queries, schemas, and tests; `src/pages/` contains screens; `src/components/` contains shared UI; `src/types/database.ts` contains database types; `supabase/tests/` contains PGlite migration-backed database tests; `Roadmap/RoadMapFiles/` is the roadmap; `Roadmap/Reports/` is evidence; `Roadmap/Handoff/` is this transfer.

## Product decisions to preserve

One rental agreement has one vehicle. Pre-checkout substitution may use the existing workflow; post-checkout replacement closes the original and creates another rental. Do not reactivate active swapping or introduce multi-vehicle standard rentals.

Renter and driver are separate customer roles. Drivers may serve multiple non-overlapping rentals; committed periods and overdue custody block conflicts. Owner acceptance for driver availability is 9/9 scenarios passed.

Incidents may stand alone or link to rentals and maintenance. Resolving an incident never completes maintenance, and maintenance completion never resolves an incident. Neither silently alters rentals or charges.

Maintenance derives effective vehicle restrictions from maintenance records and dedicated operational restrictions. Keep independent off-road actions, period overlap rules, overdue blocking, private documents, incident links, and existing expense linkage. Do not restore a general manual maintenance-status dropdown.

## Reading order

1. `CURRENT_DEVELOPMENT_STATE.md`
2. `KNOWN_ISSUES_AND_ACCEPTANCE.md`
3. `NEXT_IMPLEMENTATION_TASK.md`
4. `WORKTREE_AND_BRANCH_INVENTORY.md`
5. `ENVIRONMENT_AND_DEPLOYMENT.md` and `DATABASE_MIGRATION_STATE.md`
6. Linked reports, then `MASTER_ROADMAP.md` and the release checklist

Maintenance Management manual acceptance remediation is next. Rental Financial Adjustments must wait until Maintenance acceptance closes or the owner changes priorities.

-- Active vehicle swapping is withdrawn from the application surface.
-- Preserve the RPC and its migration history for historical data and rollback
-- reference, but remove all application execution paths.

set search_path = public, extensions, pg_temp;

revoke all on function public.rental_swap_vehicle(
  uuid, uuid, public.rental_assignment_reason, text, timestamptz,
  integer, smallint, text, uuid
) from public, anon, authenticated, service_role;

comment on function public.rental_swap_vehicle(
  uuid, uuid, public.rental_assignment_reason, text, timestamptz,
  integer, smallint, text, uuid
) is
  'Historical Phase 1B-03 active vehicle swap RPC. Withdrawn from application execution; retained for migration and audit history.';

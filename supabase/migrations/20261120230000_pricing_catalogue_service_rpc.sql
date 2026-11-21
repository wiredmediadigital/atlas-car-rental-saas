-- =============================================================================
-- Expose the pricing catalogue write through a service-role-only public RPC.
--
-- The implementation remains private in app. The public wrapper is the narrow
-- PostgREST boundary required by the pricing Edge Function; browser roles must
-- not gain access to either function.
-- =============================================================================

create or replace function public.billing_replace_catalogue_service(p_plans jsonb)
returns integer
language sql
security invoker
set search_path = ''
as $$
  select app.billing_replace_catalogue(p_plans);
$$;

revoke all on function public.billing_replace_catalogue_service(jsonb) from public, anon, authenticated;
grant execute on function public.billing_replace_catalogue_service(jsonb) to service_role;

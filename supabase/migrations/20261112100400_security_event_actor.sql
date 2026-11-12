-- =============================================================================
-- security_events: let a service-role caller name the actor
--
-- app.record_security_event took the actor from auth.uid(). The factor-reset
-- Edge Function writes with the service-role key, where auth.uid() is null, so
-- every reset would have landed with a null actor_user_id: the audit table could
-- not answer "who reset this person's second factor" without parsing `detail`.
--
-- The function gains an explicit p_actor_user_id that DEFAULTS to auth.uid(), so
-- every existing four-argument caller keeps its behaviour. A defaulted parameter
-- cannot sit beside the old four-argument function (the call would be ambiguous
-- between the overloads), so the old function is dropped first and the grant is
-- restated exactly as it was: service_role only.
-- =============================================================================

drop function if exists app.record_security_event(public.security_event_type, uuid, uuid, jsonb);

create or replace function app.record_security_event(
  p_event_type public.security_event_type,
  p_subject_user_id uuid,
  p_organization_id uuid,
  p_detail jsonb,
  p_actor_user_id uuid default auth.uid()
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into public.security_events (
    organization_id, actor_user_id, subject_user_id, event_type, detail
  )
  values (
    p_organization_id,
    p_actor_user_id,
    p_subject_user_id,
    p_event_type,
    coalesce(p_detail, '{}'::jsonb)
  )
  returning id into v_id;

  return v_id;
end;
$$;

comment on function app.record_security_event(public.security_event_type, uuid, uuid, jsonb, uuid) is
  'Appends a security event. The actor is p_actor_user_id, which defaults to the requesting user (auth.uid()); a service-role caller, where auth.uid() is null, passes it explicitly. The only write path to public.security_events.';

revoke all on function app.record_security_event(public.security_event_type, uuid, uuid, jsonb, uuid)
  from public, anon, authenticated;
grant execute on function app.record_security_event(public.security_event_type, uuid, uuid, jsonb, uuid)
  to service_role;

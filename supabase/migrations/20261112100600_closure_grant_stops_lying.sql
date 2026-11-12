-- =============================================================================
-- 20261112100600_closure_grant_stops_lying.sql
--
-- public.organization_request_closure keeps its EXECUTE grant to service_role in
-- 20261112100300, where the same migration gave it
--
--   if not app.has_second_factor() then raise ... errcode = '42501'
--
-- A service key's JWT has no `aal` claim and never will — it is not a user
-- session — so that check refuses every service-role call. The grant therefore
-- describes a capability that does not exist.
--
-- Nothing calls it that way today, so this changes no behaviour. It is dropped
-- because a grant that lies is worse than a missing one: the next person adding
-- a server-side closure path (a billing webhook, a scheduled wind-down) would
-- read the grant as permission, get 42501 at run time, and go looking for the
-- fault in RLS or in their key rather than in a second-factor check that cannot
-- apply to them. Such a path needs a deliberate decision about how a machine
-- caller authorises closing an agency, not this grant.
--
-- 20261112100300 is not edited: the branch it belongs to is about to merge, and
-- its history has to read truthfully from here on.
--
-- `authenticated` keeps its grant. That is the only caller there has ever been.
-- =============================================================================

revoke execute on function public.organization_request_closure(uuid) from service_role;

comment on function public.organization_request_closure(uuid) is
  'An owner starts the 30-day closure of their agency. Requires a verified second factor, so it is callable by authenticated sessions only: a service key carries no aal claim and would always be refused.';

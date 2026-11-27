/**
 * The assignment lifecycle goes back to being something an agency is given,
 * not something it gets by not being asked.
 *
 * WHAT HAPPENED. 20261120100000 wrote the STG-02 contract in its own words --
 * "defines the contract only", "does not enable any organization", "missing
 * rows mean disabled". Four days later 20261124100000 redefined
 * app.assignment_lifecycle_active with `coalesce(..., true)` and inverted it.
 * Nothing recorded the change; the table comment was quietly rewritten from
 * "activation state" to "safety state"; and the one artefact still asserting
 * the original contract was a failing test that has been carried as a
 * "baseline failure" ever since. A fresh organization has been getting the
 * assignment lifecycle by default since 2026-11-24.
 *
 * THE DANGER IN SIMPLY SWITCHING IT BACK, which is why this migration is
 * longer than one line. Twelve functions consult the gate. Three of them
 * RELEASE assignments. If the gate goes false while a car is out with a
 * customer, the release never runs, the in_custody row stays open forever, and
 * the exclusion constraint rental_vehicle_assignments_no_overlap then blocks
 * that vehicle over that window permanently -- surfacing much later as a raw
 * constraint error on an unrelated booking.
 *
 * THE DISTINCTION THIS DRAWS. Activation governs OPENING a new assignment.
 * Drainage governs CONTINUING one that already exists. A rental that already
 * has an open assignment keeps its whole lifecycle -- check-out, return,
 * completion, cancellation -- whatever the organization's activation says,
 * because the alternative is stranding a vehicle that is genuinely in a
 * customer's hands.
 */

-- -----------------------------------------------------------------------------
-- 1. Activation: default off, and not settable from a session
-- -----------------------------------------------------------------------------

create or replace function app.assignment_lifecycle_active(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  /*
   * The session setting this used to consult is gone.
   *
   * It was a caller-settable GUC sitting inside an authorization decision, and
   * 20261124100000 defaulted it to on. The database row is the only authority
   * now, which is what the STG-02 contract asked for.
   *
   * The default is FALSE: an agency nobody has switched on does not have the
   * feature.
   */
  select app.is_org_member(p_organization_id)
    and coalesce(
      (
        select a.enabled
        from app.assignment_feature_activation a
        where a.organization_id = p_organization_id
      ),
      false
    );
$$;

comment on function app.assignment_lifecycle_active(uuid) is
  'Whether NEW assignment rows may be opened for this organization. Default off: a missing activation row means disabled, per the STG-02 contract. Says nothing about continuing an assignment that already exists -- see app.assignment_lifecycle_engaged.';

-- -----------------------------------------------------------------------------
-- 2. Drainage: an assignment that exists keeps its lifecycle
-- -----------------------------------------------------------------------------

create or replace function app.assignment_lifecycle_engaged(
  p_rental_id uuid,
  p_organization_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.assignment_lifecycle_active(p_organization_id)
      or exists (
        select 1
          from public.rental_vehicle_assignments a
         where a.rental_id = p_rental_id
           and a.organization_id = p_organization_id
           and a.state in ('planned', 'reserved', 'in_custody', 'swap_pending')
      );
$$;

comment on function app.assignment_lifecycle_engaged(uuid, uuid) is
  'Whether this rental''s assignment lifecycle should run: either the organization is activated, or the rental already carries an open assignment that has to be allowed to finish. Switching activation off must never strand a vehicle that is in a customer''s hands.';

revoke all on function app.assignment_lifecycle_engaged(uuid, uuid) from public, anon;
grant execute on function app.assignment_lifecycle_engaged(uuid, uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 3. The rental functions ask the rental-scoped question
--
-- Rewritten from their LIVE definitions, and verified afterwards. Seven
-- functions consult the gate with `v_rental.organization_id`; each becomes a
-- question about this rental rather than about the organization alone.
--
-- rental_confirm and rental_substitute_vehicle open assignments as well as
-- transitioning them, and they are included deliberately: with activation off
-- and nothing open, `engaged` is false and no row is created; with a legacy row
-- already open, it is true and that row continues its lifecycle. That is the
-- behaviour both halves need.
-- -----------------------------------------------------------------------------

do $rewire$
declare
  v_function   record;
  v_definition text;
  v_patched    text;
begin
  for v_function in
    select p.oid, p.proname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prokind = 'f'
       and pg_get_functiondef(p.oid) like '%app.assignment_lifecycle_active(v_rental.organization_id)%'
     order by p.proname
  loop
    v_definition := pg_get_functiondef(v_function.oid);
    v_patched := replace(
      v_definition,
      'app.assignment_lifecycle_active(v_rental.organization_id)',
      'app.assignment_lifecycle_engaged(p_rental_id, v_rental.organization_id)');

    if v_patched = v_definition then
      raise exception 'Assignment drainage: public.% was selected but not rewritten.',
        v_function.proname;
    end if;

    execute v_patched;
  end loop;
end;
$rewire$;

do $verify$
declare
  v_left text[];
begin
  select coalesce(array_agg(p.proname order by p.proname), '{}')
    into v_left
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.prokind = 'f'
     and pg_get_functiondef(p.oid) like '%app.assignment_lifecycle_active(v_rental.organization_id)%';

  if array_length(v_left, 1) is not null then
    raise exception 'Assignment drainage did not take for: %', array_to_string(v_left, ', ');
  end if;

  -- And the session flag must be gone from the decision entirely.
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('public', 'app') and p.prokind = 'f'
       and p.proname = 'assignment_lifecycle_active'
       and pg_get_functiondef(p.oid) ~ 'current_setting\s*\(\s*''app\.assignment_lifecycle_enabled'
  ) then
    raise exception 'The activation decision still reads a caller-settable session flag.';
  end if;
end;
$verify$;

-- -----------------------------------------------------------------------------
-- 4. Stale assignments on rentals that are already over
--
-- Released, because the rental they belong to has finished and nothing will
-- ever release them otherwise -- each one blocks its vehicle over its window
-- for good.
--
-- Deliberately NOT released: anything on a draft, reserved or active rental.
-- An in_custody row on an active rental is a car genuinely in a customer's
-- hands, and marking it returned would be a lie that also frees the vehicle for
-- someone else to book.
--
-- And deliberately not conditioned on activation: an assignment is not stale
-- because its organization was never switched on. It is stale because its
-- rental is over.
-- -----------------------------------------------------------------------------

do $drain$
declare
  v_assignment record;
  v_count integer := 0;
begin
  for v_assignment in
    select a.id, a.rental_id, r.status
      from public.rental_vehicle_assignments a
      join public.rentals r
        on r.id = a.rental_id and r.organization_id = a.organization_id
     where a.state in ('planned', 'reserved', 'in_custody', 'swap_pending')
       and r.status in ('completed', 'cancelled')
     order by a.id
  loop
    perform app.transition_rental_assignment(v_assignment.id, 'released', now());
    v_count := v_count + 1;
  end loop;

  if v_count > 0 then
    raise notice
      'Assignment drainage: released % open assignment(s) whose rental was already completed or cancelled.',
      v_count;
  end if;
end;
$drain$;

-- -----------------------------------------------------------------------------
-- 5. Capability reporting
--
-- can_swap is false, full stop. 20261124120000 revoked rental_swap_vehicle from
-- every role, so a capability flag saying otherwise advertised something nobody
-- could call. History stays visible to a member regardless of activation,
-- because what an agency already did is not a feature to be switched on.
-- -----------------------------------------------------------------------------

create or replace function public.assignment_feature_eligibility(p_organization_id uuid)
returns table (
  enabled boolean,
  can_view_history boolean,
  can_swap boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    case when app.is_org_member(p_organization_id)
      then app.assignment_lifecycle_active(p_organization_id) else false end,
    -- Reading the past does not depend on the feature being on.
    case when app.is_org_member(p_organization_id)
      then app.has_min_role(p_organization_id, 'staff'::public.org_role) else false end,
    -- The active vehicle swap is withdrawn. There is no state in which this is true.
    false;
$$;

comment on function public.assignment_feature_eligibility(uuid) is
  'What this member may do with assignments. can_swap is always false: the active vehicle swap was withdrawn by 20261124120000 and its function is revoked from every role. History stays readable to any staff member whether or not new assignment activity is enabled.';

revoke all on function public.assignment_feature_eligibility(uuid) from public, anon;
grant execute on function public.assignment_feature_eligibility(uuid) to authenticated;

/*
 * The withdrawal, asserted rather than assumed. If a later migration ever
 * grants rental_swap_vehicle back to a browser role, this fails at migration
 * time rather than in production.
 */
do $withdrawn$
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'rental_swap_vehicle'
       and (has_function_privilege('authenticated', p.oid, 'EXECUTE')
            or has_function_privilege('anon', p.oid, 'EXECUTE'))
  ) then
    raise exception 'rental_swap_vehicle is executable by a browser role; the withdrawal has been undone.';
  end if;
end;
$withdrawn$;

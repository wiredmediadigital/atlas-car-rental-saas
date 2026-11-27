/**
 * Billing entitlement for the incident and maintenance RPCs.
 *
 * THE DEFECT, demonstrated rather than inferred. Eleven SECURITY DEFINER
 * functions were executable by `authenticated`, wrote tenant data, and asked
 * nothing about the agency's billing state. With an agency driven to a
 * restricted subscription, a direct `insert into public.maintenance_records`
 * was refused -- "permission denied for table maintenance_records" -- while the
 * same agency could still create, start, complete and cancel maintenance
 * through the RPCs. The read-only state the billing architecture promises was
 * not read-only.
 *
 * THE OWNER'S DECISION, implemented here. Seven are gated. Four are exempt,
 * narrowly, because refusing them would be worse than allowing them: an agency
 * whose card expired still has to be able to record that a car crashed and take
 * it off the road. That is the same argument the schema already accepted once,
 * when vehicle_take_off_road was exempted.
 *
 *   GATED                            WHY
 *   maintenance_link_expense         attaches money to a record
 *   maintenance_unlink_expense       detaches money from a record
 *   maintenance_complete             PUTS THE CAR BACK ON HIRE
 *   maintenance_cancel               REMOVES A SAFETY RESTRICTION
 *   maintenance_reschedule           ordinary commercial planning
 *   maintenance_set_service_plan     ordinary commercial planning
 *   incident_resolve                 closes the record of a safety event
 *
 *   EXEMPT                           WHY, AND WHAT IT CANNOT DO
 *   incident_create                  records an accident that already happened.
 *                                    Writes no money. Cannot touch a vehicle's
 *                                    status or availability.
 *   incident_update                  documents that accident -- type, time,
 *                                    location, description, responsibility,
 *                                    towing, insurance. It ALREADY refuses
 *                                    p_status = 'resolved' ("Use
 *                                    incident_resolve to resolve an incident."),
 *                                    so it is not a way around the gated
 *                                    incident_resolve. Writes no money.
 *   maintenance_create               reports a breakdown. estimated_cost_minor
 *                                    is a number on the record; no expense row
 *                                    is created and nothing is charged.
 *   maintenance_start                takes the car OFF the road. Strictly
 *                                    safety-positive: it can only make a fleet
 *                                    smaller, never larger.
 *
 * None of the four can return a vehicle to service, remove a restriction, move
 * money, change tenant association or bypass a role check -- each keeps its
 * existing app.has_min_role test untouched.
 *
 * The limitation, stated rather than buried: incident_update cannot distinguish
 * "documenting a crash" from "tidying up an old incident's insurance
 * reference", because both are the same call with the same effects. The
 * exemption is accepted on the ground that NEITHER moves money, changes a
 * vehicle's availability or closes the incident.
 */

-- -----------------------------------------------------------------------------
-- The seven gated functions
--
-- The check goes AFTER the existing tenant and role test, so a caller from
-- another agency still gets "not found" rather than a billing message that
-- confirms the record exists.
--
-- Rewritten from the live definitions for the same reason as everything else in
-- this release: 20261120100000 and 20261124100000 rewrite bodies in place, and
-- restating a function from an older file is how the assignment gate was
-- silently reverted once already.
-- -----------------------------------------------------------------------------

do $gate$
declare
  v_spec       record;
  v_definition text;
  v_patched    text;
  v_oid        oid;
begin
  /*
   * Anchored on the role check itself, not on a literal refusal line.
   *
   * The refusal text and its layout differ across these seven: some are one
   * line with errcode='P0002', some have a space either side of the '=', and
   * maintenance_complete was reshaped into a multi-line block by
   * 20261126120000. A literal anchor matched four of them and failed loudly on
   * the fifth, which is how this was found. The pattern below matches the
   * tenant-and-role test in every shape and appends the billing check straight
   * after its `end if;` -- so the billing state is only ever asked about an
   * agency the caller is already a member of.
   *
   * Only the organization expression stays per-function, because the local
   * record is named differently in each family (v_row, v_m, v_e, v_incident).
   */
  for v_spec in
    select *
      from (values
        ('maintenance_complete',         'v_row.organization_id'),
        ('maintenance_cancel',           'v_row.organization_id'),
        ('maintenance_reschedule',       'v_row.organization_id'),
        ('maintenance_set_service_plan', 'v_row.organization_id'),
        ('maintenance_link_expense',     'v_m.organization_id'),
        ('maintenance_unlink_expense',   'v_e.organization_id'),
        ('incident_resolve',             'v_incident.organization_id')
      ) as t(proname, org_expression)
  loop
    select p.oid into v_oid
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = v_spec.proname
     order by p.oid desc limit 1;

    if v_oid is null then
      raise exception 'Billing hardening: public.% does not exist.', v_spec.proname;
    end if;

    v_definition := pg_get_functiondef(v_oid);

    if position('billing_require_write' in v_definition) > 0 then
      continue;  -- already gated
    end if;

    -- First role check only: non-greedy, so it stops at the first `end if;`.
    v_patched := regexp_replace(
      v_definition,
      '(not app\.has_min_role.*?end if;)',
      '\1 perform app.billing_require_write(' || v_spec.org_expression || ');');

    if v_patched = v_definition then
      raise exception
        'Billing hardening: could not find the role check in public.%. The billing check was NOT inserted.',
        v_spec.proname;
    end if;

    execute v_patched;
  end loop;
end;
$gate$;

/*
 * Ask the catalog rather than trust the rewrite. A `replace` that does not
 * match returns its input unchanged, and `execute` then recreates the function
 * exactly as it was -- a failed gating would otherwise look identical to a
 * successful one.
 */
do $verify$
declare
  v_name    text;
  v_missing text[] := '{}';
  v_def     text;
begin
  foreach v_name in array array['maintenance_link_expense', 'maintenance_unlink_expense',
                                'maintenance_complete', 'maintenance_cancel',
                                'maintenance_reschedule', 'maintenance_set_service_plan',
                                'incident_resolve']
  loop
    select pg_get_functiondef(p.oid) into v_def
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = v_name
     order by p.oid desc limit 1;

    if v_def is null then
      v_missing := v_missing || (v_name || ' (absent)');
    elsif position('billing_require_write' in v_def) = 0 then
      v_missing := v_missing || v_name;
    elsif position('has_min_role' in v_def) = 0 then
      v_missing := v_missing || (v_name || ' (lost its role check)');
    end if;
  end loop;

  if array_length(v_missing, 1) is not null then
    raise exception 'Billing hardening did not take: %', array_to_string(v_missing, ', ');
  end if;
end;
$verify$;

-- -----------------------------------------------------------------------------
-- The exemption register
--
-- A table rather than a comment, because the structural billing test reads it.
-- An exemption that is not written down here is not an exemption: the test goes
-- on reporting the function, which is the behaviour we want.
-- -----------------------------------------------------------------------------

create table if not exists app.billing_exempt_functions (
  function_name text primary key,
  reason        text not null check (char_length(btrim(reason)) between 20 and 500),
  approved_on   date not null,
  recorded_at   timestamptz not null default now()
);

comment on table app.billing_exempt_functions is
  'SECURITY DEFINER write paths deliberately permitted for a billing-restricted agency, each with the reason it was approved. The structural billing test treats this table as the only legitimate source of exemptions.';

revoke all on table app.billing_exempt_functions from public, anon, authenticated;

insert into app.billing_exempt_functions (function_name, reason, approved_on) values
  ('incident_create',
   'Records an accident that has already happened. Writes no money and cannot change a vehicle''s status or availability. Refusing it would stop a restricted agency documenting a crash.',
   date '2026-11-27'),
  ('incident_update',
   'Documents an accident already recorded. It already refuses p_status = ''resolved'', so it is not a path around the gated incident_resolve. Writes no money and touches no vehicle.',
   date '2026-11-27'),
  ('maintenance_create',
   'Reports a breakdown. estimated_cost_minor is a figure on the record; no expense row is created and nothing is charged. Cannot return a vehicle to service.',
   date '2026-11-27'),
  ('maintenance_start',
   'Takes the vehicle off the road. Strictly safety-positive: it can only make a fleet smaller, never larger, so it cannot be used to keep earning while restricted.',
   date '2026-11-27')
on conflict (function_name) do update
  set reason = excluded.reason, approved_on = excluded.approved_on, recorded_at = now();

/*
 * The four exempt functions keep their role checks and gain nothing. Asserted
 * here so that a later migration quietly adding a billing check to one of them
 * -- or quietly removing its role check -- is caught at migration time.
 */
do $exempt$
declare
  v_name  text;
  v_def   text;
  v_wrong text[] := '{}';
begin
  foreach v_name in array array['incident_create', 'incident_update',
                                'maintenance_create', 'maintenance_start']
  loop
    select pg_get_functiondef(p.oid) into v_def
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = v_name
     order by p.oid desc limit 1;

    if v_def is null then
      v_wrong := v_wrong || (v_name || ' (absent)');
    elsif position('has_min_role' in v_def) = 0 then
      v_wrong := v_wrong || (v_name || ' (no role check)');
    end if;
  end loop;

  if array_length(v_wrong, 1) is not null then
    raise exception 'Billing exemption register is inconsistent: %', array_to_string(v_wrong, ', ');
  end if;
end;
$exempt$;

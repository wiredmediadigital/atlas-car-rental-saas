/**
 * The rental lifecycle becomes a privileged operation.
 *
 * THE DEFECT. public.rentals carried an update policy asking for a staff role
 * and a billing entitlement, and saying nothing about which columns were being
 * written. A signed-in staff member could therefore issue
 *
 *   update public.rentals
 *      set status = 'active', picked_up_at = now(), pickup_odometer = 12345
 *    where id = <a reserved rental>;
 *
 * and counterfeit a check-out. The status machine was never the weakness: the
 * transition guard refuses every illegal move, and this migration leaves it
 * exactly as it is. What a direct write bypassed was everything the RPC does
 * AROUND the transition -- vehicle availability revalidation, maintenance
 * restrictions, driver conflict prevention, assignment synchronisation, the
 * odometer and fuel capture, and the inspection record.
 *
 * THE CORRECTION, in two halves that only work together.
 *
 *   1. The five lifecycle functions become SECURITY DEFINER, carrying the
 *      tenant, role and billing checks that row level security used to apply on
 *      their behalf -- the same shape 20261126130000 gave rental_extend and
 *      rental_reprice.
 *
 *   2. The lifecycle and hand-over columns are frozen against every writer that
 *      is not the table owner, so the RPCs are the only way in.
 *
 * Half one without half two leaves the direct write open. Half two without half
 * one breaks the desk, because the RPCs run as the caller today.
 */

-- -----------------------------------------------------------------------------
-- 1. The five lifecycle functions
--
-- Rewritten FROM THEIR LIVE DEFINITIONS, not from migration files.
--
-- This is not a stylistic preference. 20261120100000 and 20261124100000 both
-- rewrite function bodies in place with `do` blocks, so several of these
-- functions have an effective definition that exists in no migration file at
-- all; 20261120220000 restated two of them from their original text and
-- silently reverted the per-organization assignment gate to a session flag
-- nobody sets. Deriving the new definition from pg_get_functiondef is what
-- makes that class of mistake impossible here.
--
-- The rewrite is VERIFIED below and the migration fails if any function came
-- out without its guard. A replace that silently does not match would otherwise
-- leave a function looking converted while carrying no authorization at all,
-- which is a worse outcome than not converting it.
-- -----------------------------------------------------------------------------

do $rewrite$
declare
  v_function  record;
  v_definition text;
  v_guard     text;
  v_anchors   text[] := array[
    'select * into v_rental from public.rentals where id = p_rental_id for update;',
    'select * into v_rental from public.rentals where id=p_rental_id for update;'
  ];
  v_anchor    text;
  v_matched   boolean;
begin
  /*
   * The preamble. Membership and role are asked together, and the refusal does
   * not confirm the rental exists -- telling another agency that an id is real
   * is itself a leak. The role test is skipped for the service role and for the
   * owner, exactly as rental_extend does it, so Edge Functions and the account
   * purge keep working.
   *
   * app.billing_require_write preserves what rentals_update used to apply: a
   * billing-restricted agency could not write public.rentals before this
   * migration and still cannot after it. This is parity, not a new gate.
   */
  v_guard :=
    ' if v_rental.id is null' ||
    ' or (current_setting(''role'', true) = ''authenticated''' ||
    ' and not app.has_min_role(v_rental.organization_id, ''staff''::public.org_role)) then' ||
    ' raise exception ''Rental not found.'' using errcode = ''P0002''; end if;' ||
    ' perform app.billing_require_write(v_rental.organization_id);';

  for v_function in
    select p.oid, p.proname
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('rental_confirm', 'rental_check_out', 'rental_check_in',
                         'rental_complete', 'rental_cancel')
     order by p.proname
  loop
    v_definition := pg_get_functiondef(v_function.oid);
    v_matched := false;

    foreach v_anchor in array v_anchors loop
      if position(v_anchor in v_definition) > 0 then
        v_definition := replace(v_definition, v_anchor, v_anchor || v_guard);
        v_matched := true;
        exit;
      end if;
    end loop;

    if not v_matched then
      raise exception
        'Lifecycle hardening: could not find the rental row lock in public.%. Its body has changed shape; the guard was NOT inserted.',
        v_function.proname;
    end if;

    -- SECURITY DEFINER, and a search_path that cannot be shadowed.
    v_definition := replace(v_definition, E'\n LANGUAGE plpgsql',
                                          E'\n LANGUAGE plpgsql\n SECURITY DEFINER');
    v_definition := replace(v_definition, E'SET search_path TO ''public'', ''pg_temp''',
                                          E'SET search_path TO ''public'', ''extensions'', ''pg_temp''');

    execute v_definition;
  end loop;
end;
$rewrite$;

/*
 * The rewrite answered for itself. This asks the catalog.
 *
 * A `replace` that does not match returns its input unchanged and `execute`
 * then happily re-creates the function exactly as it was. Without this block a
 * failed conversion would be indistinguishable from a successful one until
 * something went wrong in production.
 */
do $verify$
declare
  v_name    text;
  v_missing text[] := '{}';
  v_def     text;
  v_secdef  boolean;
begin
  foreach v_name in array array['rental_confirm', 'rental_check_out', 'rental_check_in',
                                'rental_complete', 'rental_cancel']
  loop
    select pg_get_functiondef(p.oid), p.prosecdef
      into v_def, v_secdef
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = v_name
     order by p.oid desc limit 1;

    if v_def is null then
      v_missing := v_missing || (v_name || ' (absent)');
    elsif not v_secdef then
      v_missing := v_missing || (v_name || ' (not security definer)');
    elsif position('has_min_role' in v_def) = 0 then
      v_missing := v_missing || (v_name || ' (no role check)');
    elsif position('billing_require_write' in v_def) = 0 then
      v_missing := v_missing || (v_name || ' (no billing check)');
    elsif position('app.assignment_lifecycle_enabled' in v_def) > 0 then
      v_missing := v_missing || (v_name || ' (reverted to the session flag)');
    end if;
  end loop;

  if array_length(v_missing, 1) is not null then
    raise exception 'Lifecycle hardening did not take: %', array_to_string(v_missing, ', ');
  end if;
end;
$verify$;

-- Browser callers reach these only through the RPC, never as anon.
revoke all on function public.rental_confirm(uuid) from public, anon;
grant execute on function public.rental_confirm(uuid) to authenticated, service_role;

revoke all on function public.rental_complete(uuid) from public, anon;
grant execute on function public.rental_complete(uuid) to authenticated, service_role;

do $grants$
declare
  v record;
begin
  for v in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('rental_check_out', 'rental_check_in', 'rental_cancel')
  loop
    execute format('revoke all on function %s from public, anon', v.sig);
    execute format('grant execute on function %s to authenticated, service_role', v.sig);
  end loop;
end;
$grants$;

-- -----------------------------------------------------------------------------
-- 2. The lifecycle and hand-over columns
--
-- Frozen against every writer that is not the table owner, in EVERY state
-- including draft. A draft is still freely editable in every other respect --
-- its dates, its rate, its deposit, its notes -- but moving it to 'reserved'
-- is a lifecycle act with a precondition (a named primary driver) that only
-- rental_confirm checks.
--
-- The owner exemption is what lets the five functions above through, now that
-- they run as the owner. It is the same discriminator the charge guard and the
-- pricing-input guard use, and it works for the same reason: a SECURITY DEFINER
-- function owned by the table's owner runs with current_user set to that owner,
-- and a signed-in role cannot become the owner.
--
-- SECURITY INVOKER on purpose. As a definer this would run as its own owner
-- whoever wrote the row, and current_user would be a constant that said
-- nothing -- the mistake that made the first version of the charge guard pass
-- vacuously.
-- -----------------------------------------------------------------------------

create or replace function app.guard_rental_lifecycle_columns()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_owner text;
  v_field text;
begin
  select pg_catalog.pg_get_userbyid(c.relowner) into v_owner
    from pg_catalog.pg_class c
   where c.oid = 'public.rentals'::regclass;

  -- An authorized lifecycle function, running as the table owner.
  if current_user = v_owner then
    return new;
  end if;

  -- A closing agency is allowed to take its own records apart.
  if app.rental_charges_purge_exempt(old.id) then
    return new;
  end if;

  v_field := case
    when new.status                 is distinct from old.status                 then 'status'
    when new.confirmed_at           is distinct from old.confirmed_at           then 'confirmation time'
    when new.cancelled_at           is distinct from old.cancelled_at           then 'cancellation time'
    when new.cancellation_reason    is distinct from old.cancellation_reason    then 'cancellation reason'
    when new.picked_up_at           is distinct from old.picked_up_at           then 'collection time'
    when new.returned_at            is distinct from old.returned_at            then 'return time'
    when new.pickup_odometer        is distinct from old.pickup_odometer        then 'odometer out'
    when new.return_odometer        is distinct from old.return_odometer        then 'odometer in'
    when new.pickup_fuel_percent    is distinct from old.pickup_fuel_percent    then 'fuel out'
    when new.return_fuel_percent    is distinct from old.return_fuel_percent    then 'fuel in'
    when new.pickup_condition_notes is distinct from old.pickup_condition_notes then 'condition out'
    when new.return_condition_notes is distinct from old.return_condition_notes then 'condition in'
    when new.original_ends_at       is distinct from old.original_ends_at       then 'original return date'
    when new.extension_count        is distinct from old.extension_count        then 'extension count'
    else null
  end;

  if v_field is not null then
    raise exception
      'The % of a rental is set by the action that changes it, not by editing the record.',
      v_field
      using errcode = '42501',
            hint = 'Confirm, check out, record the return, complete, extend or cancel the rental instead.';
  end if;

  return new;
end;
$$;

comment on function app.guard_rental_lifecycle_columns() is
  'Refuses a direct client write to any column the rental lifecycle owns. SECURITY INVOKER on purpose: current_user has to name the real writer, so the authorized SECURITY DEFINER lifecycle functions are the only exemption.';

revoke all on function app.guard_rental_lifecycle_columns() from public, anon, authenticated;

drop trigger if exists rentals_guard_lifecycle_columns on public.rentals;
create trigger rentals_guard_lifecycle_columns
  before update on public.rentals
  for each row
  execute function app.guard_rental_lifecycle_columns();

/*
 * The hand-over columns were already frozen in the terminal states by
 * app.guard_rental_pricing_inputs. That block is now redundant -- this trigger
 * covers them in every state -- but it is left in place deliberately. Two
 * guards refusing the same write is not a bug, and removing a protection to
 * tidy up is how protections get lost.
 */

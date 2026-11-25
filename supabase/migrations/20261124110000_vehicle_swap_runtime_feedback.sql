-- Make the custody prerequisite actionable without bypassing it.
-- The RPC still fails closed when no current custody assignment exists.

set search_path = public, extensions, pg_temp;

do $$
declare
  v_function record;
  v_definition text;
begin
  for v_function in
    select p.oid
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'rental_swap_vehicle'
      and pg_get_functiondef(p.oid) like '%Current custody assignment not found.%'
  loop
    v_definition := replace(
      pg_get_functiondef(v_function.oid),
      $needle$raise exception 'Current custody assignment not found.' using errcode='P0002';$needle$,
      $replacement$raise exception 'This active rental has no current custody assignment. Refresh the rental, complete checkout, or reconcile its assignment history before swapping.' using errcode='P0002';$replacement$
    );
    v_definition := replace(
      v_definition,
      $needle$raise exception 'Current custody assignment not found.' using errcode = 'P0002';$needle$,
      $replacement$raise exception 'This active rental has no current custody assignment. Refresh the rental, complete checkout, or reconcile its assignment history before swapping.' using errcode = 'P0002';$replacement$
    );
    execute v_definition;
  end loop;
end;
$$;

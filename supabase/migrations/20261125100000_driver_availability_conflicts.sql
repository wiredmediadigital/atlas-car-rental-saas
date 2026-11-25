-- Driver assignments are commitments just like vehicle reservations.  Keep the
-- invariant in the database so direct API writes and lifecycle RPCs share the
-- same conflict protection.

create or replace function app.lock_driver_commitment(
  p_organization_id uuid,
  p_customer_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      format('pevvy-driver:%s:%s', p_organization_id, p_customer_id),
      0
    )
  );
end;
$$;

create or replace function app.validate_rental_driver_commitments(
  p_rental_id uuid,
  p_for_checkout boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rental record;
  v_driver record;
  v_conflict record;
begin
  select r.id, r.organization_id, r.reference, r.status, r.starts_at, r.ends_at,
         r.returned_at, v.registration_plate, v.make, v.model
    into v_rental
    from public.rentals r
    join public.vehicles v on v.id = r.vehicle_id
   where r.id = p_rental_id
   for update of r;

  if not found or v_rental.status not in ('reserved', 'active') then
    return;
  end if;

  -- Every transaction takes customer locks in the same order.  The deferred
  -- trigger below sees the complete assignment set for a batch insert.
  for v_driver in
    select rd.customer_id
      from public.rental_drivers rd
     where rd.rental_id = p_rental_id
     order by rd.customer_id
  loop
    perform app.lock_driver_commitment(v_rental.organization_id, v_driver.customer_id);
  end loop;

  for v_driver in
    select rd.customer_id
      from public.rental_drivers rd
     where rd.rental_id = p_rental_id
     order by rd.customer_id
  loop
    select c.display_name,
           r2.reference,
           r2.starts_at,
           r2.ends_at,
           r2.status,
           r2.returned_at,
           v2.registration_plate,
           v2.make,
           v2.model
      into v_conflict
      from public.rental_drivers rd2
      join public.rentals r2 on r2.id = rd2.rental_id
      join public.customers c on c.id = rd2.customer_id
      join public.vehicles v2 on v2.id = r2.vehicle_id
     where rd2.organization_id = v_rental.organization_id
       and rd2.customer_id = v_driver.customer_id
       and r2.id <> v_rental.id
       and (
         (r2.status = 'reserved'
           and r2.starts_at < v_rental.ends_at
           and r2.ends_at > v_rental.starts_at)
         or
         (r2.status = 'active'
           and r2.returned_at is null
           and (
             (r2.starts_at < v_rental.ends_at and r2.ends_at > v_rental.starts_at)
             or (p_for_checkout and r2.starts_at <= now())
           ))
       )
     order by r2.starts_at, r2.id
     limit 1;

    if found then
      if v_conflict.status = 'active' and v_conflict.returned_at is null and p_for_checkout
         and v_conflict.starts_at <= now()
         and not (v_conflict.starts_at < v_rental.ends_at and v_conflict.ends_at > v_rental.starts_at) then
        raise exception
          '% is still assigned to checked-out vehicle under rental % (% - % %). Return the previous vehicle or assign another eligible driver before checkout.',
          v_conflict.display_name, v_conflict.reference, v_conflict.registration_plate,
          v_conflict.make, v_conflict.model
          using errcode = '23P01';
      end if;

      raise exception
        'Driver availability conflict: % is already assigned on rental % from % to %. Vehicle: % - % %. Select another driver or adjust the rental dates.',
        v_conflict.display_name, v_conflict.reference,
        to_char(v_conflict.starts_at, 'YYYY-MM-DD HH24:MI TZH:TZM'),
        to_char(v_conflict.ends_at, 'YYYY-MM-DD HH24:MI TZH:TZM'),
        v_conflict.registration_plate, v_conflict.make, v_conflict.model
        using errcode = '23P01';
    end if;
  end loop;
end;
$$;

create or replace function app.validate_rental_driver_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.validate_rental_driver_commitments(new.rental_id);
  return new;
end;
$$;

drop trigger if exists rental_drivers_validate_availability on public.rental_drivers;
create constraint trigger rental_drivers_validate_availability
after insert or update on public.rental_drivers
deferrable initially deferred
for each row execute function app.validate_rental_driver_row();

create or replace function app.validate_rental_driver_transition()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status in ('reserved', 'active') and (
    old.status is distinct from new.status
    or old.starts_at is distinct from new.starts_at
    or old.ends_at is distinct from new.ends_at
    or old.vehicle_id is distinct from new.vehicle_id
  ) then
    perform app.validate_rental_driver_commitments(new.id, new.status = 'active');
  end if;
  return new;
end;
$$;

drop trigger if exists rentals_validate_driver_transition on public.rentals;
create trigger rentals_validate_driver_transition
after update of status, starts_at, ends_at, vehicle_id on public.rentals
for each row execute function app.validate_rental_driver_transition();

create or replace function public.driver_availability(
  p_organization_id uuid,
  p_customer_ids uuid[],
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_exclude_rental_id uuid default null
)
returns table (
  customer_id uuid,
  available boolean,
  conflict_reference text,
  conflict_vehicle_plate text,
  conflict_vehicle_make text,
  conflict_vehicle_model text,
  conflict_starts_at timestamptz,
  conflict_ends_at timestamptz,
  conflict_is_custody boolean
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.is_org_member(p_organization_id) then
    raise exception 'Not authorized for this organization.' using errcode = '42501';
  end if;
  if p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at then
    raise exception 'A valid rental period is required.' using errcode = '22023';
  end if;

  return query
  select requested.customer_id,
         conflict.rental_id is null,
         conflict.reference,
         conflict.registration_plate,
         conflict.make,
         conflict.model,
         conflict.starts_at,
         conflict.ends_at,
         conflict.is_custody
    from unnest(coalesce(p_customer_ids, '{}'::uuid[])) as requested(customer_id)
    left join lateral (
      select r2.id as rental_id,
             r2.reference,
             v2.registration_plate,
             v2.make,
             v2.model,
             r2.starts_at,
             r2.ends_at,
             (r2.status = 'active' and r2.returned_at is null) as is_custody
        from public.rental_drivers rd2
        join public.rentals r2 on r2.id = rd2.rental_id
        join public.vehicles v2 on v2.id = r2.vehicle_id
       where rd2.organization_id = p_organization_id
         and rd2.customer_id = requested.customer_id
         and (p_exclude_rental_id is null or r2.id <> p_exclude_rental_id)
         and (
           (r2.status = 'reserved' and r2.starts_at < p_ends_at and r2.ends_at > p_starts_at)
           or
           (r2.status = 'active' and r2.returned_at is null
             and r2.starts_at < p_ends_at and r2.ends_at > p_starts_at)
         )
       order by r2.starts_at, r2.id
       limit 1
    ) as conflict on true;
end;
$$;

revoke all on function public.driver_availability(uuid, uuid[], timestamptz, timestamptz, uuid)
  from public, anon;
grant execute on function public.driver_availability(uuid, uuid[], timestamptz, timestamptz, uuid)
  to authenticated;

comment on function public.driver_availability(uuid, uuid[], timestamptz, timestamptz, uuid) is
  'Tenant-scoped, read-only driver availability for a half-open rental period.';

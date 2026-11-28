/**
 * A cost linked to a maintenance record stays a cost for that vehicle.
 *
 * THE DEFECT, and it is reachable from the product's own screens.
 * public.maintenance_link_expense enforces two invariants at link time -- the
 * expense must be allocated to a vehicle, and that vehicle must be the
 * maintenance record's vehicle. Nothing re-checked them afterwards. There was
 * no check constraint, no trigger and no foreign key covering vehicle_id, so
 * the RPC's rules were advisory the moment it returned.
 *
 * Meanwhile the expense feature has no awareness of maintenance_id at all:
 * updateExpense writes allocation, vehicle_id and rental_id and leaves
 * maintenance_id alone. So an ordinary manager editing a linked cost could
 * switch it to "Agency overhead", or to another vehicle, or to a rental, and
 * the link survived. Reproduced: a maintenance record then reported an actual
 * cost of 15000 made up of one overhead cost, one belonging to a different
 * vehicle, and one belonging to a rental -- and its detail page listed all
 * three.
 *
 * WHAT IS NOT WRONG. Cross-tenant association is already blocked three times
 * over -- by the RPC, by the composite tenant-scoped foreign key, and by
 * expenses_freeze_columns -- and the account purge already empties expenses
 * before maintenance_records. Those protections are preserved untouched; this
 * migration adds nothing to them and takes nothing away.
 */

-- -----------------------------------------------------------------------------
-- 1. The invariants, enforced where they cannot be edited around
--
-- A trigger rather than a check constraint, because the rule spans two tables:
-- the expense's vehicle has to equal the maintenance record's vehicle, and a
-- check constraint cannot see the other row.
--
-- It REFUSES rather than silently clearing maintenance_id. Clearing it would
-- detach a cost from the work it belongs to without anybody being told, which
-- is the same class of silent financial edit the rest of this release exists to
-- stop.
-- -----------------------------------------------------------------------------

create or replace function app.guard_maintenance_expense_link()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_record public.maintenance_records;
begin
  if new.maintenance_id is null then
    return new;
  end if;

  select * into v_record
    from public.maintenance_records
   where id = new.maintenance_id
     and organization_id = new.organization_id;

  if v_record.id is null then
    raise exception 'That maintenance record is not this agency''s.'
      using errcode = '23503';
  end if;

  /*
   * Reassignment has to be deliberate. The picker only offers unlinked
   * expenses, so a cost moving straight from one record to another is either a
   * stale screen or a direct call -- and in both cases the first record
   * silently loses a cost it was reporting.
   */
  if tg_op = 'UPDATE'
     and old.maintenance_id is not null
     and old.maintenance_id is distinct from new.maintenance_id then
    raise exception
      'This cost is already attached to another maintenance record. Unlink it first.'
      using errcode = '23514',
            hint = 'Use maintenance_unlink_expense, then link it to the other record.';
  end if;

  if new.allocation <> 'vehicle' then
    raise exception
      'A cost attached to maintenance has to stay a vehicle cost.'
      using errcode = '23514',
            hint = 'Unlink it from the maintenance record first, then change how it is allocated.';
  end if;

  if new.vehicle_id is distinct from v_record.vehicle_id then
    raise exception
      'A cost attached to maintenance has to stay on the vehicle that was worked on.'
      using errcode = '23514',
            hint = 'Unlink it from the maintenance record first, then move it to another vehicle.';
  end if;

  /*
   * A cancelled record is work that did not happen. Costs attached BEFORE it
   * was cancelled are kept -- a tow that was already paid for is still a real
   * cost -- but nothing new attaches to it.
   */
  if tg_op = 'INSERT' or old.maintenance_id is distinct from new.maintenance_id then
    if v_record.status = 'cancelled' then
      raise exception 'That maintenance was cancelled, so no new costs can be attached to it.'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

comment on function app.guard_maintenance_expense_link() is
  'Holds a maintenance-linked expense to the invariants maintenance_link_expense checks at link time: same agency, allocated to a vehicle, the maintenance record''s vehicle, and not newly attached to cancelled work. Refuses rather than clearing the link, so a cost is never quietly detached from the work it belongs to.';

revoke all on function app.guard_maintenance_expense_link() from public, anon, authenticated;

drop trigger if exists expenses_guard_maintenance_link on public.expenses;
create trigger expenses_guard_maintenance_link
  before insert or update on public.expenses
  for each row
  execute function app.guard_maintenance_expense_link();

-- -----------------------------------------------------------------------------
-- 2. The foreign key clears only what it should
--
-- expenses_maintenance_fkey was declared ON DELETE SET NULL with no column
-- list, so it would null BOTH maintenance_id and organization_id -- and
-- organization_id is NOT NULL, so the delete would fail with a constraint
-- violation rather than clearing the link.
--
-- Latent rather than live: `authenticated` holds only SELECT on
-- maintenance_records, and the purge empties expenses first. But a declared
-- referential action that can never fire as written is a trap for whoever
-- reads it next.
--
-- The column list form requires PostgreSQL 15 or later. Supabase runs 15+,
-- and the guarded branch below leaves the constraint exactly as it was on
-- anything older rather than failing the migration.
-- -----------------------------------------------------------------------------

do $fk$
begin
  if current_setting('server_version_num')::int >= 150000 then
    alter table public.expenses drop constraint if exists expenses_maintenance_fkey;
    alter table public.expenses
      add constraint expenses_maintenance_fkey
      foreign key (maintenance_id, organization_id)
      references public.maintenance_records (id, organization_id)
      on delete set null (maintenance_id);
  else
    raise notice
      'expenses_maintenance_fkey left as-is: PostgreSQL % does not support a SET NULL column list.',
      current_setting('server_version');
  end if;
end;
$fk$;

-- -----------------------------------------------------------------------------
-- 3. Existing records
--
-- Reported, never rewritten. A financial record that is already inconsistent is
-- evidence of something that happened, and deciding what it should have said is
-- the owner's to make, not a migration's.
--
-- The view is deliberately narrow: it answers "which linked costs would the new
-- trigger have refused", and nothing else.
-- -----------------------------------------------------------------------------

create or replace view app.maintenance_expense_anomalies as
  select e.organization_id,
         e.id            as expense_id,
         e.maintenance_id,
         e.allocation,
         e.vehicle_id    as expense_vehicle_id,
         m.vehicle_id    as maintenance_vehicle_id,
         m.status        as maintenance_status,
         e.amount_minor,
         e.currency,
         case
           when m.id is null                      then 'maintenance record missing'
           when e.allocation <> 'vehicle'         then 'not a vehicle cost'
           when e.vehicle_id is distinct from m.vehicle_id then 'wrong vehicle'
         end as anomaly
    from public.expenses e
    left join public.maintenance_records m
      on m.id = e.maintenance_id and m.organization_id = e.organization_id
   where e.maintenance_id is not null
     and (m.id is null
          or e.allocation <> 'vehicle'
          or e.vehicle_id is distinct from m.vehicle_id);

comment on view app.maintenance_expense_anomalies is
  'Linked maintenance costs that the integrity trigger would now refuse. Reporting only: nothing is rewritten, because what an inconsistent financial record should have said is the owner''s decision.';

revoke all on app.maintenance_expense_anomalies from public, anon, authenticated;

/*
 * Say so at migration time rather than leaving it to be discovered. The
 * migration does NOT fail -- refusing to deploy because historical data is
 * untidy would be worse than deploying and reporting it.
 */
do $report$
declare
  v_count bigint;
begin
  select count(*) into v_count from app.maintenance_expense_anomalies;
  if v_count > 0 then
    raise warning
      'Maintenance expense integrity: % existing linked cost(s) would not satisfy the new invariants. They are listed in app.maintenance_expense_anomalies and have NOT been changed. Owner decision required.',
      v_count;
  end if;
end;
$report$;

-- -----------------------------------------------------------------------------
-- 4. The read model has to show the attachment it is now enforcing
--
-- THE GAP, found while checking that the refusals above reach a human. The
-- expense screens carry no maintenance field at all -- not a label, not a
-- badge, not a link -- and the reason is upstream of the UI: public.
-- expense_ledger, which every expense list and the detail page read, does not
-- select maintenance_id. The attachment was invisible by construction.
--
-- So the first a user heard of it was a refusal when they pressed save, on a
-- screen that gave them no way to know the cost was attached to anything and
-- no route to the unlink. Enforcing an invariant the interface cannot show is
-- how a correct database earns a reputation for being broken.
--
-- The column is appended, which is all `create or replace view` permits and
-- all that is wanted: every existing consumer keeps the shape it reads today.
-- security_invoker is restated rather than assumed, because losing it would
-- silently turn a tenant-scoped read model into a leak.
-- -----------------------------------------------------------------------------

create or replace view public.expense_ledger
with (security_invoker = true) as
SELECT e.id,
    e.organization_id,
    e.incurred_on,
    e.description,
    e.amount_minor,
    e.tax_amount_minor,
    e.amount_minor - e.tax_amount_minor AS net_amount_minor,
    e.tax_rate_bps,
    e.tax_label,
    e.currency,
    e.status,
    e.source,
    e.allocation,
    e.payment_method,
    e.reference,
    e.notes,
    e.odometer,
    e.category_id,
    c.name AS category_name,
    c.system_key AS category_system_key,
    c.archived_at IS NOT NULL AS category_archived,
    e.vendor_id,
    v.name AS vendor_name,
    v.archived_at IS NOT NULL AS vendor_archived,
    COALESCE(e.vehicle_id, r.vehicle_id) AS effective_vehicle_id,
    COALESCE(direct_vehicle.registration_plate, rental_vehicle.registration_plate) AS vehicle_plate,
    COALESCE(direct_vehicle.make, rental_vehicle.make) AS vehicle_make,
    COALESCE(direct_vehicle.model, rental_vehicle.model) AS vehicle_model,
    COALESCE(direct_vehicle.archived_at, rental_vehicle.archived_at) IS NOT NULL AS vehicle_archived,
    e.rental_id,
    r.reference AS rental_reference,
    attachments.total AS attachment_count,
    e.voided_at,
    e.void_reason,
    e.created_by,
    e.created_at,
    e.updated_by,
    e.updated_at,
    e.maintenance_id
   FROM public.expenses e
     JOIN public.expense_categories c ON c.id = e.category_id
     LEFT JOIN public.expense_vendors v ON v.id = e.vendor_id
     LEFT JOIN public.rentals r ON r.id = e.rental_id
     LEFT JOIN public.vehicles direct_vehicle ON direct_vehicle.id = e.vehicle_id
     LEFT JOIN public.vehicles rental_vehicle ON rental_vehicle.id = r.vehicle_id
     LEFT JOIN LATERAL ( SELECT count(*) AS total
           FROM public.expense_attachments a
          WHERE a.expense_id = e.id) attachments ON true;

comment on view public.expense_ledger is
  'One row per cost with its category, vendor, vehicle, contract and maintenance attachment already resolved. A rental cost reads its vehicle through the contract, so the two can never disagree. security_invoker, so RLS applies to every source table.';

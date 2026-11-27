-- Rental charge lines stop being destructible once money is committed.
--
-- WHAT WAS WRONG. `public.rental_line_items` granted DELETE to every member at
-- or above 'staff' with no reference to the rental's state:
--
--   create policy rental_line_items_delete on public.rental_line_items
--     for delete to authenticated
--     using (app.has_min_role(organization_id, 'staff'));      -- 20260815100000:569
--
-- and the client deletes the row directly, with no RPC in between
-- (src/features/rentals/api.ts, removeCharge). So a charge could be erased
-- after the reservation, after the contract was issued, after the customer had
-- paid, and after the hire was over. `rental_line_items_recalculate` fires on
-- DELETE, so the rental's totals silently dropped to match, while the issued
-- contract kept the frozen figure it was signed at and the payments already
-- taken turned into an overpayment that never happened. Nothing recorded what
-- had been removed: there is no `rental_line_items` equivalent of
-- `expense_change_events`.
--
-- The lifecycle gate existed only in the browser
-- (RentalDetailPage.tsx: status !== 'completed' && status !== 'cancelled'),
-- which a direct PostgREST call ignores entirely.
--
-- This is the asymmetry the module itself argues against in its own words at
-- 20260815100000:20 -- "Financial history should not evaporate because somebody
-- mistyped. A payment is voided, not deleted." Charges were the one place that
-- rule was not applied.
--
-- WHAT THIS DOES. Before any financial commitment a rental is still being
-- drafted, and its charges stay freely editable -- that is not a correction,
-- it is composition. Once a commitment exists, the lines are posted: they can
-- no longer be deleted or have their money, tax or ownership rewritten, and a
-- mistake is undone by REVERSING it, which leaves both the original and its
-- reversal visible.
--
-- NO NEW LEDGER, AND NO NEW ENUM VALUE. A reversal is an ordinary
-- `rental_line_items` row that points at the line it reverses. Pointing is a
-- stronger marker than a `kind` would be -- it names the exact row -- and it
-- avoids `alter type ... add value`, which cannot be used in the same
-- transaction that adds it.

-- -----------------------------------------------------------------------------
-- The reversal link
-- -----------------------------------------------------------------------------

-- Needed so the reversal's foreign key can carry organization_id and prove, in
-- the schema rather than in a function, that a reversal cannot point at another
-- agency's charge. `id` is already unique; this names the pair.
alter table public.rental_line_items
  drop constraint if exists rental_line_items_tenant_key;
alter table public.rental_line_items
  add constraint rental_line_items_tenant_key unique (id, organization_id);

alter table public.rental_line_items
  add column if not exists reverses_line_item_id uuid,
  add column if not exists reversal_reason text;

alter table public.rental_line_items
  drop constraint if exists rental_line_items_reverses_fkey;
alter table public.rental_line_items
  add constraint rental_line_items_reverses_fkey
  foreign key (reverses_line_item_id, organization_id)
  references public.rental_line_items (id, organization_id)
  on delete restrict;

-- One reversal per charge. This is what makes "prevent duplicate reversal" a
-- property of the schema rather than a race between two operators.
drop index if exists rental_line_items_one_reversal;
create unique index rental_line_items_one_reversal
  on public.rental_line_items (reverses_line_item_id)
  where reverses_line_item_id is not null;

alter table public.rental_line_items
  drop constraint if exists rental_line_items_reversal_shape;
alter table public.rental_line_items
  add constraint rental_line_items_reversal_shape
  check (
    (reverses_line_item_id is null and reversal_reason is null)
    or (
      reverses_line_item_id is not null
      and reversal_reason is not null
      and char_length(btrim(reversal_reason)) between 1 and 500
    )
  );

-- A reversal of a DISCOUNT is positive, because it takes the discount back.
-- The original sign rule would have refused it, so the rule now applies to
-- ordinary lines and leaves reversals to the integrity trigger, which checks
-- the stronger property: that the amount mirrors the line being reversed.
alter table public.rental_line_items
  drop constraint if exists rental_line_items_discount_is_negative;
alter table public.rental_line_items
  add constraint rental_line_items_discount_is_negative
  check (
    reverses_line_item_id is not null
    or (case when kind = 'discount' then amount_minor < 0 else amount_minor >= 0 end)
  );

comment on column public.rental_line_items.reverses_line_item_id is
  'The charge this line reverses. Non-null makes this row a correction: it mirrors the original''s amount and tax treatment, and the original is preserved.';
comment on column public.rental_line_items.reversal_reason is
  'Why the charge was reversed. Required on a reversal, refused on an ordinary line.';

-- -----------------------------------------------------------------------------
-- When a rental stops being a draft in the financial sense
-- -----------------------------------------------------------------------------

/**
 * Has this rental made a financial commitment?
 *
 * Three independent things qualify, and any one is enough:
 *
 *   it is no longer a draft -- reservation, checkout, completion and
 *   cancellation are all states somebody has acted on;
 *
 *   a contract has been issued -- the lines were frozen into a snapshot that a
 *   customer may be holding;
 *
 *   money has been taken -- a payment that has not been voided.
 *
 * The third is checked separately from the first because a draft can carry a
 * deposit: taking money before confirming is ordinary, and it commits the
 * charges just as firmly as a reservation does.
 */
create or replace function app.rental_is_finalized(p_rental_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
      select 1 from public.rentals r
       where r.id = p_rental_id and r.status <> 'draft'
    )
    or exists (
      select 1 from public.rental_contracts c
       where c.rental_id = p_rental_id
    )
    or exists (
      select 1 from public.payments p
       where p.rental_id = p_rental_id and p.voided_at is null
    );
$$;

comment on function app.rental_is_finalized(uuid) is
  'True once a rental has reserved, issued a contract, or taken money that is still standing. Posted charges are protected from that point on.';

revoke all on function app.rental_is_finalized(uuid) from public, anon;
grant execute on function app.rental_is_finalized(uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- The integrity trigger
-- -----------------------------------------------------------------------------

/**
 * What a posted charge line will and will not accept.
 *
 * RLS can refuse a whole row but cannot say "these columns are frozen and
 * those are not", so column-level protection lives here. The trigger is the
 * boundary; the policies below it are a second, coarser one.
 *
 * DELETE is refused outright once the rental is finalized. UPDATE is refused
 * for the columns that carry money, tax treatment or ownership -- amount, unit
 * amount, quantity, taxability, currency, kind, the rental and the
 * organization -- while leaving `sort_order` and `description` editable,
 * because reordering a contract or fixing a typo in a label changes nothing
 * financial.
 *
 * A reversal, once posted, is itself a posted charge: it is protected by the
 * same rules, so a correction cannot be quietly un-corrected.
 */
create or replace function app.guard_rental_line_item_integrity()
returns trigger
language plpgsql
-- SECURITY DEFINER because the guard consults `app.closure_state_of` and
-- `app.rental_is_finalized`, neither of which a signed-in role may execute.
-- It reads to decide a refusal and writes nothing, and `anon` is revoked below.
security definer
set search_path = public, pg_temp
as $$
declare
  v_original public.rental_line_items;
begin
  if tg_op = 'DELETE' then
    /*
     * A charge whose rental has gone is not being erased, it is being carried
     * away. `rental_line_items_rental_fkey` is ON DELETE CASCADE, so closing
     * an account and purging its data arrives here with the parent already
     * removed. Refusing that would make the protection outlive the thing it
     * protects and leave an agency unable to delete its own records.
     */
    if not exists (select 1 from public.rentals r where r.id = old.rental_id) then
      return old;
    end if;

    /*
     * An agency erasing itself is not an operator erasing a charge.
     * `app.organization_purge_tables` deletes `rental_line_items` by
     * organization while the rentals are still standing, so without this an
     * agency that asked to close could never finish closing -- the protection
     * would hold its data hostage. The state is derived from the closure
     * timestamps on the organization and reached only through the owner-only
     * closure workflow, so it is not something a client can assert for itself.
     */
    if app.closure_state_of(old.organization_id) in ('purging', 'closed') then
      return old;
    end if;

    if app.rental_is_finalized(old.rental_id) then
      raise exception
        'This charge is part of a committed rental and cannot be deleted. Reverse it instead.'
        using errcode = '42501';
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' then
    /*
     * The base hire is exempt, and this is a deliberate, narrow hole.
     *
     * `rental_extend` and `rental_reprice` restate the hire by UPDATE-ing its
     * base_rental line, and both are SECURITY INVOKER, so they are
     * indistinguishable here from a direct write by the same operator. There
     * is no discriminator available: a session flag would be settable by the
     * caller it is meant to constrain, and `current_user` does not change
     * because nothing in this path is SECURITY DEFINER.
     *
     * Everything an operator can add is frozen; the one line nobody can add is
     * not. Closing this properly means giving the amendment RPCs their own
     * privileged, authorization-checked boundary, which is a larger change than
     * this migration should make unannounced. It is reported for decision.
     */
    if old.kind <> 'base_rental'
       and app.rental_is_finalized(old.rental_id)
       /*
        * `id`, `organization_id`, `rental_id`, `currency`, `created_at` and
        * `created_by` are absent from this list because they are already
        * frozen by `rental_line_items_freeze_columns` (20260815100000:277),
        * which RESTORES them rather than refusing. That trigger sorts before
        * this one, so by the time this runs those columns are back to their
        * old values and testing them here would be dead code that reads like
        * protection. What was missing was the money and the tax.
        */
       and (new.amount_minor      is distinct from old.amount_minor
         or new.unit_amount_minor is distinct from old.unit_amount_minor
         or new.quantity          is distinct from old.quantity
         or new.is_taxable        is distinct from old.is_taxable
         or new.kind              is distinct from old.kind
         or new.reverses_line_item_id is distinct from old.reverses_line_item_id
         or new.reversal_reason   is distinct from old.reversal_reason)
    then
      raise exception
        'This charge is part of a committed rental. Its amount and tax treatment cannot be changed; post a reversal instead.'
        using errcode = '42501';
    end if;
    return new;
  end if;

  -- INSERT of a reversal: it must mirror a real charge on the same rental.
  if new.reverses_line_item_id is not null then
    select * into v_original
      from public.rental_line_items l
     where l.id = new.reverses_line_item_id;

    if v_original.id is null then
      raise exception 'The charge being reversed does not exist.' using errcode = 'P0002';
    end if;

    if v_original.rental_id <> new.rental_id
       or v_original.organization_id <> new.organization_id then
      raise exception 'A reversal must belong to the same rental as the charge it reverses.'
        using errcode = '23514';
    end if;

    if v_original.reverses_line_item_id is not null then
      raise exception 'A reversal cannot itself be reversed.' using errcode = '23514';
    end if;

    -- The money and the tax must come back out exactly as they went in.
    -- Anything else is a new charge wearing a reversal's name.
    if new.amount_minor <> -v_original.amount_minor then
      raise exception 'A reversal must be the exact opposite of the charge it reverses.'
        using errcode = '23514';
    end if;

    if new.is_taxable is distinct from v_original.is_taxable then
      raise exception 'A reversal must carry the same tax treatment as the charge it reverses.'
        using errcode = '23514';
    end if;

    if new.currency is distinct from v_original.currency then
      raise exception 'A reversal must be in the same currency as the charge it reverses.'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists rental_line_items_integrity on public.rental_line_items;
create trigger rental_line_items_integrity
  before insert or update or delete on public.rental_line_items
  for each row execute function app.guard_rental_line_item_integrity();

-- -----------------------------------------------------------------------------
-- Policies: a second boundary, coarser than the trigger
-- -----------------------------------------------------------------------------

/*
 * The DELETE policy is deliberately left as it was, and the trigger above is
 * the boundary.
 *
 * Adding `not app.rental_is_finalized(rental_id)` here was the first attempt
 * and it was wrong in a way worth recording. A row a policy hides is not
 * refused, it is INVISIBLE: the DELETE matches nothing, affects zero rows and
 * returns success. The client then believes the charge is gone while the
 * database still holds it, which is a worse failure than the one being fixed --
 * the operator walks away satisfied and the books disagree with the screen.
 *
 * A BEFORE DELETE trigger raising 42501 cannot be bypassed by any client, runs
 * for every path including direct PostgREST calls, and says out loud what
 * happened and what to do instead.
 */

/*
 * Posting a reversal is a MANAGER action, not a staff one.
 *
 * This follows the ladder the codebase already uses for money rather than
 * inventing a role: recording a payment is staff (payments_insert), voiding one
 * is manager (payments_update), destroying one is admin (payments_delete).
 * Undoing a posted charge is the same kind of act as voiding a payment, so it
 * sits at the same height. Staff keep every ordinary charge they had before.
 */
alter policy rental_line_items_insert on public.rental_line_items
  with check (app.has_min_role(organization_id, 'staff'::public.org_role)
              and app.billing_may_write(organization_id)
              and (reverses_line_item_id is null
                   or app.has_min_role(organization_id, 'manager'::public.org_role)));

-- -----------------------------------------------------------------------------
-- The totals have to understand a reversal
-- -----------------------------------------------------------------------------

/**
 * Unchanged except that a reversal is subtracted from the bucket it came from.
 *
 * Without this a negative reversal would fall into the discount bucket, and a
 * refunded extra would be printed on a later contract version as a discount the
 * agency never gave. A reversal of a discount is positive and would otherwise
 * have been counted as an extra. Joining to the line being reversed puts each
 * correction back where the original was counted, so the breakdown stays
 * readable and the total is unchanged either way.
 */
create or replace function app.recalculate_rental_totals(p_rental_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_base      bigint;
  v_extras    bigint;
  v_discount  bigint;
  v_taxable   bigint;
  v_tax       bigint;
  v_rate      integer;
  v_status    public.rental_status;
begin
  select r.tax_rate_bps, r.status into v_rate, v_status
  from public.rentals r
  where r.id = p_rental_id;

  if v_rate is null then
    return;
  end if;

  select
    coalesce(sum(l.amount_minor) filter (
      where l.reverses_line_item_id is null and l.kind = 'base_rental' and l.amount_minor > 0), 0)
      + coalesce(sum(l.amount_minor) filter (where o.kind = 'base_rental'), 0),

    coalesce(sum(l.amount_minor) filter (
      where l.reverses_line_item_id is null and l.kind <> 'base_rental' and l.amount_minor > 0), 0)
      + coalesce(sum(l.amount_minor) filter (
          where o.id is not null and o.kind <> 'base_rental' and o.amount_minor > 0), 0),

    coalesce(-sum(l.amount_minor) filter (
      where l.reverses_line_item_id is null and l.amount_minor < 0), 0)
      - coalesce(sum(l.amount_minor) filter (where o.amount_minor < 0), 0),

    coalesce(sum(l.amount_minor) filter (where l.is_taxable), 0)
    into v_base, v_extras, v_discount, v_taxable
  from public.rental_line_items l
  left join public.rental_line_items o on o.id = l.reverses_line_item_id
  where l.rental_id = p_rental_id;

  -- Tax applies to the taxable lines net of any taxable discount, never to the
  -- deposit, which is not a charge at all.
  v_tax := round(greatest(v_taxable, 0)::numeric * v_rate / 10000.0)::bigint;

  if v_base + v_extras - v_discount + v_tax < 0 then
    raise exception 'The discount on this contract exceeds its charges.'
      using errcode = '23514';
  end if;

  perform set_config('app.rental_totals_sync', 'on', true);
  update public.rentals r
     set subtotal_minor = v_base,
         extras_minor   = v_extras,
         discount_minor = v_discount,
         tax_minor      = v_tax,
         total_minor    = v_base + v_extras - v_discount + v_tax
   where r.id = p_rental_id;
  perform set_config('app.rental_totals_sync', 'off', true);
end;
$$;

-- -----------------------------------------------------------------------------
-- Reversing a charge
-- -----------------------------------------------------------------------------

/**
 * Undo a posted charge without destroying it.
 *
 * SECURITY INVOKER on purpose. It runs with the caller's own rights, so row
 * level security, the role ladder and the billing entitlement all apply exactly
 * as they would to any other write -- there is no privileged helper here to
 * find a way into. The checks below are for clear errors, not for safety; the
 * policies and the integrity trigger are what make it safe.
 *
 * The base hire is deliberately not reversible. It is written by the system,
 * and the product already has the right instrument for changing it: repricing,
 * extension and early return restate the hire through their own paths, each of
 * which keeps the contract and the availability in step. A reversal is for the
 * charges an operator added.
 */
create or replace function public.rental_reverse_charge(
  p_line_item_id uuid,
  p_reason       text
)
returns public.rental_line_items
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_original public.rental_line_items;
  v_reversal public.rental_line_items;
begin
  select * into v_original
    from public.rental_line_items l
   where l.id = p_line_item_id;

  if v_original.id is null then
    raise exception 'Charge not found.' using errcode = 'P0002';
  end if;

  if v_original.kind = 'base_rental' then
    raise exception
      'The hire itself is changed by repricing, extension or an early return, not by a reversal.'
      using errcode = '23514';
  end if;

  if v_original.reverses_line_item_id is not null then
    raise exception 'A reversal cannot itself be reversed.' using errcode = '23514';
  end if;

  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'A reversal has to say why.' using errcode = '23514';
  end if;

  if exists (
    select 1 from public.rental_line_items x
     where x.reverses_line_item_id = v_original.id
  ) then
    raise exception 'That charge has already been reversed.' using errcode = '23505';
  end if;

  insert into public.rental_line_items (
    organization_id, rental_id, kind, description,
    quantity, unit_amount_minor, amount_minor, currency,
    is_taxable, sort_order, created_by,
    reverses_line_item_id, reversal_reason
  ) values (
    v_original.organization_id,
    v_original.rental_id,
    v_original.kind,
    'Reversal — ' || v_original.description,
    v_original.quantity,
    -v_original.unit_amount_minor,
    -v_original.amount_minor,
    v_original.currency,
    v_original.is_taxable,
    v_original.sort_order,
    auth.uid(),
    v_original.id,
    btrim(p_reason)
  )
  returning * into v_reversal;

  return v_reversal;
end;
$$;

comment on function public.rental_reverse_charge(uuid, text) is
  'Posts the exact opposite of a charge, preserving the original. Manager and above, enforced by the insert policy. The hire itself is not reversible.';

revoke all on function public.rental_reverse_charge(uuid, text) from public, anon;
grant execute on function public.rental_reverse_charge(uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- Cancellation settles by reversing, not by erasing
-- -----------------------------------------------------------------------------

/*
 * A staff member may cancel, and cancelling must still work.
 *
 * Reversing a charge is a manager's act when an operator chooses to do it, but
 * cancellation settlement is staff today and the workflow is approved, so the
 * two have to coexist. The discriminator is the rental's own state, not a flag
 * the caller can set: `rental_cancel` writes `status = 'cancelled'` before it
 * settles, so a reversal on an already-cancelled rental is a settlement
 * reversal by construction.
 *
 * The opening this leaves is nil in practice. On a cancelled rental settlement
 * has already reversed everything that carried money, one reversal per line is
 * enforced by a unique index, and a reversal must mirror its original exactly
 * -- so a staff member who cancels a booking gains no power to invent an
 * amount.
 */
alter policy rental_line_items_insert on public.rental_line_items
  with check (app.has_min_role(organization_id, 'staff'::public.org_role)
              and app.billing_may_write(organization_id)
              and (reverses_line_item_id is null
                   or app.has_min_role(organization_id, 'manager'::public.org_role)
                   or exists (select 1 from public.rentals r
                               where r.id = rental_id and r.status = 'cancelled')));

/**
 * Settling a cancelled booking.
 *
 * SAME OUTCOME, DIFFERENT MEANS. The charge still falls to whatever the agency
 * keeps -- the cancellation fee, or nothing -- which is the approved pricing
 * and is not changed here. What changes is that the money is taken off by
 * REVERSING each line instead of deleting the discounts and zeroing the rest.
 * The original figures stay on the contract beside their reversals, so a
 * cancelled booking can still be read: what was charged, what was taken back,
 * and what was kept.
 *
 * ORDER IS LOAD-BEARING, for the same reason it always was. Reversing a
 * discount is a POSITIVE line, so discounts go first and the total rises before
 * anything reduces it. Reversing the charges first would leave a moment where
 * the discount exceeded them, and `recalculate_rental_totals` refuses that
 * outright -- which would fail the whole cancellation.
 *
 * SAFE TO RETRY. Every step skips lines that already carry a reversal, and the
 * unique index on `reverses_line_item_id` makes that guarantee the schema's
 * rather than the query's. `rental_set_cancellation_fee` calls this again to
 * change the fee: the old fee line is reversed and a new one posted, so both
 * figures remain visible. The whole function runs inside the caller's
 * transaction, so a failure anywhere leaves no partial settlement.
 */
create or replace function app.settle_cancelled_rental(
  p_rental_id  uuid,
  p_fee_minor  bigint
)
returns void
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_rental public.rentals;
  v_line   public.rental_line_items;
begin
  select * into v_rental from public.rentals where id = p_rental_id;
  if v_rental.id is null then
    raise exception 'Rental not found.' using errcode = 'P0002';
  end if;

  -- Discounts first: their reversals are positive and raise the total.
  for v_line in
    select l.* from public.rental_line_items l
     where l.rental_id = p_rental_id
       and l.reverses_line_item_id is null
       and l.amount_minor < 0
       and not exists (
         select 1 from public.rental_line_items x where x.reverses_line_item_id = l.id)
     order by l.id
  loop
    perform app.post_settlement_reversal(v_line);
  end loop;

  -- Then everything still carrying a charge, the cancellation fee included:
  -- a fee already on the booking is reversed so a changed fee leaves both.
  for v_line in
    select l.* from public.rental_line_items l
     where l.rental_id = p_rental_id
       and l.reverses_line_item_id is null
       and l.amount_minor > 0
       and not exists (
         select 1 from public.rental_line_items x where x.reverses_line_item_id = l.id)
     order by l.id
  loop
    perform app.post_settlement_reversal(v_line);
  end loop;

  if coalesce(p_fee_minor, 0) > 0 then
    /*
     * Outside the tax base by default. What a cancellation fee is for tax
     * purposes differs by country -- compensation in many, a supply in some --
     * and the flag is per line precisely so the agency can say. Charging tax
     * nobody owes is the worse of the two mistakes to make silently.
     */
    insert into public.rental_line_items (
      organization_id, rental_id, kind, description,
      quantity, unit_amount_minor, amount_minor, currency, is_taxable, sort_order, created_by
    ) values (
      v_rental.organization_id, p_rental_id, 'cancellation_fee', 'Cancellation fee',
      1, p_fee_minor, p_fee_minor, v_rental.currency, false, 1000, (select auth.uid())
    );
  end if;
end;
$$;

/** One settlement reversal, mirroring its line exactly. */
create or replace function app.post_settlement_reversal(p_line public.rental_line_items)
returns void
language plpgsql
set search_path = public, pg_temp
as $$
begin
  insert into public.rental_line_items (
    organization_id, rental_id, kind, description,
    quantity, unit_amount_minor, amount_minor, currency,
    is_taxable, sort_order, created_by,
    reverses_line_item_id, reversal_reason
  ) values (
    p_line.organization_id, p_line.rental_id, p_line.kind,
    'Reversal — ' || p_line.description,
    p_line.quantity, -p_line.unit_amount_minor, -p_line.amount_minor, p_line.currency,
    p_line.is_taxable, p_line.sort_order, (select auth.uid()),
    p_line.id, 'Booking cancelled'
  );
end;
$$;

revoke all on function app.post_settlement_reversal(public.rental_line_items) from public, anon;
grant execute on function app.post_settlement_reversal(public.rental_line_items) to authenticated;

-- Supabase's default privileges grant EXECUTE on a new function to `public`,
-- which includes `anon`. Nothing in `app` is reachable anonymously -- there is
-- no schema USAGE and PostgREST exposes only `public` -- but the boundary has
-- to be where the schema says it is, and permission-matrix asserts exactly that.
revoke all on function app.guard_rental_line_item_integrity() from public, anon;
-- Re-granted explicitly: `authenticated` held EXECUTE only through PUBLIC, and
-- revoking PUBLIC without this leaves every signed-in write to a charge line
-- failing with "permission denied for function".
grant execute on function app.guard_rental_line_item_integrity() to authenticated, service_role;
grant execute on function app.post_settlement_reversal(public.rental_line_items) to service_role;

-- =============================================================================
-- The base hire stops being the exception
-- =============================================================================
--
-- The first version of this migration froze every charge an operator can add
-- and left the base hire mutable, because `rental_extend` and `rental_reprice`
-- restate it by UPDATE and both ran as the caller -- indistinguishable, from
-- inside a trigger, from the operator editing the figure by hand. That left
-- the largest amount on the contract as the one thing a direct PostgREST call
-- could still rewrite, which is not a protection worth having.
--
-- THE DISCRIMINATOR IS WHO THE WRITER IS, and it is not forgeable. A
-- SECURITY DEFINER function owned by the table's owner runs with
-- `current_user` set to that owner; a request arriving through PostgREST runs
-- as `authenticated`, and a signed-in role cannot become the owner -- there is
-- no SET ROLE it is permitted to make. So the guard asks whether the writer is
-- the owner rather than asking the writer to assert anything about itself.
--
-- This is deliberately NOT a session flag. `set_config` is callable by anyone,
-- so a GUC the trigger trusts is a GUC the attacker sets first; a flag like
-- that would read as a boundary while being none.
--
-- The two pricing functions are therefore given a real privileged boundary:
-- tenant membership, the role the workflow already required, the billing
-- entitlement RLS used to apply on their behalf, the rental state rules they
-- already enforced, a fixed search path, and grants that keep `anon` out.
-- Making them definer removes RLS from their writes, so every gate RLS was
-- providing is restated explicitly inside them. Neither signature changes.

/**
 * Is this agency being purged? Asked on the guard's behalf.
 *
 * `app.closure_state_of` is not executable by a signed-in role, and the guard
 * below has to run AS THE CALLER to see who the caller is. So the one
 * privileged read it needs is wrapped here instead, where SECURITY DEFINER
 * costs nothing: it answers a yes/no question about the caller's own
 * organization and writes nothing.
 */
create or replace function app.rental_charges_purge_exempt(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.closure_state_of(p_organization_id) in ('purging', 'closed');
$$;

revoke all on function app.rental_charges_purge_exempt(uuid) from public, anon;
grant execute on function app.rental_charges_purge_exempt(uuid) to authenticated, service_role;

/*
 * SECURITY INVOKER, and that is the whole point.
 *
 * A SECURITY DEFINER trigger runs as its own owner whoever wrote the row, so
 * `current_user` inside it is a constant and tells you nothing about the
 * writer. Running as the invoker makes `current_user` the identity that
 * actually performed the write: `authenticated` for a request through
 * PostgREST, and the owner when the statement came from inside one of the
 * privileged pricing functions. The two privileged reads it needs are definer
 * helpers of their own.
 */
create or replace function app.guard_rental_line_item_integrity()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_original public.rental_line_items;
  v_owner    text;
begin
  /*
   * Writes made by the table's owner are the authorized pricing paths.
   *
   * `rental_extend` and `rental_reprice` are SECURITY DEFINER and owned by the
   * owner, so inside them `current_user` is the owner. A client is
   * `authenticated` and cannot become the owner. Checked by comparing against
   * the catalogue rather than against a literal, so this keeps working wherever
   * the schema is installed under a different name.
   */
  select pg_get_userbyid(c.relowner) into v_owner
    from pg_class c where c.oid = 'public.rental_line_items'::regclass;

  if current_user = v_owner then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op = 'DELETE' then
    /*
     * A charge whose rental has gone is not being erased, it is being carried
     * away. `rental_line_items_rental_fkey` is ON DELETE CASCADE, so closing
     * an account and purging its data arrives here with the parent already
     * removed. Refusing that would make the protection outlive the thing it
     * protects and leave an agency unable to delete its own records.
     */
    if not exists (select 1 from public.rentals r where r.id = old.rental_id) then
      return old;
    end if;

    /*
     * An agency erasing itself is not an operator erasing a charge.
     * `app.organization_purge_tables` deletes `rental_line_items` by
     * organization while the rentals are still standing. The state is derived
     * from the closure timestamps and reached only through the owner-only
     * closure workflow, so it is not something a client can assert for itself.
     */
    if app.rental_charges_purge_exempt(old.organization_id) then
      return old;
    end if;

    if app.rental_is_finalized(old.rental_id) then
      raise exception
        'This charge is part of a committed rental and cannot be deleted. Reverse it instead.'
        using errcode = '42501';
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' then
    /*
     * No kind is exempt any more. `id`, `organization_id`, `rental_id`,
     * `currency`, `created_at` and `created_by` are still absent from this list
     * because `rental_line_items_freeze_columns` (20260815100000:277) already
     * RESTORES them, and it sorts before this trigger -- testing them here
     * would be dead code that reads like protection.
     */
    if app.rental_is_finalized(old.rental_id)
       and (new.amount_minor      is distinct from old.amount_minor
         or new.unit_amount_minor is distinct from old.unit_amount_minor
         or new.quantity          is distinct from old.quantity
         or new.is_taxable        is distinct from old.is_taxable
         or new.kind              is distinct from old.kind
         or new.reverses_line_item_id is distinct from old.reverses_line_item_id
         or new.reversal_reason   is distinct from old.reversal_reason)
    then
      raise exception
        'This charge is part of a committed rental. Its amount and tax treatment cannot be changed; post a reversal instead.'
        using errcode = '42501';
    end if;
    return new;
  end if;

  /*
   * A second base hire cannot be inserted onto a committed rental.
   *
   * Freezing the existing line is not enough on its own: the pricing functions
   * read "the earliest base_rental line", so an operator who could post
   * another one could restate the hire by addition instead of by edit. The
   * authorized paths are exempt above; this closes the same door for everyone
   * else.
   */
  -- A REVERSAL of the hire is not a second hire: cancellation settlement
  -- posts exactly that, and it is the mechanism this migration introduced.
  if new.kind = 'base_rental'
     and new.reverses_line_item_id is null
     and app.rental_is_finalized(new.rental_id)
     -- REPLACING one, not creating the first. A committed booking that has no
     -- hire line yet is an ordinary case -- lead conversion builds the rental
     -- before its charge, and repricing writes one where none exists -- and
     -- refusing that would block creation while claiming to prevent
     -- substitution.
     and exists (
       select 1 from public.rental_line_items l
        where l.rental_id = new.rental_id
          and l.kind = 'base_rental'
          and l.reverses_line_item_id is null) then
    raise exception
      'The hire on a committed rental is changed by repricing or an extension, not by adding another hire line.'
      using errcode = '42501';
  end if;

  -- INSERT of a reversal: it must mirror a real charge on the same rental.
  if new.reverses_line_item_id is not null then
    select * into v_original
      from public.rental_line_items l
     where l.id = new.reverses_line_item_id;

    if v_original.id is null then
      raise exception 'The charge being reversed does not exist.' using errcode = 'P0002';
    end if;

    if v_original.rental_id <> new.rental_id
       or v_original.organization_id <> new.organization_id then
      raise exception 'A reversal must belong to the same rental as the charge it reverses.'
        using errcode = '23514';
    end if;

    if v_original.reverses_line_item_id is not null then
      raise exception 'A reversal cannot itself be reversed.' using errcode = '23514';
    end if;

    if new.amount_minor <> -v_original.amount_minor then
      raise exception 'A reversal must be the exact opposite of the charge it reverses.'
        using errcode = '23514';
    end if;

    if new.is_taxable is distinct from v_original.is_taxable then
      raise exception 'A reversal must carry the same tax treatment as the charge it reverses.'
        using errcode = '23514';
    end if;

    if new.currency is distinct from v_original.currency then
      raise exception 'A reversal must be in the same currency as the charge it reverses.'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function app.guard_rental_line_item_integrity() from public, anon;
grant execute on function app.guard_rental_line_item_integrity() to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- The two authorized pricing paths, now privileged and explicitly gated
-- -----------------------------------------------------------------------------

/**
 * Extending a hire. Behaviour unchanged; the boundary is new.
 *
 * SECURITY DEFINER so the hire line can be restated while remaining frozen
 * against everyone else. That removes RLS from its writes, so the three gates
 * RLS was applying on its behalf are restated here: membership, the staff role
 * the policies required, and the billing entitlement. The state rules the
 * function already enforced are unchanged, and the signature is identical, so
 * every existing caller keeps working.
 */
create or replace function public.rental_extend(
  p_rental_id uuid,
  p_new_ends_at timestamptz,
  p_charge_minor bigint default 0,
  p_charge_description text default null,
  p_additional_days integer default null
)
returns public.rentals
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_rental   public.rentals;
  v_added    integer;
  v_line     public.rental_line_items;
  v_quantity numeric(10, 2);
  v_amount   bigint;
begin
  select * into v_rental from public.rentals where id = p_rental_id for update;

  -- Membership and role together, and a refusal that does not confirm the
  -- rental exists: telling another agency that an id is real is itself a leak.
  if v_rental.id is null
     or (current_setting('role', true) = 'authenticated'
         and not app.has_min_role(v_rental.organization_id, 'staff'::public.org_role)) then
    raise exception 'Rental not found.' using errcode = 'P0002';
  end if;

  -- RLS used to apply this through rental_line_items_update. It does not any
  -- more, so it is asked for directly.
  perform app.billing_require_write(v_rental.organization_id);

  if v_rental.status not in ('reserved', 'active') then
    raise exception 'Only a reservation or an active rental can be extended.' using errcode = '23514';
  end if;
  if p_new_ends_at <= v_rental.ends_at then
    raise exception 'An extension must end after the current return date.' using errcode = '23514';
  end if;

  v_added := greatest(
    coalesce(p_additional_days, public.rental_billable_days(v_rental.ends_at, p_new_ends_at)), 0);

  /*
   * `app.assignment_lifecycle_active`, NOT the session GUC the original text
   * carried. 20261120100000 rewrites every function mentioning that GUC into
   * this per-organization check, in place, with a `do` block -- so a later
   * migration that re-states the old wording silently reverts the feature to a
   * session flag nobody sets, and the assignment row a reservation needs stops
   * being opened. The rewrite has already run by the time this migration does;
   * it will not run again.
   */
  if v_rental.status = 'reserved'
     and app.assignment_lifecycle_active(v_rental.organization_id) then
    perform app.sync_rental_assignment_schedule(
      p_rental_id, v_rental.vehicle_id, v_rental.starts_at, p_new_ends_at);
  end if;

  update public.rentals
     set ends_at = p_new_ends_at,
         original_ends_at = coalesce(original_ends_at, v_rental.ends_at),
         extension_count = extension_count + 1,
         billable_days = coalesce(billable_days, 0) + v_added
   where id = p_rental_id
  returning * into v_rental;

  select * into v_line from public.rental_line_items l
   where l.rental_id = p_rental_id and l.kind = 'base_rental'
   order by l.sort_order, l.created_at limit 1;

  if v_line.id is not null then
    v_quantity := v_line.quantity + v_added;
    v_amount   := v_line.amount_minor + coalesce(p_charge_minor, 0);
    update public.rental_line_items
       set quantity = v_quantity,
           amount_minor = v_amount,
           unit_amount_minor = case
             when v_quantity > 0 then round(v_amount / v_quantity)::bigint else v_amount end,
           description = round(v_quantity)::integer || ' day hire'
     where id = v_line.id;
  elsif coalesce(p_charge_minor, 0) > 0 or v_added > 0 then
    insert into public.rental_line_items (
      organization_id, rental_id, kind, description, quantity,
      unit_amount_minor, amount_minor, currency, sort_order, created_by)
    values (
      v_rental.organization_id, p_rental_id, 'base_rental',
      greatest(v_added, 1) || ' day hire', greatest(v_added, 1),
      case when v_added > 0
        then round(coalesce(p_charge_minor, 0)::numeric / v_added)::bigint
        else coalesce(p_charge_minor, 0) end,
      coalesce(p_charge_minor, 0), v_rental.currency, 0, (select auth.uid()));
  end if;

  perform p_charge_description;
  select * into v_rental from public.rentals where id = p_rental_id;
  return v_rental;
end;
$$;

revoke all on function public.rental_extend(uuid, timestamptz, bigint, text, integer) from public, anon;
grant execute on function public.rental_extend(uuid, timestamptz, bigint, text, integer) to authenticated;

/**
 * Repricing a booking that has not started. Behaviour unchanged; boundary new.
 *
 * Same reasoning as the extension above, and the same three gates. The day
 * arithmetic, the currency check and the refusal when extensions already cover
 * the hire are exactly as they were.
 */
create or replace function public.rental_reprice(p_rental_id uuid)
returns public.rentals
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_rental     public.rentals;
  v_vehicle    public.vehicles;
  v_total_days integer;
  v_extra_days integer;
  v_days       integer;
  v_amount     bigint;
  v_line       public.rental_line_items;
begin
  select * into v_rental from public.rentals where id = p_rental_id for update;

  if v_rental.id is null
     or (current_setting('role', true) = 'authenticated'
         and not app.has_min_role(v_rental.organization_id, 'staff'::public.org_role)) then
    raise exception 'Rental not found.' using errcode = 'P0002';
  end if;

  perform app.billing_require_write(v_rental.organization_id);

  if v_rental.status not in ('draft', 'reserved') then
    raise exception 'Only a draft or a confirmed reservation can be repriced.'
      using errcode = '23514';
  end if;

  select * into v_vehicle from public.vehicles where id = v_rental.vehicle_id;
  if v_vehicle.id is null then
    raise exception 'That vehicle is no longer in the fleet.' using errcode = 'P0002';
  end if;
  if v_vehicle.currency <> v_rental.currency then
    raise exception 'That vehicle is priced in %, and this rental is in %.',
      v_vehicle.currency, v_rental.currency using errcode = '23514';
  end if;

  v_total_days := coalesce(
    nullif(v_rental.billable_days, 0),
    public.rental_billable_days(v_rental.starts_at, v_rental.ends_at));

  select * into v_line from public.rental_line_items l
   where l.rental_id = p_rental_id and l.kind = 'base_rental'
   order by l.sort_order, l.created_at limit 1;

  select coalesce(sum(l.quantity), 0)::integer into v_extra_days
    from public.rental_line_items l
   where l.rental_id = p_rental_id and l.kind = 'base_rental'
     and (v_line.id is null or l.id <> v_line.id);

  v_days := v_total_days - v_extra_days;

  if v_days <= 0 then
    raise exception
      'The extensions on this booking already cover % of its % days. Adjust the charges by hand.',
      v_extra_days, v_total_days using errcode = '23514';
  end if;

  v_amount := v_vehicle.daily_rate_minor * v_days;

  if v_line.id is not null then
    update public.rental_line_items
       set description = v_days || ' day hire',
           quantity = v_days,
           unit_amount_minor = v_vehicle.daily_rate_minor,
           amount_minor = v_amount
     where id = v_line.id;
  else
    insert into public.rental_line_items (
      organization_id, rental_id, kind, description, quantity,
      unit_amount_minor, amount_minor, currency, sort_order, created_by)
    values (
      v_rental.organization_id, p_rental_id, 'base_rental',
      v_days || ' day hire', v_days,
      v_vehicle.daily_rate_minor, v_amount, v_rental.currency, 0, (select auth.uid()));
  end if;

  update public.rentals set daily_rate_minor = v_vehicle.daily_rate_minor
   where id = p_rental_id;

  select * into v_rental from public.rentals where id = p_rental_id;
  return v_rental;
end;
$$;

revoke all on function public.rental_reprice(uuid) from public, anon;
grant execute on function public.rental_reprice(uuid) to authenticated;

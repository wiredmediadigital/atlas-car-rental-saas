/**
 * One amendment record per restatement of the hire. Exactly one.
 *
 * THE DEFECT. The evidence requirement matched a mutation's SIGNATURE -- the
 * rental, the charge line, the previous and revised amounts, and the quantity,
 * rate and tax changes. A signature is not a claim: two mutations with the same
 * signature were both satisfied by one record. Reproduced, in one transaction:
 *
 *     10000 -> 20000   recorded
 *     20000 -> 10000   recorded
 *     10000 -> 20000   NOT recorded, and it committed
 *
 * The history did not merely under-record. It became internally inconsistent:
 * read back, the last recorded revised amount was 10000 while the live hire
 * stood at 20000. Reconciling the two would say the contract and the record
 * disagree, which is the one thing this table exists to prevent.
 *
 * THE MECHANISM. Every charge line now carries a revision number, bumped by the
 * database on each mutation that moves money. An amendment records the revision
 * it describes, a unique index allows one amendment per revision, and the
 * evidence check asks for THAT revision rather than for something that looks
 * like it.
 *
 * Deliberately NOT a transaction id, a timestamp, an amount signature, xmin, or
 * a unique index over the previous and revised amounts -- each of those is a
 * fingerprint that two genuinely different mutations can share. Identical
 * pricing transitions are legitimate and must stay recordable: 100 -> 200 twice
 * in one transaction is two amendments, at two revisions, and both are kept.
 */

-- -----------------------------------------------------------------------------
-- 1. A revision number on the charge line
--
-- The counter is maintained by the database, not by the caller, so a function
-- that forgets to bump it cannot exist. It counts only mutations that move
-- money or change the tax treatment -- the same set the evidence requirement
-- cares about -- so renaming a line is not a revision.
-- -----------------------------------------------------------------------------

alter table public.rental_line_items
  add column if not exists revision_no integer not null default 0;

comment on column public.rental_line_items.revision_no is
  'How many times this charge has been financially restated. Maintained by app.bump_rental_line_item_revision; an amendment record names the revision it describes, which is what makes the two one-to-one.';

create or replace function app.bump_rental_line_item_revision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.amount_minor      is distinct from old.amount_minor
     or new.quantity          is distinct from old.quantity
     or new.unit_amount_minor is distinct from old.unit_amount_minor
     or new.is_taxable        is distinct from old.is_taxable then
    new.revision_no := coalesce(old.revision_no, 0) + 1;
  else
    -- Not a financial restatement, so not a revision. The counter must not
    -- drift on a description edit, or the evidence check would start asking
    -- for records of changes that never happened.
    new.revision_no := old.revision_no;
  end if;
  return new;
end;
$$;

revoke all on function app.bump_rental_line_item_revision() from public, anon, authenticated;

/*
 * Named to sort after rental_line_items_freeze_columns, which restores frozen
 * columns from the old row. revision_no is deliberately not among them, but
 * ordering this last means the counter is set on the row that is actually
 * written whatever the other BEFORE triggers do to it.
 */
drop trigger if exists rental_line_items_zz_revision on public.rental_line_items;
create trigger rental_line_items_zz_revision
  before update on public.rental_line_items
  for each row
  execute function app.bump_rental_line_item_revision();

-- -----------------------------------------------------------------------------
-- 2. The amendment names the revision it describes
-- -----------------------------------------------------------------------------

alter table public.rental_pricing_amendments
  add column if not exists line_revision_no integer;

comment on column public.rental_pricing_amendments.line_revision_no is
  'The charge line revision this record describes. With the unique index below it is what makes one amendment answer for exactly one restatement.';

/*
 * One amendment per revision of a line. This is the one-to-one guarantee; the
 * evidence check below is how it is enforced at the moment of the write.
 *
 * Partial, because an amendment whose charge line has since been deleted keeps
 * line_item_id null (the foreign key sets it null rather than cascading) and
 * must not then collide with another.
 */
create unique index if not exists rental_pricing_amendments_one_per_revision
  on public.rental_pricing_amendments (line_item_id, line_revision_no)
  where line_item_id is not null and line_revision_no is not null;

-- -----------------------------------------------------------------------------
-- 3. Recording, and when not to
-- -----------------------------------------------------------------------------

create or replace function app.record_rental_pricing_amendment(
  p_before_rental public.rentals,
  p_before_line   public.rental_line_items,
  p_after_rental  public.rentals,
  p_after_line    public.rental_line_items,
  p_kind          public.rental_amendment_kind,
  p_reason        text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_changes jsonb := '{}'::jsonb;
  v_version integer;
  v_moved   boolean;
begin
  if p_after_rental.id is null then
    raise exception 'An amendment needs the rental it amended.' using errcode = '23502';
  end if;

  -- Only what moved. A key's absence is itself a claim that the field held
  -- still, and the evidence check holds the mutation to it.
  if p_after_rental.starts_at is distinct from p_before_rental.starts_at then
    v_changes := v_changes || jsonb_build_object('starts_at',
      jsonb_build_object('from', p_before_rental.starts_at, 'to', p_after_rental.starts_at));
  end if;
  if p_after_rental.ends_at is distinct from p_before_rental.ends_at then
    v_changes := v_changes || jsonb_build_object('ends_at',
      jsonb_build_object('from', p_before_rental.ends_at, 'to', p_after_rental.ends_at));
  end if;
  if p_after_rental.billable_days is distinct from p_before_rental.billable_days then
    v_changes := v_changes || jsonb_build_object('billable_days',
      jsonb_build_object('from', p_before_rental.billable_days, 'to', p_after_rental.billable_days));
  end if;
  if p_after_line.quantity is distinct from p_before_line.quantity then
    v_changes := v_changes || jsonb_build_object('quantity',
      jsonb_build_object('from', p_before_line.quantity, 'to', p_after_line.quantity));
  end if;
  if p_after_line.unit_amount_minor is distinct from p_before_line.unit_amount_minor then
    v_changes := v_changes || jsonb_build_object('unit_amount_minor',
      jsonb_build_object('from', p_before_line.unit_amount_minor, 'to', p_after_line.unit_amount_minor));
  end if;
  if p_after_line.is_taxable is distinct from p_before_line.is_taxable then
    v_changes := v_changes || jsonb_build_object('is_taxable',
      jsonb_build_object('from', p_before_line.is_taxable, 'to', p_after_line.is_taxable));
  end if;
  if p_after_rental.total_minor is distinct from p_before_rental.total_minor then
    v_changes := v_changes || jsonb_build_object('total_minor',
      jsonb_build_object('from', p_before_rental.total_minor, 'to', p_after_rental.total_minor));
  end if;

  /*
   * A record of nothing is noise, and noise in a financial history costs
   * something: it is one more row somebody has to read and discount.
   *
   * Two concurrent repricings produce exactly this -- the second recomputes,
   * finds the first already did the work, and would otherwise file
   * "15000 -> 15000, difference 0".
   *
   * The test is deliberately narrow. A date-only amendment still records,
   * because `changes` carries the dates even when the money held still, and a
   * zero-value adjustment that moved a date is a real financial event.
   */
  v_moved := v_changes <> '{}'::jsonb
             or coalesce(p_before_line.amount_minor, 0) is distinct from coalesce(p_after_line.amount_minor, 0);

  if not v_moved then
    return;
  end if;

  select max(c.version) into v_version
    from public.rental_contracts c
   where c.rental_id = p_after_rental.id;

  insert into public.rental_pricing_amendments (
    organization_id, rental_id, line_item_id, line_revision_no, kind,
    previous_amount_minor, revised_amount_minor, currency,
    changes, contract_version, reason, amended_by)
  values (
    p_after_rental.organization_id,
    p_after_rental.id,
    coalesce(p_after_line.id, p_before_line.id),
    p_after_line.revision_no,
    p_kind,
    coalesce(p_before_line.amount_minor, 0),
    coalesce(p_after_line.amount_minor, 0),
    p_after_rental.currency,
    v_changes,
    v_version,
    nullif(btrim(coalesce(p_reason, '')), ''),
    (select auth.uid()));
end;
$$;

revoke all on function app.record_rental_pricing_amendment(
  public.rentals, public.rental_line_items, public.rentals,
  public.rental_line_items, public.rental_amendment_kind, text) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 4. The evidence requirement asks for the revision
--
-- Still deferred to commit, for the same reason as before: the pricing function
-- updates the line and records immediately afterwards, so an immediate check
-- would fire between the two and refuse every legitimate amendment.
--
-- What changed is the question. It used to be "is there a record that looks
-- like this change?", which two identical changes could both answer with one
-- record. It is now "is there a record OF THIS REVISION?", and the unique index
-- guarantees there is at most one.
-- -----------------------------------------------------------------------------

create or replace function app.require_rental_pricing_amendment_evidence()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.kind <> 'base_rental'
     or new.reverses_line_item_id is not null
     or not app.rental_is_finalized(new.rental_id)
     or (new.amount_minor is not distinct from old.amount_minor
         and new.quantity is not distinct from old.quantity
         and new.unit_amount_minor is not distinct from old.unit_amount_minor
         and new.is_taxable is not distinct from old.is_taxable) then
    return new;
  end if;

  /*
   * Two questions, and both have to be answered.
   *
   * The revision makes the record one-to-one: a unique index allows one
   * amendment per revision, so a second restatement cannot ride on the first
   * one's evidence however much it resembles it.
   *
   * The amounts make the record TRUE. A revision match on its own would accept
   * a record claiming the hire went to 12345 when it actually went to 20000 --
   * unique, and wrong. Keeping the field comparison is what holds the record
   * to what happened, and it is why the last recorded revised amount can be
   * relied on to equal the live hire.
   */
  if not exists (
    select 1 from public.rental_pricing_amendments a
     where a.line_item_id      = new.id
       and a.line_revision_no  = new.revision_no
       and a.rental_id         = new.rental_id
       and a.organization_id   = new.organization_id
       and a.previous_amount_minor = old.amount_minor
       and a.revised_amount_minor  = new.amount_minor
       and (case when a.changes ? 'quantity'
                 then (a.changes #>> '{quantity,from}')::numeric = old.quantity
                  and (a.changes #>> '{quantity,to}')::numeric   = new.quantity
                 else old.quantity is not distinct from new.quantity end)
       and (case when a.changes ? 'unit_amount_minor'
                 then (a.changes #>> '{unit_amount_minor,from}')::bigint = old.unit_amount_minor
                  and (a.changes #>> '{unit_amount_minor,to}')::bigint   = new.unit_amount_minor
                 else old.unit_amount_minor is not distinct from new.unit_amount_minor end)
       and (case when a.changes ? 'is_taxable'
                 then (a.changes #>> '{is_taxable,from}')::boolean = old.is_taxable
                  and (a.changes #>> '{is_taxable,to}')::boolean   = new.is_taxable
                 else old.is_taxable is not distinct from new.is_taxable end)
  ) then
    raise exception
      'The hire on a committed rental was restated without recording what changed.'
      using errcode = '23514',
            hint = 'Use public.rental_reprice or public.rental_extend, which record the amendment.';
  end if;

  return new;
end;
$$;

revoke all on function app.require_rental_pricing_amendment_evidence() from public, anon, authenticated;

-- =============================================================================
-- Public booking: the cancellation fee charge kind
--
-- A new enum value cannot be used in the transaction that adds it, so it is
-- added here and used in the next file, as 20261113100600 / 20261113100650 did
-- for the booking lead notice.
-- =============================================================================

alter type public.rental_charge_kind add value if not exists 'cancellation_fee';

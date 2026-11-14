-- =============================================================================
-- Public booking: the notification kind
--
-- A new enum value cannot be used in the transaction that adds it, so it is
-- added here and used in the next file, as 20261102100000 / 20261102100100 did
-- for the trial reminder and 20261110100000 / 20261110100100 for the closure
-- notice.
-- =============================================================================

alter type public.notification_kind add value if not exists 'booking_lead_received';

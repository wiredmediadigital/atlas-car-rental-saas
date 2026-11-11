-- =============================================================================
-- Account closure: the notification kind for a restore
--
-- A new enum value cannot be used in the transaction that adds it, so it is
-- added here and used in 20261110100900, as 20261110100000 / 20261110100100 did
-- for the closure request.
-- =============================================================================

alter type public.notification_kind add value if not exists 'account_closure_restored';

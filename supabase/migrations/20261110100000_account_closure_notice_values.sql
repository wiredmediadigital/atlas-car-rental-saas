-- =============================================================================
-- Account closure: the notification kind
--
-- A new enum value cannot be used in the transaction that adds it, so it is
-- added here and used in the next file, as 20261102100000 / 20261102100100 did
-- for the trial reminder.
--
-- This file is dated 20261110 on purpose: nine 20261109 migrations from another
-- feature are already applied to the live project, and a migration that sorts
-- before them would never be applied there.
-- =============================================================================

alter type public.notification_kind add value if not exists 'account_closure_requested';

-- =============================================================================
-- Vocabulary for the free trial
--
-- ADDING ENUM VALUES IS ITS OWN MIGRATION, AND HAS TO BE.
--
-- PostgreSQL will not let a value added by `alter type ... add value` be USED in
-- the transaction that added it. Both the Supabase CLI and the PGlite harness
-- apply one migration file as one transaction, so the values live here and
-- everything that reads or writes them lives in the next file. This is the same
-- split 20260823100100 made for the billing notification kinds, and for the
-- same reason: a single file fails with "unsafe use of new value of enum type"
-- the first time it is applied.
--
-- Nothing here starts a trial, offers one, or changes what any existing
-- subscription does. It creates the words a trial could be described in.
-- =============================================================================

set search_path = public, extensions, pg_temp;

/*
 * A fourteenth billing event kind.
 *
 * Stripe sends `customer.subscription.trial_will_end` three days before a trial
 * converts, and that is the only warning before a card is charged. It is an
 * EVENT — a moment, in the agency's billing history — and not a status: the
 * subscription is still `trialing` and nothing about the projection changes
 * when the reminder arrives.
 */
alter type public.billing_event_kind add value if not exists 'trial_ending';

/*
 * The notification an owner receives for it.
 *
 * Severity is decided in the next file, not here, because it is a judgement
 * about how loudly to interrupt somebody rather than a fact about the enum.
 */
alter type public.notification_kind add value if not exists 'billing_trial_ending';

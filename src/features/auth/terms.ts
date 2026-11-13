/**
 * The handful of facts about terms acceptance that both halves have to agree on.
 *
 * A leaf module on purpose: the database suite imports it so the key it writes
 * into sign-up metadata is the same string the client sends, rather than a
 * second copy of it that agrees by coincidence. Renaming the key in one place
 * now fails a test instead of quietly ending the recording of acceptance.
 */

/**
 * The key `supabase.auth.signUp` carries in `options.data`, read by
 * app.handle_new_user(). Only a JSON boolean `true` counts as ticked; the
 * trigger treats every other shape as absent and still creates the account.
 */
export const TERMS_ACCEPTED_METADATA_KEY = 'terms_accepted'

/**
 * When both screens began refusing to submit without the box.
 *
 * Used for one decision only: whether a profile with no acceptance on it is
 * somebody the product never asked, or somebody it asked and whose answer was
 * lost. An account created before this moment is the first — grandfathered, and
 * left alone. An account created after it cannot exist without the box having
 * been ticked, so a null there is a lost write and worth completing.
 *
 * It is the timestamp of 20261112100700_terms_acceptance.sql, which is the
 * migration that made the columns exist. Erring early would stamp people who
 * were never asked, so when in doubt this value should move later, never
 * earlier.
 */
export const TERMS_REQUIRED_FROM = '2026-11-12T10:07:00.000Z'

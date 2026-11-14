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
 * The cut-off for deciding what a missing acceptance means.
 *
 * Used for one decision only: whether a profile with no acceptance on it is
 * somebody the product never asked, or somebody it asked and whose answer was
 * lost. An account created before this moment is the first — grandfathered, and
 * left alone. An account created after it cannot exist without the box having
 * been ticked, so a null there is a lost write and worth completing.
 *
 * It is deliberately NOT the timestamp of 20261112100700_terms_acceptance.sql.
 * Migration filenames here are a synthetic ordering convention — 100300 through
 * 100800 sit minutes apart across two days of real work — so that stamp read
 * about seventeen hours before this code existed, and would have stamped live
 * sign-ups that were never shown the sentence.
 *
 * It is not quite the deploy either. The build that first carried the checkbox
 * to pevvy.io wrote index.html at 05:08:15Z, eight minutes after this value, so
 * the window 05:00:00Z–05:08:15Z is one where an account could in principle be
 * treated as asked when it was not. That window is closed and was checked
 * directly on 13 November 2026: no profile was created inside it, and no future
 * account can land in a past interval, so the gap can no longer mislead anyone.
 * It is left as it stands rather than edited to 05:08:15Z, because moving a
 * decided cut-off is a change with no effect to buy and a transcription error to
 * risk.
 *
 * Erring early manufactures exactly the evidence this record exists to make
 * trustworthy, and a false stamp cannot be cleared through the application: the
 * guard restores the stored value on every update. When in doubt move it later,
 * never earlier.
 */
export const TERMS_REQUIRED_FROM = '2026-11-13T05:00:00.000Z'

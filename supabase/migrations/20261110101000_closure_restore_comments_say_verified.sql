-- =============================================================================
-- Account closure: one comment corrected, no behaviour changed
--
-- The header of 20261110100900 says that when an agency has closed again before
-- an unsent restore notice goes out, "the drain is told (closing_again) and the
-- email says so rather than claiming the agency is working". That is not what the
-- sender does. The email states, in the present tense, that the agency is
-- working, so the sender re-reads the agency (this same finder, for that one
-- agency) immediately before delivering and SENDS NOTHING if the agency is
-- closing again, was restored a second time, or can no longer be read. A skipped
-- notice stays owed and is not recorded as sent or failed; if the agency stays
-- closed the closure notice of the new closure covers the operator.
--
-- The header of 20261110100900 is history and is left as it is; the function
-- comment below is the live description.
-- =============================================================================

comment on function app.closure_restore_notices_pending(uuid) is
  'Agencies whose operator restore notice is owed, with closure_restored_at (which restore) and closing_again (the agency is closing again as of this read). Never capped. Returns no addresses. The sender calls it again for one agency just before sending and sends only if closing_again is false. Service role only.';

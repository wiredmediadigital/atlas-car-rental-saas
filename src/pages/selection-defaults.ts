/**
 * The "offered until the desk says otherwise" rule, in one place.
 *
 * Both RentalNewPage and IncidentNewPage used to sync a default into state
 * from an effect, which is the pattern `react-hooks/set-state-in-effect`
 * refuses: the first render shows the wrong value, the effect corrects it, and
 * anything reading the field in between sees the gap. The correction derives
 * the value during render instead, which needs a way to tell "not chosen yet"
 * apart from "chosen, and the answer is nothing".
 *
 * `undefined` means not chosen yet, so the default applies. Any other value is
 * the operator's choice and is returned unchanged -- including the empty
 * string and `null`, which is how the desk clears a default they do not want.
 * Getting that distinction wrong is how a cleared field silently refills
 * itself, so it is the thing these helpers exist to make testable.
 */

/** True when the operator has not expressed a choice yet. */
export function isUnchosen<T>(choice: T | undefined): choice is undefined {
  return choice === undefined
}

/**
 * The operator's choice, or the default when they have not made one.
 *
 * `fallback` is a thunk so a caller can pass something it only wants to
 * compute, or only wants to read, when the default actually applies.
 */
export function chosenOr<T>(choice: T | undefined, fallback: () => T): T {
  return isUnchosen(choice) ? fallback() : choice
}

/**
 * A default that is only safe to offer once the data behind it has arrived.
 *
 * While a query is pending or has failed there is no honest answer, and the
 * empty value is returned rather than a guess -- a blank box must never be a
 * claim that no such record exists.
 */
export function settledDefault<T>(
  state: { isPending: boolean; isError: boolean },
  empty: T,
  value: () => T,
): T {
  return state.isPending || state.isError ? empty : value()
}

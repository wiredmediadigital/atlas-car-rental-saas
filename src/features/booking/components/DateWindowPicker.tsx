import { Field, Input } from '@/components/ui'

import { fromLocalInputValue, toLocalInputValue, type BookingWindow } from '../dates'

export interface DateWindowPickerProps {
  value: BookingWindow
  timeZone: string
  /** Disabled while the fleet for a new window is being fetched. */
  isBusy: boolean
  onChange: (next: BookingWindow) => void
}

/**
 * When the visitor wants the car.
 *
 * READ AND WRITTEN IN THE AGENCY'S TIME ZONE, not the visitor's. Somebody
 * looking up a Paris agency from Auckland is asking for a car at a counter in
 * Paris, and a picker in their own local time would have them collect it a day
 * either side of what they meant. The browser's `datetime-local` has no zone of
 * its own, which is what makes this possible: the value is just wall-clock
 * text, and both ends of the conversion name the agency's zone.
 */
export function DateWindowPicker({ value, timeZone, isBusy, onChange }: DateWindowPickerProps) {
  function change(which: 'from' | 'to', raw: string) {
    const at = fromLocalInputValue(raw, timeZone)
    // An unparseable value is a half-typed one; leave the window alone rather
    // than snapping it somewhere the visitor did not ask for.
    if (at === null) return

    if (which === 'to') {
      onChange({ ...value, to: at })
      return
    }

    /*
     * Moving the pick-up past the return carries the return with it, keeping
     * the hire the same length. The alternative is a dead end: the visitor
     * changes one field, is told the window is inverted, and has to fix
     * something they did not break.
     */
    const length = value.to.getTime() - value.from.getTime()
    const to = at.getTime() >= value.to.getTime() ? new Date(at.getTime() + length) : value.to
    onChange({ from: at, to })
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Pick-up">
        <Input
          type="datetime-local"
          value={toLocalInputValue(value.from, timeZone)}
          disabled={isBusy}
          onChange={(event) => change('from', event.target.value)}
        />
      </Field>
      <Field label="Return">
        <Input
          type="datetime-local"
          value={toLocalInputValue(value.to, timeZone)}
          disabled={isBusy}
          onChange={(event) => change('to', event.target.value)}
        />
      </Field>
    </div>
  )
}

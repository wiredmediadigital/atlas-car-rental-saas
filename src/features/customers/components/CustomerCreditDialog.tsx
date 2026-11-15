import { useState } from 'react'

import {
  Alert,
  Button,
  Dialog,
  DialogContent,
  Field,
  Input,
  Select,
  Textarea,
  useToast,
} from '@/components/ui'
import { PAYMENT_METHOD_LABELS } from '@/features/rentals/schemas'
import { fromDateTimeLocalValue, toDateTimeLocalValue } from '@/lib/datetime/timezone'
import { formatMoney, minorToDecimalString, parseMoneyToMinor } from '@/lib/money/money'
import { toErrorMessage } from '@/lib/supabase/errors'
import type { PaymentMethod, RentalBoardEntry } from '@/types/database'

import { useApplyCustomerCredit, useRecordCustomerCredit } from '../queries'

export type CreditIntent = 'take' | 'payout' | 'apply'

export interface CustomerCreditDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  intent: CreditIntent
  customerId: string
  currency: string
  locale: string
  timeZone: string
  /** What is held in this currency. Nothing may leave the account above it. */
  heldMinor: number
  /** The customer's own bookings, for the one case that spends the money. */
  rentals: readonly RentalBoardEntry[]
}

const METHODS = Object.entries(PAYMENT_METHOD_LABELS).map(([value, label]) => ({
  value,
  label,
}))

/**
 * Money on and off a customer's account.
 *
 * Three cases rather than three dialogs, because they differ by one field and
 * the sentence at the top: taking money that belongs to no booking yet, paying
 * it back out, and spending it on one of their bookings.
 */
export function CustomerCreditDialog({
  open,
  onOpenChange,
  intent,
  customerId,
  currency,
  locale,
  timeZone,
  heldMinor,
  rentals,
}: CustomerCreditDialogProps) {
  const toast = useToast()
  const record = useRecordCustomerCredit(customerId)
  const applyCredit = useApplyCustomerCredit(customerId)

  const isApply = intent === 'apply'
  const isPayout = intent === 'payout'

  /*
   * Only bookings that can actually take the money, in the currency the money
   * is held in. Offering a cancelled booking that charges nothing, or one in
   * another currency, is offering a refusal.
   */
  const payable = rentals.filter(
    (rental) => rental.currency === currency && rental.balance_due_minor > 0,
  )

  const [rentalId, setRentalId] = useState(() => payable[0]?.id ?? '')
  const selected = payable.find((rental) => rental.id === rentalId)

  const ceiling = isApply
    ? Math.min(heldMinor, selected?.balance_due_minor ?? heldMinor)
    : isPayout
      ? heldMinor
      : 0

  const [amount, setAmount] = useState(() =>
    ceiling > 0 ? minorToDecimalString(ceiling, currency) : '',
  )
  const [method, setMethod] = useState<PaymentMethod>('cash')
  const [paidAt, setPaidAt] = useState(() => toDateTimeLocalValue(new Date(), timeZone))
  const [reference, setReference] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)

  const isPending = record.isPending || applyCredit.isPending

  const submit = async () => {
    const minor = parseMoneyToMinor(amount, currency)
    if (minor === null || minor <= 0) {
      setError('Enter an amount above zero.')
      return
    }
    if (ceiling > 0 && minor > ceiling) {
      setError(`That is more than the ${formatMoney(ceiling, currency, { locale })} available.`)
      return
    }
    if (isApply && !rentalId) {
      setError('Choose the booking this is going against.')
      return
    }

    const instant = isApply ? new Date() : fromDateTimeLocalValue(paidAt, timeZone)
    if (!instant) {
      setError('Choose a valid date and time.')
      return
    }

    setError(null)

    try {
      if (isApply) {
        await applyCredit.mutateAsync({ rentalId, amountMinor: minor })
        toast.success('Put against the booking', formatMoney(minor, currency, { locale }))
      } else {
        await record.mutateAsync({
          amountMinor: minor,
          currency,
          direction: isPayout ? 'outbound' : 'inbound',
          method,
          paidAt: instant.toISOString(),
          reference: reference.trim() || null,
          notes: notes.trim() || null,
        })
        toast.success(
          isPayout ? 'Paid out' : 'Taken on account',
          formatMoney(minor, currency, { locale }),
        )
      }
      onOpenChange(false)
    } catch (failure) {
      toast.error('Could not record this', toErrorMessage(failure))
    }
  }

  const title = isApply
    ? 'Use this on a booking'
    : isPayout
      ? 'Pay this back'
      : 'Take money on account'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={title}
        description={`In ${currency}. Money on account is never added across currencies.`}
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={isPending}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => void submit()} isLoading={isPending}>
              {title}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {!isApply && !isPayout ? (
            <Alert tone="info" title="This belongs to no booking yet">
              It sits on the customer’s account until it is put against one of their contracts or
              handed back.
            </Alert>
          ) : null}

          {isApply && payable.length === 0 ? (
            <Alert tone="caution" title="Nothing to put it against">
              This customer has no booking in {currency} with anything left to pay. Take a new
              booking first, or pay the money back instead.
            </Alert>
          ) : null}

          {isApply && payable.length > 0 ? (
            <Field label="Booking" required>
              <Select
                value={rentalId}
                onChange={(event) => {
                  const next = event.target.value
                  setRentalId(next)
                  const booking = payable.find((rental) => rental.id === next)
                  const limit = Math.min(heldMinor, booking?.balance_due_minor ?? heldMinor)
                  setAmount(limit > 0 ? minorToDecimalString(limit, currency) : '')
                }}
                options={payable.map((rental) => ({
                  value: rental.id,
                  label: `${rental.reference} — ${formatMoney(rental.balance_due_minor, rental.currency, { locale })} owed`,
                }))}
              />
            </Field>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Amount" required {...(error ? { error } : {})}>
              <Input
                value={amount}
                inputMode="decimal"
                onChange={(event) => setAmount(event.target.value)}
              />
            </Field>

            {!isApply ? (
              <Field label="Method" required>
                <Select
                  value={method}
                  onChange={(event) => setMethod(event.target.value as PaymentMethod)}
                  options={METHODS}
                />
              </Field>
            ) : null}
          </div>

          {!isApply ? (
            <>
              <Field label={isPayout ? 'Paid out at' : 'Received at'} required>
                <Input
                  type="datetime-local"
                  value={paidAt}
                  onChange={(event) => setPaidAt(event.target.value)}
                />
              </Field>

              <Field
                label="Reference"
                hint="Receipt number, transaction id, anything you file it by."
              >
                <Input
                  value={reference}
                  maxLength={80}
                  onChange={(event) => setReference(event.target.value)}
                />
              </Field>

              <Field label="Notes">
                <Textarea
                  rows={2}
                  value={notes}
                  maxLength={2000}
                  onChange={(event) => setNotes(event.target.value)}
                />
              </Field>
            </>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}

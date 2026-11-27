import { RotateCcw, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'

import { Alert, Button, Dialog, DialogContent, Field, Textarea } from '@/components/ui'
import { formatDateTime } from '@/lib/datetime/format'
import { formatMoney } from '@/lib/money/money'
import type { RentalLineItem } from '@/types/database'
import { cn } from '@/lib/utils/cn'

import { CHARGE_KIND_LABELS } from '../pricing'

export interface ChargesPanelProps {
  lines: readonly RentalLineItem[]
  currency: string
  locale: string
  timeZone: string
  /**
   * True once the rental is past draft. The database refuses a delete from
   * this point on, so the interface stops offering one.
   */
  isFinalized: boolean
  canRemove: boolean
  canReverse: boolean
  isRemoving: boolean
  isReversing: boolean
  onRemove: (lineItemId: string) => void
  onReverse: (lineItemId: string, reason: string) => Promise<unknown>
  error?: string | null
}

interface ChargeRow {
  line: RentalLineItem
  /** The reversal posted against this charge, if one was. */
  reversal: RentalLineItem | null
}

/** The hire is changed by repricing or an extension, never by a reversal. */
const isHire = (line: RentalLineItem) => line.kind === 'base_rental'

/**
 * Every charge on the contract, including the ones that were taken back.
 *
 * A correction here is additive. The original line stays exactly as it was
 * posted and a mirrored line is added beside it, so the contract reads as a
 * history rather than as a current opinion. That is why a reversed charge is
 * shown struck through and still present, instead of disappearing: a customer
 * asking "what was I charged, and what did you give back?" is asking about two
 * numbers, and a screen that erases the first cannot answer.
 *
 * Deleting outright remains available only while the rental is a draft —
 * nothing has been agreed, so there is nothing to preserve. Past that point
 * the database refuses the delete, and offering a button that always fails
 * would teach the desk that the screen is broken rather than that the rule
 * exists.
 */
export function ChargesPanel({
  lines,
  currency,
  locale,
  timeZone,
  isFinalized,
  canRemove,
  canReverse,
  isRemoving,
  isReversing,
  onRemove,
  onReverse,
  error,
}: ChargesPanelProps) {
  const [reversing, setReversing] = useState<RentalLineItem | null>(null)
  const [reason, setReason] = useState('')
  const [reasonError, setReasonError] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const cash = (minor: number) => formatMoney(minor, currency, { locale })

  const rows = useMemo<ChargeRow[]>(() => {
    const reversalsByOriginal = new Map<string, RentalLineItem>()
    for (const line of lines) {
      if (line.reverses_line_item_id) reversalsByOriginal.set(line.reverses_line_item_id, line)
    }
    return lines
      .filter((line) => !line.reverses_line_item_id)
      .map((line) => ({ line, reversal: reversalsByOriginal.get(line.id) ?? null }))
  }, [lines])

  function startReversal(line: RentalLineItem) {
    setReversing(line)
    setReason('')
    setReasonError(null)
    setSubmitError(null)
  }

  async function confirmReversal() {
    if (!reversing) return
    const trimmed = reason.trim()
    if (trimmed.length === 0) {
      setReasonError('Say why this charge is being reversed.')
      return
    }
    setReasonError(null)
    setSubmitError(null)
    try {
      await onReverse(reversing.id, trimmed)
      setReversing(null)
      setReason('')
    } catch (cause) {
      setSubmitError(cause instanceof Error ? cause.message : 'The reversal could not be posted.')
    }
  }

  return (
    <div className="space-y-3">
      {error ? (
        <Alert tone="critical" title="That change was not saved">
          {error}
        </Alert>
      ) : null}

      <ul className="divide-line divide-y">
        {rows.map(({ line, reversal }) => (
          <li key={line.id} className="py-2.5">
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <p
                  className={cn(
                    'truncate text-[0.8125rem]',
                    reversal ? 'text-ink-subtle line-through' : 'text-ink',
                  )}
                >
                  {line.description}
                </p>
                <p className="text-ink-subtle text-[0.6875rem]">
                  {CHARGE_KIND_LABELS[line.kind]}
                  {Number(line.quantity) !== 1
                    ? ` · ${line.quantity} × ${cash(line.unit_amount_minor)}`
                    : ''}
                  {line.is_taxable ? '' : ' · not taxed'}
                </p>
              </div>

              <span
                data-numeric=""
                className={cn(
                  'shrink-0 text-[0.8125rem]',
                  reversal ? 'text-ink-subtle line-through' : 'text-ink',
                )}
              >
                {cash(line.amount_minor)}
              </span>

              {!reversal && !isHire(line) && canReverse && isFinalized ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => startReversal(line)}
                  aria-label={`Reverse ${line.description}`}
                >
                  <RotateCcw className="size-3.5" aria-hidden="true" />
                </Button>
              ) : null}

              {!isFinalized && canRemove && !isHire(line) ? (
                <Button
                  variant="ghost"
                  size="sm"
                  isLoading={isRemoving}
                  onClick={() => onRemove(line.id)}
                  aria-label={`Remove ${line.description}`}
                >
                  <Trash2 className="size-3.5" aria-hidden="true" />
                </Button>
              ) : null}
            </div>

            {reversal ? (
              <div className="border-caution-200 bg-caution-50 mt-2 rounded-md border px-3 py-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-ink text-[0.75rem] font-medium">Reversed</p>
                    <p className="text-ink-subtle mt-0.5 text-[0.6875rem]">
                      {reversal.reversal_reason}
                    </p>
                    <p className="text-ink-subtle mt-0.5 text-[0.6875rem]">
                      {formatDateTime(new Date(reversal.created_at), { locale, timeZone })}
                    </p>
                  </div>
                  <span data-numeric="" className="text-ink shrink-0 text-[0.8125rem]">
                    {cash(reversal.amount_minor)}
                  </span>
                </div>
                <p className="text-ink-subtle mt-1.5 text-[0.6875rem]">
                  Net effect on this contract: {cash(line.amount_minor + reversal.amount_minor)}
                </p>
              </div>
            ) : null}
          </li>
        ))}

        {rows.length === 0 ? (
          <li className="text-ink-subtle py-4 text-center text-[0.8125rem]">
            Nothing charged yet.
          </li>
        ) : null}
      </ul>

      {isFinalized && !canReverse ? (
        <p className="text-ink-subtle text-[0.6875rem]">
          Charges on a committed rental are corrected by posting a reversal, which a manager does.
        </p>
      ) : null}

      <Dialog
        open={reversing !== null}
        onOpenChange={(open) => (open ? undefined : setReversing(null))}
      >
        <DialogContent
          title="Reverse this charge"
          description="The original stays on the contract. A matching line is added that takes it back."
        >
          {reversing ? (
            <div className="space-y-4">
              <div className="border-line bg-surface-inset rounded-md border p-3">
                <p className="text-ink text-[0.8125rem]">{reversing.description}</p>
                <p className="text-ink-subtle mt-0.5 text-[0.6875rem]">
                  {CHARGE_KIND_LABELS[reversing.kind]}
                  {reversing.is_taxable ? '' : ' · not taxed'}
                </p>
                <dl className="mt-2 space-y-1">
                  <div className="flex justify-between gap-3">
                    <dt className="text-ink-muted text-[0.75rem]">Charged</dt>
                    <dd data-numeric="" className="text-ink text-[0.75rem]">
                      {cash(reversing.amount_minor)}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-ink-muted text-[0.75rem]">Reversal</dt>
                    <dd data-numeric="" className="text-ink text-[0.75rem]">
                      {cash(-reversing.amount_minor)}
                    </dd>
                  </div>
                  <div className="border-line flex justify-between gap-3 border-t pt-1">
                    <dt className="text-ink text-[0.75rem] font-medium">Net effect</dt>
                    <dd data-numeric="" className="text-ink text-[0.75rem] font-medium">
                      {cash(0)}
                    </dd>
                  </div>
                </dl>
              </div>

              <Field
                label="Why is this being reversed?"
                hint="Kept with the reversal, and shown on the contract."
                {...(reasonError ? { error: reasonError } : {})}
              >
                <Textarea
                  rows={3}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="Charged in error — the valet was not carried out."
                />
              </Field>

              {submitError ? (
                <Alert tone="critical" title="The reversal was not posted">
                  {submitError}
                </Alert>
              ) : null}

              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button variant="secondary" onClick={() => setReversing(null)}>
                  Keep the charge
                </Button>
                <Button isLoading={isReversing} onClick={() => void confirmReversal()}>
                  Post the reversal
                </Button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  )
}

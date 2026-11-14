import { useEffect, useState } from 'react'

import { Alert, Button, Dialog, DialogContent, Field, Input } from '@/components/ui'
import { formatMoney } from '@/lib/money/money'
import { toErrorMessage } from '@/lib/supabase/errors'

import { convertLead, fetchCurrentDailyRate, type ConvertedLead, type Lead } from '../api'

/** The warning's words, named so the test can ask for them exactly. */
export const DRIFT_LABEL = 'The daily rate has changed since this request'

export interface ConvertLeadDialogProps {
  lead: Lead
  open: boolean
  onOpenChange: (open: boolean) => void
  onConverted: (result: ConvertedLead) => void
}

/** Splits on the last space, the same way the database does, so the fields agree. */
function splitName(fullName: string): { first: string; last: string } {
  const trimmed = fullName.trim()
  const at = trimmed.lastIndexOf(' ')
  if (at === -1) return { first: trimmed, last: '' }
  return { first: trimmed.slice(0, at), last: trimmed.slice(at + 1) }
}

/**
 * Turning a request into business.
 *
 * TWO PRICES, BOTH SHOWN. The lead carries what the renter was quoted; the
 * rental will be priced from the vehicle as it stands today. When they differ,
 * staff see both figures and the difference before they press anything. An
 * estimate from three weeks ago is not a price the agency is bound by, and
 * silently honouring it -- or silently replacing it -- are both worse than
 * saying so and letting a person decide.
 *
 * The name is split into two fields because the database splits on the last
 * space, which is wrong for a great many names. This is where somebody fixes
 * it, before a customer record exists with the wrong surname.
 */
export function ConvertLeadDialog({
  lead,
  open,
  onOpenChange,
  onConverted,
}: ConvertLeadDialogProps) {
  const parsed = splitName(lead.fullName)
  const [firstName, setFirstName] = useState(parsed.first)
  const [lastName, setLastName] = useState(parsed.last)
  const [email, setEmail] = useState(lead.email)
  const [phone, setPhone] = useState(lead.phone ?? '')

  const [currentRate, setCurrentRate] = useState<number | null>(null)
  const [isConverting, setIsConverting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    let current = true
    void fetchCurrentDailyRate(lead.vehicleId)
      .then((rate) => {
        if (current && rate !== null) setCurrentRate(rate.dailyRateMinor)
      })
      .catch(() => {
        // The dialog still works without the comparison; it simply cannot warn.
      })
    return () => {
      current = false
    }
  }, [open, lead.vehicleId])

  const hasDrifted = currentRate !== null && currentRate !== lead.dailyRateMinor
  const projectedTotal = (currentRate ?? lead.dailyRateMinor) * lead.billableDays

  async function convert() {
    setError(null)
    setIsConverting(true)
    try {
      const result = await convertLead(lead.id, {
        first_name: firstName,
        last_name: lastName,
        email,
        phone,
      })
      onConverted(result)
    } catch (caught) {
      /*
       * The database's sentence, shown as written. "That vehicle is no longer
       * free for those dates" is exactly what a staff member needs to know,
       * and inventing a friendlier version would lose the one fact in it.
       */
      setError(toErrorMessage(caught))
      setIsConverting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Convert this request"
        description={`${lead.vehicleLabel} · ${lead.reference}`}
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={isConverting}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => void convert()}
              isLoading={isConverting}
              /* A second press would be a second rental, and the car can only
                 be let once. The database locks the lead as well. */
              disabled={isConverting}
            >
              Create customer and rental
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {error === null ? null : <Alert tone="critical">{error}</Alert>}

          {hasDrifted ? (
            <Alert tone="caution">
              <p className="font-medium">{DRIFT_LABEL}</p>
              <p className="text-[0.8125rem]">
                Quoted {formatMoney(lead.dailyRateMinor, lead.currency)} per day, now{' '}
                {formatMoney(currentRate, lead.currency)}. The rental will be created at
                today&rsquo;s rate: {formatMoney(projectedTotal, lead.currency)} for{' '}
                {lead.billableDays} days. The renter was told{' '}
                {formatMoney(lead.quotedTotalMinor, lead.currency)}.
              </p>
            </Alert>
          ) : (
            <p className="text-ink-muted text-sm">
              {formatMoney(projectedTotal, lead.currency)} for {lead.billableDays} days, the same as
              quoted.
            </p>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="First name" required>
              <Input value={firstName} onChange={(event) => setFirstName(event.target.value)} />
            </Field>
            <Field
              label="Last name"
              hint="The request held one name; check it was split where it should be."
            >
              <Input value={lastName} onChange={(event) => setLastName(event.target.value)} />
            </Field>
            <Field label="Email" required>
              <Input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </Field>
            <Field label="Telephone">
              <Input type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} />
            </Field>
          </div>

          {lead.note === null ? null : (
            <div className="border-line bg-surface-muted rounded-md border px-4 py-3">
              <p className="text-ink-muted text-[0.75rem]">What they wrote</p>
              <p className="text-sm">{lead.note}</p>
            </div>
          )}

          <p className="text-ink-subtle text-[0.75rem]">
            This creates a customer and a reserved rental, and marks the request converted. The car
            is held from that moment.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  )
}

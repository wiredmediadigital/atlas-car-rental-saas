import { useEffect, useId, useRef, useState, type FormEvent } from 'react'

import { Alert, Button, Field, Input, Textarea } from '@/components/ui'
import { formatMoney } from '@/lib/money/money'

import { submitBookingRequest, type PublicAgency, type PublicVehicle } from '../api'
import { formatWindow } from '../dates'

/**
 * The four questions a stranger is asked, and nothing else.
 *
 * WHAT IS DELIBERATELY NOT HERE: date of birth, licence number, passport,
 * address, a file upload. An enquiry is not a hire. Pevvy holds identity
 * documents behind a verified second factor for the people an agency has
 * actually rented to; collecting them from someone who has only asked a
 * question would mean holding a stranger's papers on the strength of a form
 * nobody has answered yet. The agency takes those at the counter, where they
 * can look at the document.
 *
 * THE REQUEST HOLDS NOTHING, and the page says so in as many words. A renter
 * who believes a car is booked and turns up to find it gone has been misled by
 * this screen, not by the agency.
 */

export interface RequestFormProps {
  agency: PublicAgency
  vehicle: PublicVehicle
  slug: string
  period: { from: string; to: string }
  onClose: () => void
}

interface Sent {
  reference: string
}

export function RequestForm({ agency, vehicle, slug, period, onClose }: RequestFormProps) {
  const honeypotId = useId()
  /**
   * When the form was built, so the server can see a submission no person could
   * have typed. Read in an effect rather than during render: Date.now() is
   * impure, and a component that calls it while rendering produces a different
   * answer every time React happens to render it again.
   *
   * It stays null until mounted. The server treats a missing timestamp as a
   * visitor with scripting partly blocked rather than as a machine, so the
   * worst case is one fewer check, not a refused request.
   */
  const startedAt = useRef<number | null>(null)

  useEffect(() => {
    startedAt.current = Date.now()
  }, [])

  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [note, setNote] = useState('')
  const [honeypot, setHoneypot] = useState('')

  const [isSending, setIsSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState<Sent | null>(null)

  const name = `${vehicle.make} ${vehicle.model}`
  const readable = formatWindow(
    { from: new Date(period.from), to: new Date(period.to) },
    agency.timeZone,
  )
  const total = formatMoney(vehicle.quotedTotalMinor, vehicle.currency)

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setIsSending(true)

    const result = await submitBookingRequest({
      slug,
      vehicleId: vehicle.id,
      from: period.from,
      to: period.to,
      fullName,
      email,
      phone: phone.trim() === '' ? null : phone,
      note: note.trim() === '' ? null : note,
      company: honeypot,
      startedAt: startedAt.current,
    })

    setIsSending(false)
    if (result.status === 'sent') {
      setSent({ reference: result.reference })
      return
    }
    // Everything the visitor typed is still in state, and stays on screen: a
    // form that empties itself on a failure asks someone to type it all again
    // to find out whether the second attempt works any better.
    setError(result.message)
  }

  if (sent !== null) {
    return (
      <section aria-labelledby="request-sent" className="space-y-4">
        <h2 id="request-sent" className="text-lg font-semibold">
          Your request has been sent
        </h2>

        <dl className="space-y-1 text-sm">
          <div className="flex gap-2">
            <dt className="text-ink-muted">Reference</dt>
            <dd className="font-medium">{sent.reference}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-ink-muted">Car</dt>
            <dd>{name}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-ink-muted">Dates</dt>
            <dd>{readable}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-ink-muted">Estimate</dt>
            <dd>{total}</dd>
          </div>
        </dl>

        {/*
         * The sentence that keeps this honest. It is not a confirmation, the
         * car is still on offer to everyone else, and the estimate is an
         * estimate until the agency says otherwise.
         */}
        <Alert tone="info">
          This is a request, not a confirmed booking. {agency.name} will be in touch to confirm. The
          car is not held in the meantime, and the price is an estimate until they confirm it.
        </Alert>

        {agency.phone === null ? null : (
          <p className="text-ink-muted text-sm">
            If you need an answer quickly, call{' '}
            <a href={`tel:${agency.phone.replace(/\s+/g, '')}`} className="text-brand-700">
              {agency.phone}
            </a>
            .
          </p>
        )}

        <Button type="button" variant="secondary" onClick={onClose}>
          Back to the cars
        </Button>
      </section>
    )
  }

  return (
    <form onSubmit={(event) => void onSubmit(event)} className="space-y-4" noValidate>
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">Request {name}</h2>
        <p className="text-ink-muted text-sm">
          {readable} · {total} estimated
        </p>
      </div>

      {error === null ? null : <Alert tone="critical">{error}</Alert>}

      <Field label="Your name" required>
        <Input
          value={fullName}
          onChange={(event) => setFullName(event.target.value)}
          autoComplete="name"
          maxLength={120}
          required
        />
      </Field>

      <Field label="Email" required hint="So the agency can reply.">
        <Input
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          autoComplete="email"
          maxLength={320}
          required
        />
      </Field>

      <Field label="Telephone" hint="Optional, but it is usually the quickest way to reach you.">
        <Input
          type="tel"
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
          autoComplete="tel"
          maxLength={40}
        />
      </Field>

      <Field label="Anything the agency should know" hint="Optional.">
        <Textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          rows={3}
          maxLength={2000}
        />
      </Field>

      {/*
       * The honeypot. Hidden from sight and from assistive technology, and
       * taken out of the tab order, so no person is ever asked to fill it in;
       * a machine filling every field it finds reveals itself. Deliberately
       * NOT `display: none`, which the better scrapers already skip.
       */}
      <div aria-hidden="true" className="absolute left-[-9999px] h-px w-px overflow-hidden">
        <label htmlFor={honeypotId}>Company</label>
        <input
          id={honeypotId}
          name="company"
          type="text"
          value={honeypot}
          onChange={(event) => setHoneypot(event.target.value)}
          tabIndex={-1}
          autoComplete="off"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="primary" isLoading={isSending}>
          Send request
        </Button>
        <Button type="button" variant="secondary" onClick={onClose} disabled={isSending}>
          Cancel
        </Button>
      </div>

      <p className="text-ink-subtle text-[0.75rem]">
        Sending this does not book the car. {agency.name} will confirm by email or telephone.
      </p>
    </form>
  )
}

import { describe, expect, it } from 'vitest'

import {
  MAIL_CAP_PER_HOUR,
  agencyNotification,
  envelopesFor,
  renterAcknowledgement,
  senderFor,
  type AgencySummary,
  type LeadSummary,
} from '../_shared/booking-lead-email.ts'

const LEAD: LeadSummary = {
  reference: 'REQ-ABCD2345',
  vehicleLabel: 'Renault Clio',
  startsAt: '2027-03-01T09:00:00Z',
  endsAt: '2027-03-05T09:00:00Z',
  currency: 'EUR',
  quotedTotalMinor: 18000,
  renterName: 'Grace Hopper',
  renterEmail: 'grace@example.test',
}

const AGENCY: AgencySummary = {
  name: 'Atlas Cars',
  phone: '+33 1 23 45 67 89',
  timeZone: 'Europe/Paris',
  contactEmail: 'bookings@atlascars.test',
  leadsUrl: 'https://pevvy.test/leads',
}

const PLATFORM_FROM = 'Pevvy <no-reply@pevvy.test>'

/** Everything a recipient could possibly read, in one string. */
function everything(message: { subject: string; html: string; text: string }): string {
  return `${message.subject} ${message.html} ${message.text}`
}

describe('the renter acknowledgement', () => {
  it('tells the renter the car is not held', () => {
    const message = renterAcknowledgement(LEAD, AGENCY)
    const body = everything(message)
    expect(body).toMatch(/not a confirmed booking/i)
    expect(body).toMatch(/not being held/i)
    expect(body).toMatch(/estimate until/i)
  })

  it('names the agency rather than the product', () => {
    // The renter asked Atlas Cars about a car. They have never heard of Pevvy.
    const message = renterAcknowledgement(LEAD, AGENCY)
    expect(message.subject).toContain('Atlas Cars')
    expect(message.subject).not.toMatch(/pevvy/i)
  })

  it('carries the reference, the car, the dates and the estimate', () => {
    const body = everything(renterAcknowledgement(LEAD, AGENCY))
    expect(body).toContain('REQ-ABCD2345')
    expect(body).toContain('Renault Clio')
    expect(body).toMatch(/1 March at 10:00 to 5 March at 10:00/)
    expect(body).toMatch(/180[.,]00/)
  })

  it('never puts the renter note in the acknowledgement', () => {
    /*
     * The note is free text from an unauthenticated form. A message that
     * quotes it back is a message an attacker composes: their words, from an
     * address the recipient's provider trusts, to whatever address they typed
     * into the form. The builder takes no note at all, which is the only way
     * to be sure.
     */
    const withNote = {
      ...LEAD,
      // Even if a caller tried, there is nowhere for this to go.
      note: 'Click https://evil.test to confirm your booking immediately.',
    } as LeadSummary & { note: string }
    const body = everything(renterAcknowledgement(withNote, AGENCY))
    expect(body).not.toMatch(/evil\.test/)
    expect(body).not.toMatch(/click/i)
    expect(Object.keys(LEAD)).not.toContain('note')
  })

  it('offers the telephone number when there is one, and a reply when there is not', () => {
    expect(everything(renterAcknowledgement(LEAD, AGENCY))).toContain('+33 1 23 45 67 89')
    const noPhone = everything(renterAcknowledgement(LEAD, { ...AGENCY, phone: null }))
    expect(noPhone).toMatch(/reply to this message/i)
  })

  it('tells somebody who did not send it that nothing has happened', () => {
    // An address can be typed into a public form by anybody.
    const body = everything(renterAcknowledgement(LEAD, AGENCY))
    expect(body).toMatch(/if that was not you/i)
    expect(body).toMatch(/no account has been created/i)
  })

  it('goes to the address that asked', () => {
    expect(renterAcknowledgement(LEAD, AGENCY).to).toBe('grace@example.test')
  })
})

describe('the agency notification', () => {
  it('puts no renter name, email or phone in the agency email', () => {
    const message = agencyNotification(LEAD, AGENCY, 'owner@atlascars.test')
    const body = everything(message)
    for (const secret of ['Grace Hopper', 'grace@example.test', 'Grace', 'Hopper']) {
      expect(body).not.toContain(secret)
    }
  })

  it('carries the vehicle, the dates and a link, and says where the rest is', () => {
    const body = everything(agencyNotification(LEAD, AGENCY, 'owner@atlascars.test'))
    expect(body).toContain('Renault Clio')
    expect(body).toMatch(/1 March at 10:00 to 5 March at 10:00/)
    expect(body).toContain('REQ-ABCD2345')
    expect(body).toContain('https://pevvy.test/leads')
    expect(body).toMatch(/not in this message/i)
  })

  it('says a request does not hold the car', () => {
    const body = everything(agencyNotification(LEAD, AGENCY, 'owner@atlascars.test'))
    expect(body).toMatch(/does not hold the car/i)
  })

  it('is addressed to the member it was built for', () => {
    expect(agencyNotification(LEAD, AGENCY, 'admin@atlascars.test').to).toBe('admin@atlascars.test')
  })
})

describe('who the acknowledgement comes from', () => {
  it('shows the agency name in front of the platform address', () => {
    // The renter sees Atlas Cars. SPF and DKIM still authenticate the
    // platform's domain, which is correct, because it is the platform's domain.
    const sender = senderFor(AGENCY, PLATFORM_FROM)
    expect(sender.from).toContain('Atlas Cars')
    expect(sender.from).toContain('<no-reply@pevvy.test>')
  })

  it('points replies at the agency', () => {
    expect(senderFor(AGENCY, PLATFORM_FROM).replyTo).toBe('bookings@atlascars.test')
  })

  it('omits Reply-To when the agency has no address', () => {
    // Better than inviting a reply nobody will read.
    expect(senderFor({ ...AGENCY, contactEmail: null }, PLATFORM_FROM).replyTo).toBeUndefined()
  })

  it('cannot be made to carry a second address through the agency name', () => {
    /*
     * An agency name is typed by whoever signed the agency up and ends up in a
     * mail header. The text may survive -- a name that looks like an address
     * stays inside the quotes, reading oddly -- but there must be exactly one
     * deliverable address in the header, and it must be the platform's.
     */
    const hostile: AgencySummary = {
      ...AGENCY,
      name: 'Atlas" <attacker@evil.test>, "Cars',
    }
    const sender = senderFor(hostile, PLATFORM_FROM)
    expect(sender.from.match(/<[^>]*>/g)).toEqual(['<no-reply@pevvy.test>'])
    expect(sender.from).not.toContain('<attacker')
  })

  it('cannot be made to start a second header', () => {
    // A newline in a header ends it, and everything after is read as another:
    // a second Bcc, a different Reply-To.
    const hostile: AgencySummary = {
      ...AGENCY,
      name: 'Atlas\r\nBcc: everyone@evil.test\r\nX-Spoof: yes',
    }
    const sender = senderFor(hostile, PLATFORM_FROM)
    expect(sender.from).not.toMatch(/[\r\n]/)
    expect(sender.from.match(/<[^>]*>/g)).toEqual(['<no-reply@pevvy.test>'])
  })

  it('copes with a bare platform address and an empty agency name', () => {
    expect(senderFor(AGENCY, 'no-reply@pevvy.test').from).toContain('no-reply@pevvy.test')
    expect(senderFor({ ...AGENCY, name: '   ' }, PLATFORM_FROM).from).toContain('pevvy')
  })
})

describe('the cap on mail', () => {
  const context = { recentRequests: 1, platformFrom: PLATFORM_FROM }
  const recipients = ['owner@atlascars.test', 'admin@atlascars.test']

  it('writes to the renter first, then to each owner and administrator', () => {
    // If anything fails halfway, the person waiting for an answer should be
    // the one who got theirs; the agency can see the request in the product.
    const envelopes = envelopesFor(LEAD, AGENCY, recipients, context)
    expect(envelopes.map((envelope) => envelope.message.to)).toEqual([
      'grace@example.test',
      'owner@atlascars.test',
      'admin@atlascars.test',
    ])
  })

  it('sends the acknowledgement as the agency and the rest as the platform', () => {
    const [acknowledgement, notification] = envelopesFor(LEAD, AGENCY, recipients, context)
    expect(acknowledgement!.sender?.from).toContain('Atlas Cars')
    expect(acknowledgement!.sender?.replyTo).toBe('bookings@atlascars.test')
    expect(notification!.sender).toBeUndefined()
  })

  it('stops at the cap', () => {
    const atTheCap = { ...context, recentRequests: MAIL_CAP_PER_HOUR }
    const overIt = { ...context, recentRequests: MAIL_CAP_PER_HOUR + 1 }
    expect(envelopesFor(LEAD, AGENCY, recipients, atTheCap)).toHaveLength(3)
    expect(envelopesFor(LEAD, AGENCY, recipients, overIt)).toEqual([])
  })

  it('stops the renter acknowledgement too, which is the one that matters', () => {
    /*
     * The acknowledgement goes to an address whoever sent the request chose.
     * That is what turns a flood into spam complaints against the one domain
     * every agency on this deployment sends from, so the cap cannot spare it.
     */
    const envelopes = envelopesFor(LEAD, AGENCY, recipients, {
      ...context,
      recentRequests: MAIL_CAP_PER_HOUR + 1,
    })
    expect(envelopes.some((envelope) => envelope.message.to === LEAD.renterEmail)).toBe(false)
  })

  it('still produces the acknowledgement for an agency with nobody to notify', () => {
    expect(envelopesFor(LEAD, AGENCY, [], context)).toHaveLength(1)
  })
})

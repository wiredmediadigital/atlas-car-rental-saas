/**
 * The two messages a booking request produces, and who they are from.
 *
 * ONE GOES TO A STRANGER, which is unusual here: every other message this
 * product sends goes to somebody with an account. That decides most of what
 * follows -- the acknowledgement names the agency rather than the product,
 * promises nothing, and is sent once.
 *
 * THE OTHER CARRIES NO RENTER DATA AT ALL. Pevvy requires a verified second
 * factor to read a customer record; putting a stranger's name, address and
 * message into whatever inbox an agency happens to use would undo that for
 * every request that ever arrives. The agency's message says a request is
 * waiting and links into the product, where the second factor still applies.
 */

import {
  PRODUCT_NAME,
  renderEmailHtml,
  renderEmailText,
  type EmailDocument,
} from './email-layout.ts'
import type { OutgoingMessage } from './team-email.ts'

export interface LeadSummary {
  reference: string
  vehicleLabel: string
  /** As stored. Formatted here, in the agency's zone, not by the caller. */
  startsAt: string
  endsAt: string
  currency: string
  quotedTotalMinor: number
  renterName: string
  renterEmail: string
}

/**
 * The dates as the agency's counter would say them.
 *
 * In the AGENCY's zone rather than the renter's: the renter is being told when
 * to turn up somewhere, and the only clock that matters is the one on the wall
 * where they are turning up.
 */
function formatPeriod(lead: LeadSummary, timeZone: string): string {
  const one = (value: string) => {
    try {
      return new Intl.DateTimeFormat('en-GB', {
        timeZone,
        day: 'numeric',
        month: 'long',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(new Date(value))
    } catch {
      // An agency with a misconfigured zone still gets a readable message.
      return value.slice(0, 16).replace('T', ' ')
    }
  }
  return `${one(lead.startsAt)} to ${one(lead.endsAt)}`
}

/** Minor units, written the way the agency writes money. */
function formatMoney(amountMinor: number, currency: string): string {
  const code = currency.toUpperCase()
  try {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency: code,
      currencyDisplay: 'narrowSymbol',
    }).format(amountMinor / 100)
  } catch {
    // An unrecognised code must not blank out the figure in a quote.
    return `${(amountMinor / 100).toFixed(2)} ${code}`
  }
}

export interface AgencySummary {
  name: string
  phone: string | null
  /** The agency's own zone: the dates are read against their counter's clock. */
  timeZone: string
  /** The agency's own address, for Reply-To. Null when they have not set one. */
  contactEmail: string | null
  /** Where the agency reads its requests. */
  leadsUrl: string
}

/** From and Reply-To for one message. */
export interface SenderIdentity {
  from: string
  replyTo?: string
}

/**
 * Who a renter's acknowledgement appears to come from.
 *
 * THE SEAM. Today every message leaves from the one address the deployment has
 * verified with its provider, and all this does is put the agency's name in
 * front of it and point replies at the agency. The renter sees "Atlas Cars",
 * and a reply reaches Atlas Cars, but SPF and DKIM still authenticate the
 * platform's domain -- which is correct, because it IS the platform's domain.
 *
 * Putting the agency's own address in `from` without their domain being
 * verified would not make the mail theirs; it would break DMARC alignment and
 * send their customers' acknowledgements to spam, or get them rejected
 * outright by any agency whose domain publishes p=reject.
 *
 * Per-agency sending is therefore a separate piece of work -- the agency
 * proves the domain, the provider returns DKIM records, and only a verified
 * domain is used -- and when it exists it replaces the body of this function
 * and nothing else. That is the whole reason it is a function.
 */
export function senderFor(agency: AgencySummary, platformFrom: string): SenderIdentity {
  const address = addressOf(platformFrom)
  const identity: SenderIdentity = {
    from: address === null ? platformFrom : `${displayName(agency.name)} <${address}>`,
  }
  if (agency.contactEmail !== null) identity.replyTo = agency.contactEmail
  return identity
}

/** The bare address out of `Name <address>`, or null if there is no such shape. */
function addressOf(from: string): string | null {
  const match = /<([^>]+)>/.exec(from)
  if (match?.[1] !== undefined) return match[1].trim()
  return from.includes('@') ? from.trim() : null
}

/**
 * A display name safe to put before an address.
 *
 * AN AGENCY NAME IS ATTACKER-CONTROLLED. Whoever signed the agency up typed
 * it, and it goes into a mail header, so two kinds of character are removed
 * rather than escaped.
 *
 * Carriage returns and line feeds are the dangerous ones: a newline ends the
 * header and lets everything after it be read as another -- a second Bcc, a
 * different Reply-To. Every control character goes, not just those two.
 *
 * Quotation marks, angle brackets and the address separators would end the
 * quoted name early and let the rest be read as another address. An agency
 * name containing one of those is a typo, not a requirement.
 *
 * What remains may still read oddly -- a name containing something
 * resembling an address stays, as text, inside the quotes -- but it cannot be
 * delivered to and cannot start a header. The address in the envelope is the
 * platform's, and there is only ever one.
 */
function displayName(agencyName: string): string {
  const cleaned = agencyName
    // eslint-disable-next-line no-control-regex -- removing them is the point
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/["<>\\,;:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const name = cleaned === '' ? PRODUCT_NAME : `${cleaned} via ${PRODUCT_NAME}`
  return `"${name}"`
}

function render(to: string, subject: string, document: EmailDocument): OutgoingMessage {
  return {
    to,
    subject,
    html: renderEmailHtml(document),
    text: renderEmailText(document),
  }
}

/**
 * What the renter is sent.
 *
 * IT PROMISES NOTHING. It is a receipt for a question, not a confirmation of a
 * booking: the car is not held, the price is an estimate, and the agency has
 * not agreed to anything yet. Somebody who turns up at a counter believing
 * otherwise was misled by this message.
 *
 * IT NEVER CONTAINS WHAT THEY WROTE. The note is free text from an
 * unauthenticated form, and a message that quotes it back is a message an
 * attacker can compose: the body would carry whatever they typed, from an
 * address the recipient's provider trusts, to anybody whose address they put
 * in the form. Leaving the note out entirely removes that, and costs the
 * renter nothing -- they know what they wrote.
 */
export function renterAcknowledgement(lead: LeadSummary, agency: AgencySummary): OutgoingMessage {
  const period = formatPeriod(lead, agency.timeZone)
  const quoted = formatMoney(lead.quotedTotalMinor, lead.currency)

  const paragraphs: EmailDocument['paragraphs'] = [
    [`${agency.name} has your request for the `, { strong: lead.vehicleLabel }, '.'],
    [`Dates: ${period}. Estimate: ${quoted}.`],
    [`Your reference is `, { strong: lead.reference }, '.'],
    [
      'This is a request, not a confirmed booking. ',
      { strong: 'The car is not being held' },
      ', and the price is an estimate until ',
      `${agency.name} confirms it. They will be in touch.`,
    ],
  ]

  const footnotes: EmailDocument['paragraphs'][number][] = [
    agency.phone === null
      ? [`If you need an answer quickly, reply to this message.`]
      : [`If you need an answer quickly, telephone ${agency.name} on ${agency.phone}.`],
    [
      `You are receiving this because somebody used this address to ask ${agency.name} about a `,
      'car. If that was not you, ignore this message: no account has been created and you will ',
      'not be contacted again.',
    ],
  ]

  return render(lead.renterEmail, `Your request to ${agency.name}`, {
    preheader: `${agency.name} has your request. It is not a confirmed booking.`,
    paragraphs,
    footnotes,
  })
}

/**
 * What the agency is sent, for each owner and administrator.
 *
 * Deliberately almost empty. The vehicle, the dates and the reference are the
 * agency's own information; who asked is not in here at any price, because an
 * agency mailbox is not behind the second factor and this product's whole
 * argument is that identity data is.
 */
export function agencyNotification(
  lead: LeadSummary,
  agency: AgencySummary,
  to: string,
): OutgoingMessage {
  return render(to, `New booking request: ${lead.vehicleLabel}`, {
    preheader: `A request for the ${lead.vehicleLabel} is waiting in ${PRODUCT_NAME}.`,
    paragraphs: [
      ['Somebody has asked to hire the ', { strong: lead.vehicleLabel }, '.'],
      [
        `Dates: ${formatPeriod(lead, agency.timeZone)}. ` +
          `Quoted: ${formatMoney(lead.quotedTotalMinor, lead.currency)}. ` +
          `Reference: ${lead.reference}.`,
      ],
      [
        `Their name and contact details are in ${PRODUCT_NAME}. They are not in this message, `,
        'because an inbox is not protected the way your account is.',
      ],
    ],
    action: { label: 'Open the request', url: agency.leadsUrl },
    footnotes: [['A request does not hold the car. It is held when you convert the request.']],
  })
}

/**
 * How many requests an agency may receive in an hour before this stops mailing.
 *
 * Generously above what a real agency sees. A promotion that brings in thirty
 * enquiries in an hour is a good day; thirty-one is almost certainly a machine,
 * and the cost of being wrong is one hour without email for an agency that can
 * still see every request in the product.
 */
export const MAIL_CAP_PER_HOUR = 30

/** One message, and who it should appear to come from. */
export interface Envelope {
  message: OutgoingMessage
  /** Absent means the platform's own sender, unchanged. */
  sender?: SenderIdentity
}

/**
 * Every message one request should produce, in the order they should be sent.
 *
 * RETURNS AN EMPTY LIST WHEN THE AGENCY IS OVER THE CAP, which is the whole of
 * the cap's implementation. The caller sends what it is handed and has no
 * branch to get wrong -- and because this is the only place the decision is
 * made, it is the only place a test has to reach.
 *
 * CAPPING MAIL IS NOT CAPPING REQUESTS. The lead is written before any of this
 * is called, the in-app notification has already fired, and the agency's queue
 * is unaffected. Somebody who floods an agency costs it an hour of email and
 * nothing else; refusing their requests instead would have handed them a way
 * to switch a competitor's booking page off.
 *
 * THE RENTER IS WRITTEN TO FIRST. If anything is going to fail halfway, the
 * person waiting for an answer should be the one who got theirs: the agency
 * can see the request in the product regardless.
 */
export function envelopesFor(
  lead: LeadSummary,
  agency: AgencySummary,
  recipients: readonly string[],
  context: { recentRequests: number; platformFrom: string },
): Envelope[] {
  if (context.recentRequests > MAIL_CAP_PER_HOUR) return []

  return [
    {
      message: renterAcknowledgement(lead, agency),
      sender: senderFor(agency, context.platformFrom),
    },
    ...recipients.map((recipient) => ({
      message: agencyNotification(lead, agency, recipient),
    })),
  ]
}

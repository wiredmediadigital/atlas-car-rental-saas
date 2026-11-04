/**
 * Invitation email delivery.
 *
 * Membership truth and email transport are kept apart on purpose. An invitation
 * existing in the database and a message reaching somebody's inbox are two
 * different facts, and a system that treats them as one produces the worst
 * failure this module has: a Team page that says "Invitation sent" while nothing
 * left the building and a colleague waits for an email that was never written.
 *
 * So this module knows nothing about memberships. It takes an already-created
 * invitation, tries to hand a message to a provider, and reports exactly what it
 * observed — which is never "delivered", because no email API can tell you that.
 * `accepted_by_provider` means an HTTP call returned success. Whether the
 * message reached an inbox, a spam folder or a bounce is not something this
 * system sees, and it does not claim to.
 *
 * If no provider is configured the invitation is still perfectly valid; the
 * caller is told `not_configured` and can fall back to handing the person a
 * one-time link by whatever means they already use.
 */

import {
  escapeHtml,
  PRODUCT_NAME,
  renderEmailHtml,
  renderEmailText,
  type EmailDocument,
} from './email-layout.ts'

/**
 * The product name and the HTML escaper now live in `email-layout.ts`, with the
 * rest of the design, so that every outgoing message shares one of each.
 *
 * They are re-exported here unchanged because this module's surface is what the
 * Edge Function and `supabase/tests/team-email.test.ts` already import, and
 * moving a constant between files is not a reason to churn either of them. The
 * test that holds `PRODUCT_NAME` in step with `src/lib/config/brand.ts` still
 * reaches it through this path and still passes.
 */
export { escapeHtml, PRODUCT_NAME }

/** Mirrors public.invitation_delivery. */
export type DeliveryState =
  'pending' | 'accepted_by_provider' | 'failed' | 'manual_link' | 'not_configured'

export interface DeliveryOutcome {
  readonly state: DeliveryState
  /** A short, human-readable category. Never a provider payload, never a key. */
  readonly detail: string
}

export interface InvitationMessage {
  readonly to: string
  readonly organizationName: string
  readonly inviterName: string
  readonly roleLabel: string
  readonly acceptUrl: string
  readonly expiresAt: string
  readonly locale: string
}

/**
 * Validates the configured application origin.
 *
 * The destination of an invitation link is never taken from a request. A `Host`
 * or `Origin` header is chosen by whoever is calling, and honouring one would
 * turn every invitation email this product sends into an open redirect carrying
 * a bearer token. It comes from server configuration, and it has to look like an
 * origin and nothing more.
 */
export function resolveAppOrigin(raw: string | undefined): URL | null {
  if (!raw) return null

  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return null
  }

  const isLocal = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLocal)) return null
  // `https://user:pass@evil.example@real.example` and friends.
  if (url.username || url.password) return null
  if (url.search || url.hash) return null

  return url
}

/**
 * The acceptance link.
 *
 * The token lives in the FRAGMENT, not the query string. A fragment is never
 * sent to a server, so it stays out of access logs, out of any proxy in front of
 * the application, and out of the Referer header of anything the page loads. The
 * application reads it, strips it from the address bar and keeps it in memory
 * for the length of the acceptance.
 */
export function buildAcceptUrl(origin: URL, token: string): string {
  const url = new URL('/accept-invite', origin)
  url.hash = `token=${encodeURIComponent(token)}`
  return url.toString()
}

/**
 * The invitation, as a document.
 *
 * The markup moved to `email-layout.ts`; what stays here is the only part that
 * is about invitations — the words, and which of them are the agency's own text
 * rather than ours. Every segment is escaped by the renderer, so an agency
 * called `<img onerror=...>` is still text in a message this product signs its
 * name to.
 *
 * Deliberately plain, and unchanged in that respect: no customer names, no
 * figures, no internal identifiers, no mention of any other agency. An
 * invitation is read before anybody has agreed to anything, and often in a
 * webmail client that will forward it.
 */
function invitationDocument(message: InvitationMessage): EmailDocument {
  const opener = message.inviterName
    ? `${message.inviterName} has invited you`
    : 'You have been invited'

  return {
    preheader: `Join ${message.organizationName} on ${PRODUCT_NAME}.`,
    paragraphs: [
      [
        `${opener} to join `,
        { strong: message.organizationName },
        ` on ${PRODUCT_NAME} as `,
        { strong: message.roleLabel },
        '.',
      ],
      [
        `${PRODUCT_NAME} is the system ${message.organizationName} uses to run its fleet, `,
        'contracts and finances.',
      ],
    ],
    action: {
      label: `Join ${message.organizationName}`,
      url: message.acceptUrl,
    },
    footnotes: [
      [
        `This invitation expires on ${message.expiresAt}. If you were not expecting it, you `,
        'can ignore this message — nothing happens until you accept.',
      ],
    ],
  }
}

function renderHtml(message: InvitationMessage): string {
  return renderEmailHtml(invitationDocument(message))
}

function renderText(message: InvitationMessage): string {
  return renderEmailText(invitationDocument(message))
}

export interface EmailTransportConfig {
  readonly provider: string | undefined
  readonly apiKey: string | undefined
  readonly from: string | undefined
}

/**
 * Sends the message, if a provider is configured.
 *
 * One transport is implemented — Resend's HTTP API — because it is an HTTP call
 * with a bearer token, which is all an Edge Function can make. Adding another is
 * a branch here and a secret in the project; nothing above this line changes,
 * because nothing above this line knows how the message travels.
 *
 * Configuration is passed in rather than read from the environment, so this
 * module has no ambient dependency and every branch below — including the two
 * failure branches, which are the ones that matter — can be exercised by a test
 * that never sends an email.
 */
export async function deliverInvitation(
  message: InvitationMessage,
  config: EmailTransportConfig,
  send: typeof fetch = fetch,
): Promise<DeliveryOutcome> {
  const provider = (config.provider ?? '').trim().toLowerCase()
  const apiKey = config.apiKey
  const from = config.from

  if (!provider || provider === 'none') {
    return {
      state: 'not_configured',
      detail: 'No email provider is configured for this project.',
    }
  }
  if (provider !== 'resend') {
    return { state: 'failed', detail: `Unsupported email provider: ${provider}.` }
  }
  if (!apiKey || !from) {
    return {
      state: 'failed',
      detail: 'The email provider is named but its API key or sender address is missing.',
    }
  }

  let response: Response
  try {
    response = await send('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [message.to],
        subject: `Join ${message.organizationName} on ${PRODUCT_NAME}`,
        html: renderHtml(message),
        text: renderText(message),
      }),
    })
  } catch {
    // Deliberately not including the error: a fetch failure can carry the
    // request it was made with, and that request carried the link.
    return { state: 'failed', detail: 'The email provider could not be reached.' }
  }

  if (!response.ok) {
    /*
     * A status and nothing else. A provider's error body echoes the request in
     * several common cases, and the request contains the invitation link.
     */
    return {
      state: 'failed',
      detail:
        response.status === 429
          ? 'The email provider is rate limiting this project. Try again shortly.'
          : `The email provider refused the message (HTTP ${response.status}).`,
    }
  }

  return {
    state: 'accepted_by_provider',
    // Said precisely, because the Team page repeats it to an administrator who
    // is deciding whether to chase somebody up.
    detail: 'The email provider accepted the message. Receipt is not confirmed.',
  }
}

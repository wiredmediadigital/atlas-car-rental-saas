/**
 * The emails sent when an agency asks to close.
 *
 * Two messages, and they matter for different reasons.
 *
 *   MEMBERS. Every owner and administrator is told the moment it is requested,
 *   so a closure can never be quiet. It says what happened, when the data will
 *   be purged, and that anyone who owns or administers the agency can take it
 *   back from Settings.
 *
 *   OPERATOR. Adera Labs is told to cancel the agency's Stripe subscription.
 *   That cancellation is manual by design, and the purge refuses to run while a
 *   subscription is live, so this message is the only thing standing between a
 *   closure request and an agency being billed for an account it asked to close.
 *
 * THIS MODULE DECIDES NOTHING ABOUT WHO MAY SEND. It sends what the database says
 * is pending (see closure_notices_pending) and reports what it observed. A failed
 * email must never block or undo a closure request, so nothing here throws on a
 * delivery failure: it records `failed` and the next attempt tries again.
 *
 * NOTHING HERE LOGS, RETURNS OR RECORDS AN ADDRESS, A MESSAGE BODY OR A KEY. The
 * detail written back to the database is a category sentence assembled from
 * constants.
 */

import {
  PRODUCT_NAME,
  type EmailDocument,
  renderEmailHtml,
  renderEmailText,
} from './email-layout.ts'
import { isAuthorizedRunner } from './account-closure.ts'
import {
  deliverMessage,
  type DeliveryOutcome,
  type DeliveryState,
  type EmailTransportConfig,
} from './team-email.ts'

export type NoticeCaller = 'runner' | 'user' | 'refused'

/**
 * Who is calling. The runner secret (the same one the purge runner uses) means
 * the scheduled drain over every agency; any other bearer token is a user
 * session that the caller must still verify; no bearer token is refused.
 * An unset or short secret can never produce 'runner'.
 */
export function resolveNoticeCaller(authorization: string | null, secret: string): NoticeCaller {
  if (authorization === null || !/^Bearer\s+\S+/i.test(authorization.trim())) return 'refused'
  return isAuthorizedRunner(authorization, secret) ? 'runner' : 'user'
}

export interface PendingNotice {
  readonly organizationId: string
  readonly organizationName: string
  readonly requestedByName: string
  /**
   * WHICH CLOSURE THIS IS: the agency's closure_requested_at, handed straight
   * back when the outcome is recorded. An agency can be restored and closed
   * again between reading this list and recording what the provider said, and
   * without this the outcome would land on the new closure -- marking a notice
   * sent that nobody has sent.
   */
  readonly requestedAt: string
  /** ISO timestamp of the earliest purge. */
  readonly purgeAfter: string
  readonly sendMembers: boolean
  readonly sendOperator: boolean
  readonly recipients: readonly string[]
}

export interface DeliveryUpdate {
  readonly members?: DeliveryState
  readonly operator?: DeliveryState
  readonly detail?: string
}

export interface NoticeDeps {
  listPending(): Promise<readonly PendingNotice[]>
  /** Takes the whole notice, because the outcome is recorded against ITS closure. */
  record(notice: PendingNotice, update: DeliveryUpdate): Promise<void>
}

export interface NoticeConfig {
  readonly transport: EmailTransportConfig
  /** Where the Stripe-cancellation notice goes. Server configuration, never `VITE_`. */
  readonly operatorAddress: string | undefined
  /** The application's own origin, for the restore link. Null omits the link. */
  readonly appOrigin: URL | null
}

export interface NoticeReport {
  readonly organizations: number
  /**
   * Operator notices attempted this run that the provider did not accept (or that
   * had nowhere to go). The scheduled drain turns a non-zero count into a failed
   * job: the operator email is the only prompt to cancel the subscription.
   */
  readonly operatorUndelivered: number
}

const MEMBERS_DETAIL = {
  accepted_by_provider: 'The email to owners and administrators was accepted by the provider.',
  failed: 'The email to owners and administrators could not be delivered.',
  not_configured: 'No email provider is configured, so owners and administrators were not emailed.',
} as const

const OPERATOR_DETAIL = {
  accepted_by_provider: 'The email to the operator was accepted by the provider.',
  failed: 'The email to the operator could not be delivered.',
  not_configured:
    'No operator address or email provider is configured, so the operator was not emailed.',
} as const

function purgeDay(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10)
}

/** A subject is one line; an agency name must not be able to add another. */
function oneLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function membersDocument(notice: PendingNotice, origin: URL | null): EmailDocument {
  const day = purgeDay(notice.purgeAfter)
  const requester = notice.requestedByName
    ? `${notice.requestedByName} has asked`
    : 'An owner has asked'

  return {
    preheader: `${notice.organizationName} will be closed and its data deleted on ${day}.`,
    paragraphs: [
      [`${requester} to close `, { strong: notice.organizationName }, ` on ${PRODUCT_NAME}.`],
      [
        'The agency is now read-only. Its data will be permanently deleted on ',
        { strong: day },
        '. Until then, nothing has been deleted.',
      ],
      [
        'If this was not intended, an owner or an administrator can restore the agency ',
        'from Settings at any time before that date.',
      ],
    ],
    ...(origin
      ? {
          action: {
            label: 'Open Settings to restore',
            url: new URL('/settings', origin).toString(),
          },
        }
      : {}),
    footnotes: [['You are receiving this because you own or administer this agency.']],
  }
}

function operatorDocument(notice: PendingNotice): EmailDocument {
  const day = purgeDay(notice.purgeAfter)
  return {
    preheader: `Cancel the Stripe subscription for ${notice.organizationName}.`,
    paragraphs: [
      [{ strong: notice.organizationName }, ' has asked to close its account.'],
      [
        { strong: 'Cancel its subscription in Stripe now.' },
        ' Cancellation is a manual step. Until it is done the agency will keep being billed, ',
        'and the purge on ',
        { strong: day },
        ' will refuse to run while a subscription is live.',
      ],
      [`Agency id: ${notice.organizationId}`],
      [
        'The agency can still restore itself before the purge date, in which case the ',
        'subscription should not be cancelled.',
      ],
    ],
  }
}

/**
 * One state for a channel from however many sends it made.
 *
 * NO SENDS IS `not_configured`, NOT `failed`. The members channel sends to
 * whatever addresses closure_notices_pending returned, and an agency whose
 * owners and administrators have no address on file returns none. Nothing was
 * attempted and nothing failed, but `failed` is counted towards the three
 * members attempts, so three drain ticks burned the entire budget on sending
 * zero emails and the notice was then given up on for ever. `not_configured`
 * is the honest state and is deliberately not counted, so the notice goes out
 * as soon as somebody has an address.
 *
 * The operator channel is unaffected: it always aggregates exactly one outcome.
 */
function aggregate(
  outcomes: readonly DeliveryOutcome[],
): 'accepted_by_provider' | 'failed' | 'not_configured' {
  if (outcomes.length === 0) return 'not_configured'
  if (outcomes.some((o) => o.state === 'failed')) return 'failed'
  if (outcomes.some((o) => o.state === 'not_configured')) return 'not_configured'
  return 'accepted_by_provider'
}

async function sendOne(
  to: string,
  subject: string,
  document: EmailDocument,
  config: NoticeConfig,
  send: typeof fetch,
): Promise<DeliveryOutcome> {
  try {
    return await deliverMessage(
      { to, subject, html: renderEmailHtml(document), text: renderEmailText(document) },
      config.transport,
      send,
    )
  } catch {
    // deliverMessage reports its own failures; this is only for an exception it
    // did not anticipate. The error is dropped: it can carry the request.
    return { state: 'failed', detail: 'The email could not be sent.' }
  }
}

async function recordSafely(
  deps: NoticeDeps,
  notice: PendingNotice,
  update: DeliveryUpdate,
): Promise<void> {
  try {
    await deps.record(notice, update)
  } catch {
    // The notice stays pending and is attempted again. Failing to write the
    // outcome must not turn into failing the caller.
  }
}

async function sendMembersNotice(
  deps: NoticeDeps,
  notice: PendingNotice,
  config: NoticeConfig,
  send: typeof fetch,
): Promise<void> {
  const document = membersDocument(notice, config.appOrigin)
  const subject = `${oneLine(notice.organizationName)} has been set to close on ${PRODUCT_NAME}`

  const outcomes: DeliveryOutcome[] = []
  for (const to of notice.recipients) {
    outcomes.push(await sendOne(to, subject, document, config, send))
  }

  const state = aggregate(outcomes)
  await recordSafely(deps, notice, { members: state, detail: MEMBERS_DETAIL[state] })
}

async function sendOperatorNotice(
  deps: NoticeDeps,
  notice: PendingNotice,
  config: NoticeConfig,
  send: typeof fetch,
): Promise<boolean> {
  const to = (config.operatorAddress ?? '').trim()
  if (!to) {
    // The one place this gap can be seen: the state column is read by nobody, and
    // a missing address means the Stripe cancellation is never prompted. A fixed
    // line, with no address and no agency, so it is safe in any log.
    console.error('account-closure-notice: no operator address configured')
    await recordSafely(deps, notice, {
      operator: 'not_configured',
      detail: OPERATOR_DETAIL.not_configured,
    })
    return false
  }

  const subject = `Cancel the Stripe subscription: ${oneLine(notice.organizationName)} is closing`
  const outcome = await sendOne(to, subject, operatorDocument(notice), config, send)
  const state = aggregate([outcome])
  if (state === 'failed') {
    // One fixed line per attempt, with no address, agency or provider detail. The
    // operator channel is never given up on, so a closure that is stuck here
    // shows up as a line per drain tick: that is the signal, and it is rare.
    console.error('account-closure-notice: operator email was not accepted')
  }
  await recordSafely(deps, notice, { operator: state, detail: OPERATOR_DETAIL[state] })
  return state === 'accepted_by_provider'
}

/**
 * Sends every pending notice and records what each attempt observed.
 *
 * The operator's notice goes first: it is the one with a financial consequence,
 * so it must not wait behind a long list of recipients.
 */
export async function sendClosureNotices(
  deps: NoticeDeps,
  config: NoticeConfig,
  send: typeof fetch = fetch,
): Promise<NoticeReport> {
  const pending = await deps.listPending()

  let operatorUndelivered = 0
  for (const notice of pending) {
    if (notice.sendOperator && !(await sendOperatorNotice(deps, notice, config, send))) {
      operatorUndelivered += 1
    }
    if (notice.sendMembers) await sendMembersNotice(deps, notice, config, send)
  }

  return { organizations: pending.length, operatorUndelivered }
}

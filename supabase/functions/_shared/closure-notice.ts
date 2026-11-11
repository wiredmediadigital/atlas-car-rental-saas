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
 *   OPERATOR. Adera Labs is told a closure happened, as a backstop. The agency
 *   is asked to cancel its own Stripe subscription from Manage billing; nothing
 *   cancels it automatically, by design, so that restoring stays a clean undo.
 *   The purge refuses to run while a subscription is live, so this message is
 *   how the operator learns which agency to look at if it is still live by the
 *   purge date.
 *
 *   OPERATOR, ON RESTORE. When an agency is restored the operator is told the
 *   closure was withdrawn, so the earlier message is not acted on, and that a
 *   subscription which was already cancelled has to be restarted by a person:
 *   restoring does not bring billing back and nothing here touches Stripe.
 *   Owners and administrators are NOT emailed on restore (they get the in-app
 *   notification written by organization_restore).
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

/**
 * An operator notice that a closure was withdrawn. Carries no address: the
 * operator is the only recipient, and its address is server configuration.
 */
export interface PendingRestoreNotice {
  readonly organizationId: string
  readonly organizationName: string
  /**
   * WHICH RESTORE THIS IS: the agency's closure_restored_at, handed straight back
   * when the outcome is recorded, so a later restore cannot be marked sent by an
   * outcome that was for an earlier one.
   */
  readonly restoredAt: string
  /**
   * The agency has asked to close again since this restore. The email must not
   * then claim that the agency is working.
   */
  readonly closingAgain: boolean
}

export interface RestoreDeliveryUpdate {
  readonly state: 'accepted_by_provider' | 'failed' | 'not_configured'
  readonly detail: string
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
  /** The operator notices owed because an agency was restored. */
  listRestorePending(): Promise<readonly PendingRestoreNotice[]>
  /** Takes the whole notice, because the outcome is recorded against ITS restore. */
  recordRestore(notice: PendingRestoreNotice, update: RestoreDeliveryUpdate): Promise<void>
}

export interface NoticeConfig {
  readonly transport: EmailTransportConfig
  /** Where the operator backstop notice goes. Server configuration, never `VITE_`. */
  readonly operatorAddress: string | undefined
  /** The application's own origin, for the restore link. Null omits the link. */
  readonly appOrigin: URL | null
}

export interface NoticeReport {
  readonly organizations: number
  /**
   * Operator notices attempted this run that the provider did not accept (or that
   * had nowhere to go). The scheduled drain turns a non-zero count into a failed
   * job: the operator email is the only way the operator learns of a closure.
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

const RESTORE_DETAIL = {
  accepted_by_provider: 'The restore notice to the operator was accepted by the provider.',
  failed: 'The restore notice to the operator could not be delivered.',
  not_configured:
    'No operator address or email provider is configured, so the operator was not told of the restore.',
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
    preheader: `${notice.organizationName} has asked to close; purge on ${day}.`,
    paragraphs: [
      [{ strong: notice.organizationName }, ' has asked to close its account.'],
      [
        'Its data is due to be purged on ',
        { strong: day },
        '. The agency has been asked to cancel its own subscription from Manage billing.',
      ],
      [
        { strong: 'No action is needed now.' },
        ' If its subscription is still live after that date, cancel it in Stripe so the ',
        'deletion can proceed: the purge refuses to run while a subscription is live.',
      ],
      [`Agency id: ${notice.organizationId}`],
    ],
  }
}

/**
 * The restore email. Every sentence is true of what the product does: restoring
 * clears the closure (so the purge no longer applies) and never touches Stripe.
 * It also never claims the agency is working when the agency has been closed
 * again since, which can happen if the drain has not run in between.
 */
function restoreOperatorDocument(notice: PendingRestoreNotice): EmailDocument {
  const day = purgeDay(notice.restoredAt)
  const status: EmailDocument['paragraphs'][number] = notice.closingAgain
    ? [
        `It restored its account on ${day}, which withdrew its earlier closure request. `,
        'It has since asked to close again; that request has its own notice and is the one ',
        'that stands. Disregard any earlier closure notice for the first request.',
      ]
    : [
        'The closure has been withdrawn and the agency is working again; its data will not ',
        'be purged. Disregard any earlier closure notice for this agency.',
      ]

  return {
    preheader: `${notice.organizationName} has withdrawn its closure request.`,
    paragraphs: [
      [{ strong: notice.organizationName }, ' has restored its account.'],
      status,
      [
        { strong: 'If its subscription was already cancelled, it has to be restarted.' },
        ' Restoring does not bring billing back by itself, and the product never restarts a ',
        'subscription on its own: this needs a person.',
      ],
      [`Agency id: ${notice.organizationId}`],
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
    // a missing address means the operator never learns of the closure. A fixed
    // line, with no address and no agency, so it is safe in any log.
    console.error('account-closure-notice: no operator address configured')
    await recordSafely(deps, notice, {
      operator: 'not_configured',
      detail: OPERATOR_DETAIL.not_configured,
    })
    return false
  }

  const subject = `Account closure: ${oneLine(notice.organizationName)} is closing`
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

async function sendRestoreNotice(
  deps: NoticeDeps,
  notice: PendingRestoreNotice,
  config: NoticeConfig,
  send: typeof fetch,
): Promise<boolean> {
  const record = async (state: RestoreDeliveryUpdate['state']): Promise<void> => {
    try {
      await deps.recordRestore(notice, { state, detail: RESTORE_DETAIL[state] })
    } catch {
      // The notice stays owed and is attempted again.
    }
  }

  const to = (config.operatorAddress ?? '').trim()
  if (!to) {
    // A fixed line, with no address and no agency, so it is safe in any log.
    console.error('account-closure-notice: no operator address configured for a restore notice')
    await record('not_configured')
    return false
  }

  const subject = `Account closure withdrawn: ${oneLine(notice.organizationName)}`
  const outcome = await sendOne(to, subject, restoreOperatorDocument(notice), config, send)
  const state = aggregate([outcome])
  if (state === 'failed') {
    console.error('account-closure-notice: restore email to the operator was not accepted')
  }
  await record(state)
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
  const restores = await deps.listRestorePending()

  let operatorUndelivered = 0

  // Restore notices first. A restore always happened before the closure that is
  // now owed (a restore clears an unsent closure notice), so this is the order
  // the events happened in, and the operator never reads a retraction after the
  // instruction it should have been read before.
  for (const notice of restores) {
    if (!(await sendRestoreNotice(deps, notice, config, send))) operatorUndelivered += 1
  }

  for (const notice of pending) {
    if (notice.sendOperator && !(await sendOperatorNotice(deps, notice, config, send))) {
      operatorUndelivered += 1
    }
    if (notice.sendMembers) await sendMembersNotice(deps, notice, config, send)
  }

  const organizations = new Set([
    ...pending.map((n) => n.organizationId),
    ...restores.map((n) => n.organizationId),
  ]).size
  return { organizations, operatorUndelivered }
}

// @vitest-environment node
/**
 * The email sent to the operator when an agency is restored.
 *
 * Its point: the closure email asked the operator to cancel a subscription if it
 * was still live past the purge date, and nothing retracted that. This message
 * retracts it, and says that a subscription that was already cancelled has to be
 * restarted by a person, because restoring does not bring billing back.
 * Owners and administrators are never emailed on restore.
 */
import { describe, expect, it, vi } from 'vitest'

import {
  sendClosureNotices,
  type NoticeDeps,
  type PendingNotice,
  type PendingRestoreNotice,
} from '../functions/_shared/closure-notice.ts'

const transport = { provider: 'resend', apiKey: 'key', from: 'Pevvy <no-reply@example.test>' }
const OPERATOR = 'ops@adera.test'

const restore: PendingRestoreNotice = {
  organizationId: '11111111-1111-4111-8111-111111111111',
  organizationName: 'Atlas Rentals',
  restoredAt: '2026-11-12T09:30:00.000Z',
  closingAgain: false,
}

const closure: PendingNotice = {
  organizationId: restore.organizationId,
  organizationName: 'Atlas Rentals',
  requestedByName: 'Sara Bennani',
  requestedAt: '2026-11-13T10:00:00.000Z',
  purgeAfter: '2026-12-13T10:00:00.000Z',
  sendMembers: true,
  sendOperator: true,
  recipients: ['owner@atlas.test', 'admin@atlas.test'],
}

interface Sent {
  to: string[]
  subject: string
  text: string
  html: string
}

function harness(
  restores: PendingRestoreNotice[],
  closures: PendingNotice[] = [],
  responder?: (to: string) => Response,
) {
  const sent: Sent[] = []
  const recorded: Array<{ id: string; restoredAt: string; update: Record<string, unknown> }> = []
  const order: string[] = []
  const deps: NoticeDeps = {
    listPending: () => Promise.resolve(closures),
    record: () => Promise.resolve(),
    listRestorePending: () => Promise.resolve(restores),
    recordRestore: (notice, update) => {
      recorded.push({ id: notice.organizationId, restoredAt: notice.restoredAt, update })
      return Promise.resolve()
    },
  }
  const send = vi.fn((_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(init?.body as string) as Sent
    sent.push(body)
    order.push(body.subject)
    return Promise.resolve(responder ? responder(body.to[0]!) : new Response('{}', { status: 200 }))
  }) as unknown as typeof fetch
  return { deps, send, sent, recorded, order }
}

const config = {
  transport,
  operatorAddress: OPERATOR,
  appOrigin: new URL('https://app.example.test'),
}

describe('the restore email to the operator', () => {
  it('goes to the operator only, never to owners and administrators', async () => {
    const h = harness([restore])
    await sendClosureNotices(h.deps, config, h.send)

    expect(h.sent).toHaveLength(1)
    expect(h.sent[0]!.to).toEqual([OPERATOR])
  })

  it('names the agency the way the closure email does, in subject and body', async () => {
    const h = harness([restore])
    await sendClosureNotices(h.deps, config, h.send)

    const m = h.sent[0]!
    expect(m.subject).toBe('Account closure withdrawn: Atlas Rentals')
    expect(m.text).toContain('Atlas Rentals')
    expect(m.text).toContain(restore.organizationId)
  })

  it('says the closure has been withdrawn and the agency is working again', async () => {
    const h = harness([restore])
    await sendClosureNotices(h.deps, config, h.send)

    const m = h.sent[0]!
    expect(m.text).toMatch(/closure has been withdrawn/i)
    expect(m.text).toMatch(/working again/i)
    expect(m.text).toMatch(/will not be purged/i)
    expect(m.text).toMatch(/disregard any earlier closure notice/i)
  })

  it('says that a cancelled subscription has to be restarted, and that nothing does it for you', async () => {
    const h = harness([restore])
    await sendClosureNotices(h.deps, config, h.send)

    const m = h.sent[0]!
    expect(m.text).toMatch(/if its subscription was already cancelled, it has to be restarted/i)
    expect(m.text).toMatch(/does not bring billing back by itself/i)
    expect(m.text).toMatch(/never restarts a subscription on its own/i)
    expect(m.html).toContain('has to be restarted')
    expect(m.html).toContain('Atlas Rentals has withdrawn its closure request.')
  })

  it('does not tell the operator to cancel anything', async () => {
    const h = harness([restore])
    await sendClosureNotices(h.deps, config, h.send)
    expect(h.sent[0]!.text).not.toMatch(/cancel it in stripe/i)
  })

  it('does not claim the agency is working when it has been closed again since', async () => {
    const h = harness([{ ...restore, closingAgain: true }])
    await sendClosureNotices(h.deps, config, h.send)

    const m = h.sent[0]!
    expect(m.text).not.toMatch(/working again/i)
    expect(m.text).not.toMatch(/will not be purged/i)
    expect(m.text).toContain('2026-11-12')
    expect(m.text).toMatch(/asked to close again/i)
    expect(m.text).toMatch(/has to be restarted/i)
    expect(m.subject).toBe('Account closure withdrawn: Atlas Rentals')
  })

  it('sends the restore notice before the closure notice of a later closure', async () => {
    const h = harness([{ ...restore, closingAgain: true }], [closure])
    await sendClosureNotices(h.deps, config, h.send)

    const toOperator = h.sent.filter((m) => m.to[0] === OPERATOR).map((m) => m.subject)
    expect(toOperator).toEqual([
      'Account closure withdrawn: Atlas Rentals',
      'Account closure: Atlas Rentals is closing',
    ])
  })

  it('records accepted_by_provider against the restore it was for', async () => {
    const h = harness([restore])
    await sendClosureNotices(h.deps, config, h.send)

    expect(h.recorded).toEqual([
      {
        id: restore.organizationId,
        restoredAt: restore.restoredAt,
        update: expect.objectContaining({ state: 'accepted_by_provider' }),
      },
    ])
  })

  it('records failed when the provider refuses, and reports it undelivered', async () => {
    const h = harness([restore], [], () => new Response('{}', { status: 500 }))
    const report = await sendClosureNotices(h.deps, config, h.send)

    expect(h.recorded[0]!.update).toEqual(expect.objectContaining({ state: 'failed' }))
    expect(report.operatorUndelivered).toBe(1)
  })

  it('records not_configured without sending when there is no operator address', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const h = harness([restore])
    const report = await sendClosureNotices(h.deps, { ...config, operatorAddress: '' }, h.send)
    quiet.mockRestore()

    expect(h.sent).toEqual([])
    expect(h.recorded[0]!.update).toEqual(expect.objectContaining({ state: 'not_configured' }))
    expect(report.operatorUndelivered).toBe(1)
  })

  it('counts the agency once when it owes both a restore and a closure notice', async () => {
    const h = harness([restore], [closure])
    const report = await sendClosureNotices(h.deps, config, h.send)
    expect(report.organizations).toBe(1)
  })

  it('never writes the operator address or the message into what it records', async () => {
    const h = harness([restore])
    await sendClosureNotices(h.deps, config, h.send)
    const recorded = JSON.stringify(h.recorded)
    expect(recorded).not.toContain(OPERATOR)
    expect(recorded).not.toContain('Atlas')
  })

  it('sends nothing when no restore notice is owed', async () => {
    const h = harness([])
    await sendClosureNotices(h.deps, config, h.send)
    expect(h.sent).toEqual([])
  })
})

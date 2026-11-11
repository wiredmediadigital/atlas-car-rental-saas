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
  type RestoreDeliveryUpdate,
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
  // What the re-read just before sending returns. Defaults to "unchanged".
  recheck?: PendingRestoreNotice[] | Error,
  // What the re-read of ONE agency's closure notices returns just before sending.
  closureRecheck?: PendingNotice[] | Error,
) {
  const reads: string[] = []
  const listCalls: Array<string | undefined> = []
  const sent: Sent[] = []
  const recorded: Array<{ id: string; restoredAt: string; update: RestoreDeliveryUpdate }> = []
  const order: string[] = []
  const deps: NoticeDeps = {
    listPending: (organizationId?: string) => {
      reads.push(organizationId === undefined ? 'pending:all' : 'pending:one')
      if (organizationId === undefined) return Promise.resolve(closures)
      if (closureRecheck instanceof Error) return Promise.reject(closureRecheck)
      return Promise.resolve(
        closureRecheck ?? closures.filter((c) => c.organizationId === organizationId),
      )
    },
    record: () => Promise.resolve(),
    listRestorePending: (organizationId?: string) => {
      listCalls.push(organizationId)
      reads.push(organizationId === undefined ? 'restores:all' : 'restores:one')
      if (organizationId === undefined) return Promise.resolve(restores)
      if (recheck instanceof Error) return Promise.reject(recheck)
      return Promise.resolve(recheck ?? restores.filter((r) => r.organizationId === organizationId))
    },
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
  return { deps, send, sent, recorded, order, listCalls, reads }
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
    expect(m.text).toMatch(/no longer scheduled for deletion/i)
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

  it('re-reads the agency just before sending, for that agency alone', async () => {
    const h = harness([restore])
    await sendClosureNotices(h.deps, config, h.send)
    expect(h.listCalls).toEqual([undefined, restore.organizationId])
  })

  it('sends nothing when the agency has closed again since the notice was queued', async () => {
    // Queued as a restore notice, then the agency closed once more before the
    // drain ran: "working again" would be false when read.
    const h = harness([restore], [], undefined, [{ ...restore, closingAgain: true }])
    const report = await sendClosureNotices(h.deps, config, h.send)

    expect(h.sent.filter((m) => m.subject.startsWith('Account closure withdrawn'))).toEqual([])
    // Not marked sent, not marked failed: it stays owed until the agency is open again.
    expect(h.recorded).toEqual([])
    // A deliberate skip is not an undelivered operator notice.
    expect(report.operatorUndelivered).toBe(0)
  })

  it('still sends the closure notice of the new closure when it skips the restore notice', async () => {
    const h = harness([restore], [closure], undefined, [{ ...restore, closingAgain: true }])
    await sendClosureNotices(h.deps, config, h.send)

    expect(h.sent.filter((m) => m.to[0] === OPERATOR).map((m) => m.subject)).toEqual([
      'Account closure: Atlas Rentals is closing',
    ])
  })

  it('sends nothing when the agency is no longer owed the notice at all', async () => {
    // Purged or closed between listing and sending: the finder no longer returns it.
    const h = harness([restore], [], undefined, [])
    await sendClosureNotices(h.deps, config, h.send)
    expect(h.sent).toEqual([])
    expect(h.recorded).toEqual([])
  })

  it('sends nothing when it was replaced by a newer restore in the meantime', async () => {
    const h = harness([restore], [], undefined, [
      { ...restore, restoredAt: '2026-11-14T08:00:00.000Z' },
    ])
    await sendClosureNotices(h.deps, config, h.send)
    expect(h.sent).toEqual([])
    expect(h.recorded).toEqual([])
  })

  it('does not send an unverified claim when the re-read fails, and reports it undelivered', async () => {
    const h = harness([restore], [], undefined, new Error('db down'))
    const report = await sendClosureNotices(h.deps, config, h.send)

    expect(h.sent).toEqual([])
    expect(report.operatorUndelivered).toBe(1)
  })

  it('sends the restore notice before the closure notice of a later closure', async () => {
    const h = harness([restore], [closure])
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

    expect(h.recorded).toHaveLength(1)
    expect(h.recorded[0]!.id).toBe(restore.organizationId)
    expect(h.recorded[0]!.restoredAt).toBe(restore.restoredAt)
    expect(h.recorded[0]!.update.state).toBe('accepted_by_provider')
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

describe('the order the drain reads and sends in', () => {
  it('reads the restore notices BEFORE the closure notices', async () => {
    // A restore wipes the closure it withdraws. Reading restores first means a
    // restore that lands between the two reads can only make the closure list
    // smaller, never leave a stale closure beside its own retraction.
    const h = harness([restore], [closure])
    await sendClosureNotices(h.deps, config, h.send)
    expect(h.reads.slice(0, 2)).toEqual(['restores:all', 'pending:all'])
  })

  it('never ends on a closure notice for an agency that was restored between the two reads', async () => {
    // The world: a closure is open, and a restore commits right after whichever
    // list is read first. The restore clears the closure.
    let closureOpen = true
    let restored = false
    let firstReadDone = false
    const commitRestoreAfterFirstRead = () => {
      if (!firstReadDone) {
        firstReadDone = true
        restored = true
        closureOpen = false
      }
    }
    const sent: string[] = []
    const deps: NoticeDeps = {
      listPending: (organizationId) => {
        const open = closureOpen
        commitRestoreAfterFirstRead()
        const rows = open ? [closure] : []
        return Promise.resolve(
          organizationId ? rows.filter((r) => r.organizationId === organizationId) : rows,
        )
      },
      record: () => Promise.resolve(),
      listRestorePending: (organizationId) => {
        const was = restored
        commitRestoreAfterFirstRead()
        const rows = was ? [restore] : []
        return Promise.resolve(
          organizationId ? rows.filter((r) => r.organizationId === organizationId) : rows,
        )
      },
      recordRestore: () => Promise.resolve(),
    }
    const send = vi.fn((_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string) as Sent
      if (body.to[0] === OPERATOR) sent.push(body.subject)
      return Promise.resolve(new Response('{}', { status: 200 }))
    }) as unknown as typeof fetch

    await sendClosureNotices(deps, config, send)

    expect(sent.at(-1)).not.toBe('Account closure: Atlas Rentals is closing')
    expect(sent).not.toContain('Account closure: Atlas Rentals is closing')
  })
})

describe('a closure notice is verified before it is sent', () => {
  it('re-reads the agency just before sending, for that agency alone', async () => {
    const h = harness([], [closure])
    await sendClosureNotices(h.deps, config, h.send)
    expect(h.reads).toEqual(['restores:all', 'pending:all', 'pending:one'])
  })

  it('sends nothing, to anyone, when the closure is gone by then (the agency was restored)', async () => {
    const h = harness([], [closure], undefined, undefined, [])
    const report = await sendClosureNotices(h.deps, config, h.send)

    expect(h.sent).toEqual([])
    expect(h.recorded).toEqual([])
    expect(report.operatorUndelivered).toBe(0)
  })

  it('sends nothing for a closure that has since been replaced by a newer one', async () => {
    const newer = { ...closure, requestedAt: '2026-11-14T10:00:00.000Z' }
    const h = harness([], [closure], undefined, undefined, [newer])
    await sendClosureNotices(h.deps, config, h.send)
    expect(h.sent).toEqual([])
  })

  it('does not send a channel that was accepted in the meantime', async () => {
    const h = harness([], [closure], undefined, undefined, [{ ...closure, sendOperator: false }])
    await sendClosureNotices(h.deps, config, h.send)
    expect(h.sent.filter((m) => m.to[0] === OPERATOR)).toEqual([])
    expect(h.sent.map((m) => m.to[0])).toEqual(['owner@atlas.test', 'admin@atlas.test'])
  })

  it('sends nothing when the re-read fails, and reports the operator notice undelivered', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const h = harness([], [closure], undefined, undefined, new Error('db down'))
    const report = await sendClosureNotices(h.deps, config, h.send)
    quiet.mockRestore()

    expect(h.sent).toEqual([])
    expect(report.operatorUndelivered).toBe(1)
  })
})

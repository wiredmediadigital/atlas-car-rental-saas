// @vitest-environment node
/**
 * The emails sent when an agency asks to close.
 *
 * The operator's email is the one that matters: cancelling the Stripe
 * subscription is manual, and this message is what prompts it. Each test below
 * names a behaviour whose removal would fail it.
 */
import { describe, expect, it, vi } from 'vitest'

import {
  sendClosureNotices,
  type NoticeDeps,
  type PendingNotice,
} from '../functions/_shared/closure-notice.ts'

const transport = { provider: 'resend', apiKey: 'key', from: 'Pevvy <no-reply@example.test>' }
const OPERATOR = 'ops@adera.test'

const notice: PendingNotice = {
  organizationId: '11111111-1111-4111-8111-111111111111',
  organizationName: 'Atlas Rentals',
  requestedByName: 'Sara Bennani',
  purgeAfter: '2026-12-10T10:00:00.000Z',
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

function harness(pending: PendingNotice[], responder?: (to: string) => Response) {
  const sent: Sent[] = []
  const recorded: Array<{ id: string; update: Record<string, unknown> }> = []
  const deps: NoticeDeps = {
    listPending: () => Promise.resolve(pending),
    record: (id, update) => {
      recorded.push({ id, update: { ...update } })
      return Promise.resolve()
    },
  }
  const send = vi.fn((_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(init?.body as string) as Sent
    sent.push(body)
    return Promise.resolve(responder ? responder(body.to[0]!) : new Response('{}', { status: 200 }))
  }) as unknown as typeof fetch
  return { deps, send, sent, recorded }
}

interface Merged {
  members?: string
  operator?: string
}

/** Every update folded into one, last write per channel winning. */
function mergedOf(recorded: Array<{ update: Record<string, unknown> }>): Merged {
  return Object.assign({}, ...recorded.map((r) => r.update)) as Merged
}

const config = {
  transport,
  operatorAddress: OPERATOR,
  appOrigin: new URL('https://app.example.test'),
}

describe('the email to owners and administrators', () => {
  it('goes to every owner and administrator, one message each', async () => {
    const h = harness([notice])
    await sendClosureNotices(h.deps, config, h.send)

    const toMembers = h.sent.filter((m) => m.to[0] !== OPERATOR)
    expect(toMembers.map((m) => m.to)).toEqual([['owner@atlas.test'], ['admin@atlas.test']])
  })

  it('names the agency, the date it will be purged, and how to take it back', async () => {
    const h = harness([notice])
    await sendClosureNotices(h.deps, config, h.send)

    const m = h.sent.find((s) => s.to[0] === 'owner@atlas.test')!
    expect(m.text).toContain('Atlas Rentals')
    expect(m.text).toContain('2026-12-10')
    expect(m.text).toMatch(/restore/i)
    expect(m.text).toContain('https://app.example.test/settings')
  })

  it('does not reveal who else was told', async () => {
    const h = harness([notice])
    await sendClosureNotices(h.deps, config, h.send)
    const m = h.sent.find((s) => s.to[0] === 'owner@atlas.test')!
    expect(m.text + m.html).not.toContain('admin@atlas.test')
  })
})

describe('the email to the operator', () => {
  it('names the agency and says to cancel the subscription in Stripe', async () => {
    const h = harness([notice])
    await sendClosureNotices(h.deps, config, h.send)

    const m = h.sent.find((s) => s.to[0] === OPERATOR)!
    expect(m).toBeDefined()
    expect(m.subject).toContain('Atlas Rentals')
    expect(m.text).toContain('Atlas Rentals')
    expect(m.text).toMatch(/cancel/i)
    expect(m.text).toContain('Stripe')
    expect(m.text).toContain(notice.organizationId)
    expect(m.text).toContain('2026-12-10')
  })

  it('cannot be turned into markup by an agency name', async () => {
    const h = harness([{ ...notice, organizationName: '<img src=x onerror=alert(1)>' }])
    await sendClosureNotices(h.deps, config, h.send)

    const m = h.sent.find((s) => s.to[0] === OPERATOR)!
    expect(m.html).not.toContain('<img')
    expect(m.html).toContain('&lt;img')
  })

  it('is not sent twice once the provider has accepted it', async () => {
    const h = harness([{ ...notice, sendOperator: false }])
    await sendClosureNotices(h.deps, config, h.send)
    expect(h.sent.some((s) => s.to[0] === OPERATOR)).toBe(false)
    expect(h.sent).toHaveLength(2)
  })

  it('is recorded as not configured, not as sent, when no operator address is set', async () => {
    const h = harness([notice])
    await sendClosureNotices(h.deps, { ...config, operatorAddress: undefined }, h.send)

    expect(h.sent.some((s) => s.to[0] === OPERATOR)).toBe(false)
    const merged = mergedOf(h.recorded)
    expect(merged.operator).toBe('not_configured')
  })
})

describe('a missing operator address', () => {
  it('is logged, once and without any address, so it reaches the function logs', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const h = harness([notice])
      await sendClosureNotices(h.deps, { ...config, operatorAddress: undefined }, h.send)

      expect(spy).toHaveBeenCalledTimes(1)
      expect(spy).toHaveBeenCalledWith('account-closure-notice: no operator address configured')
    } finally {
      spy.mockRestore()
    }
  })

  it('logs a failed operator send once, as a fixed line with nothing identifying', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const h = harness(
        [{ ...notice, sendMembers: false }],
        () => new Response('no', { status: 500 }),
      )
      await sendClosureNotices(h.deps, config, h.send)

      expect(spy).toHaveBeenCalledTimes(1)
      expect(spy).toHaveBeenCalledWith('account-closure-notice: operator email was not accepted')
    } finally {
      spy.mockRestore()
    }
  })

  it('is not logged when the address is configured', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const h = harness([notice])
      await sendClosureNotices(h.deps, config, h.send)
      expect(spy).not.toHaveBeenCalled()
    } finally {
      spy.mockRestore()
    }
  })
})

describe('what gets recorded', () => {
  it('is accepted_by_provider for both once everything was handed over', async () => {
    const h = harness([notice])
    await sendClosureNotices(h.deps, config, h.send)

    const merged = mergedOf(h.recorded)
    expect(merged.members).toBe('accepted_by_provider')
    expect(merged.operator).toBe('accepted_by_provider')
  })

  it('is failed, never accepted, when the provider refuses', async () => {
    const h = harness([notice], () => new Response('no', { status: 500 }))
    await sendClosureNotices(h.deps, config, h.send)

    const merged = mergedOf(h.recorded)
    expect(merged.members).toBe('failed')
    expect(merged.operator).toBe('failed')
  })

  it('keeps the members notice failed if even one recipient was refused', async () => {
    const h = harness([notice], (to) =>
      to === 'admin@atlas.test' ? new Response('no', { status: 500 }) : new Response('{}'),
    )
    await sendClosureNotices(h.deps, config, h.send)

    const merged = mergedOf(h.recorded)
    expect(merged.members).toBe('failed')
    expect(merged.operator).toBe('accepted_by_provider')
  })

  it('never contains an address or a message body in the detail', async () => {
    const h = harness([notice], () => new Response('owner@atlas.test echoed', { status: 500 }))
    await sendClosureNotices(h.deps, config, h.send)
    for (const r of h.recorded) {
      expect(JSON.stringify(r.update)).not.toMatch(/@|Atlas/)
    }
  })

  it('does not throw when the transport throws: a failed email blocks nothing', async () => {
    const h = harness([notice])
    const exploding = vi.fn(() =>
      Promise.reject(new Error('network down')),
    ) as unknown as typeof fetch

    await expect(sendClosureNotices(h.deps, config, exploding)).resolves.toBeDefined()
    const merged = mergedOf(h.recorded)
    expect(merged.members).toBe('failed')
  })
})

describe('when there is nothing to send', () => {
  it('sends nothing and records nothing for an empty list', async () => {
    const h = harness([])
    const report = await sendClosureNotices(h.deps, config, h.send)

    expect(h.sent).toHaveLength(0)
    expect(h.recorded).toHaveLength(0)
    expect(report.organizations).toBe(0)
  })
})

describe('the report the scheduled drain acts on', () => {
  it('counts an operator notice the provider did not accept', async () => {
    const h = harness([notice])
    const failing = vi.fn(() =>
      Promise.resolve(new Response('no', { status: 500 })),
    ) as unknown as typeof fetch
    const report = await sendClosureNotices(h.deps, config, failing)
    expect(report.operatorUndelivered).toBe(1)
  })

  it('counts an operator notice with no address configured', async () => {
    const h = harness([notice])
    const report = await sendClosureNotices(
      h.deps,
      { ...config, operatorAddress: undefined },
      h.send,
    )
    expect(report.operatorUndelivered).toBe(1)
  })

  it('reports zero when the operator notice was accepted', async () => {
    const h = harness([notice])
    const report = await sendClosureNotices(h.deps, config, h.send)
    expect(report.operatorUndelivered).toBe(0)
  })
})

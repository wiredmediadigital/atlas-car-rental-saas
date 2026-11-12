// @vitest-environment node
/**
 * Factor reset logic, with every dependency faked in memory.
 *
 * The fakes hold real state (factors, membership rows, consumed codes), so the
 * assertions are on what was left standing, not on what a mock was called with.
 * The ordering property matters most: a reset that is refused deletes nothing.
 */
import { describe, expect, it } from 'vitest'

import {
  normaliseRecoveryCode,
  resetMemberFactor,
  resetOwnFactor,
  type ResetDeps,
  type SecurityEventInput,
} from '../_shared/mfa-reset.ts'

const ORG = '00000000-0000-0000-0000-0000000000a1'
const OTHER_ORG = '00000000-0000-0000-0000-0000000000a2'
const ACTOR = '00000000-0000-0000-0000-00000000000a'
const SUBJECT = '00000000-0000-0000-0000-00000000000b'
const VALID_CODE = '0123456789'

interface Member {
  readonly organizationId: string
  readonly userId: string
  readonly role: 'owner' | 'admin' | 'manager' | 'staff'
  readonly status: 'active' | 'suspended'
}

function world(options: { members?: readonly Member[]; factors?: Record<string, string[]> }) {
  const factors = new Map<string, string[]>(
    Object.entries(options.factors ?? { [SUBJECT]: ['f1', 'f2'] }).map(([k, v]) => [k, [...v]]),
  )
  const events: SecurityEventInput[] = []
  const codesSeen: string[] = []
  const deleted: string[] = []

  const deps: ResetDeps = {
    consumeRecoveryCode: (_userId, code) => {
      codesSeen.push(code)
      return Promise.resolve(code === VALID_CODE)
    },
    findMembership: (organizationId, userId) => {
      const row = (options.members ?? []).find(
        (m) => m.organizationId === organizationId && m.userId === userId,
      )
      return Promise.resolve(row ? { role: row.role, status: row.status } : null)
    },
    listFactorIds: (userId) => Promise.resolve([...(factors.get(userId) ?? [])]),
    deleteFactor: (userId, factorId) => {
      deleted.push(factorId)
      factors.set(
        userId,
        (factors.get(userId) ?? []).filter((id) => id !== factorId),
      )
      return Promise.resolve()
    },
    recordSecurityEvent: (event) => {
      events.push(event)
      return Promise.resolve()
    },
  }
  return { deps, factors, events, codesSeen, deleted }
}

const member = (userId: string, role: Member['role'], status: Member['status'] = 'active') => ({
  organizationId: ORG,
  userId,
  role,
  status,
})

describe('normaliseRecoveryCode', () => {
  it('strips whitespace and separators and upper-cases', () => {
    expect(normaliseRecoveryCode(' 0123-4abc–de \n')).toBe('01234ABCDE')
    expect(normaliseRecoveryCode('abcde fghjk')).toBe('ABCDEFGHJK')
    expect(normaliseRecoveryCode('abc_de.fg')).toBe('ABCDEFG')
  })

  it('folds the ambiguous characters the alphabet excludes', () => {
    expect(normaliseRecoveryCode('oOiIlL')).toBe('001111')
  })
})

describe('resetOwnFactor', () => {
  it('deletes every factor for a valid code and records the event', async () => {
    const w = world({})
    const outcome = await resetOwnFactor(w.deps, { userId: SUBJECT, recoveryCode: VALID_CODE })

    expect(outcome).toEqual({ ok: true, factorsRemoved: 2 })
    expect(w.factors.get(SUBJECT)).toEqual([])
    expect(w.events).toEqual([
      {
        eventType: 'factor_removed',
        subjectUserId: SUBJECT,
        actorUserId: SUBJECT,
        organizationId: null,
        detail: { actor_user_id: SUBJECT, method: 'recovery_code', factors_removed: 2 },
      },
    ])
  })

  it('normalises the code before it reaches the database', async () => {
    const w = world({})
    const outcome = await resetOwnFactor(w.deps, {
      userId: SUBJECT,
      recoveryCode: ' 01234-56789 ',
    })

    expect(outcome.ok).toBe(true)
    expect(w.codesSeen).toEqual([VALID_CODE])
  })

  it('resolves a code typed with O for 0 and I or L for 1, with spaces and lower case', async () => {
    const w = world({})
    // VALID_CODE is 0123456789; the user has misread 0 as O and 1 as I.
    const outcome = await resetOwnFactor(w.deps, {
      userId: SUBJECT,
      recoveryCode: 'o i23 4567 89',
    })
    const viaL = await resetOwnFactor(world({}).deps, {
      userId: SUBJECT,
      recoveryCode: 'Ol23-45678-9',
    })

    expect(outcome.ok).toBe(true)
    expect(viaL.ok).toBe(true)
    expect(w.codesSeen).toEqual([VALID_CODE])
  })

  it('refuses an invalid code and deletes nothing', async () => {
    const w = world({})
    const outcome = await resetOwnFactor(w.deps, { userId: SUBJECT, recoveryCode: 'WRONGWRONG' })

    expect(outcome).toEqual({ ok: false, reason: 'invalid_code' })
    expect(w.factors.get(SUBJECT)).toEqual(['f1', 'f2'])
    expect(w.deleted).toEqual([])
    expect(w.events).toEqual([])
  })

  it('refuses an empty code without asking the database', async () => {
    const w = world({})
    const outcome = await resetOwnFactor(w.deps, { userId: SUBJECT, recoveryCode: ' - ' })

    expect(outcome).toEqual({ ok: false, reason: 'invalid_code' })
    expect(w.codesSeen).toEqual([])
    expect(w.factors.get(SUBJECT)).toEqual(['f1', 'f2'])
  })

  it('reports no_factor, without spending the code, when there is nothing to remove', async () => {
    const w = world({ factors: { [SUBJECT]: [] } })
    const outcome = await resetOwnFactor(w.deps, { userId: SUBJECT, recoveryCode: VALID_CODE })

    expect(outcome).toEqual({ ok: false, reason: 'no_factor' })
    expect(w.codesSeen).toEqual([])
    expect(w.events).toEqual([])
  })
})

describe('resetMemberFactor', () => {
  const input = { actorUserId: ACTOR, subjectUserId: SUBJECT, organizationId: ORG }

  it('lets an active owner reset an active member and records it against the organization', async () => {
    const w = world({ members: [member(ACTOR, 'owner'), member(SUBJECT, 'staff')] })
    const outcome = await resetMemberFactor(w.deps, input)

    expect(outcome).toEqual({ ok: true, factorsRemoved: 2 })
    expect(w.factors.get(SUBJECT)).toEqual([])
    expect(w.events).toEqual([
      {
        eventType: 'factor_reset_by_owner',
        subjectUserId: SUBJECT,
        actorUserId: ACTOR,
        organizationId: ORG,
        detail: { actor_user_id: ACTOR, factors_removed: 2 },
      },
    ])
  })

  it.each(['admin', 'manager', 'staff'] as const)(
    'refuses an actor whose role is %s and deletes nothing',
    async (role) => {
      const w = world({ members: [member(ACTOR, role), member(SUBJECT, 'staff')] })
      const outcome = await resetMemberFactor(w.deps, input)

      expect(outcome).toEqual({ ok: false, reason: 'not_permitted' })
      expect(w.factors.get(SUBJECT)).toEqual(['f1', 'f2'])
      expect(w.events).toEqual([])
    },
  )

  it('refuses a suspended owner', async () => {
    const w = world({ members: [member(ACTOR, 'owner', 'suspended'), member(SUBJECT, 'staff')] })
    expect(await resetMemberFactor(w.deps, input)).toEqual({ ok: false, reason: 'not_permitted' })
    expect(w.deleted).toEqual([])
  })

  it('refuses an owner of a different organization', async () => {
    const w = world({
      members: [{ ...member(ACTOR, 'owner'), organizationId: OTHER_ORG }, member(SUBJECT, 'staff')],
    })
    expect(await resetMemberFactor(w.deps, input)).toEqual({ ok: false, reason: 'not_permitted' })
    expect(w.deleted).toEqual([])
  })

  it('refuses a subject who is not a member of the organization', async () => {
    const w = world({
      members: [member(ACTOR, 'owner'), { ...member(SUBJECT, 'staff'), organizationId: OTHER_ORG }],
    })
    expect(await resetMemberFactor(w.deps, input)).toEqual({ ok: false, reason: 'not_permitted' })
    expect(w.factors.get(SUBJECT)).toEqual(['f1', 'f2'])
    expect(w.events).toEqual([])
  })

  it('refuses a suspended subject', async () => {
    const w = world({ members: [member(ACTOR, 'owner'), member(SUBJECT, 'staff', 'suspended')] })
    expect(await resetMemberFactor(w.deps, input)).toEqual({ ok: false, reason: 'not_permitted' })
    expect(w.deleted).toEqual([])
  })

  it('refuses an owner resetting themselves, which would bypass the recovery code', async () => {
    const w = world({ members: [member(ACTOR, 'owner')], factors: { [ACTOR]: ['f1'] } })
    const outcome = await resetMemberFactor(w.deps, { ...input, subjectUserId: ACTOR })

    expect(outcome).toEqual({ ok: false, reason: 'not_permitted' })
    expect(w.factors.get(ACTOR)).toEqual(['f1'])
  })

  it('reports no_factor when an authorised reset finds nothing to remove', async () => {
    const w = world({
      members: [member(ACTOR, 'owner'), member(SUBJECT, 'staff')],
      factors: { [SUBJECT]: [] },
    })
    expect(await resetMemberFactor(w.deps, input)).toEqual({ ok: false, reason: 'no_factor' })
    expect(w.events).toEqual([])
  })
})

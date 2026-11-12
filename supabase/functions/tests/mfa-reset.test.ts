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

interface WorldOptions {
  members?: readonly Member[]
  factors?: Record<string, string[]>
  /** Makes deleteFactor throw once it has removed this many factors. */
  deleteFailsAfter?: number
  /** Makes recordSecurityEvent throw, to prove it never masks another failure. */
  recordFails?: boolean
}

function world(options: WorldOptions) {
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
    listActiveOrganizationIds: (userId) =>
      Promise.resolve(
        (options.members ?? [])
          .filter((m) => m.userId === userId && m.status === 'active')
          .map((m) => m.organizationId),
      ),
    listFactorIds: (userId) => Promise.resolve([...(factors.get(userId) ?? [])]),
    deleteFactor: (userId, factorId) => {
      if (options.deleteFailsAfter !== undefined && deleted.length >= options.deleteFailsAfter) {
        return Promise.reject(new Error('delete_factor_failed'))
      }
      deleted.push(factorId)
      factors.set(
        userId,
        (factors.get(userId) ?? []).filter((id) => id !== factorId),
      )
      return Promise.resolve()
    },
    recordSecurityEvent: (event) => {
      events.push(event)
      return options.recordFails
        ? Promise.reject(new Error('record_security_event_failed'))
        : Promise.resolve()
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

describe('resetMemberFactor across the subject’s other agencies', () => {
  // A factor belongs to the person, not to one agency. Agency B loses its
  // member's protection too, and the select policy on security_events filters on
  // organization_id, so a row carrying only agency A's id is one B can never
  // read.
  const input = { actorUserId: ACTOR, subjectUserId: SUBJECT, organizationId: ORG }
  const elsewhere = { ...member(SUBJECT, 'manager'), organizationId: OTHER_ORG }

  it('records one event per agency the subject is active in, each with that agency’s id', async () => {
    const w = world({ members: [member(ACTOR, 'owner'), member(SUBJECT, 'staff'), elsewhere] })

    expect(await resetMemberFactor(w.deps, input)).toEqual({ ok: true, factorsRemoved: 2 })
    expect(w.events.map((event) => event.organizationId)).toEqual([ORG, OTHER_ORG])
    expect(w.events.every((event) => event.eventType === 'factor_reset_by_owner')).toBe(true)
    expect(w.events.every((event) => event.subjectUserId === SUBJECT)).toBe(true)
  })

  it('tells neither agency about the other', async () => {
    const w = world({ members: [member(ACTOR, 'owner'), member(SUBJECT, 'staff'), elsewhere] })
    await resetMemberFactor(w.deps, input)

    for (const event of w.events) {
      expect(event.detail).toEqual({ actor_user_id: ACTOR, factors_removed: 2 })
      expect(Object.keys(event.detail)).toEqual(['actor_user_id', 'factors_removed'])
    }
  })

  it('leaves out an agency the subject is suspended in', async () => {
    const w = world({
      members: [
        member(ACTOR, 'owner'),
        member(SUBJECT, 'staff'),
        { ...elsewhere, status: 'suspended' as const },
      ],
    })
    await resetMemberFactor(w.deps, input)

    expect(w.events.map((event) => event.organizationId)).toEqual([ORG])
  })

  it('records the acting agency even if the listing leaves it out, and never twice', async () => {
    const w = world({ members: [member(ACTOR, 'owner'), member(SUBJECT, 'staff'), elsewhere] })
    const deps = {
      ...w.deps,
      listActiveOrganizationIds: () => Promise.resolve([ORG, ORG, OTHER_ORG, OTHER_ORG]),
    }
    await resetMemberFactor(deps, input)

    expect(w.events.map((event) => event.organizationId)).toEqual([ORG, OTHER_ORG])
  })
})

describe('a reset that fails part-way', () => {
  // The module header promises an event for the factors it DID remove. That is
  // the audit trail under stress, so it is asserted rather than trusted.
  const input = { actorUserId: ACTOR, subjectUserId: SUBJECT, organizationId: ORG }
  const owned = [member(ACTOR, 'owner'), member(SUBJECT, 'staff')]

  it('records the one factor it removed and still throws the delete failure', async () => {
    const w = world({ members: owned, deleteFailsAfter: 1 })

    await expect(resetMemberFactor(w.deps, input)).rejects.toThrow('delete_factor_failed')
    expect(w.deleted).toEqual(['f1'])
    expect(w.factors.get(SUBJECT)).toEqual(['f2'])
    expect(w.events).toEqual([
      {
        eventType: 'factor_reset_by_owner',
        subjectUserId: SUBJECT,
        actorUserId: ACTOR,
        organizationId: ORG,
        detail: { actor_user_id: ACTOR, factors_removed: 1 },
      },
    ])
  })

  it('records nothing when the very first delete fails', async () => {
    const w = world({ members: owned, deleteFailsAfter: 0 })

    await expect(resetMemberFactor(w.deps, input)).rejects.toThrow('delete_factor_failed')
    expect(w.factors.get(SUBJECT)).toEqual(['f1', 'f2'])
    expect(w.events).toEqual([])
  })

  it('reports the delete failure, not a failure to record it', async () => {
    const w = world({ members: owned, deleteFailsAfter: 1, recordFails: true })

    await expect(resetMemberFactor(w.deps, input)).rejects.toThrow('delete_factor_failed')
  })

  it('leaves the same trace on the recovery-code path, with the code already spent', async () => {
    const w = world({ deleteFailsAfter: 1 })

    await expect(
      resetOwnFactor(w.deps, { userId: SUBJECT, recoveryCode: VALID_CODE }),
    ).rejects.toThrow('delete_factor_failed')
    expect(w.codesSeen).toEqual([VALID_CODE])
    expect(w.events).toEqual([
      {
        eventType: 'factor_removed',
        subjectUserId: SUBJECT,
        actorUserId: SUBJECT,
        organizationId: null,
        detail: { actor_user_id: SUBJECT, method: 'recovery_code', factors_removed: 1 },
      },
    ])
  })
})

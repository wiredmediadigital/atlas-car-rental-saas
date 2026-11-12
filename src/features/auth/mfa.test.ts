import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AppError } from '@/lib/supabase/errors'

import {
  assuranceLevel,
  beginEnrolment,
  challenge,
  completeEnrolment,
  listFactorState,
  recordEnrolment,
  removeFactor,
} from './mfa'

const FACTOR_CEILING = 10
const NETWORK_FAILURE = { message: 'Failed to fetch' }

interface FakeFactor {
  id: string
  factor_type: 'totp'
  status: 'verified' | 'unverified'
}

interface Backend {
  factors: FakeFactor[]
  calls: string[]
  nextId: number
  assurance: 'aal1' | 'aal2' | null
  failNext: { op: string; error: unknown } | null
}

const backend = vi.hoisted((): Backend => ({
  factors: [],
  calls: [],
  nextId: 1,
  assurance: 'aal1',
  failNext: null,
}))

function failureFor(op: string): { data: null; error: unknown } | null {
  if (backend.failNext?.op !== op) return null
  const { error } = backend.failNext
  backend.failNext = null
  return { data: null, error }
}

vi.mock('@/lib/supabase/client', () => ({
  getSupabaseClient: () => ({
    auth: {
      mfa: {
        listFactors: () => {
          backend.calls.push('list')
          const failure = failureFor('list')
          if (failure) return Promise.resolve(failure)
          const all = [...backend.factors]
          return Promise.resolve({
            data: { all, totp: all.filter((f) => f.status === 'verified') },
            error: null,
          })
        },
        unenroll: ({ factorId }: { factorId: string }) => {
          backend.calls.push(`unenroll:${factorId}`)
          const failure = failureFor('unenroll')
          if (failure) return Promise.resolve(failure)
          backend.factors = backend.factors.filter((f) => f.id !== factorId)
          return Promise.resolve({ data: { id: factorId }, error: null })
        },
        enroll: () => {
          backend.calls.push('enroll')
          const failure = failureFor('enroll')
          if (failure) return Promise.resolve(failure)
          if (backend.factors.length >= FACTOR_CEILING) {
            return Promise.resolve({
              data: null,
              error: { message: 'Maximum number of enrolled factors reached' },
            })
          }
          const id = `factor-${backend.nextId++}`
          backend.factors = [...backend.factors, { id, factor_type: 'totp', status: 'unverified' }]
          return Promise.resolve({
            data: {
              id,
              type: 'totp',
              totp: { qr_code: `<svg>${id}</svg>`, secret: `SECRET-${id}` },
            },
            error: null,
          })
        },
        challengeAndVerify: ({ factorId, code }: { factorId: string; code: string }) => {
          backend.calls.push(`verify:${factorId}:${code}`)
          const failure = failureFor('verify')
          if (failure) return Promise.resolve(failure)
          backend.factors = backend.factors.map((f) =>
            f.id === factorId ? { ...f, status: 'verified' } : f,
          )
          return Promise.resolve({ data: {}, error: null })
        },
        getAuthenticatorAssuranceLevel: () => {
          const failure = failureFor('aal')
          if (failure) return Promise.resolve(failure)
          return Promise.resolve({ data: { currentLevel: backend.assurance }, error: null })
        },
      },
    },
    rpc: (name: string) => {
      backend.calls.push(`rpc:${name}`)
      const failure = failureFor('rpc')
      if (failure) return Promise.resolve(failure)
      return Promise.resolve({ data: null, error: null })
    },
  }),
}))

function totp(id: string, status: FakeFactor['status']): FakeFactor {
  return { id, factor_type: 'totp', status }
}

beforeEach(() => {
  backend.factors = []
  backend.calls = []
  backend.nextId = 1
  backend.assurance = 'aal1'
  backend.failNext = null
})

describe('listFactorState', () => {
  it('reports none when the user has no factor', async () => {
    expect(await listFactorState()).toEqual({ status: 'none', factorId: null })
  })

  it('reports verified only for a factor whose status is verified', async () => {
    backend.factors = [totp('good', 'verified')]
    expect(await listFactorState()).toEqual({ status: 'verified', factorId: 'good' })
  })

  it('reports an abandoned enrolment as unverified, not verified', async () => {
    backend.factors = [totp('abandoned', 'unverified')]
    expect(await listFactorState()).toEqual({ status: 'unverified', factorId: 'abandoned' })
  })

  it('prefers the verified factor when an unverified one is also present', async () => {
    backend.factors = [totp('stale', 'unverified'), totp('good', 'verified')]
    expect(await listFactorState()).toEqual({ status: 'verified', factorId: 'good' })
  })

  it('converts a client failure with toAppError', async () => {
    backend.failNext = { op: 'list', error: NETWORK_FAILURE }
    const failure = await listFactorState().catch((e: unknown) => e)
    expect(failure).toBeInstanceOf(AppError)
    expect((failure as AppError).kind).toBe('network')
  })
})

describe('beginEnrolment', () => {
  it('returns the new factor with its QR code and secret', async () => {
    expect(await beginEnrolment()).toEqual({
      factorId: 'factor-1',
      qrCodeSvg: '<svg>factor-1</svg>',
      secret: 'SECRET-factor-1',
    })
  })

  it('removes an abandoned unverified factor before enrolling a new one', async () => {
    backend.factors = [totp('abandoned', 'unverified')]

    const result = await beginEnrolment()

    const removedAt = backend.calls.indexOf('unenroll:abandoned')
    expect(removedAt).toBeGreaterThanOrEqual(0)
    expect(removedAt).toBeLessThan(backend.calls.indexOf('enroll'))
    expect(backend.factors.map((f) => f.id)).toEqual([result.factorId])
  })

  it('does not accumulate abandoned factors against the ceiling', async () => {
    for (let attempt = 0; attempt < FACTOR_CEILING + 5; attempt++) {
      await beginEnrolment()
    }
    expect(backend.factors).toHaveLength(1)
  })

  it('succeeds even when the ceiling is already full of unverified factors', async () => {
    backend.factors = Array.from({ length: FACTOR_CEILING }, (_, i) =>
      totp(`old-${i}`, 'unverified'),
    )
    await expect(beginEnrolment()).resolves.toMatchObject({ factorId: 'factor-1' })
    expect(backend.factors).toHaveLength(1)
  })

  it('never removes a verified factor', async () => {
    backend.factors = [totp('good', 'verified'), totp('abandoned', 'unverified')]
    await beginEnrolment()
    expect(backend.factors.map((f) => f.id)).toContain('good')
    expect(backend.calls).not.toContain('unenroll:good')
  })

  it('does not enroll when the cleanup fails', async () => {
    backend.factors = [totp('abandoned', 'unverified')]
    backend.failNext = { op: 'unenroll', error: NETWORK_FAILURE }
    await expect(beginEnrolment()).rejects.toBeInstanceOf(AppError)
    expect(backend.calls).not.toContain('enroll')
  })

  it('converts an enrol failure with toAppError', async () => {
    backend.failNext = { op: 'enroll', error: NETWORK_FAILURE }
    await expect(beginEnrolment()).rejects.toMatchObject({ name: 'AppError', kind: 'network' })
  })
})

describe('completeEnrolment and challenge', () => {
  it('completing an enrolment turns the factor verified', async () => {
    const { factorId } = await beginEnrolment()
    await completeEnrolment(factorId, '123456')
    expect(await listFactorState()).toEqual({ status: 'verified', factorId })
  })

  it('submits the code for the given factor when challenging', async () => {
    backend.factors = [totp('good', 'verified')]
    await challenge('good', '654321')
    expect(backend.calls).toContain('verify:good:654321')
  })

  it('converts a wrong-code failure with toAppError', async () => {
    backend.failNext = {
      op: 'verify',
      error: { message: 'Invalid TOTP code entered', code: 'mfa_verification_failed' },
    }
    await expect(challenge('good', '000000')).rejects.toBeInstanceOf(AppError)
  })

  it('converts a completeEnrolment failure with toAppError', async () => {
    backend.failNext = { op: 'verify', error: NETWORK_FAILURE }
    await expect(completeEnrolment('x', '1')).rejects.toMatchObject({ kind: 'network' })
  })
})

describe('recordEnrolment', () => {
  it('asks the database to record the enrolment, and nothing else', async () => {
    await recordEnrolment()

    expect(backend.calls).toEqual(['rpc:mfa_record_enrolment'])
  })

  it('throws an app error when the database refuses', async () => {
    backend.failNext = { op: 'rpc', error: NETWORK_FAILURE }

    await expect(recordEnrolment()).rejects.toBeInstanceOf(AppError)
  })
})

describe('removeFactor', () => {
  it('removes the named factor and leaves the account with none', async () => {
    backend.factors = [totp('factor-1', 'verified')]

    await removeFactor('factor-1')

    expect(backend.calls).toEqual(['unenroll:factor-1'])
    await expect(listFactorState()).resolves.toEqual({ status: 'none', factorId: null })
  })

  it('touches nothing else the user has enrolled', async () => {
    backend.factors = [totp('factor-1', 'verified'), totp('factor-2', 'unverified')]

    await removeFactor('factor-1')

    expect(backend.factors.map((factor) => factor.id)).toEqual(['factor-2'])
  })

  it('throws an app error rather than reporting a removal that did not happen', async () => {
    backend.factors = [totp('factor-1', 'verified')]
    backend.failNext = { op: 'unenroll', error: NETWORK_FAILURE }

    await expect(removeFactor('factor-1')).rejects.toBeInstanceOf(AppError)
    expect(backend.factors).toHaveLength(1)
  })
})

describe('assuranceLevel', () => {
  it('reports aal2 once a second factor has passed', async () => {
    backend.assurance = 'aal2'
    expect(await assuranceLevel()).toBe('aal2')
  })

  it('reports aal1 before a second factor', async () => {
    expect(await assuranceLevel()).toBe('aal1')
  })

  it('treats an unknown level as aal1', async () => {
    backend.assurance = null
    expect(await assuranceLevel()).toBe('aal1')
  })

  it('converts a client failure with toAppError', async () => {
    backend.failNext = { op: 'aal', error: NETWORK_FAILURE }
    await expect(assuranceLevel()).rejects.toMatchObject({ kind: 'network' })
  })
})

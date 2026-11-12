import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AppError } from '@/lib/supabase/errors'

import { FactorResetError, generateRecoveryCodes, resetOwnFactor } from './mfa-recovery'

const client = vi.hoisted(() => ({
  rpc: vi.fn(),
  invoke: vi.fn(),
}))

vi.mock('@/lib/supabase/client', () => ({
  getSupabaseClient: () => ({ rpc: client.rpc, functions: { invoke: client.invoke } }),
}))

function httpFailure(status: number, body: unknown) {
  return {
    data: null,
    error: {
      name: 'FunctionsHttpError',
      message: 'non-2xx',
      context: Response.json(body, { status }),
    },
  }
}

beforeEach(() => {
  client.rpc.mockReset()
  client.invoke.mockReset()
})

describe('generateRecoveryCodes', () => {
  it('returns the codes the database minted', async () => {
    const codes = ['AAAAAAAAAA', 'BBBBBBBBBB']
    client.rpc.mockResolvedValue({ data: codes, error: null })

    await expect(generateRecoveryCodes()).resolves.toEqual(codes)
    expect(client.rpc).toHaveBeenCalledWith('mfa_generate_recovery_codes')
  })

  it('throws an app error when the database refuses', async () => {
    client.rpc.mockResolvedValue({ data: null, error: { message: 'Failed to fetch' } })

    await expect(generateRecoveryCodes()).rejects.toBeInstanceOf(AppError)
  })
})

describe('resetOwnFactor', () => {
  it('asks the mfa-reset function to reset the caller in self mode', async () => {
    client.invoke.mockResolvedValue({ data: { ok: true, factorsRemoved: 1 }, error: null })

    await resetOwnFactor('ABCDEFGHJK')

    expect(client.invoke).toHaveBeenCalledWith('mfa-reset', {
      body: { mode: 'self', recoveryCode: 'ABCDEFGHJK' },
    })
  })

  it.each([
    [400, 'invalid_code'],
    [403, 'not_permitted'],
    [404, 'no_factor'],
  ] as const)('reports a %i refusal as %s', async (status, reason) => {
    client.invoke.mockResolvedValue(httpFailure(status, { ok: false, reason }))

    await expect(resetOwnFactor('ABCDEFGHJK')).rejects.toMatchObject({
      name: 'FactorResetError',
      reason,
    })
  })

  it('reports an unexpected server failure as unavailable', async () => {
    client.invoke.mockResolvedValue(
      httpFailure(500, { ok: false, error: { category: 'server_error' } }),
    )

    const failure: unknown = await resetOwnFactor('ABCDEFGHJK').catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(FactorResetError)
    expect(failure).toMatchObject({ reason: 'unavailable' })
  })

  it('reports a network failure as unavailable', async () => {
    client.invoke.mockResolvedValue({
      data: null,
      error: { name: 'FunctionsFetchError', message: 'Failed to fetch' },
    })

    await expect(resetOwnFactor('ABCDEFGHJK')).rejects.toMatchObject({ reason: 'unavailable' })
  })

  it('does not put the recovery code in the error it throws', async () => {
    client.invoke.mockResolvedValue(httpFailure(400, { ok: false, reason: 'invalid_code' }))

    const failure = (await resetOwnFactor('ABCDEFGHJK').catch((error: unknown) => error)) as Error
    expect(`${failure.name} ${failure.message}`).not.toContain('ABCDEFGHJK')
  })
})

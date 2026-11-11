import { beforeEach, describe, expect, it, vi } from 'vitest'

const rpc = vi.fn()
const invoke = vi.fn()

vi.mock('@/lib/supabase/client', () => ({
  getSupabaseClient: () => ({ rpc, functions: { invoke } }),
}))

import { requestClosure, restoreAccount } from './api'

const ORG = { id: 'org-1' }

beforeEach(() => {
  rpc.mockReset()
  invoke.mockReset()
})

describe('requestClosure', () => {
  it('asks the notice function to send the emails once the request has committed', async () => {
    rpc.mockResolvedValue({ data: ORG, error: null })
    invoke.mockResolvedValue({ data: { ok: true }, error: null })

    await expect(requestClosure('org-1')).resolves.toEqual(ORG)

    expect(invoke).toHaveBeenCalledWith('account-closure-notice', {
      body: { organization_id: 'org-1' },
    })
  })

  it('still succeeds when the notice function returns an error', async () => {
    rpc.mockResolvedValue({ data: ORG, error: null })
    invoke.mockResolvedValue({ data: null, error: new Error('boom') })

    await expect(requestClosure('org-1')).resolves.toEqual(ORG)
  })

  it('still succeeds when the notice function cannot be reached at all', async () => {
    rpc.mockResolvedValue({ data: ORG, error: null })
    invoke.mockRejectedValue(new Error('offline'))

    await expect(requestClosure('org-1')).resolves.toEqual(ORG)
  })

  it('sends no notice when the request was refused', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'Only an owner can close an agency.' } })

    await expect(requestClosure('org-1')).rejects.toBeDefined()
    expect(invoke).not.toHaveBeenCalled()
  })
})

describe('restoreAccount', () => {
  it('asks the notice function to send the operator email once the restore has committed', async () => {
    rpc.mockResolvedValue({ data: ORG, error: null })
    invoke.mockResolvedValue({ data: { ok: true }, error: null })

    await expect(restoreAccount('org-1')).resolves.toEqual(ORG)

    expect(invoke).toHaveBeenCalledWith('account-closure-notice', {
      body: { organization_id: 'org-1' },
    })
  })

  it('still succeeds when the notice function returns an error', async () => {
    rpc.mockResolvedValue({ data: ORG, error: null })
    invoke.mockResolvedValue({ data: null, error: new Error('boom') })

    await expect(restoreAccount('org-1')).resolves.toEqual(ORG)
  })

  it('still succeeds when the notice function cannot be reached at all', async () => {
    rpc.mockResolvedValue({ data: ORG, error: null })
    invoke.mockRejectedValue(new Error('offline'))

    await expect(restoreAccount('org-1')).resolves.toEqual(ORG)
  })

  it('does not wait for the notice function', async () => {
    rpc.mockResolvedValue({ data: ORG, error: null })
    invoke.mockReturnValue(new Promise(() => undefined))

    await expect(restoreAccount('org-1')).resolves.toEqual(ORG)
  })

  it('sends no notice when the restore was refused', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'nothing to restore' } })

    await expect(restoreAccount('org-1')).rejects.toBeDefined()
    expect(invoke).not.toHaveBeenCalled()
  })
})

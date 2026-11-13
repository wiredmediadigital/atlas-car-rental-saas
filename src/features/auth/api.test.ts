import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The sign-up metadata, asserted against the client that sends it.
 *
 * This file exists because of a gap the review found: the only line that writes
 * the agreement into sign-up metadata had no test that could fail. The page
 * tests mock this module wholesale, and the database tests wrote the key
 * themselves, so renaming it would have left every test green while sign-up
 * acceptance quietly stopped being recorded — producing nulls indistinguishable
 * from a grandfathered account, which nothing downstream could ever notice.
 */

const authSignUp = vi.fn()
const rpc = vi.fn()
const maybeSingle = vi.fn()
const eq = vi.fn(() => ({ maybeSingle }))
const select = vi.fn(() => ({ eq }))
const from = vi.fn(() => ({ select }))

vi.mock('@/lib/supabase/client', () => ({
  getSupabaseClient: () => ({ auth: { signUp: authSignUp }, rpc, from }),
}))

import { fetchTermsAcceptance, recordTermsAcceptance, signUp } from './api'
import { TERMS_ACCEPTED_METADATA_KEY } from './terms'

const INPUT = {
  fullName: 'Ada Lovelace',
  email: 'ada@agency.test',
  password: 'correct horse battery',
  confirmPassword: 'correct horse battery',
  organizationName: 'Lovelace Motors',
  countryCode: 'PT',
  defaultCurrency: 'EUR',
  timeZone: 'Europe/Lisbon',
  acceptedTerms: true,
}

/** The `options.data` object handed to supabase-js on the last call. */
function metadataSent(): Record<string, unknown> {
  const call = authSignUp.mock.calls.at(-1)
  return (call?.[0] as { options: { data: Record<string, unknown> } }).options.data
}

beforeEach(() => {
  vi.resetAllMocks()
  authSignUp.mockResolvedValue({ data: { session: null }, error: null })
  rpc.mockResolvedValue({ error: null })
})

describe('signUp metadata', () => {
  it('carries the agreement under the key the trigger reads', async () => {
    await signUp(INPUT)

    expect(metadataSent()[TERMS_ACCEPTED_METADATA_KEY]).toBe(true)
  })

  it('carries a false through rather than leaving the key out', async () => {
    // The invitation screen's own sign-up form sends a real answer, and the
    // trigger treats absent and false the same way. Sending the answer anyway
    // keeps the client honest about what it was told.
    await signUp({ ...INPUT, acceptedTerms: false })

    expect(metadataSent()[TERMS_ACCEPTED_METADATA_KEY]).toBe(false)
  })

  it('sends a boolean, not a string, because only a JSON true is read', async () => {
    await signUp(INPUT)

    expect(typeof metadataSent()[TERMS_ACCEPTED_METADATA_KEY]).toBe('boolean')
  })

  it('names no version of its own', async () => {
    // The server stamps the version from app.current_terms_version(). A client
    // that sent one would be claiming something it cannot prove, and a reader
    // of this metadata might one day believe it.
    await signUp(INPUT)

    expect(Object.keys(metadataSent()).filter((key) => key.includes('version'))).toEqual([])
  })

  it('sends exactly the keys the trigger reads, and no others', async () => {
    await signUp(INPUT)

    expect(Object.keys(metadataSent()).sort()).toEqual(
      [
        'country_code',
        'default_currency',
        'full_name',
        'organization_name',
        TERMS_ACCEPTED_METADATA_KEY,
        'time_zone',
      ].sort(),
    )
  })
})

describe('recordTermsAcceptance', () => {
  it('calls the write-once function, with no arguments to get wrong', async () => {
    await recordTermsAcceptance()

    expect(rpc).toHaveBeenCalledWith('record_terms_acceptance')
  })

  it('resolves rather than throwing when the call is refused', async () => {
    rpc.mockResolvedValue({ error: { message: 'nope' } })
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(recordTermsAcceptance()).resolves.toBeUndefined()

    expect(logged).toHaveBeenCalled()
    logged.mockRestore()
  })
})

describe('fetchTermsAcceptance', () => {
  it('reads the caller own row, not everybody else', async () => {
    maybeSingle.mockResolvedValue({
      data: { terms_accepted_at: null, created_at: '2026-11-13T09:00:00Z' },
      error: null,
    })

    const state = await fetchTermsAcceptance('user-1')

    expect(from).toHaveBeenCalledWith('profiles')
    expect(eq).toHaveBeenCalledWith('id', 'user-1')
    expect(state).toEqual({ acceptedAt: null, accountCreatedAt: '2026-11-13T09:00:00Z' })
  })

  it('answers null when the read fails, so nothing is written on a guess', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: { message: 'offline' } })

    await expect(fetchTermsAcceptance('user-1')).resolves.toBeNull()
  })
})

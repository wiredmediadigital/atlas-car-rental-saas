import { resetEnvironmentCache } from '@/lib/config/env'

import { SUPPORT_EMAIL } from './constants'
import { resolveTokens } from './tokens'

/**
 * The environment is stubbed rather than mocking getAppName, so these tests
 * exercise the real resolution path, including its fallback.
 */
function useValidEnvironment(appName: string) {
  vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co')
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_test')
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', '')
  vi.stubEnv('VITE_APP_NAME', appName)
  resetEnvironmentCache()
}

function useInvalidEnvironment() {
  vi.stubEnv('VITE_SUPABASE_URL', '')
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', '')
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', '')
  vi.stubEnv('VITE_APP_NAME', 'Renamed Rentals')
  resetEnvironmentCache()
}

beforeEach(() => {
  resetEnvironmentCache()
})

afterEach(() => {
  vi.unstubAllEnvs()
  resetEnvironmentCache()
})

describe('resolveTokens', () => {
  test('replaces every {{productName}} occurrence with the configured app name', () => {
    useValidEnvironment('Acme Fleet')

    const result = resolveTokens('Welcome to {{productName}}. {{productName}} keeps rentals tidy.')

    expect(result).toBe('Welcome to Acme Fleet. Acme Fleet keeps rentals tidy.')
  })

  test('replaces every {{supportEmail}} with SUPPORT_EMAIL', () => {
    useValidEnvironment('Acme Fleet')

    const result = resolveTokens('Write to {{supportEmail}} or again {{supportEmail}}.')

    expect(result).toBe(`Write to ${SUPPORT_EMAIL} or again ${SUPPORT_EMAIL}.`)
  })

  test('leaves text containing no tokens unchanged', () => {
    useValidEnvironment('Acme Fleet')
    const text = '# Heading\n\nPlain prose with `code` and { single braces }.'

    expect(resolveTokens(text)).toBe(text)
  })

  test('leaves unknown tokens and mistyped names visible rather than blanking them', () => {
    useValidEnvironment('Acme Fleet')

    const result = resolveTokens('{{productname}} {{unknown}} {{ productName }} {{productName}}')

    expect(result).toBe('{{productname}} {{unknown}} {{ productName }} Acme Fleet')
  })

  test('falls back to the default product name when the environment is invalid', () => {
    useInvalidEnvironment()

    const result = resolveTokens('Welcome to {{productName}}.')

    expect(result).toBe('Welcome to Pevvy.')
    expect(result).not.toContain('{{')
  })
})

describe('resolveTokens with awkward app names', () => {
  test('inserts a name containing replacement patterns literally', () => {
    useValidEnvironment("Cars $& Co $1 $'")

    expect(resolveTokens('Welcome to {{productName}}.')).toBe("Welcome to Cars $& Co $1 $'.")
  })
})

import {
  ORG_ROLES,
  PERMISSIONS,
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  roleRank,
  type OrgRole,
} from '@/lib/authz/permissions'
import type * as PermissionsModule from '@/lib/authz/permissions'
import { resetEnvironmentCache } from '@/lib/config/env'

import { SUPPORT_EMAIL } from './constants'
import { isPermissionKey, roleLabelFor } from './permission-labels'
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

/**
 * Reads a rendered table back into cells, so the assertions below describe what
 * a reader gets rather than restating the template that produced it.
 *
 * An earlier version of these tests compared the output against
 * `` `| ${label} | ${description} |` `` — the implementation's own format
 * string. That passes for any change made to both at once, including a change
 * that breaks the table, which is the opposite of what a test is for.
 */
function parseTable(markdown: string): { header: string[]; rows: string[][] } {
  const cells = (line: string): string[] =>
    line
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      // Split on pipes that are not escaped — an escaped one is cell content.
      .split(/(?<!\\)\|/)
      .map((cell) => cell.trim().replaceAll('\\|', '|'))

  const lines = markdown.split('\n').filter((line) => line.trim().startsWith('|'))
  return { header: cells(lines[0] ?? ''), rows: lines.slice(2).map(cells) }
}

describe('{{roleTable}}', () => {
  /*
   * Expectations are built from PERMISSIONS' own constants rather than typed
   * out. A test that hard-codes "Administrator" would be the second copy of the
   * matrix that this token exists to avoid, and it would pass while the help
   * page said something the product no longer does.
   */
  test('gives every role a row, labelled and described as the matrix does', () => {
    useValidEnvironment('Acme Fleet')

    const { rows } = parseTable(resolveTokens('{{roleTable}}'))

    expect(rows.map((row) => row[0])).toEqual(ORG_ROLES.map((role) => ROLE_LABELS[role]))
    expect(rows.map((row) => row[1])).toEqual(ORG_ROLES.map((role) => ROLE_DESCRIPTIONS[role]))
  })

  test('orders the rows from most access to least', () => {
    useValidEnvironment('Acme Fleet')

    const { rows } = parseTable(resolveTokens('{{roleTable}}'))
    const ranks = rows.map((row) =>
      roleRank(ORG_ROLES.find((role) => ROLE_LABELS[role] === row[0]) as OrgRole),
    )

    expect(ranks).toEqual([...ranks].sort((a, b) => b - a))
  })

  test('renders a table GitHub-flavoured Markdown will parse', () => {
    useValidEnvironment('Acme Fleet')

    const lines = resolveTokens('{{roleTable}}').split('\n')
    const { header } = parseTable(resolveTokens('{{roleTable}}'))

    expect(header).toHaveLength(2)
    expect(lines[1]).toBe('| --- | --- |')
    expect(lines).toHaveLength(ORG_ROLES.length + 2)
  })

  test('leaves no cell empty, so no role reaches a reader undescribed', () => {
    useValidEnvironment('Acme Fleet')

    const { rows } = parseTable(resolveTokens('{{roleTable}}'))

    expect(rows).toHaveLength(ORG_ROLES.length)
    for (const row of rows) {
      expect(row).toHaveLength(2)
      for (const cell of row) expect(cell).not.toBe('')
    }
  })

  test('replaces every occurrence, and leaves surrounding prose alone', () => {
    useValidEnvironment('Acme Fleet')

    const result = resolveTokens('Before\n\n{{roleTable}}\n\nAfter')

    expect(result).not.toContain('{{')
    expect(result.startsWith('Before\n\n|')).toBe(true)
    expect(result.endsWith('|\n\nAfter')).toBe(true)
  })
})

/*
 * The pipe escape, which nothing in the matrix exercises today.
 *
 * A pipe inside a description would end its cell early and shift every column
 * after it — a quietly wrong table on a public page, with no error anywhere. The
 * module is re-imported against a stubbed matrix rather than the real one,
 * because the point is to test the escape, not to wait for somebody to put a
 * pipe in ROLE_DESCRIPTIONS and find out the hard way.
 */
describe('{{roleTable}} with a pipe in the matrix', () => {
  afterEach(() => {
    vi.doUnmock('@/lib/authz/permissions')
    vi.resetModules()
  })

  test('escapes it so the cell survives intact', async () => {
    useValidEnvironment('Acme Fleet')
    vi.resetModules()
    vi.doMock('@/lib/authz/permissions', async (importOriginal) => {
      const actual = await importOriginal<typeof PermissionsModule>()
      return {
        ...actual,
        ROLE_DESCRIPTIONS: { ...actual.ROLE_DESCRIPTIONS, staff: 'Books | takes payments.' },
      }
    })

    const { resolveTokens: resolve } = await import('./tokens')
    const staffRow = resolve('{{roleTable}}')
      .split('\n')
      .find((line) => line.includes('Books'))

    // Escaped in the source, so GFM keeps it as one cell...
    expect(staffRow).toContain('Books \\| takes payments.')
    // ...and the row still has exactly the two cells every other row has.
    expect(staffRow?.split(/(?<!\\)\|/).filter((part) => part.trim() !== '')).toHaveLength(2)
  })
})

/*
 * The permission matrix the "Who can do what" reference renders.
 *
 * Expectations are built from PERMISSIONS and from `roleLabelFor`, never typed
 * out. A test naming `rentals.create` and "Everyone in the agency" would be the
 * third copy of the matrix, and it would go on passing while the page told a
 * reader they may do something the database refuses.
 */
describe('{{permissionMatrix}}', () => {
  test('gives every permission in the matrix exactly one row, in its declared order', () => {
    useValidEnvironment('Acme Fleet')

    const { rows } = parseTable(resolveTokens('{{permissionMatrix}}'))

    expect(rows.map((row) => row[0])).toEqual(Object.keys(PERMISSIONS).map((key) => `\`${key}\``))
  })

  test('states the derived role label, and says so in words where everyone holds it', () => {
    useValidEnvironment('Acme Fleet')

    const { rows } = parseTable(resolveTokens('{{permissionMatrix}}'))

    const expected = Object.keys(PERMISSIONS).map((key) =>
      isPermissionKey(key) ? roleLabelFor(key) : null,
    )
    rows.forEach((row, index) => {
      const label = expected[index]
      if (label === null) expect(row[1]).toBe('Everyone in the agency')
      else expect(row[1]).toBe(label)
    })
  })

  test('leaves no cell empty, so no permission reaches a reader unanswered', () => {
    useValidEnvironment('Acme Fleet')

    const { rows } = parseTable(resolveTokens('{{permissionMatrix}}'))

    for (const row of rows) {
      expect(row).toHaveLength(2)
      for (const cell of row) expect(cell).not.toBe('')
    }
  })

  test('renders a table GitHub-flavoured Markdown will parse', () => {
    useValidEnvironment('Acme Fleet')

    const lines = resolveTokens('{{permissionMatrix}}').split('\n')
    const { header } = parseTable(resolveTokens('{{permissionMatrix}}'))

    expect(header).toHaveLength(2)
    expect(lines[1]).toBe('| --- | --- |')
    expect(lines).toHaveLength(Object.keys(PERMISSIONS).length + 2)
  })

  test('replaces every occurrence, and leaves surrounding prose alone', () => {
    useValidEnvironment('Acme Fleet')

    const result = resolveTokens('Before\n\n{{permissionMatrix}}\n\nAfter')

    expect(result).not.toContain('{{')
    expect(result.startsWith('Before\n\n|')).toBe(true)
    expect(result.endsWith('|\n\nAfter')).toBe(true)
  })
})

describe('resolveTokens with awkward app names', () => {
  test('inserts a name containing replacement patterns literally', () => {
    useValidEnvironment("Cars $& Co $1 $'")

    expect(resolveTokens('Welcome to {{productName}}.')).toBe("Welcome to Cars $& Co $1 $'.")
  })
})

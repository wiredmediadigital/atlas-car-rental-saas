// @vitest-environment node
/**
 * The check behind the test gate: every test file that exists must have run.
 *
 * vitest exits 0 when a worker fails to start and the file it was assigned
 * never runs — the summary then counts only the files that did. The comparison
 * that notices is a pure function so it can be tested without making a worker
 * fail on demand.
 */
import { describe, expect, it } from 'vitest'

import {
  findMissingTestFiles,
  isNarrowedRun,
  normalizeTestPath,
  describeMissingFiles,
} from '../../scripts/test-files-ran-lib.mjs'
import { TEST_INCLUDE } from '../../scripts/test-include.mjs'

const ROOT = 'E:/proj'

describe('findMissingTestFiles', () => {
  it('reports nothing when every file that exists was reported as run', () => {
    const files = ['src/a.test.ts', 'src/b.test.tsx']
    expect(findMissingTestFiles(files, files, ROOT)).toEqual([])
  })

  it('reports the one file that did not run', () => {
    const existing = ['src/a.test.ts', 'src/b.test.tsx']
    expect(findMissingTestFiles(existing, ['src/a.test.ts'], ROOT)).toEqual(['src/b.test.tsx'])
  })

  it('reports every file that did not run, sorted', () => {
    const existing = ['src/c.test.ts', 'src/a.test.ts', 'src/b.test.ts']
    expect(findMissingTestFiles(existing, ['src/b.test.ts'], ROOT)).toEqual([
      'src/a.test.ts',
      'src/c.test.ts',
    ])
  })

  it('does not report a file whose path differs only in separator or absolute form', () => {
    const existing = ['src\\lib\\a.test.ts', 'supabase/tests/b.test.ts']
    const ran = ['E:/proj/src/lib/a.test.ts', 'E:\\proj\\supabase\\tests\\b.test.ts']
    expect(findMissingTestFiles(existing, ran, ROOT)).toEqual([])
  })

  it('ignores drive-letter case on a Windows root', () => {
    expect(findMissingTestFiles(['src/a.test.ts'], ['e:/PROJ/src/a.test.ts'], ROOT)).toEqual([])
  })

  it('does not mind files that ran but are not in the existing list', () => {
    expect(
      findMissingTestFiles(['src/a.test.ts'], ['src/a.test.ts', 'src/x.test.ts'], ROOT),
    ).toEqual([])
  })
})

describe('normalizeTestPath', () => {
  it('makes absolute paths root-relative with forward slashes', () => {
    expect(normalizeTestPath('E:\\proj\\src\\a.test.ts', ROOT)).toBe('src/a.test.ts')
    expect(normalizeTestPath('./src/a.test.ts', ROOT)).toBe('src/a.test.ts')
  })
})

describe('isNarrowedRun', () => {
  it('is false for a bare run and for flags that do not choose files', () => {
    expect(isNarrowedRun([])).toBe(false)
    expect(isNarrowedRun(['--reporter=dot', '--silent'])).toBe(false)
  })

  it('is true for a file filter, a shard, or a changed/related selection', () => {
    expect(isNarrowedRun(['src/a.test.ts'])).toBe(true)
    expect(isNarrowedRun(['--shard=1/3'])).toBe(true)
    expect(isNarrowedRun(['--shard', '1/3'])).toBe(true)
    expect(isNarrowedRun(['--changed'])).toBe(true)
    expect(isNarrowedRun(['--related', 'src/a.ts'])).toBe(true)
    expect(isNarrowedRun(['-t', 'name'])).toBe(true)
  })
})

describe('describeMissingFiles', () => {
  it('names every file and says it did not run, not that it failed', () => {
    const text = describeMissingFiles(['src/a.test.ts', 'src/b.test.ts'])
    expect(text).toContain('src/a.test.ts')
    expect(text).toContain('src/b.test.ts')
    expect(text).toMatch(/did not run/i)
    expect(text).toMatch(/worker/i)
  })
})

describe('TEST_INCLUDE', () => {
  it('is the very array vite.config.ts hands to vitest', async () => {
    const { default: config } = await import('../../vite.config.ts')
    const resolved =
      typeof config === 'function' ? config({ mode: 'test', command: 'serve' }) : config
    expect(resolved.test?.include).toBe(TEST_INCLUDE)
  })
})

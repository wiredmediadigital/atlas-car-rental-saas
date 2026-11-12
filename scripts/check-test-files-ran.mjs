/**
 * Fails when a test file that exists did not run.
 *
 * Reads the JSON report vitest wrote (see scripts/run-tests.mjs) and compares
 * it with the files TEST_INCLUDE matches. Exit codes: 0 all ran, 1 some did
 * not, 2 the report is missing or unreadable (the check cannot vouch for the run).
 *
 *   node scripts/check-test-files-ran.mjs
 */
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { globSync } from 'tinyglobby'

import { describeMissingFiles, findMissingTestFiles, RESULTS_FILE } from './test-files-ran-lib.mjs'
import { TEST_INCLUDE } from './test-include.mjs'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))

/** Files on disk that match the include globs, as the root-relative paths vitest would pick up. */
function existingTestFiles() {
  return globSync(TEST_INCLUDE, {
    cwd: ROOT,
    ignore: ['**/node_modules/**', '**/dist/**', '**/.git/**'],
  })
}

/** Files the JSON reporter says it reported on. */
function ranTestFiles(resultsPath) {
  const report = JSON.parse(readFileSync(resultsPath, 'utf8'))
  if (!Array.isArray(report.testResults)) {
    throw new Error('no "testResults" array')
  }
  return report.testResults.map((result) => result.name)
}

export function checkTestFilesRan() {
  const resultsPath = resolve(ROOT, RESULTS_FILE)
  if (!existsSync(resultsPath)) {
    console.error(
      `Test-file check: vitest left no report at ${RESULTS_FILE}, so it cannot tell whether every test file ran.`,
    )
    return 2
  }
  let ran
  try {
    ran = ranTestFiles(resultsPath)
  } catch (error) {
    console.error(`Test-file check: could not read ${RESULTS_FILE} (${error.message}).`)
    return 2
  }
  const existing = existingTestFiles()
  const missing = findMissingTestFiles(existing, ran, ROOT)
  if (missing.length > 0) {
    console.error(`\n${describeMissingFiles(missing)}`)
    return 1
  }
  console.log(`Test-file check: all ${existing.length} test files ran.`)
  return 0
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(checkTestFilesRan())
}

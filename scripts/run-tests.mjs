/**
 * `npm run test` — vitest, then a check that every test file actually ran.
 *
 * vitest exits 0 when a worker fails to start and its test file never runs.
 * This runs vitest with the JSON reporter alongside the default one (human
 * output unchanged), then compares the report with the files on disk.
 *
 * Extra arguments pass straight to vitest. A run that picks a subset of files
 * (a filename, --shard, --changed, ...) is partial by intent, so the check is
 * skipped. If vitest itself fails, its exit code is returned and the check is
 * not run: a failing file is reported by vitest and must not be masked.
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { checkTestFilesRan } from './check-test-files-ran.mjs'
import { isNarrowedRun, RESULTS_FILE } from './test-files-ran-lib.mjs'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))

/**
 * Turns vitest's outcome into this script's exit code. `spawn` runs vitest and
 * returns a spawnSync-style result; `check` is the every-file-ran check. Both
 * are injected so the property that matters most — a non-zero vitest exit is
 * never swallowed — can be tested.
 */
export function runTests({ args, spawn, check, reportError }) {
  const run = spawn(args)
  if (run.error) {
    reportError(`Test run: could not start vitest (${run.error.message}).`)
    return 1
  }
  if (run.status !== 0) return run.status ?? 1
  if (isNarrowedRun(args)) return 0
  return check()
}

function spawnVitest(args) {
  const resultsPath = resolve(ROOT, RESULTS_FILE)
  // A stale report from an earlier run must never satisfy this one.
  rmSync(resultsPath, { force: true })
  mkdirSync(dirname(resultsPath), { recursive: true })
  return spawnSync(
    process.execPath,
    [
      resolve(ROOT, 'node_modules/vitest/vitest.mjs'),
      'run',
      '--reporter=default',
      '--reporter=json',
      `--outputFile.json=${resultsPath}`,
      ...args,
    ],
    { cwd: ROOT, stdio: 'inherit' },
  )
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(
    runTests({
      args: process.argv.slice(2),
      spawn: spawnVitest,
      check: checkTestFilesRan,
      reportError: (message) => console.error(message),
    }),
  )
}

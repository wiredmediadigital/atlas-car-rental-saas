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
const extraArgs = process.argv.slice(2)
const resultsPath = resolve(ROOT, RESULTS_FILE)

// A stale report from an earlier run must never satisfy this one.
rmSync(resultsPath, { force: true })
mkdirSync(dirname(resultsPath), { recursive: true })

const vitestBin = resolve(ROOT, 'node_modules/vitest/vitest.mjs')
const run = spawnSync(
  process.execPath,
  [
    vitestBin,
    'run',
    '--reporter=default',
    '--reporter=json',
    `--outputFile.json=${resultsPath}`,
    ...extraArgs,
  ],
  { cwd: ROOT, stdio: 'inherit' },
)

if (run.status !== 0) process.exit(run.status ?? 1)
if (isNarrowedRun(extraArgs)) process.exit(0)
process.exit(checkTestFilesRan())

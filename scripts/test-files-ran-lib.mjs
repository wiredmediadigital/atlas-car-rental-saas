/**
 * The decisions behind the "every test file ran" gate check, free of file and
 * process access so they can be tested. scripts/check-test-files-ran.mjs
 * gathers the facts; this module says what they mean.
 *
 * Why it exists: when a vitest worker fails to start (memory pressure), the
 * file it was assigned never runs and vitest still exits 0.
 */

/** Where the JSON reporter writes, relative to the repository root. Git-ignored. */
export const RESULTS_FILE = '.vitest-report/results.json'

/** True when the root is a Windows path, whose file system ignores case. */
function isWindowsPath(path) {
  return /^[a-zA-Z]:[\\/]/.test(path)
}

/**
 * A path as a root-relative, forward-slash string, so a glob result
 * (`src\a.test.ts` or `src/a.test.ts`) and the reporter's absolute path
 * (`E:/proj/src/a.test.ts` or `E:\proj\src\a.test.ts`) compare equal.
 */
export function normalizeTestPath(path, root) {
  let value = String(path).replaceAll('\\', '/')
  const base = String(root).replaceAll('\\', '/').replace(/\/+$/, '')
  const windows = isWindowsPath(root)
  const startsWithBase = windows
    ? value.toLowerCase().startsWith(`${base.toLowerCase()}/`)
    : value.startsWith(`${base}/`)
  if (startsWithBase) value = value.slice(base.length + 1)
  return value.replace(/^(\.\/)+/, '')
}

/**
 * The files that exist but are absent from what the reporter says ran, sorted,
 * in the spelling the caller passed them in.
 *
 * Presence is the test, not outcome: a file that ran and failed, has no tests,
 * or is entirely skipped still appears in the reporter's results, and vitest's
 * own exit code already speaks for it.
 */
export function findMissingTestFiles(existingFiles, ranFiles, root) {
  const windows = isWindowsPath(root)
  const key = (path) => {
    const normal = normalizeTestPath(path, root)
    return windows ? normal.toLowerCase() : normal
  }
  const ran = new Set(ranFiles.map(key))
  return existingFiles.filter((file) => !ran.has(key(file))).sort()
}

const NARROWING_FLAGS = [
  '--shard',
  '--changed',
  '--related',
  '--dir',
  '--project',
  '--exclude',
  '--testNamePattern',
  '-t',
  '--bail',
  '--root',
  '--config',
  '--typecheck',
]

/**
 * True when the arguments choose a subset of files, so a partial run is
 * legitimate. Errs toward true: a positional argument may be a file filter or
 * the value of a flag, and either way skipping the check cannot cause a false
 * failure.
 */
export function isNarrowedRun(args) {
  return args.some(
    (arg) =>
      !arg.startsWith('-') ||
      NARROWING_FLAGS.some((flag) => arg === flag || arg.startsWith(`${flag}=`)),
  )
}

/** The failure message: names each file and says it did not run. */
export function describeMissingFiles(missing) {
  const noun = missing.length === 1 ? 'test file' : 'test files'
  return [
    `${missing.length} ${noun} did not run, so the gate cannot call this a pass:`,
    ...missing.map((file) => `  - ${file}`),
    '',
    'This is not a test failure. vitest never reported on these files, which is',
    'usually a worker that failed to start under memory pressure ("Failed to start',
    'forks worker" / "Timeout waiting for worker to respond") — vitest still exits 0',
    'when that happens. Re-run `npm run test`; if the same file keeps going missing,',
    'it is too heavy to start alongside the others.',
  ].join('\n')
}

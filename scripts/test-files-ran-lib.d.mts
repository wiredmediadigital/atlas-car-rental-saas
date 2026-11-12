/** Types for the "every test file ran" check; see test-files-ran-lib.mjs. */

export declare const RESULTS_FILE: string
export declare function normalizeTestPath(path: string, root: string): string
export declare function findMissingTestFiles(
  existingFiles: readonly string[],
  ranFiles: readonly string[],
  root: string,
): string[]
export declare function isNarrowedRun(args: readonly string[]): boolean
export declare function describeMissingFiles(missing: readonly string[]): string

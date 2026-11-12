/**
 * Which files are test files. The single source of truth: vite.config.ts hands
 * it to vitest as `test.include`, and scripts/check-test-files-ran.mjs globs it
 * to find the files that should have run. If the two ever disagreed the check
 * would pass in exactly the case it exists for.
 */
export const TEST_INCLUDE = [
  'src/**/*.{test,spec}.{ts,tsx}',
  'supabase/tests/**/*.test.ts',
  'supabase/functions/tests/**/*.test.ts',
]

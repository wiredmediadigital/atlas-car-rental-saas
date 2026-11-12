export interface SpawnResult {
  status: number | null
  error?: Error
}

export interface RunTestsDeps {
  args: readonly string[]
  spawn: (args: readonly string[]) => SpawnResult
  check: () => number
  reportError: (message: string) => void
}

/** The exit code `npm run test` should finish with. */
export declare function runTests(deps: RunTestsDeps): number

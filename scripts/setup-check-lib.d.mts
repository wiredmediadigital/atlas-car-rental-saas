/**
 * Types for the setup checklist's decision logic.
 *
 * Hand-written because `scripts/` is plain ESM run by node and is outside every
 * tsconfig — but the logic is worth testing, and a test needs a shape to check.
 */

export declare const ORIGINAL_ATLAS_REPOSITORY: string
export declare const GIT_PUSH_WARNING_BELOW: string
export declare const SECOND_FACTOR_MIGRATION: string
export declare const TOTP_CONFIRMATION_VARIABLE: string

export type KeyKind = 'missing' | 'publishable' | 'legacy-anon' | 'secret' | 'unknown'

export interface Remote {
  name: string
  fetch: string
  push: string
}

export interface SetupFacts {
  nodeVersion: string
  requiredNode: string
  gitVersion: string | null
  dependenciesInstalled: boolean
  env: Record<string, string> | null
  linkedRef: string | null
  migrationCount: number
  latestMigration: string | null
  hasSecondFactorMigration: boolean
  isGitRepository: boolean
  envIgnored: boolean | null
  remotes: Remote[]
}

export interface CheckResult {
  id: string
  status: 'ok' | 'warn' | 'fail'
  message: string
}

export declare function parseEnvFile(text: string): Record<string, string>
export declare function classifyKey(value: string | undefined): KeyKind
export declare function projectRefFromUrl(value: string | undefined): string | null
export declare function compareVersions(a: string, b: string): -1 | 0 | 1
export declare function isOriginalAtlasRemote(url: string | undefined): boolean
export declare function evaluate(facts: SetupFacts): CheckResult[]
export declare function isReady(results: readonly CheckResult[]): boolean

export interface ApiKeyEntry {
  name?: string
  type?: string
  api_key?: string
}

export declare function pickBrowserKey(
  apiKeys: unknown,
): { kind: 'publishable' | 'legacy-anon'; value: string } | null
export declare function envFileContents(projectRef: string, key: string): string
export declare const MANAGED_ENV_KEYS: readonly string[]
export declare function mergeEnvFileContents(
  existing: string | null | undefined,
  projectRef: string,
  key: string,
): string

export declare const SITE_ROUTES: readonly string[]

export interface SiteFacts {
  origin: string
  expectedRef: string | null
  rootStatus: number | null
  hsts: boolean
  routes: { path: string; status: number | null; html: boolean }[]
  bundleFiles: number
  refs: string[]
  keyFound: boolean | null
  secretFound: boolean
  /** Edge Function directories in this folder; the check is skipped when absent. */
  localFunctions?: readonly string[]
  /** Functions on the linked project, or null when that could not be read. */
  deployedFunctions?: readonly DeployedFunction[] | null
}

export interface DeployedFunction {
  slug: string
  status: string | undefined
}

export declare const NON_FUNCTION_DIRECTORIES: readonly string[]
export declare function localFunctionSlugs(directoryNames: Iterable<string>): string[]
export declare function parseDeployedFunctions(
  text: string | null | undefined,
): DeployedFunction[] | null
export declare function evaluateFunctions(
  facts: Pick<SiteFacts, 'localFunctions' | 'deployedFunctions'>,
): CheckResult[]

export declare function siteOrigin(value: string | undefined): string | null
export declare function bundleAssetUrls(html: string, origin: string): string[]
export declare function supabaseRefsIn(text: string): string[]
export declare function containsSecretKey(text: string): boolean
export declare function evaluateSite(facts: SiteFacts): CheckResult[]

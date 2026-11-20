export const STAGING_PROJECT: string
export const PRODUCTION_PROJECT: string
export const STAGING_URL: string
export const STAGING_BUILD_INTENT: string
export function validateStagingEnvironment(env: Record<string, string | undefined>): string[]
export function verifyStagingArtifact(root: string, expectedPublishableKey: string): {
  errors: string[]
  contentSha256: string
  fileCount: number
}

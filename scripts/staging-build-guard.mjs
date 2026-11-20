import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'

export const STAGING_PROJECT = 'yeklucfthspvejlkffln'
export const PRODUCTION_PROJECT = 'ysnumxtzcgzyabrghxwq'
export const STAGING_URL = `https://${STAGING_PROJECT}.supabase.co`
export const STAGING_BUILD_INTENT = 'approved-local-build'

function privilegedJwt(value) {
  const segments = value.split('.')
  if (segments.length !== 3) return false
  try {
    const payload = JSON.parse(Buffer.from(segments[1], 'base64url').toString('utf8'))
    return payload?.role === 'service_role'
  } catch {
    return false
  }
}

/** Validate only the effective process environment. Staging Vite mode reads no .env files. */
export function validateStagingEnvironment(env) {
  const errors = []
  if (env.PEVVY_STAGING_BUILD_INTENT !== STAGING_BUILD_INTENT)
    errors.push('explicit-intent-required')

  const url = env.VITE_SUPABASE_URL ?? ''
  try {
    const parsed = new URL(url)
    if (parsed.href !== `${STAGING_URL}/`) errors.push('approved-staging-url-required')
  } catch {
    errors.push('approved-staging-url-required')
  }

  const key = env.VITE_SUPABASE_PUBLISHABLE_KEY ?? ''
  if (!key.startsWith('sb_publishable_') || key.length <= 'sb_publishable_'.length) {
    errors.push('browser-publishable-key-required')
  }
  if (env.VITE_SUPABASE_ANON_KEY) errors.push('legacy-key-conflict')

  for (const [name, value] of Object.entries(env)) {
    if (!name.startsWith('VITE_') || !value) continue
    if (value.includes(PRODUCTION_PROJECT)) errors.push('production-reference-in-browser-config')
    if (value.includes('sb_secret_') || privilegedJwt(value)) errors.push('privileged-browser-key')
    if (
      name.startsWith('VITE_SUPABASE_') &&
      !['VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY', 'VITE_SUPABASE_ANON_KEY'].includes(
        name,
      )
    ) {
      errors.push('unknown-supabase-browser-variable')
    }
  }
  return [...new Set(errors)]
}

function filesUnder(root, dir = root) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    return entry.isDirectory() ? filesUnder(root, path) : [path]
  })
}

/** Return only nonsecret, deterministic evidence about a freshly built staging bundle. */
export function verifyStagingArtifact(root, expectedPublishableKey) {
  const paths = filesUnder(root).filter((path) => !path.endsWith('staging-build-manifest.json'))
  const errors = []
  if (!paths.some((path) => relative(root, path).replaceAll('\\', '/') === 'index.html')) {
    errors.push('missing-index')
  }
  const digest = createHash('sha256')
  let stagingFound = false
  let expectedKeyFound = false
  for (const path of paths.sort()) {
    const contents = readFileSync(path)
    const text = contents.toString('utf8')
    digest.update(relative(root, path).replaceAll('\\', '/'))
    digest.update(contents)
    if (text.includes(STAGING_PROJECT)) stagingFound = true
    if (text.includes(expectedPublishableKey)) expectedKeyFound = true
    if (text.includes(PRODUCTION_PROJECT)) errors.push('production-reference-in-artifact')
    // The source intentionally contains the literal prefix in a rejection message.
    if (/sb_secret_[A-Za-z0-9_-]{12,}/.test(text)) errors.push('privileged-key-in-artifact')
    for (const candidate of text.match(/sb_publishable_[A-Za-z0-9_-]{12,}/g) ?? []) {
      if (candidate !== expectedPublishableKey) errors.push('unexpected-publishable-key')
    }
    for (const candidate of text.match(
      /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/g,
    ) ?? []) {
      if (privilegedJwt(candidate)) errors.push('privileged-key-in-artifact')
    }
  }
  if (!stagingFound) errors.push('staging-reference-missing')
  if (!expectedKeyFound) errors.push('expected-publishable-key-missing')
  return {
    errors: [...new Set(errors)],
    contentSha256: digest.digest('hex'),
    fileCount: paths.length,
  }
}

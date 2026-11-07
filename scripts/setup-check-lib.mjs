/**
 * The decisions behind `npm run setup:check`, kept free of file and process
 * access so they can be tested. scripts/setup-check.mjs gathers the facts; this
 * module says what they mean.
 *
 * Nothing here ever returns a key's value — only what kind of key it is.
 */

/** The repository Atlas is published from. Setups must never push back to it. */
export const ORIGINAL_ATLAS_REPOSITORY = 'salhiworks/atlas-car-rental-saas'

/**
 * Git releases older than this have been seen to fail a first HTTPS push of this
 * repository with "RPC failed; HTTP 400". It is a warning, not a requirement:
 * many older clients push fine, and the fix is a one-off flag.
 */
export const GIT_PUSH_WARNING_BELOW = '2.30.0'

/** Reads KEY=value lines, ignoring comments and blank lines. */
export function parseEnvFile(text) {
  const values = {}
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const index = line.indexOf('=')
    if (index <= 0) continue
    const name = line.slice(0, index).trim()
    let value = line.slice(index + 1).trim()
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1)
    }
    values[name] = value
  }
  return values
}

function jwtRole(token) {
  const segments = token.split('.')
  if (segments.length !== 3 || !segments[1]) return null
  try {
    const json = Buffer.from(
      segments[1].replaceAll('-', '+').replaceAll('_', '/'),
      'base64',
    ).toString('utf8')
    const payload = JSON.parse(json)
    return typeof payload?.role === 'string' ? payload.role : null
  } catch {
    return null
  }
}

/** What kind of Supabase key a value is, without exposing the value. */
export function classifyKey(value) {
  const key = String(value ?? '').trim()
  if (!key) return 'missing'
  if (key.startsWith('sb_secret_')) return 'secret'
  if (key.startsWith('sb_publishable_')) return 'publishable'
  const role = jwtRole(key)
  if (role === 'service_role') return 'secret'
  if (role === 'anon') return 'legacy-anon'
  return 'unknown'
}

/** The project ref in https://<ref>.supabase.co, or null. */
export function projectRefFromUrl(value) {
  try {
    const url = new URL(String(value ?? '').trim())
    if (url.protocol !== 'https:') return null
    const match = /^([a-z0-9]{20})\.supabase\.co$/.exec(url.hostname)
    return match ? match[1] : null
  } catch {
    return null
  }
}

/** Compares dotted versions numerically; returns -1, 0 or 1. */
export function compareVersions(a, b) {
  const left = String(a)
    .replace(/^v/, '')
    .split('.')
    .map((part) => parseInt(part, 10) || 0)
  const right = String(b)
    .replace(/^v/, '')
    .split('.')
    .map((part) => parseInt(part, 10) || 0)
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0)
    if (difference !== 0) return difference < 0 ? -1 : 1
  }
  return 0
}

/** True for any GitHub URL form of the original Atlas repository. */
export function isOriginalAtlasRemote(url) {
  const normalised = String(url ?? '')
    .trim()
    .toLowerCase()
    .replace(/\.git$/, '')
  return (
    normalised.endsWith(`github.com/${ORIGINAL_ATLAS_REPOSITORY}`) ||
    normalised.endsWith(`github.com:${ORIGINAL_ATLAS_REPOSITORY}`)
  )
}

/**
 * Turns gathered facts into a checklist.
 *
 * Each result is { id, status: 'ok' | 'warn' | 'fail', message }. A `fail`
 * blocks the next setup step; a `warn` is something Claude explains or fixes
 * at the stage it belongs to.
 */
export function evaluate(facts) {
  const results = []
  const add = (id, status, message) => results.push({ id, status, message })

  // Tools ---------------------------------------------------------------------
  if (compareVersions(facts.nodeVersion, facts.requiredNode) >= 0) {
    add('node', 'ok', `Node.js ${facts.nodeVersion}`)
  } else {
    add(
      'node',
      'fail',
      `Node.js ${facts.nodeVersion} is too old. Install the current LTS (${facts.requiredNode} or newer).`,
    )
  }

  if (!facts.gitVersion) {
    add('git', 'warn', 'Git was not found. It is needed before publishing to GitHub.')
  } else if (compareVersions(facts.gitVersion, GIT_PUSH_WARNING_BELOW) < 0) {
    add(
      'git',
      'warn',
      `Git ${facts.gitVersion} is old. If the first push fails with "HTTP 400", retry it once with -c http.postBuffer=157286400, or update Git.`,
    )
  } else {
    add('git', 'ok', `Git ${facts.gitVersion}`)
  }

  add(
    'dependencies',
    facts.dependenciesInstalled ? 'ok' : 'fail',
    facts.dependenciesInstalled
      ? 'Dependencies installed'
      : 'Dependencies are not installed yet (npm ci).',
  )

  // Frontend configuration ----------------------------------------------------
  const env = facts.env
  let urlRef = null
  if (!env) {
    add(
      'env-file',
      'warn',
      '.env.local does not exist yet. Setup writes it once a Supabase project is connected (npm run setup:env).',
    )
  } else {
    add('env-file', 'ok', '.env.local exists')

    urlRef = projectRefFromUrl(env.VITE_SUPABASE_URL)
    if (!env.VITE_SUPABASE_URL) {
      add('supabase-url', 'fail', 'VITE_SUPABASE_URL is empty.')
    } else if (!urlRef) {
      add(
        'supabase-url',
        'fail',
        'VITE_SUPABASE_URL is not an https://<project-ref>.supabase.co address.',
      )
    } else {
      add('supabase-url', 'ok', `VITE_SUPABASE_URL points at project ${urlRef}`)
    }

    const current = classifyKey(env.VITE_SUPABASE_PUBLISHABLE_KEY)
    const legacy = classifyKey(env.VITE_SUPABASE_ANON_KEY)
    if (current === 'secret' || legacy === 'secret') {
      const name = current === 'secret' ? 'VITE_SUPABASE_PUBLISHABLE_KEY' : 'VITE_SUPABASE_ANON_KEY'
      add(
        'supabase-key',
        'fail',
        `${name} holds a SECRET key. Replace it with the publishable key — secrets must never be in a VITE_ variable.`,
      )
    } else if (current === 'publishable') {
      add('supabase-key', 'ok', 'VITE_SUPABASE_PUBLISHABLE_KEY is a publishable key')
    } else if (current === 'missing' && (legacy === 'publishable' || legacy === 'legacy-anon')) {
      add(
        'supabase-key',
        'ok',
        'Key set under the older VITE_SUPABASE_ANON_KEY name (works; VITE_SUPABASE_PUBLISHABLE_KEY is preferred)',
      )
    } else if (current === 'missing' && legacy === 'missing') {
      add('supabase-key', 'fail', 'VITE_SUPABASE_PUBLISHABLE_KEY is empty.')
    } else {
      add(
        'supabase-key',
        'warn',
        'The Supabase key is not a recognised publishable key. Check it was copied from Project Settings -> API Keys.',
      )
    }
  }

  // Supabase link -------------------------------------------------------------
  if (!facts.linkedRef) {
    add('supabase-link', 'warn', 'This folder is not linked to a Supabase project yet.')
  } else if (urlRef && facts.linkedRef !== urlRef) {
    add(
      'supabase-link',
      'fail',
      `Mismatch: the Supabase CLI is linked to ${facts.linkedRef} but .env.local points at ${urlRef}. Stop and confirm which project is yours before any remote command.`,
    )
  } else {
    add('supabase-link', 'ok', `Supabase CLI linked to ${facts.linkedRef}`)
  }

  add(
    'migrations',
    'ok',
    `${facts.migrationCount} migrations in supabase/migrations (latest ${facts.latestMigration ?? 'none'})`,
  )

  // Repository ----------------------------------------------------------------
  if (!facts.isGitRepository) {
    add(
      'repository',
      'warn',
      'Not a Git repository (downloaded as a ZIP). It will be initialised at the GitHub step.',
    )
  } else {
    if (facts.envIgnored === false) {
      add('env-ignored', 'fail', '.env.local is NOT ignored by Git. It must never be committed.')
    } else {
      add('env-ignored', 'ok', '.env.local is ignored by Git')
    }
    const pushable = (facts.remotes ?? []).filter((remote) => isOriginalAtlasRemote(remote.push))
    if (pushable.length > 0) {
      add(
        'repository',
        'warn',
        `Remote "${pushable.map((remote) => remote.name).join('", "')}" can push to the original Atlas repository. Rename it to upstream and disable its push URL before publishing.`,
      )
    } else {
      add('repository', 'ok', 'No remote can push to the original Atlas repository')
    }
  }

  return results
}

/**
 * Picks the key a browser may hold from `supabase projects api-keys -o json`.
 *
 * Prefers the publishable key, falls back to the legacy anon key, and never
 * returns a secret or service_role key. Returns null when there is nothing
 * safe to use.
 */
export function pickBrowserKey(apiKeys) {
  const list = Array.isArray(apiKeys) ? apiKeys : []
  const safe = list.filter((entry) => {
    const kind = classifyKey(entry?.api_key)
    return kind === 'publishable' || kind === 'legacy-anon'
  })
  const chosen =
    safe.find((entry) => entry.type === 'publishable') ??
    safe.find((entry) => classifyKey(entry.api_key) === 'publishable') ??
    safe.find((entry) => entry.name === 'anon') ??
    null
  return chosen ? { kind: classifyKey(chosen.api_key), value: chosen.api_key } : null
}

/** The two lines of a fresh .env.local. */
export function envFileContents(projectRef, key) {
  return [
    '# Written by the Atlas setup. Both values are public by design.',
    `VITE_SUPABASE_URL=https://${projectRef}.supabase.co`,
    `VITE_SUPABASE_PUBLISHABLE_KEY=${key}`,
    '',
  ].join('\n')
}

/** True when nothing failed. */
export function isReady(results) {
  return results.every((result) => result.status !== 'fail')
}

// Live site ---------------------------------------------------------------------
//
// The decisions behind `npm run setup:site`, which checks a deployed Atlas after
// the Hostinger build. Like the rest of this module it never returns a key's
// value.

/** Paths a deployed Atlas must serve: sign-up, the four Auth redirects, and a deep link. */
export const SITE_ROUTES = [
  '/',
  '/sign-up',
  '/auth/callback',
  '/confirm-email',
  '/accept-invite',
  '/auth/reset-password',
  '/settings',
  '/help',
]

function isLocalHost(hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
}

/**
 * The origin of a site address as a user pastes it ("my-site.com",
 * "https://my-site.com/settings"), or null. Only https is accepted, except for
 * a local address used to rehearse the check against `npm run preview`.
 */
export function siteOrigin(value) {
  const text = String(value ?? '').trim()
  if (!text) return null
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`)
    if (url.protocol === 'https:') return url.origin
    if (url.protocol === 'http:' && isLocalHost(url.hostname)) return url.origin
    return null
  } catch {
    return null
  }
}

/** Same-origin module scripts and modulepreloads named in index.html. */
export function bundleAssetUrls(html, origin) {
  const urls = new Set()
  const tags = String(html ?? '').match(/<(script|link)\b[^>]*>/gi) ?? []
  for (const tag of tags) {
    const isScript = /^<script/i.test(tag)
    if (!isScript && !/\brel=["']?modulepreload/i.test(tag)) continue
    const match = (isScript ? /\bsrc=["']([^"']+)["']/i : /\bhref=["']([^"']+)["']/i).exec(tag)
    if (!match) continue
    try {
      const url = new URL(match[1], origin)
      if (url.origin === origin) urls.add(url.toString())
    } catch {
      // Not a URL; ignore it.
    }
  }
  return [...urls]
}

/** Every Supabase project ref a bundle points at. */
export function supabaseRefsIn(text) {
  const refs = new Set()
  for (const match of String(text ?? '').matchAll(/https:\/\/([a-z0-9]{20})\.supabase\.co/g)) {
    refs.add(match[1])
  }
  return [...refs]
}

/** True when a bundle contains something that must never reach a browser. */
export function containsSecretKey(text) {
  const source = String(text ?? '')
  if (/sb_secret_[A-Za-z0-9_-]{8,}/.test(source)) return true
  for (const match of source.matchAll(/eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g)) {
    if (classifyKey(match[0]) === 'secret') return true
  }
  return false
}

/**
 * Turns what was fetched from a deployed site into a checklist, in the same
 * { id, status, message } shape as `evaluate`.
 *
 * facts: { origin, expectedRef, rootStatus, hsts, routes: [{ path, status, html }],
 *          bundleFiles, refs, keyFound (boolean | null), secretFound }
 */
export function evaluateSite(facts) {
  const results = []
  const add = (id, status, message) => results.push({ id, status, message })
  const local = isLocalHost(new URL(facts.origin).hostname)

  if (facts.rootStatus !== 200) {
    add(
      'reachable',
      'fail',
      `${facts.origin} answered ${facts.rootStatus ?? 'nothing'}. The deploy may still be running, or the address is wrong.`,
    )
    return results
  }
  add('reachable', 'ok', `${facts.origin} is online`)

  if (local) {
    add('https', 'ok', 'Local rehearsal (HTTPS is checked on the live address)')
  } else if (facts.hsts) {
    add('https', 'ok', 'Served over HTTPS with Atlas security headers')
  } else {
    add(
      'https',
      'warn',
      'No Strict-Transport-Security header. public/.htaccess may not be in the deployed build — check the output directory is dist.',
    )
  }

  const broken = (facts.routes ?? []).filter((route) => route.status !== 200 || !route.html)
  if (broken.length > 0) {
    add(
      'routes',
      'fail',
      `These pages do not load: ${broken.map((route) => `${route.path} (${route.status ?? 'no answer'})`).join(', ')}. The output directory must be dist, so that .htaccess sends every page to the app.`,
    )
  } else {
    add(
      'routes',
      'ok',
      `Sign-up, the four sign-in links and deep links all load (${facts.routes.length} pages)`,
    )
  }

  if (!facts.bundleFiles) {
    add('config', 'fail', 'The page does not load the Atlas application script.')
    return results
  }

  const refs = facts.refs ?? []
  if (refs.length === 0) {
    add(
      'config',
      'fail',
      'The build has no Supabase address. VITE_SUPABASE_URL was missing when Hostinger built it — add it and redeploy.',
    )
  } else if (refs.length > 1 || (facts.expectedRef && refs[0] !== facts.expectedRef)) {
    add(
      'config',
      'fail',
      `The build points at ${refs.join(', ')}, not ${facts.expectedRef ?? 'the confirmed project'}. Fix VITE_SUPABASE_URL in Hostinger and redeploy.`,
    )
  } else {
    add('config', 'ok', `The build uses Supabase project ${refs[0]}`)
  }

  if (facts.secretFound) {
    add(
      'key',
      'fail',
      'The build contains a SECRET key. Replace it with the publishable key in Hostinger, redeploy, and rotate the secret key in Supabase.',
    )
  } else if (facts.keyFound === false) {
    add(
      'key',
      'fail',
      'The build does not contain the publishable key from .env.local. Fix VITE_SUPABASE_PUBLISHABLE_KEY in Hostinger and redeploy.',
    )
  } else if (facts.keyFound === null) {
    add(
      'key',
      'warn',
      'No .env.local to compare the key with; only checked that no secret key is present.',
    )
  } else {
    add('key', 'ok', 'The build uses the publishable key, and no secret key')
  }

  return results
}

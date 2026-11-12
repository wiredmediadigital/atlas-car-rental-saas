/**
 * `npm run setup:site -- <address>` — checks a deployed Atlas, read-only.
 *
 * Used by the atlas-setup skill once Hostinger has built the site. It fetches
 * public pages only: the home page, sign-up, the four Auth redirect pages and a
 * deep link, then the application script, and says whether the build points at
 * this folder's Supabase project with its publishable key. It changes nothing
 * and never prints a key. It also checks that every Edge Function in
 * supabase/functions/ is deployed and ACTIVE on the linked project (a warning,
 * not a failure, when that cannot be read).
 *
 *   npm run setup:site -- my-site.hostingersite.com
 *   npm run setup:site -- https://my-site.com --json
 *
 * Exits 1 when something is wrong with the deployment.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'

import {
  SITE_ROUTES,
  bundleAssetUrls,
  containsSecretKey,
  evaluateSite,
  isReady,
  localFunctionSlugs,
  parseDeployedFunctions,
  parseEnvFile,
  projectRefFromUrl,
  siteOrigin,
  supabaseRefsIn,
} from './setup-check-lib.mjs'

const input = process.argv.slice(2).find((arg) => !arg.startsWith('--'))
const origin = siteOrigin(input)
if (!origin) {
  console.error('Usage: npm run setup:site -- <your site address, e.g. my-site.hostingersite.com>')
  process.exit(1)
}

const env = existsSync('.env.local') ? parseEnvFile(readFileSync('.env.local', 'utf8')) : {}
const linkedRef = existsSync('supabase/.temp/project-ref')
  ? readFileSync('supabase/.temp/project-ref', 'utf8').trim() || null
  : null
const expectedRef = linkedRef ?? projectRefFromUrl(env.VITE_SUPABASE_URL)
const expectedKey = env.VITE_SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_ANON_KEY || null

async function get(url) {
  try {
    const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(20_000) })
    return { status: response.status, headers: response.headers, body: await response.text() }
  } catch {
    return { status: null, headers: new Headers(), body: '' }
  }
}

/** Edge Functions deployed to the linked project, or null when that cannot be read. */
function deployedFunctions() {
  if (!linkedRef) return null
  try {
    // A single fixed command string: on Windows npx is a .cmd file and needs a shell.
    const run = spawnSync('npx supabase functions list', {
      encoding: 'utf8',
      timeout: 30_000,
      shell: true,
    })
    return run.status === 0 ? parseDeployedFunctions(run.stdout) : null
  } catch {
    return null
  }
}

const localFunctions = existsSync('supabase/functions')
  ? localFunctionSlugs(
      readdirSync('supabase/functions', { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name),
    )
  : []

const root = await get(`${origin}/`)
const assets = root.status === 200 ? bundleAssetUrls(root.body, origin) : []
// A page "loads" when it is the Atlas index.html — the one naming the same script.
const marker = assets[0] ? new URL(assets[0]).pathname : null

const routes = []
for (const path of SITE_ROUTES) {
  const page = path === '/' ? root : await get(`${origin}${path}`)
  routes.push({
    path,
    status: page.status,
    html: Boolean(marker) && page.body.includes(marker),
  })
}

let bundle = ''
for (const url of assets) {
  const file = await get(url)
  if (file.status === 200) bundle += `\n${file.body}`
}

const results = evaluateSite({
  origin,
  expectedRef,
  rootStatus: root.status,
  hsts: root.headers.has('strict-transport-security'),
  routes,
  bundleFiles: assets.length,
  refs: supabaseRefsIn(bundle),
  keyFound: expectedKey ? bundle.includes(expectedKey) : null,
  secretFound: containsSecretKey(bundle),
  localFunctions,
  deployedFunctions: localFunctions.length > 0 ? deployedFunctions() : null,
})

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ ready: isReady(results), results }, null, 2))
} else {
  const mark = { ok: '✓', warn: '!', fail: '✗' }
  console.log(`Atlas live site check — ${origin}\n`)
  for (const result of results) console.log(`  ${mark[result.status]} ${result.message}`)
  console.log(
    isReady(results)
      ? '\nThe deployed site is ready for its Auth settings.'
      : '\nSomething above (✗) must be fixed in Hostinger before going on.',
  )
}

process.exitCode = isReady(results) ? 0 : 1

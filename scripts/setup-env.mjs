/**
 * `npm run setup:env -- <project-ref>` — writes .env.local for that project.
 *
 * Fetches the project's API keys with the Supabase CLI (the user must already
 * be signed in), keeps only the browser-safe one and writes the two values the
 * app needs. The output names the kind of key used and nothing else: the CLI's
 * response also contains the project's secret keys, and those must not reach a
 * terminal, a log or a chat transcript.
 *
 * An existing .env.local is updated, not replaced: only the two values this script
 * owns are written, and every other key (such as SUPABASE_TOTP_ENABLED_FOR, which
 * the setup records before this runs) survives with its value. It refuses to
 * change a value that is already there and differs unless `--force` is given.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

import { mergeEnvFileContents, parseEnvFile, pickBrowserKey } from './setup-check-lib.mjs'

const projectRef = process.argv.slice(2).find((argument) => !argument.startsWith('--'))
const force = process.argv.includes('--force')

function fail(message) {
  console.error(message)
  process.exit(1)
}

if (!projectRef || !/^[a-z0-9]{20}$/.test(projectRef)) {
  fail(
    'Usage: npm run setup:env -- <project-ref>   (the 20-character ref of your Supabase project)',
  )
}
const existing = existsSync('.env.local') ? readFileSync('.env.local', 'utf8') : ''

let output
try {
  output = execFileSync(
    'npx',
    ['supabase', 'projects', 'api-keys', '--project-ref', projectRef, '-o', 'json'],
    {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
} catch (error) {
  // stderr carries the CLI's own explanation (not signed in, no access, ...);
  // stdout is not echoed because it may hold keys.
  fail(
    `Could not read the project's API keys: ${String(error?.stderr ?? error?.message ?? error)
      .trim()
      .slice(0, 300)}`,
  )
}

let keys
try {
  keys = JSON.parse(output.slice(output.search(/[[{]/)))
} catch {
  fail('The Supabase CLI returned something that is not JSON. Update it with npm ci and try again.')
}

const chosen = pickBrowserKey(Array.isArray(keys) ? keys : keys?.keys)
if (!chosen) fail('No publishable or anon key was found for that project.')

const current = parseEnvFile(existing)
const expected = {
  VITE_SUPABASE_URL: `https://${projectRef}.supabase.co`,
  VITE_SUPABASE_PUBLISHABLE_KEY: chosen.value,
}
const wouldChange = Object.keys(expected).filter(
  (name) => current[name] !== undefined && current[name] !== expected[name],
)
if (wouldChange.length > 0 && !force) {
  fail(
    `.env.local already holds different values for ${wouldChange.join(', ')}. Re-run with --force to replace them; other keys are kept.`,
  )
}

writeFileSync('.env.local', mergeEnvFileContents(existing, projectRef, chosen.value), {
  mode: 0o600,
})
console.log(
  `Wrote .env.local for project ${projectRef} using its ${chosen.kind === 'publishable' ? 'publishable' : 'legacy anon'} key.`,
)

/**
 * `npm run setup:check` — where this Atlas folder stands, read-only.
 *
 * Used by the atlas-setup skill as the checkpoint between stages, and safe to
 * run at any time: it reads local files and asks Git for its version and
 * remotes. It changes nothing, contacts no server, and never prints a key —
 * only what kind of key is configured.
 *
 *   npm run setup:check            human-readable checklist
 *   npm run setup:check -- --json  the same results as JSON
 *
 * Exits 1 when something blocks the next step.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'

import { SECOND_FACTOR_MIGRATION, evaluate, isReady, parseEnvFile } from './setup-check-lib.mjs'

function git(args) {
  try {
    return execFileSync('git', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return null
  }
}

function gitIgnores(path) {
  try {
    execFileSync('git', ['check-ignore', '-q', path], { stdio: 'ignore' })
    return true
  } catch (error) {
    // Exit status 1 means "not ignored"; anything else means Git could not say.
    return error?.status === 1 ? false : null
  }
}

function remotes() {
  const output = git(['remote', '-v'])
  if (!output) return []
  const byName = new Map()
  for (const line of output.split('\n')) {
    const match = /^(\S+)\s+(\S+)\s+\((fetch|push)\)$/.exec(line.trim())
    if (!match) continue
    const [, name, url, kind] = match
    const entry = byName.get(name) ?? { name, fetch: '', push: '' }
    entry[kind] = url
    byName.set(name, entry)
  }
  return [...byName.values()]
}

const packageJson = JSON.parse(readFileSync('package.json', 'utf8'))
const migrations = existsSync('supabase/migrations')
  ? readdirSync('supabase/migrations')
      .filter((file) => file.endsWith('.sql'))
      .sort()
  : []
const isGitRepository = existsSync('.git')

const facts = {
  nodeVersion: process.versions.node,
  requiredNode: String(packageJson.engines?.node ?? '0').replace(/[^0-9.]/g, ''),
  gitVersion: git(['--version'])?.match(/\d+\.\d+(\.\d+)?/)?.[0] ?? null,
  dependenciesInstalled: existsSync('node_modules/vite/package.json'),
  env: existsSync('.env.local') ? parseEnvFile(readFileSync('.env.local', 'utf8')) : null,
  linkedRef: existsSync('supabase/.temp/project-ref')
    ? readFileSync('supabase/.temp/project-ref', 'utf8').trim() || null
    : null,
  migrationCount: migrations.length,
  latestMigration: migrations.at(-1)?.replace(/\.sql$/, '') ?? null,
  hasSecondFactorMigration: migrations.includes(`${SECOND_FACTOR_MIGRATION}.sql`),
  isGitRepository,
  envIgnored: isGitRepository ? gitIgnores('.env.local') : null,
  remotes: isGitRepository ? remotes() : [],
}

const results = evaluate(facts)

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ ready: isReady(results), results }, null, 2))
} else {
  const mark = { ok: '✓', warn: '!', fail: '✗' }
  console.log('Atlas setup check\n')
  for (const result of results) console.log(`  ${mark[result.status]} ${result.message}`)
  console.log(
    isReady(results)
      ? '\nNothing blocks the next step.'
      : '\nSomething above (✗) must be fixed before the next step.',
  )
}

process.exitCode = isReady(results) ? 0 : 1

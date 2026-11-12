// @vitest-environment node
/**
 * The decisions behind `npm run setup:check`.
 *
 * The beginner setup leans on this checklist between stages, so what it calls a
 * blocker — a secret in a VITE_ variable, a CLI linked to a different project
 * than the app points at, a remote that can push to the original repository —
 * has to be exactly right.
 */
import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import {
  bundleAssetUrls,
  classifyKey,
  compareVersions,
  containsSecretKey,
  envFileContents,
  evaluate,
  evaluateSite,
  isOriginalAtlasRemote,
  isReady,
  parseEnvFile,
  pickBrowserKey,
  projectRefFromUrl,
  SECOND_FACTOR_MIGRATION,
  SITE_ROUTES,
  siteOrigin,
  supabaseRefsIn,
  TOTP_CONFIRMATION_VARIABLE,
  type SetupFacts,
  type SiteFacts,
} from '../../scripts/setup-check-lib.mjs'

function jwt(role: string): string {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${encode({ alg: 'HS256' })}.${encode({ role, ref: 'abcdefghijklmnopqrst' })}.sig`
}

const REF = 'abcdefghijklmnopqrst'

function facts(overrides: Partial<SetupFacts> = {}): SetupFacts {
  return {
    nodeVersion: '22.11.0',
    requiredNode: '20.19.0',
    gitVersion: '2.45.0',
    dependenciesInstalled: true,
    env: {
      VITE_SUPABASE_URL: `https://${REF}.supabase.co`,
      VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_example',
      SUPABASE_TOTP_ENABLED_FOR: REF,
    },
    linkedRef: REF,
    migrationCount: 54,
    latestMigration: '20260825100000_fleet_occupancy_follows_lifecycle',
    hasSecondFactorMigration: true,
    isGitRepository: true,
    envIgnored: true,
    remotes: [
      {
        name: 'origin',
        fetch: 'https://github.com/someone/my-atlas.git',
        push: 'https://github.com/someone/my-atlas.git',
      },
    ],
    ...overrides,
  }
}

const status = (results: ReturnType<typeof evaluate>, id: string) =>
  results.find((result) => result.id === id)?.status

describe('setup check helpers', () => {
  it('parses env files without comments, blanks or quotes', () => {
    expect(
      parseEnvFile(
        '# comment\n\nVITE_SUPABASE_URL="https://x.supabase.co"\nVITE_SUPABASE_PUBLISHABLE_KEY= sb_publishable_a \n',
      ),
    ).toEqual({
      VITE_SUPABASE_URL: 'https://x.supabase.co',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_a',
    })
  })

  it('classifies keys without needing their value afterwards', () => {
    expect(classifyKey('')).toBe('missing')
    expect(classifyKey('sb_publishable_abc')).toBe('publishable')
    expect(classifyKey('sb_secret_abc')).toBe('secret')
    expect(classifyKey(jwt('anon'))).toBe('legacy-anon')
    expect(classifyKey(jwt('service_role'))).toBe('secret')
    expect(classifyKey('something-else')).toBe('unknown')
  })

  it('reads the project ref only from a real Supabase https URL', () => {
    expect(projectRefFromUrl(`https://${REF}.supabase.co`)).toBe(REF)
    expect(projectRefFromUrl(`http://${REF}.supabase.co`)).toBeNull()
    expect(projectRefFromUrl('https://example.com')).toBeNull()
    expect(projectRefFromUrl('')).toBeNull()
  })

  it('compares versions numerically', () => {
    expect(compareVersions('2.21.0', '2.30.0')).toBe(-1)
    expect(compareVersions('v22.11.0', '20.19.0')).toBe(1)
    expect(compareVersions('2.30', '2.30.0')).toBe(0)
  })

  it('recognises every URL form of the original repository', () => {
    expect(isOriginalAtlasRemote('https://github.com/salhiworks/atlas-car-rental-saas.git')).toBe(
      true,
    )
    expect(isOriginalAtlasRemote('git@github.com:salhiworks/atlas-car-rental-saas.git')).toBe(true)
    expect(isOriginalAtlasRemote('https://github.com/someone/atlas-car-rental-saas.git')).toBe(
      false,
    )
    expect(isOriginalAtlasRemote('DISABLED--never-push-to-original-atlas')).toBe(false)
  })
})

describe('setup check decisions', () => {
  it('passes a correctly prepared folder', () => {
    const results = evaluate(facts())
    expect(isReady(results)).toBe(true)
    expect(results.every((result) => result.status === 'ok')).toBe(true)
  })

  it('blocks on a secret key under either variable name', () => {
    expect(
      status(
        evaluate(
          facts({
            env: {
              VITE_SUPABASE_URL: `https://${REF}.supabase.co`,
              VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_x',
            },
          }),
        ),
        'supabase-key',
      ),
    ).toBe('fail')
    expect(
      status(
        evaluate(
          facts({
            env: {
              VITE_SUPABASE_URL: `https://${REF}.supabase.co`,
              VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_ok',
              VITE_SUPABASE_ANON_KEY: jwt('service_role'),
            },
          }),
        ),
        'supabase-key',
      ),
    ).toBe('fail')
  })

  it('accepts the legacy anon variable on its own', () => {
    const results = evaluate(
      facts({
        env: {
          VITE_SUPABASE_URL: `https://${REF}.supabase.co`,
          VITE_SUPABASE_ANON_KEY: jwt('anon'),
        },
      }),
    )
    expect(status(results, 'supabase-key')).toBe('ok')
  })

  it('accepts a publishable key kept under the older variable name', () => {
    // Existing installs put the new sb_publishable_ key in VITE_SUPABASE_ANON_KEY.
    const results = evaluate(
      facts({
        env: {
          VITE_SUPABASE_URL: `https://${REF}.supabase.co`,
          VITE_SUPABASE_ANON_KEY: 'sb_publishable_existing_install',
        },
      }),
    )
    expect(status(results, 'supabase-key')).toBe('ok')
  })

  it('blocks when the CLI is linked to a different project than the app uses', () => {
    const results = evaluate(facts({ linkedRef: 'zzzzzzzzzzzzzzzzzzzz' }))
    expect(status(results, 'supabase-link')).toBe('fail')
    expect(isReady(results)).toBe(false)
  })

  it('only warns before the folder is linked', () => {
    expect(status(evaluate(facts({ linkedRef: null })), 'supabase-link')).toBe('warn')
  })

  it('treats a missing .env.local as not yet written, and blocks one that could be committed', () => {
    expect(status(evaluate(facts({ env: null })), 'env-file')).toBe('warn')
    expect(status(evaluate(facts({ envIgnored: false })), 'env-ignored')).toBe('fail')
  })

  it('warns while a remote can still push to the original repository', () => {
    const results = evaluate(
      facts({
        remotes: [
          {
            name: 'origin',
            fetch: 'https://github.com/salhiworks/atlas-car-rental-saas.git',
            push: 'https://github.com/salhiworks/atlas-car-rental-saas.git',
          },
        ],
      }),
    )
    expect(status(results, 'repository')).toBe('warn')
  })

  it('treats a disabled upstream push as safe', () => {
    const results = evaluate(
      facts({
        remotes: [
          {
            name: 'upstream',
            fetch: 'https://github.com/salhiworks/atlas-car-rental-saas.git',
            push: 'DISABLED--never-push-to-original-atlas',
          },
        ],
      }),
    )
    expect(status(results, 'repository')).toBe('ok')
  })

  it('warns about an old Git and blocks on an old Node', () => {
    expect(status(evaluate(facts({ gitVersion: '2.21.0' })), 'git')).toBe('warn')
    expect(status(evaluate(facts({ gitVersion: null })), 'git')).toBe('warn')
    expect(status(evaluate(facts({ nodeVersion: '18.20.0' })), 'node')).toBe('fail')
  })

  it('never puts a key value into a message', () => {
    const secret = 'sb_secret_do_not_print_me'
    const results = evaluate(
      facts({
        env: {
          VITE_SUPABASE_URL: `https://${REF}.supabase.co`,
          VITE_SUPABASE_PUBLISHABLE_KEY: secret,
        },
      }),
    )
    expect(JSON.stringify(results)).not.toContain(secret)
  })
})

describe('the App Authenticator, which nothing local can see', () => {
  // Pevvy ships as source each operator applies to their own Supabase project.
  // SECOND_FACTOR_MIGRATION makes a verified second factor part of every read,
  // so applying it to a project with TOTP switched off locks every account out
  // of an agency that can then never be created. This script contacts no
  // server, so the deployer answers for the project in .env.local.
  const env = (over: Record<string, string> = {}) => ({
    VITE_SUPABASE_URL: `https://${REF}.supabase.co`,
    VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_example',
    ...over,
  })

  const message = (results: ReturnType<typeof evaluate>, id: string) =>
    results.find((result) => result.id === id)?.message ?? ''

  it('blocks when the migration is there and nobody has confirmed TOTP is on', () => {
    const results = evaluate(facts({ env: env() }))

    expect(status(results, 'totp')).toBe('fail')
    expect(isReady(results)).toBe(false)
  })

  it('names the project, the switch and the variable, so the message is actionable', () => {
    const text = message(evaluate(facts({ env: env() })), 'totp')

    expect(text).toContain(REF)
    expect(text).toContain('Multi-Factor Authentication')
    expect(text).toContain(TOTP_CONFIRMATION_VARIABLE)
    expect(text).toContain(SECOND_FACTOR_MIGRATION)
  })

  it('passes once the confirmation names this folder’s project', () => {
    const results = evaluate(facts({ env: env({ [TOTP_CONFIRMATION_VARIABLE]: REF }) }))

    expect(status(results, 'totp')).toBe('ok')
    expect(isReady(results)).toBe(true)
  })

  it('blocks when the confirmation names a different project', () => {
    // Answered once for the first project, then pointed at a second one. The
    // answer does not carry over.
    const other = 'zzzzzzzzzzzzzzzzzzzz'
    const results = evaluate(facts({ env: env({ [TOTP_CONFIRMATION_VARIABLE]: other }) }))

    expect(status(results, 'totp')).toBe('fail')
    expect(message(results, 'totp')).toContain(other)
  })

  it('only warns before any Supabase project is connected', () => {
    // Nothing can be pushed anywhere yet, so this must not block the first stage
    // of a setup.
    const results = evaluate(facts({ env: null, linkedRef: null }))

    expect(status(results, 'totp')).toBe('warn')
    expect(isReady(results)).toBe(true)
  })

  it('still asks when only the CLI link names the project', () => {
    expect(status(evaluate(facts({ env: null })), 'totp')).toBe('fail')
  })

  it('says nothing in a copy of the repository without that migration', () => {
    const results = evaluate(facts({ env: env(), hasSecondFactorMigration: false }))

    expect(status(results, 'totp')).toBeUndefined()
    expect(isReady(results)).toBe(true)
  })
})

describe('writing .env.local', () => {
  // The shape `supabase projects api-keys -o json` returned for a new project.
  const apiKeys = [
    { name: 'anon', type: 'legacy', api_key: jwt('anon') },
    { name: 'service_role', type: 'legacy', api_key: jwt('service_role') },
    { name: 'default', type: 'publishable', api_key: 'sb_publishable_new' },
    { name: 'default', type: 'secret', api_key: 'sb_secret_never' },
  ]

  it('prefers the publishable key', () => {
    expect(pickBrowserKey(apiKeys)).toEqual({ kind: 'publishable', value: 'sb_publishable_new' })
  })

  it('falls back to the legacy anon key when there is no publishable one', () => {
    expect(pickBrowserKey(apiKeys.filter((key) => key.type !== 'publishable'))).toEqual({
      kind: 'legacy-anon',
      value: jwt('anon'),
    })
  })

  it('never picks a secret key, whatever it is labelled', () => {
    expect(
      pickBrowserKey(apiKeys.filter((key) => key.name !== 'anon' && key.type !== 'publishable')),
    ).toBeNull()
    expect(
      pickBrowserKey([{ name: 'anon', type: 'publishable', api_key: 'sb_secret_mislabelled' }]),
    ).toBeNull()
    expect(pickBrowserKey(undefined)).toBeNull()
  })

  it('writes exactly the two values the app needs', () => {
    const contents = envFileContents(REF, 'sb_publishable_new')
    expect(parseEnvFile(contents)).toEqual({
      VITE_SUPABASE_URL: `https://${REF}.supabase.co`,
      VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_new',
    })
  })
})

describe('checking the deployed site', () => {
  const ORIGIN = 'https://my-atlas.hostingersite.com'

  function site(overrides: Partial<SiteFacts> = {}): SiteFacts {
    return {
      origin: ORIGIN,
      expectedRef: REF,
      rootStatus: 200,
      hsts: true,
      routes: SITE_ROUTES.map((path) => ({ path, status: 200, html: true })),
      bundleFiles: 3,
      refs: [REF],
      keyFound: true,
      secretFound: false,
      ...overrides,
    }
  }

  it('accepts the address however the user pastes it, and only over https', () => {
    expect(siteOrigin('my-atlas.hostingersite.com')).toBe(ORIGIN)
    expect(siteOrigin(`${ORIGIN}/settings?x=1`)).toBe(ORIGIN)
    expect(siteOrigin('http://my-atlas.hostingersite.com')).toBeNull()
    expect(siteOrigin('http://localhost:4173')).toBe('http://localhost:4173')
    expect(siteOrigin('')).toBeNull()
  })

  it('checks every Auth redirect page the setup asks the user to allow', () => {
    for (const path of [
      '/auth/callback',
      '/accept-invite',
      '/auth/reset-password',
      '/confirm-email',
    ]) {
      expect(SITE_ROUTES).toContain(path)
    }
  })

  // The Help Centre is served to signed-out visitors from the same build, so a
  // deployment that gets it wrong is a deployment the verifier should fail.
  // Checking the sitemap files without ever fetching a page they point at
  // would prove only that the XML is well formed.
  it('checks the public Help Centre, not just the sitemap that advertises it', () => {
    expect(SITE_ROUTES).toContain('/help')
  })

  // A payment provider's review opens these while signed out, and a buyer's
  // procurement check does the same. A deployment that serves them behind a
  // sign-in wall, or not at all, has the same problem as one with no policy —
  // so the deploy verifier fetches them rather than trusting they exist.
  it('checks the legal pages a signed-out reviewer will open', () => {
    expect(SITE_ROUTES).toContain('/privacy')
    expect(SITE_ROUTES).toContain('/terms')
  })

  // The screenshots in public/help/ ship as a real directory, and a real
  // directory is what Apache serves rather than handing the path to the app:
  // /help answered 403 in production while every local test passed, because
  // the dev server has no such directory to collide with. The rule that
  // rescues it is only effective ahead of the passthrough that lets real
  // files and directories through untouched.
  it('rescues the Help Centre index before the directory passthrough can claim it', () => {
    const htaccess = readFileSync(new URL('../../public/.htaccess', import.meta.url), 'utf8')

    const helpRule = htaccess.indexOf('RewriteRule ^help/?$ index.html')
    const directoryPassthrough = htaccess.indexOf('RewriteCond %{REQUEST_FILENAME} -d')

    expect(helpRule, 'the /help rewrite is missing from public/.htaccess').toBeGreaterThan(-1)
    expect(directoryPassthrough).toBeGreaterThan(-1)
    expect(helpRule, 'the /help rewrite must come first, or it never runs').toBeLessThan(
      directoryPassthrough,
    )
  })

  it('finds the application script and its preloaded chunks, on this site only', () => {
    const html = `
      <script type="module" crossorigin src="/assets/index-abc.js"></script>
      <link rel="modulepreload" crossorigin href="/assets/env-def.js">
      <link rel="stylesheet" href="/assets/index.css">
      <script src="https://cdn.example.com/other.js"></script>`
    expect(bundleAssetUrls(html, ORIGIN)).toEqual([
      `${ORIGIN}/assets/index-abc.js`,
      `${ORIGIN}/assets/env-def.js`,
    ])
  })

  it('reads project refs from the build without mistaking wildcard text for one', () => {
    expect(supabaseRefsIn(`a={URL:\`https://${REF}.supabase.co\`};b=\`*.supabase.co\``)).toEqual([
      REF,
    ])
  })

  it('spots secret keys but not the publishable or anon key', () => {
    expect(containsSecretKey('x="sb_secret_abcdefghij"')).toBe(true)
    expect(containsSecretKey(`x="${jwt('service_role')}"`)).toBe(true)
    expect(containsSecretKey(`x="sb_publishable_abcdefghij";y="${jwt('anon')}"`)).toBe(false)
  })

  it('passes a correctly deployed site', () => {
    const results = evaluateSite(site())
    expect(isReady(results)).toBe(true)
    expect(results.every((result) => result.status === 'ok')).toBe(true)
  })

  it('stops early when the site is not online yet', () => {
    const results = evaluateSite(site({ rootStatus: 404 }))
    expect(results.map((result) => result.id)).toEqual(['reachable'])
    expect(isReady(results)).toBe(false)
  })

  it('fails when a page the sign-up or email links need does not load', () => {
    const routes = SITE_ROUTES.map((path) => ({
      path,
      status: path === '/confirm-email' ? 404 : 200,
      html: path !== '/confirm-email',
    }))
    expect(status(evaluateSite(site({ routes })), 'routes')).toBe('fail')
  })

  it('fails when the build points at no project, another project, or two', () => {
    expect(status(evaluateSite(site({ refs: [] })), 'config')).toBe('fail')
    expect(status(evaluateSite(site({ refs: ['zzzzzzzzzzzzzzzzzzzz'] })), 'config')).toBe('fail')
    expect(status(evaluateSite(site({ refs: [REF, 'zzzzzzzzzzzzzzzzzzzz'] })), 'config')).toBe(
      'fail',
    )
  })

  it('fails on a missing publishable key or any secret key in the build', () => {
    expect(status(evaluateSite(site({ keyFound: false })), 'key')).toBe('fail')
    expect(status(evaluateSite(site({ secretFound: true })), 'key')).toBe('fail')
    expect(status(evaluateSite(site({ keyFound: null })), 'key')).toBe('warn')
  })

  it('only warns about missing security headers, and skips them for a local rehearsal', () => {
    expect(status(evaluateSite(site({ hsts: false })), 'https')).toBe('warn')
    expect(
      status(evaluateSite(site({ origin: 'http://localhost:4173', hsts: false })), 'https'),
    ).toBe('ok')
  })
})

describe('deployment-first setup', () => {
  it('never blocks on the absence of local sign-up state', () => {
    // A folder that is linked and configured, but has no local agency, no
    // localhost Auth URLs and has never run `npm run dev`, is ready to publish.
    // None of those are facts setup:check reads — this guards that it stays so.
    const results = evaluate(facts())
    expect(isReady(results)).toBe(true)
    expect(results.map((result) => result.id)).not.toEqual(
      expect.arrayContaining(['auth-urls', 'owner', 'dev-server']),
    )
  })
})

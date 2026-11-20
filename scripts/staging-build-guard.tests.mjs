import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  STAGING_URL,
  validateStagingEnvironment,
  verifyStagingArtifact,
} from './staging-build-guard.mjs'

const valid = {
  PEVVY_STAGING_BUILD_INTENT: 'approved-local-build',
  VITE_SUPABASE_URL: STAGING_URL,
  VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_synthetic_test_only',
}

test('staging intent, effective URL and browser key are required', () => {
  assert.deepEqual(validateStagingEnvironment(valid), [])
  for (const changes of [
    { PEVVY_STAGING_BUILD_INTENT: '' },
    { VITE_SUPABASE_URL: '' },
    { VITE_SUPABASE_URL: 'https://ysnumxtzcgzyabrghxwq.supabase.co' },
    { VITE_SUPABASE_URL: 'https://yeklucfthspvejlkffln.supabase.co.evil.test' },
    { VITE_SUPABASE_URL: 'not-a-url' },
    { VITE_SUPABASE_PUBLISHABLE_KEY: '' },
    { VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_synthetic_test_only' },
    { VITE_SUPABASE_ANON_KEY: 'synthetic-conflict' },
    { VITE_SUPABASE_EXTRA_KEY: 'synthetic-conflict' },
    { VITE_MAP_STYLE_URL: 'https://ysnumxtzcgzyabrghxwq.example.test' },
  ]) {
    assert.notDeepEqual(validateStagingEnvironment({ ...valid, ...changes }), [])
  }
})

test('artifact verification rejects wrong projects and credential-shaped keys', () => {
  const root = mkdtempSync(join(tmpdir(), 'pevvy-staging-guard-'))
  try {
    mkdirSync(join(root, 'assets'))
    writeFileSync(join(root, 'index.html'), '<html></html>')
    const asset = join(root, 'assets', 'app.js')
    writeFileSync(asset, `const url='${STAGING_URL}';const key='${valid.VITE_SUPABASE_PUBLISHABLE_KEY}';const prefix='sb_secret_';`)
    assert.deepEqual(verifyStagingArtifact(root, valid.VITE_SUPABASE_PUBLISHABLE_KEY).errors, [])

    writeFileSync(asset, 'const url="https://ysnumxtzcgzyabrghxwq.supabase.co";')
    assert.ok(verifyStagingArtifact(root, valid.VITE_SUPABASE_PUBLISHABLE_KEY).errors.includes('production-reference-in-artifact'))

    writeFileSync(asset, `const url='${STAGING_URL}';const key='sb_secret_synthetic_test_only';`)
    assert.ok(verifyStagingArtifact(root, valid.VITE_SUPABASE_PUBLISHABLE_KEY).errors.includes('privileged-key-in-artifact'))

    writeFileSync(asset, 'const unrelated=true;')
    assert.ok(verifyStagingArtifact(root, valid.VITE_SUPABASE_PUBLISHABLE_KEY).errors.includes('staging-reference-missing'))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

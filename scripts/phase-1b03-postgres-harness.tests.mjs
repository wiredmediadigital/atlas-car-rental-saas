import assert from 'node:assert/strict'
import test from 'node:test'
import { executeWithFailureSafeCleanup, validateStagingConnection } from './phase-1b03-postgres-harness.mjs'

function fixtureState() {
  return { namespace: 'phase1b03_test', cleanupRequired: true, committed: false }
}

test('successful scenarios are followed by cleanup', async () => {
  const calls = []
  const result = await executeWithFailureSafeCleanup({
    createFixture: async (fixture) => { fixture.committed = true; return fixture },
    runScenarios: async () => ({ status: 'PASS' }),
    cleanup: async (fixture) => { calls.push(fixture.namespace); return { status: 'PASS', residueFree: true } },
  })
  assert.equal(calls.length, 1)
  assert.equal(result.cleanup.residueFree, true)
})

test('scenario failure after committed setup still cleans and preserves the scenario error', async () => {
  let cleaned = false
  await assert.rejects(
    executeWithFailureSafeCleanup({
      createFixture: async (fixture) => { fixture.committed = true; return fixture },
      runScenarios: async () => { throw new Error('scenario failed') },
      cleanup: async () => { cleaned = true; return { status: 'PASS', residueFree: true } },
    }),
    /scenario failed/,
  )
  assert.equal(cleaned, true)
})

test('partial fixture setup exposes its state for cleanup', async () => {
  let cleaned = false
  const fixture = fixtureState()
  await assert.rejects(
    executeWithFailureSafeCleanup({
      createFixture: async () => { const error = new Error('partial setup failed'); error.fixture = fixture; throw error },
      runScenarios: async () => ({ status: 'UNREACHABLE' }),
      cleanup: async (received) => { cleaned = received === fixture; return { status: 'PASS', residueFree: true } },
    }),
    /partial setup failed/,
  )
  assert.equal(cleaned, true)
})

test('concurrency assertion failure still triggers cleanup', async () => {
  let cleaned = false
  await assert.rejects(
    executeWithFailureSafeCleanup({
      createFixture: async (fixture) => { fixture.committed = true; return fixture },
      runScenarios: async () => { throw new Error('concurrency assertion failed') },
      cleanup: async () => { cleaned = true; return { status: 'PASS', residueFree: true } },
    }),
    /concurrency assertion failed/,
  )
  assert.equal(cleaned, true)
})

test('cleanup failure is reported alongside the original scenario failure', async () => {
  await assert.rejects(
    executeWithFailureSafeCleanup({
      createFixture: async (fixture) => { fixture.committed = true; return fixture },
      runScenarios: async () => { throw new Error('scenario failure') },
      cleanup: async () => { throw new Error('cleanup failure') },
    }),
    /scenario failure.*cleanup also failed.*cleanup failure/,
  )
})

test('residual reconciliation cannot be reported as success', async () => {
  await assert.rejects(
    executeWithFailureSafeCleanup({
      createFixture: async (fixture) => { fixture.committed = true; return fixture },
      runScenarios: async () => ({ status: 'PASS' }),
      cleanup: async () => ({ status: 'FAIL', residueFree: false }),
    }),
    /zero synthetic residue/,
  )
})

test('cleanup can be invoked repeatedly for the same namespace', async () => {
  let calls = 0
  const run = () => executeWithFailureSafeCleanup({
    createFixture: async (fixture) => { fixture.committed = true; return fixture },
    runScenarios: async () => ({ status: 'PASS' }),
    cleanup: async () => { calls += 1; return { status: 'PASS', residueFree: true } },
  })
  await run(); await run()
  assert.equal(calls, 2)
})

test('missing or malformed staging connection configuration fails closed', () => {
  assert.throws(() => validateStagingConnection({ stagingRef: 'yeklucfthspvejlkffln', productionRef: 'ysnumxtzcgzyabrghxwq', connectionString: '' }), /SUPABASE_STAGING_DB_URL must be a PostgreSQL URL/)
  assert.throws(() => validateStagingConnection({ stagingRef: 'yeklucfthspvejlkffln', productionRef: 'ysnumxtzcgzyabrghxwq', connectionString: 'not-a-url' }), /SUPABASE_STAGING_DB_URL must be a PostgreSQL URL/)
})

test('production project references are rejected', () => {
  assert.throws(() => validateStagingConnection({ stagingRef: 'yeklucfthspvejlkffln', productionRef: 'ysnumxtzcgzyabrghxwq', connectionString: 'postgresql://postgres.ysnumxtzcgzyabrghxwq.example/db' }), /Production project reference is prohibited/)
})

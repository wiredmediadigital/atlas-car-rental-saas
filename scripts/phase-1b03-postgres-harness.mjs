import pg from 'pg'
import { fileURLToPath } from 'node:url'

const { Client } = pg
const namespace = readArg('--namespace')
const stagingRef = readArg('--staging-ref')
const execute = process.argv.includes('--execute')
const preflight = process.argv.includes('--preflight')
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
const approvedRef = 'yeklucfthspvejlkffln'
const productionRef = 'ysnumxtzcgzyabrghxwq'
const timeoutMs = 15_000
const connectionString = process.env.SUPABASE_STAGING_DB_URL

if (isMain && !execute && !preflight) fail('Hosted execution requires an explicit mode switch.')
if (isMain && execute && (!namespace || !/^phase1b03_[a-f0-9]{32}$/.test(namespace))) fail('Invalid fixture namespace.')
if (isMain && stagingRef !== approvedRef) fail('Unauthorized staging identity.')

const baseConfig = {
  connectionString,
  connectionTimeoutMillis: 10_000,
  query_timeout: timeoutMs,
  statement_timeout: timeoutMs,
  application_name: namespace ? `pevvy-phase-1b03-${namespace.slice(-8)}` : 'pevvy-phase-1b03-connection-preflight',
}
const clients = []

function readArg(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

function fail(message) {
  process.stderr.write(`${message}\n`)
  process.exit(1)
}

export function validateStagingConnection({ stagingRef: expectedStagingRef, productionRef: prohibitedProductionRef, connectionString: candidate }) {
  if (!candidate || !/^postgres(?:ql):\/\//i.test(candidate)) throw new Error('SUPABASE_STAGING_DB_URL must be a PostgreSQL URL.')
  if (candidate.includes(prohibitedProductionRef)) throw new Error('Production project reference is prohibited.')
  if (!candidate.includes(expectedStagingRef)) throw new Error('SUPABASE_STAGING_DB_URL does not identify the authorized staging project.')
  return { status: 'PASS', stagingRef: expectedStagingRef }
}

if (isMain) {
  try { validateStagingConnection({ stagingRef: approvedRef, productionRef, connectionString }) } catch (error) { fail(error.message) }
}

function safeError(error) {
  return String(error?.message ?? error).replace(/postgres(?:ql)?:\/\/[^\s]+/gi, 'postgresql://[REDACTED]')
}

export async function executeWithFailureSafeCleanup({ createFixture, runScenarios, cleanup }) {
  let fixture = { cleanupRequired: true, committed: false }
  let scenarios
  let cleanupResult
  let primaryError
  let cleanupError
  try {
    fixture = (await createFixture(fixture)) ?? fixture
    scenarios = await runScenarios(fixture)
  } catch (error) {
    primaryError = error
    fixture = error?.fixture ?? fixture
  } finally {
    if (fixture.cleanupRequired || fixture.committed) {
      try {
        cleanupResult = await cleanup(fixture)
      } catch (error) {
        cleanupError = error
      }
    }
  }
  if (primaryError && cleanupError) {
    throw new AggregateError([primaryError, cleanupError], `Acceptance failed: ${safeError(primaryError)}; cleanup also failed: ${safeError(cleanupError)}`)
  }
  if (cleanupError) throw new Error(`Cleanup failed: ${safeError(cleanupError)}`, { cause: cleanupError })
  if (primaryError) throw primaryError
  if (!cleanupResult?.residueFree) throw new Error('Cleanup did not prove zero synthetic residue.')
  return { scenarios, cleanup: cleanupResult }
}

async function connect() {
  const client = new Client(baseConfig)
  await client.connect()
  clients.push(client)
  return client
}

async function identity(client) {
  const result = await client.query(`
    select current_database() as database_name,
           current_user as connected_user,
           inet_server_addr()::text as server_address,
           pg_backend_pid() as backend_pid,
           to_regclass('public.rental_vehicle_assignments')::text as assignments,
           to_regclass('public.rental_vehicle_inspections')::text as inspections,
           to_regclass('app.rental_assignment_operations')::text as operations,
           exists (select 1 from pg_constraint where conname = 'rentals_no_vehicle_overlap' and contype = 'x') as rental_overlap,
           exists (select 1 from pg_constraint where conname = 'rental_vehicle_assignments_no_overlap' and contype = 'x') as assignment_overlap
  `)
  const row = result.rows[0]
  const required = row.assignments && row.inspections && row.operations && row.rental_overlap && row.assignment_overlap
  if (row.database_name !== 'postgres' || !required) throw new Error('Connected database identity/schema fingerprint is not the approved staging database.')
  return { status: 'PASS', database: row.database_name, user: row.connected_user, server: row.server_address, backendPid: row.backend_pid, schemaFingerprint: 'PASS' }
}

async function setupFixture(admin, fixture) {
  fixture.cleanupRequired = true
  fixture.namespace = namespace
  fixture.userEmail = `${namespace}@invalid.local`
  fixture.vehicleIds = []
  fixture.rentalIds = []
  await admin.query('begin')
  try {
    await admin.query("insert into auth.users (id, email) values (gen_random_uuid(), $1)", [fixture.userEmail])
    const user = await admin.query('select id from auth.users where email = $1', [fixture.userEmail])
    fixture.userId = user.rows[0].id
    const org = await admin.query("select id from app.provision_organization($1, $2, 'US', 'USD', 'UTC', 'en')", [fixture.userId, `Pevvy ${namespace}`])
    fixture.organizationId = org.rows[0].id
    await admin.query('insert into public.organization_members (organization_id, user_id, role, status) values ($1, $2, $3, $4) on conflict do nothing', [fixture.organizationId, fixture.userId, 'owner', 'active'])
    const customer = await admin.query("insert into public.customers (organization_id, first_name, last_name, email) values ($1, 'Phase', $2, $3) returning id", [fixture.organizationId, namespace, fixture.userEmail])
    fixture.customerId = customer.rows[0].id
    const vehicleRows = await Promise.all(Array.from({ length: 12 }, (_, index) => admin.query("insert into public.vehicles (organization_id, make, model, registration_plate, currency, created_by) values ($1, 'Pevvy', $2, $3, 'USD', $4) returning id", [fixture.organizationId, `Synthetic ${index + 1}`, `${namespace}-${index + 1}`, fixture.userId])))
    fixture.vehicleIds = vehicleRows.map((result) => result.rows[0].id)
    const starts = new Date(Date.now() + 86_400_000).toISOString()
    const ends = new Date(Date.now() + 3 * 86_400_000).toISOString()
    fixture.starts = starts
    fixture.ends = ends
    for (let index = 0; index < 10; index += 1) {
      const rental = await admin.query("insert into public.rentals (organization_id, reference, vehicle_id, customer_id, starts_at, ends_at, currency, daily_rate_minor, subtotal_minor, total_minor, deposit_minor, created_by) values ($1, $2, $3, $4, $5, $6, 'USD', 100, 300, 300, 0, $7) returning id", [fixture.organizationId, `${namespace}-R${index + 1}`, fixture.vehicleIds[index], fixture.customerId, starts, ends, fixture.userId])
      fixture.rentalIds.push(rental.rows[0].id)
      await admin.query("insert into public.rental_drivers (organization_id, rental_id, customer_id, driver_role) values ($1, $2, $3, 'primary')", [fixture.organizationId, rental.rows[0].id, fixture.customerId])
    }
    await admin.query('commit')
    fixture.committed = true
    return { ...fixture, userId: fixture.userId, vehicles: fixture.vehicleIds, rentals: fixture.rentalIds }
  } catch (error) {
    await admin.query('rollback').catch(() => undefined)
    error.fixture = fixture
    throw error
  }
}

async function withActor(client, userId) {
  await client.query("select set_config('request.jwt.claim.sub', $1, false)", [userId])
  await client.query("select set_config('app.assignment_lifecycle_enabled', 'on', false)")
}

async function concurrent(clientA, clientB, fnA, fnB) {
  const started = Date.now()
  const [a, b] = await Promise.allSettled([fnA(clientA), fnB(clientB)])
  return { results: [outcome(a), outcome(b)], elapsedMs: Date.now() - started, overlapped: true }
}

function outcome(result) {
  return result.status === 'fulfilled' ? { status: 'PASS' } : { status: 'EXPECTED_ERROR', code: result.reason?.code ?? 'UNKNOWN', message: safeError(result.reason) }
}

async function proveSessions(clientA, clientB) {
  const [a, b] = await Promise.all([clientA.query('select pg_backend_pid() as pid'), clientB.query('select pg_backend_pid() as pid')])
  if (a.rows[0].pid === b.rows[0].pid) throw new Error('Two-session proof failed: backend PIDs are identical.')
  await clientA.query('begin'); await clientB.query('begin')
  const started = Date.now()
  await Promise.all([clientA.query('select pg_sleep(0.25)'), clientB.query('select pg_sleep(0.25)')])
  const elapsedMs = Date.now() - started
  await clientA.query('rollback'); await clientB.query('rollback')
  if (elapsedMs >= 450) throw new Error('Two-session proof failed: transactions did not overlap.')
  return { distinctBackendPids: [a.rows[0].pid, b.rows[0].pid], elapsedMs, overlappingTransactions: true, boundedTimeoutMs: timeoutMs }
}

async function expectOneSuccess(race, label) {
  const successes = race.results.filter((result) => result.status === 'PASS').length
  if (successes !== 1) throw new Error(`${label} expected exactly one successful operation, received ${successes}.`)
  return { ...race, assertion: 'exactly one success and one expected error' }
}

async function confirm(client, rentalId) {
  return client.query('select public.rental_confirm($1)', [rentalId])
}

async function checkout(client, rentalId) {
  return client.query('select public.rental_check_out($1, 100, 80, $2, now())', [rentalId, `checkout-${namespace}`])
}

async function checkin(client, rentalId) {
  return client.query('select public.rental_check_in($1, 110, 75, $2, now())', [rentalId, `checkin-${namespace}`])
}

async function complete(client, rentalId) {
  return client.query('select public.rental_complete($1)', [rentalId])
}

async function runScenarios(admin, clientA, clientB, fixture) {
  await withActor(clientA, fixture.userId); await withActor(clientB, fixture.userId)
  const [confirmationRaw, checkoutRaw] = await Promise.all([
    (async () => { const race = await concurrent(clientA, clientB, (c) => confirm(c, fixture.rentals[0]), (c) => confirm(c, fixture.rentals[0])); return expectOneSuccess(race, 'Duplicate confirmation') })(),
    (async () => { await confirm(clientA, fixture.rentals[1]); const race = await concurrent(clientA, clientB, (c) => checkout(c, fixture.rentals[1]), (c) => checkout(c, fixture.rentals[1])); return expectOneSuccess(race, 'Concurrent checkout') })(),
  ])
  const checkinRace = await (async () => { await confirm(clientA, fixture.rentals[2]); await checkout(clientA, fixture.rentals[2]); const race = await concurrent(clientA, clientB, (c) => checkin(c, fixture.rentals[2]), (c) => checkin(c, fixture.rentals[2])); return expectOneSuccess(race, 'Concurrent check-in') })()
  const completionRace = await (async () => { await confirm(clientA, fixture.rentals[3]); await checkout(clientA, fixture.rentals[3]); await checkin(clientA, fixture.rentals[3]); const race = await concurrent(clientA, clientB, (c) => complete(c, fixture.rentals[3]), (c) => complete(c, fixture.rentals[3])); return expectOneSuccess(race, 'Concurrent completion') })()
  await confirm(clientA, fixture.rentals[4])
  await clientA.query('select public.rental_extend($1, $2, 100, $3, 1)', [fixture.rentals[4], new Date(Date.now() + 4 * 86_400_000).toISOString(), `extension-${namespace}`])
  await clientA.query('select public.rental_reschedule($1, $2, $3, null, false)', [fixture.rentals[4], new Date(Date.now() + 2 * 86_400_000).toISOString(), new Date(Date.now() + 5 * 86_400_000).toISOString()])
  await confirm(clientA, fixture.rentals[5])
  await clientA.query('select public.rental_substitute_vehicle($1, $2)', [fixture.rentals[5], fixture.vehicles[8]])
  await confirm(clientA, fixture.rentals[6]); await checkout(clientA, fixture.rentals[6])
  const swapOne = await clientA.query("select public.rental_swap_vehicle($1, $2, 'breakdown', $3, now(), 120, 70, null, $4)", [fixture.rentals[6], fixture.vehicles[7], `swap-one-${namespace}`, crypto.randomUUID()])
  const swapTwo = await clientA.query("select public.rental_swap_vehicle($1, $2, 'maintenance', $3, now(), 130, 65, null, $4)", [fixture.rentals[6], fixture.vehicles[8], `swap-two-${namespace}`, crypto.randomUUID()])
  if (!swapOne.rows.length || !swapTwo.rows.length) throw new Error('Active swap lifecycle did not return rentals.')
  await confirm(clientA, fixture.rentals[7]); await checkout(clientA, fixture.rentals[7])
  const beforeInvalid = await admin.query('select count(*)::int as count, vehicle_id from public.rental_vehicle_assignments a join public.rentals r on r.id = a.rental_id where a.rental_id = $1 group by vehicle_id', [fixture.rentals[7]])
  await clientA.query("select public.rental_swap_vehicle($1, $2, 'breakdown', $3, now(), 120, 70, null, $4)", [fixture.rentals[7], fixture.vehicles[9], `invalid-valid-${namespace}`, crypto.randomUUID()])
  const afterValid = await admin.query('select count(*)::int as count from public.rental_vehicle_assignments where rental_id = $1', [fixture.rentals[7]])
  let invalidRollback = 'PASS'
  try { await clientA.query("select public.rental_swap_vehicle($1, $2, 'breakdown', $3, now(), 121, 70, null, $4)", [fixture.rentals[7], fixture.vehicles[9], `invalid-${namespace}`, crypto.randomUUID()]); invalidRollback = 'FAIL' } catch { /* expected same-vehicle rejection */ }
  const afterInvalid = await admin.query('select count(*)::int as count from public.rental_vehicle_assignments where rental_id = $1', [fixture.rentals[7]])
  if (invalidRollback !== 'PASS' || Number(afterInvalid.rows[0].count) !== Number(afterValid.rows[0].count)) throw new Error('Invalid swap did not roll back completely.')
  await confirm(clientA, fixture.rentals[8]); await checkout(clientA, fixture.rentals[8])
  await confirm(clientB, fixture.rentals[9]); await checkout(clientB, fixture.rentals[9])
  const competingReplacement = await expectOneSuccess(await concurrent(clientA, clientB, (c) => c.query("select public.rental_swap_vehicle($1, $2, 'breakdown', $3, now(), 120, 70, null, $4)", [fixture.rentals[8], fixture.vehicles[11], `compete-a-${namespace}`, crypto.randomUUID()]), (c) => c.query("select public.rental_swap_vehicle($1, $2, 'breakdown', $3, now(), 120, 70, null, $4)", [fixture.rentals[9], fixture.vehicles[11], `compete-b-${namespace}`, crypto.randomUUID()])), 'Competing replacement vehicle')
  const duplicateKey = crypto.randomUUID(); const duplicateAt = new Date().toISOString()
  const beforeIdempotent = await admin.query('select count(*)::int as count from public.rental_vehicle_assignments where rental_id = $1', [fixture.rentals[6]])
  const duplicateIdempotency = await concurrent(clientA, clientB, (c) => c.query("select public.rental_swap_vehicle($1, $2, 'maintenance', $3, $4, 140, 60, null, $5)", [fixture.rentals[6], fixture.vehicles[10], `idempotent-${namespace}`, duplicateAt, duplicateKey]), (c) => c.query("select public.rental_swap_vehicle($1, $2, 'maintenance', $3, $4, 140, 60, null, $5)", [fixture.rentals[6], fixture.vehicles[10], `idempotent-${namespace}`, duplicateAt, duplicateKey]))
  if (duplicateIdempotency.results.some((result) => result.status === 'EXPECTED_ERROR')) throw new Error('Duplicate idempotency key did not converge to the original operation.')
  const afterIdempotent = await admin.query('select count(*)::int as count from public.rental_vehicle_assignments where rental_id = $1', [fixture.rentals[6]])
  if (Number(afterIdempotent.rows[0].count) !== Number(beforeIdempotent.rows[0].count) + 1) throw new Error('Duplicate idempotency key created more than one assignment.')
  const checks = await admin.query('select status from public.rentals where id = $1', [fixture.rentals[0]])
  if (checks.rows[0].status !== 'reserved') throw new Error('Duplicate confirmation did not leave a reserved rental.')
  return {
    concurrency: 'PASS',
    lifecycle: 'PASS',
    evidence: { duplicateConfirmation: confirmationRaw, concurrentCheckout: checkoutRaw, concurrentCheckin: checkinRace, concurrentCompletion: completionRace, extensionAndReschedule: 'PASS', preHandoverSubstitution: 'PASS', activeSwapsAtoBtoC: 'PASS', invalidSwapRollback: 'PASS', competingReplacementVehicle: competingReplacement, duplicateIdempotencyKey: duplicateIdempotency, initialAssignmentRowsBeforeInvalid: beforeInvalid.rows.length, rentalStatusAfterConfirmation: checks.rows[0].status },
  }
}

async function cleanupFixture(fixture) {
  if (!fixture?.committed) return { status: 'PASS', residueFree: true, namespace: fixture?.namespace, rolledBackPartialSetup: true, residue: 0 }
  const cleanupClient = new Client(baseConfig)
  await cleanupClient.connect()
  try {
    const organizationId = fixture.organizationId
    const vehicleIds = fixture.vehicleIds
    const rentalIds = fixture.rentalIds
    await cleanupClient.query('begin')
    await cleanupClient.query('delete from public.rentals where id = any($1::uuid[]) and organization_id = $2', [rentalIds, organizationId])
    await cleanupClient.query('delete from public.vehicles where id = any($1::uuid[]) and organization_id = $2', [vehicleIds, organizationId])
    await cleanupClient.query('delete from public.customers where id = $1 and organization_id = $2', [fixture.customerId, organizationId])
    await cleanupClient.query('delete from public.organizations where id = $1', [organizationId])
    await cleanupClient.query('delete from auth.users where id = $1', [fixture.userId])
    await cleanupClient.query('commit')
    const residue = await cleanupClient.query(`select
      (select count(*) from public.organizations where id = $1) organizations,
      (select count(*) from public.vehicles where id = any($2::uuid[])) vehicles,
      (select count(*) from public.customers where id = $3) customers,
      (select count(*) from public.rentals where id = any($4::uuid[])) rentals,
      (select count(*) from public.rental_vehicle_assignments where rental_id = any($4::uuid[])) assignments,
      (select count(*) from public.rental_vehicle_inspections where rental_id = any($4::uuid[])) inspections,
      (select count(*) from app.rental_assignment_operations where rental_id = any($4::uuid[])) operations,
      (select count(*) from auth.users where id = $5) users`, [organizationId, vehicleIds, fixture.customerId, rentalIds, fixture.userId])
    const counts = Object.values(residue.rows[0]).map(Number)
    if (counts.some((value) => value !== 0)) throw new Error('Synthetic cleanup left namespace residue.')
    return { status: 'PASS', residueFree: true, namespace: fixture.namespace, verifiedTables: ['organizations', 'vehicles', 'customers', 'rentals', 'rental_vehicle_assignments', 'rental_vehicle_inspections', 'app.rental_assignment_operations', 'auth.users'], residue: 0 }
  } catch (error) {
    await cleanupClient.query('rollback').catch(() => undefined)
    throw new Error(`Cleanup failed for namespace ${fixture.namespace}: ${safeError(error)}`, { cause: error })
  } finally {
    await cleanupClient.end().catch(() => undefined)
  }
}

if (isMain && preflight) {
  try {
    const clientA = await connect()
    const clientB = await connect()
    const identityA = await identity(clientA)
    const identityB = await identity(clientB)
    const distinctBackendPids = identityA.backendPid !== identityB.backendPid
    if (!distinctBackendPids) throw new Error('Read-only preflight found identical backend process IDs.')
    process.stdout.write(JSON.stringify({ identity: { status: 'PASS', database: identityA.database, user: identityA.user, server: identityA.server, schemaFingerprint: 'PASS' }, sessions: { distinctBackendPids: true, backendPids: [identityA.backendPid, identityB.backendPid], readOnlyQueriesOnly: true } }))
  } catch (error) {
    process.stderr.write(`${safeError(error)}\n`)
    process.exitCode = 1
  } finally {
    await Promise.all(clients.map((client) => client.end().catch(() => undefined)))
  }
} else if (isMain) try {
  const admin = await connect()
  const identityEvidence = await identity(admin)
  const clientA = await connect(); const clientB = await connect()
  const sessionEvidence = await proveSessions(clientA, clientB)
  const acceptance = await executeWithFailureSafeCleanup({
    createFixture: (state) => setupFixture(admin, state),
    runScenarios: (createdFixture) => runScenarios(admin, clientA, clientB, createdFixture),
    cleanup: cleanupFixture,
  })
  process.stdout.write(JSON.stringify({ identity: identityEvidence, sessions: sessionEvidence, fixtures: { committed: true, namespace }, scenarios: acceptance.scenarios, cleanup: acceptance.cleanup }))
} catch (error) {
  process.stderr.write(`${safeError(error)}\n`)
  process.exitCode = 1
} finally {
  await Promise.all(clients.map((client) => client.end().catch(() => undefined)))
}

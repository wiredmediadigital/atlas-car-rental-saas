$ErrorActionPreference = 'Stop'
$sql = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'phase-1b03-staging-acceptance.sql') -Raw

if ($sql -notmatch "'app\.rental_assignment_operations'") {
  throw 'The acceptance gate must resolve rental_assignment_operations in the app schema.'
}

if ($sql -match "'public\.rental_assignment_operations'") {
  throw 'The acceptance gate must not look for rental_assignment_operations in public.'
}

if ($sql -notmatch 'from app\.rental_assignment_operations') {
  throw 'The operation-ledger baseline query must use the app schema.'
}

if ($sql -notmatch '(?is)begin;.*set transaction read only;.*rollback;') {
  throw 'The read-only acceptance SQL must retain its transaction rollback boundary.'
}

Write-Output 'Phase 1B-03 acceptance SQL schema-qualification tests PASS.'

$runner = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'phase-1b03-staging-acceptance.ps1') -Raw
$helper = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'phase-1b03-postgres-harness.mjs') -Raw

if ($runner -notmatch '\.env\.staging\.local') { throw 'Runner must load the explicitly approved staging file.' }
if ($runner -notmatch 'ExecuteHostedAcceptance') { throw 'Hosted writes must require explicit authorization.' }
if ($runner -notmatch 'SUPABASE_STAGING_DB_URL is required') { throw 'Missing URL requirement must be exact and explicit.' }
if ($runner -match 'Write-Output.*SUPABASE_STAGING_DB_URL|Write-Host.*SUPABASE_STAGING_DB_URL') { throw 'Runner must not print connection configuration.' }
if ($helper -notmatch 'pg_backend_pid\(\)') { throw 'Helper must prove backend session identity.' }
if ($helper -notmatch 'Promise\.all') { throw 'Helper must run overlapping operations concurrently.' }
if ($helper -notmatch 'begin|BEGIN') { throw 'Helper must use transaction boundaries.' }
if ($helper -notmatch 'rental_vehicle_assignments|rental_vehicle_inspections|rental_assignment_operations') { throw 'Cleanup must cover assignment-related tables.' }
if ($helper -match 'console\.log|process\.argv.*SUPABASE') { throw 'Helper must not log or accept credentials as arguments.' }
if ($helper -notmatch '(?s)finally\s*\{.*cleanup') { throw 'Harness must attempt cleanup from a failure-safe finally path.' }
if ($helper -notmatch 'cleanupError|cleanup failure|AggregateError') { throw 'Harness must preserve and report cleanup failures alongside scenario failures.' }
if ($helper -notmatch 'committed|cleanupRequired') { throw 'Harness must track committed or partially-created fixtures for recovery.' }

Write-Output 'Phase 1B-03 runner and PostgreSQL harness static safety tests PASS.'

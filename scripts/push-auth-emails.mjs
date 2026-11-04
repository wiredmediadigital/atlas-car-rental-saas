#!/usr/bin/env node
/**
 * Pushes the generated auth email templates to the hosted project.
 *
 * WHY THIS EXISTS RATHER THAN `supabase config push`.
 *
 * `config push` uploads the WHOLE config.toml — api, db, storage and auth — to
 * whichever project is linked. This repo's config.toml is local-development
 * configuration and says so at the top of [auth]: its `site_url` is
 * http://localhost:5173. Pushing it at a deployed project would replace the live
 * site URL and redirect allow-list with a laptop's, and every sign-in link in
 * production would start pointing at a machine that is not serving anything.
 *
 * This talks to the Management API instead and names the fields it sets. A PATCH
 * leaves everything it does not mention alone, so the blast radius is the seven
 * email templates, their subjects, and the one notification toggle — and
 * nothing else in the project's auth configuration.
 *
 * WHY THE PASSWORD-CHANGED NOTICE NEEDS IT AT ALL.
 *
 * Six of the seven can be pasted into Dashboard -> Authentication -> Emails.
 * The password-changed notification has no Dashboard control: it is enabled by
 * `mailer_notifications_password_changed_enabled`, which is settable only
 * through config.toml or this API. That is the whole reason the sixth email
 * arrives and the seventh does not.
 *
 * Usage:
 *
 *     $env:SUPABASE_ACCESS_TOKEN = "sbp_..."     # a personal access token
 *     node scripts/push-auth-emails.mjs          # dry run: shows the diff
 *     node scripts/push-auth-emails.mjs --apply  # sends it
 *
 * Get a token at https://supabase.com/dashboard/account/tokens. It is a secret
 * with full control of your projects: set it in your shell, do not paste it into
 * a file, and revoke it when you are done.
 */

import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const templatesDir = join(root, 'supabase', 'templates')

/**
 * The Management API field names, beside the file each one carries.
 *
 * `subject` and `content` follow the documented `mailer_subjects_*` /
 * `mailer_templates_*_content` pattern. The script GETs the current config
 * before it writes anything and refuses to send a field the API does not
 * already report, so a name that is wrong or has been renamed fails here with
 * something readable rather than silently doing nothing on the server.
 */
const TEMPLATES = [
  { file: 'confirmation.html', key: 'confirmation', subject: 'Confirm your email address' },
  { file: 'recovery.html', key: 'recovery', subject: 'Reset your Pevvy password' },
  { file: 'magic_link.html', key: 'magic_link', subject: 'Your Pevvy sign-in link' },
  { file: 'invite.html', key: 'invite', subject: 'You have been invited to Pevvy' },
  {
    file: 'email_change.html',
    key: 'email_change',
    subject: 'Confirm the change of email address',
  },
  {
    file: 'reauthentication.html',
    key: 'reauthentication',
    subject: 'Your Pevvy confirmation code',
  },
  {
    file: 'password_changed_notification.html',
    key: 'password_changed_notification',
    subject: 'Your Pevvy password was changed',
  },
]

/** The one field with no Dashboard equivalent. */
const NOTIFICATION_FLAGS = {
  mailer_notifications_password_changed_enabled: true,
}

function fail(message) {
  console.error(`\n  ${message}\n`)
  process.exit(1)
}

function projectRef() {
  const fromEnv = process.env.SUPABASE_PROJECT_REF
  if (fromEnv) return fromEnv.trim()

  const refFile = join(root, 'supabase', '.temp', 'project-ref')
  if (!existsSync(refFile)) {
    fail('No linked project. Run `npx supabase link` first, or set SUPABASE_PROJECT_REF.')
  }
  return readFileSync(refFile, 'utf8').trim()
}

function desiredConfig() {
  const body = { ...NOTIFICATION_FLAGS }

  for (const template of TEMPLATES) {
    const path = join(templatesDir, template.file)
    if (!existsSync(path)) {
      fail(
        `${template.file} is missing. Regenerate the templates:\n` +
          '  UPDATE_EMAIL_TEMPLATES=1 npx vitest run supabase/tests/email-templates.test.ts',
      )
    }
    body[`mailer_subjects_${template.key}`] = template.subject
    body[`mailer_templates_${template.key}_content`] = readFileSync(path, 'utf8')
  }

  return body
}

/** A value short enough to print, for the dry run. */
function summarize(value) {
  if (typeof value === 'boolean') return String(value)
  const text = String(value)
  if (text.length <= 60) return JSON.stringify(text)
  return `${JSON.stringify(text.slice(0, 48))}… (${text.length} chars)`
}

async function main() {
  const token = process.env.SUPABASE_ACCESS_TOKEN
  if (!token) {
    fail(
      'SUPABASE_ACCESS_TOKEN is not set.\n' +
        '  Create one at https://supabase.com/dashboard/account/tokens, then:\n' +
        '    $env:SUPABASE_ACCESS_TOKEN = "sbp_..."',
    )
  }

  const ref = projectRef()
  const url = `https://api.supabase.com/v1/projects/${ref}/config/auth`
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
  const apply = process.argv.includes('--apply')

  console.log(`\n  Project   ${ref}`)
  console.log(`  Mode      ${apply ? 'APPLY' : 'dry run (pass --apply to send)'}\n`)

  const currentResponse = await fetch(url, { headers })
  if (!currentResponse.ok) {
    fail(
      `Could not read the project's auth config (HTTP ${currentResponse.status}). ` +
        'Check the token and that it has access to this project.',
    )
  }
  const current = await currentResponse.json()

  const desired = desiredConfig()

  /*
   * Only send fields the API already reports. A field name that has been
   * renamed upstream would otherwise be accepted and ignored, and the first
   * sign of it would be an email that never arrives — which is exactly the bug
   * this script was written to fix.
   */
  const unknown = Object.keys(desired).filter((key) => !(key in current))
  if (unknown.length > 0) {
    fail(
      'The API does not report these fields, so they would be silently dropped:\n' +
        unknown.map((key) => `    ${key}`).join('\n') +
        '\n  Check the current field names at\n' +
        '  https://supabase.com/docs/reference/api/v1-update-auth-service-config',
    )
  }

  const changed = Object.entries(desired).filter(([key, value]) => current[key] !== value)

  if (changed.length === 0) {
    console.log('  Everything already matches. Nothing to send.\n')
    return
  }

  for (const [key, value] of changed) {
    console.log(`  ~ ${key}`)
    console.log(`      from ${summarize(current[key])}`)
    console.log(`      to   ${summarize(value)}`)
  }
  console.log('')

  if (!apply) {
    console.log('  Dry run. Re-run with --apply to send these.\n')
    return
  }

  const response = await fetch(url, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(Object.fromEntries(changed)),
  })

  if (!response.ok) {
    // The body can echo the request, which contains nothing secret here, but
    // the status is what identifies the problem.
    fail(`The API refused the change (HTTP ${response.status}).`)
  }

  console.log(`  Applied ${changed.length} field(s).\n`)
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)))
